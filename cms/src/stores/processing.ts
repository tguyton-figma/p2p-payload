import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

// ── Types ────────────────────────────────────────────────────────────────────

export type JobState = 'pending' | 'done' | 'error'

export interface JobInfo {
  label: string
  field: string
  errorKey: string
  nested?: boolean
  state: JobState
  errorMessage?: string
}

export interface FieldUpdate {
  path: string
  value: unknown
}

interface TrackedDoc {
  docId: string
  mimeType: string
  jobs: JobInfo[]
  fieldUpdates: FieldUpdate[]  // pending hydration updates for the component to consume
  polling: boolean
}

// ── Job rules ────────────────────────────────────────────────────────────────

const JOB_RULES: Record<string, { label: string; field: string; errorKey: string; nested?: boolean }[]> = {
  'video/': [
    { label: 'Thumbnail', field: 'thumbnailURL', errorKey: 'thumbnail' },
    { label: 'Color', field: 'dominantColor', errorKey: 'color', nested: true },
  ],
  'image/': [
    { label: 'Color', field: 'dominantColor', errorKey: 'color', nested: true },
  ],
  'audio/': [
    { label: 'Waveform', field: 'waveform', errorKey: 'waveform' },
    { label: 'Color', field: 'dominantColor', errorKey: 'color', nested: true },
  ],
}

function getJobRules(mimeType: string) {
  for (const [prefix, jobs] of Object.entries(JOB_RULES)) {
    if (mimeType.startsWith(prefix)) return jobs
  }
  return []
}

function isPopulated(value: unknown, nested?: boolean): boolean {
  if (value == null) return false
  if (nested && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(
      (v) => v != null && v !== '',
    )
  }
  if (Array.isArray(value)) return value.length > 0
  return value !== '' && value !== false
}

// ── Store ────────────────────────────────────────────────────────────────────

const POLL_INTERVAL = 2500

interface ProcessingState {
  tracked: TrackedDoc | null

  /** Begin tracking a document's enrichment jobs. Resets any prior tracking. */
  startTracking: (docId: string, mimeType: string, currentFieldValues: Record<string, unknown>) => void

  /** Stop tracking and clear state. */
  stopTracking: () => void

  /** Consume and clear pending field updates (called by the React component). */
  consumeFieldUpdates: () => FieldUpdate[]
}

export const useProcessingStore = create<ProcessingState>()(
  subscribeWithSelector((set, get) => ({
    tracked: null,

    startTracking: (docId, mimeType, currentFieldValues) => {
      const rules = getJobRules(mimeType)
      if (rules.length === 0) return

      const jobs: JobInfo[] = rules.map((r) => ({
        ...r,
        state: isPopulated(currentFieldValues[r.field], r.nested) ? 'done' : 'pending',
      }))

      // Don't start tracking if all jobs are already done
      if (jobs.every((j) => j.state === 'done')) return

      set({
        tracked: {
          docId,
          mimeType,
          jobs,
          fieldUpdates: [],
          polling: true,
        },
      })
    },

    stopTracking: () => {
      set({ tracked: null })
    },

    consumeFieldUpdates: () => {
      const tracked = get().tracked
      if (!tracked || tracked.fieldUpdates.length === 0) return []

      const updates = [...tracked.fieldUpdates]
      set({
        tracked: { ...tracked, fieldUpdates: [] },
      })
      return updates
    },
  })),
)

// ── Poll loop (runs outside React via subscribe) ─────────────────────────────

let pollTimer: ReturnType<typeof setInterval> | null = null

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function poll() {
  const { tracked } = useProcessingStore.getState()
  if (!tracked || !tracked.polling) return

  try {
    const res = await fetch(`/api/media/${tracked.docId}?depth=0`)
    if (!res.ok) return
    const doc = await res.json()

    // Check for orchestrator errors
    const docErrors = doc._processingErrors as Record<string, string> | null | undefined
    const errorMap = (docErrors && typeof docErrors === 'object') ? docErrors : {}

    const newJobs = tracked.jobs.map((job) => {
      if (job.state === 'done') return job

      // Check for error
      if (errorMap[job.errorKey]) {
        return { ...job, state: 'error' as const, errorMessage: errorMap[job.errorKey] }
      }

      // Check for completion
      const docValue = doc[job.field]
      if (isPopulated(docValue, job.nested)) {
        return { ...job, state: 'done' as const }
      }

      return job
    })

    // Collect field updates for newly completed jobs
    const newFieldUpdates: FieldUpdate[] = []
    for (let i = 0; i < newJobs.length; i++) {
      if (tracked.jobs[i].state !== 'done' && newJobs[i].state === 'done') {
        const job = newJobs[i]
        const docValue = doc[job.field]

        if (job.nested && typeof docValue === 'object' && docValue !== null) {
          for (const [subKey, subVal] of Object.entries(docValue as Record<string, unknown>)) {
            newFieldUpdates.push({ path: `${job.field}.${subKey}`, value: subVal })
          }
        } else {
          newFieldUpdates.push({ path: job.field, value: docValue })
        }
      }
    }

    const hasPending = newJobs.some((j) => j.state === 'pending')
    const hasErrors = newJobs.some((j) => j.state === 'error')

    useProcessingStore.setState({
      tracked: {
        ...tracked,
        jobs: newJobs,
        fieldUpdates: [...tracked.fieldUpdates, ...newFieldUpdates],
        polling: hasPending && !hasErrors,
      },
    })
  } catch {
    // Silently retry on next interval
  }
}

// Start/stop polling when tracked state changes
useProcessingStore.subscribe(
  (s) => s.tracked?.polling ?? false,
  (shouldPoll) => {
    stopPoll()
    if (shouldPoll) {
      poll() // immediate first poll
      pollTimer = setInterval(poll, POLL_INTERVAL)
    }
  },
)
