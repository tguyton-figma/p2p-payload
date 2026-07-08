'use client'

import { useEffect, useRef, useCallback } from 'react'

const FLUSH_INTERVAL_MS = 5_000

interface LogEvent {
  subject: string
  data?: Record<string, unknown>
}

interface UseLogBufferOptions {
  timelineId: string
  sessionId: string
  enabled?: boolean
}

export function useLogBuffer({
  timelineId,
  sessionId,
  enabled = true,
}: UseLogBufferOptions) {
  const bufferRef = useRef<LogEvent[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const flush = useCallback(async () => {
    if (bufferRef.current.length === 0) return

    const entries = bufferRef.current.splice(0)
    const body = JSON.stringify({ entries, sessionId })

    try {
      await fetch(`/api/timelines/${timelineId}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    } catch {
      // Re-queue failed entries for next flush
      bufferRef.current.unshift(...entries)
    }
  }, [timelineId, sessionId])

  const log = useCallback(
    (subject: string, data?: Record<string, unknown>) => {
      if (!enabled) return
      bufferRef.current.push({ subject, data })
    },
    [enabled],
  )

  useEffect(() => {
    if (!enabled) return

    // Periodic flush
    flushTimerRef.current = setInterval(flush, FLUSH_INTERVAL_MS)

    // Flush on tab close via sendBeacon
    function onBeforeUnload() {
      if (bufferRef.current.length === 0) return

      const body = JSON.stringify({
        entries: bufferRef.current.splice(0),
        sessionId,
      })

      navigator.sendBeacon(
        `/api/timelines/${timelineId}/logs`,
        new Blob([body], { type: 'application/json' }),
      )
    }

    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      if (flushTimerRef.current) clearInterval(flushTimerRef.current)
      // Final flush on unmount
      flush()
    }
  }, [enabled, flush, timelineId, sessionId])

  return { log }
}
