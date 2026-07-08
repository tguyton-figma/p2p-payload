import type { PayloadRequest } from 'payload'
import type { Media } from '@/payload-types'
import { ensureFfmpeg } from '@/hooks/mediaProcessing'
import { generateThumbnailAsync } from '@/hooks/generateVideoThumbnail'
import { extractColorAsync } from '@/hooks/extractMediaColor'
import { generateWaveformAsync } from '@/hooks/generateAudioWaveform'
import { probeMediaMetaAsync } from '@/hooks/probeMediaMeta'

/**
 * `enrich-media` job task handler (Figma Cloud Jobs).
 *
 * Runs as its own Figma-managed invocation after a media upload, decoupled from
 * the upload request: large files never block the response, and the heavy work
 * is not bound by the upload's serverless lifecycle.
 *
 * Dependency graph:
 *   video:  thumbnail → color   (sequential — color reads the thumbnail)
 *   audio:  waveform ∥ color    (parallel — independent)
 *   image:  color               (single job)
 *
 * Each sub-job's error is captured to `_processingErrors` (surfaced by the
 * admin polling UI). If any sub-job failed, the handler throws so Payload
 * retries the task; already-populated fields are skipped on the re-run, so
 * successful work is never repeated.
 */

type Req = PayloadRequest
type JobResult = { job: string; ok: true } | { job: string; ok: false; error: string }

async function runJob(name: string, fn: () => Promise<void>): Promise<JobResult> {
  try {
    await fn()
    return { job: name, ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { job: name, ok: false, error: message }
  }
}

async function writeErrors(docId: string, results: JobResult[], req: Req): Promise<void> {
  const errors: Record<string, string> = {}
  for (const r of results) {
    if (!r.ok) errors[r.job] = r.error
  }

  // Defense-in-depth: this is a metadata-only write on the parent media doc, so
  // it must never carry a file buffer. If an earlier sub-job left `req.file` set
  // (e.g. a thumbnail create that threw before clearing it), a stray buffer here
  // would be re-persisted onto the doc's own storage key. Clearing it guarantees
  // this write only touches `_processingErrors`.
  req.file = undefined

  await req.payload.update({
    collection: 'media',
    id: docId,
    data: {
      _processingErrors: Object.keys(errors).length > 0 ? errors : null,
    } as Record<string, unknown>,
    context: { skipEnrichment: true },
    req,
  })
}

// ── Pipelines ────────────────────────────────────────────────────────────────

async function enrichVideo(doc: Media, req: Req): Promise<void> {
  const logger = req.payload.logger
  const results: JobResult[] = []

  // Probe and thumbnail run in parallel (both independent, both need FFmpeg)
  const parallelJobs: Promise<JobResult>[] = []

  if (!doc.thumbnailURL) {
    if (!ensureFfmpeg('enrich')) {
      results.push({ job: 'thumbnail', ok: false, error: 'FFmpeg not available' })
    } else {
      parallelJobs.push(runJob('thumbnail', () => generateThumbnailAsync(doc, req)))
    }
  } else {
    results.push({ job: 'thumbnail', ok: true })
  }

  const existingDuration = (doc as unknown as Record<string, unknown>).durationSeconds
  if (existingDuration == null) {
    if (!ensureFfmpeg('enrich')) {
      results.push({ job: 'probe', ok: false, error: 'FFmpeg not available' })
    } else {
      parallelJobs.push(runJob('probe', () => probeMediaMetaAsync(doc, req)))
    }
  } else {
    results.push({ job: 'probe', ok: true })
  }

  const settled = await Promise.allSettled(parallelJobs)
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      results.push(s.value)
    } else {
      results.push({ job: 'unknown', ok: false, error: String(s.reason) })
    }
  }

  const existing = (doc as unknown as Record<string, unknown>).dominantColor as
    | { l?: number }
    | undefined
  if (existing?.l == null) {
    let freshDoc: Media
    try {
      freshDoc = (await req.payload.findByID({
        collection: 'media',
        id: doc.id,
        depth: 0,
        overrideAccess: true,
      })) as Media
    } catch {
      freshDoc = doc
    }

    const colorResult = await runJob('color', () => extractColorAsync(freshDoc, req))
    results.push(colorResult)
  } else {
    results.push({ job: 'color', ok: true })
  }

  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    logger.error(`[enrich] Video ${doc.id}: ${failed.length} job(s) failed`)
  } else {
    logger.info(`[enrich] Video ${doc.id}: all jobs complete`)
  }

  await writeErrors(doc.id, results, req)
}

async function enrichAudio(doc: Media, req: Req): Promise<void> {
  const logger = req.payload.logger
  const results: JobResult[] = []

  const jobs: Promise<JobResult>[] = []

  const existingWaveform = (doc as unknown as Record<string, unknown>).waveform
  if (!Array.isArray(existingWaveform) || existingWaveform.length === 0) {
    if (!ensureFfmpeg('enrich')) {
      results.push({ job: 'waveform', ok: false, error: 'FFmpeg not available' })
    } else {
      jobs.push(runJob('waveform', () => generateWaveformAsync(doc, req)))
    }
  }

  const existingColor = (doc as unknown as Record<string, unknown>).dominantColor as
    | { l?: number }
    | undefined
  if (existingColor?.l == null) {
    if (!ensureFfmpeg('enrich')) {
      results.push({ job: 'color', ok: false, error: 'FFmpeg not available' })
    } else {
      jobs.push(runJob('color', () => extractColorAsync(doc, req)))
    }
  }

  const existingDuration = (doc as unknown as Record<string, unknown>).durationSeconds
  if (existingDuration == null) {
    if (!ensureFfmpeg('enrich')) {
      results.push({ job: 'probe', ok: false, error: 'FFmpeg not available' })
    } else {
      jobs.push(runJob('probe', () => probeMediaMetaAsync(doc, req)))
    }
  }

  const settled = await Promise.allSettled(jobs)
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      results.push(s.value)
    } else {
      results.push({ job: 'unknown', ok: false, error: String(s.reason) })
    }
  }

  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    logger.error(`[enrich] Audio ${doc.id}: ${failed.length} job(s) failed`)
  } else {
    logger.info(`[enrich] Audio ${doc.id}: all jobs complete`)
  }

  await writeErrors(doc.id, results, req)
}

async function enrichImage(doc: Media, req: Req): Promise<void> {
  const logger = req.payload.logger
  const results: JobResult[] = []

  const existing = (doc as unknown as Record<string, unknown>).dominantColor as
    | { l?: number }
    | undefined
  if (existing?.l == null) {
    const colorResult = await runJob('color', () => extractColorAsync(doc, req))
    results.push(colorResult)
  }

  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    logger.error(`[enrich] Image ${doc.id}: ${failed.length} job(s) failed`)
  } else {
    logger.info(`[enrich] Image ${doc.id}: all jobs complete`)
  }

  await writeErrors(doc.id, results, req)
}

// ── Task entry point ───────────────────────────────────────────────────────

export interface EnrichMediaTaskInput {
  mediaId: string
}

/**
 * Job handler invoked by Payload/Figma for the `enrich-media` task. Loads the
 * media doc fresh, runs the mime-appropriate pipeline, and throws if any
 * sub-job recorded an error so the task is retried.
 */
export async function enrichMediaTask({
  input,
  req,
}: {
  input: EnrichMediaTaskInput
  req: Req
}): Promise<{ output: Record<string, never> }> {
  const logger = req.payload.logger
  const { mediaId } = input

  const doc = (await req.payload
    .findByID({ collection: 'media', id: mediaId, depth: 0, overrideAccess: true })
    .catch(() => null)) as Media | null

  if (!doc) {
    throw new Error(`[enrich] media ${mediaId} not found`)
  }

  const mime = doc.mimeType ?? ''
  if (mime.startsWith('video/')) {
    await enrichVideo(doc, req)
  } else if (mime.startsWith('audio/')) {
    await enrichAudio(doc, req)
  } else if (mime.startsWith('image/')) {
    await enrichImage(doc, req)
  } else {
    logger.info(`[enrich] media ${mediaId} mime "${mime}" is not enrichable; nothing to do`)
    return { output: {} }
  }

  // Re-read to surface hard failures: if any sub-job recorded an error, throw
  // so Payload retries the task (populated fields are skipped on the re-run).
  const fresh = (await req.payload.findByID({
    collection: 'media',
    id: mediaId,
    depth: 0,
    overrideAccess: true,
  })) as Media
  const errs = (fresh as unknown as Record<string, unknown>)._processingErrors as
    | Record<string, string>
    | null
    | undefined
  if (errs && Object.keys(errs).length > 0) {
    throw new Error(`[enrich] sub-job(s) failed for ${mediaId}: ${Object.keys(errs).join(', ')}`)
  }

  return { output: {} }
}
