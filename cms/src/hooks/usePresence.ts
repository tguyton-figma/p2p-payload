'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

const POLL_INTERVAL_MS = 5_000

export interface Viewer {
  viewerId: string
  displayName: string
  avatarUrl: string | null
  sceneIndex: number
  playheadMs: number
  lastSeen: number
}

interface UsePresenceOptions {
  timelineId: string
  enabled?: boolean
}

interface UsePresenceReturn {
  viewers: Viewer[]
  viewerId: string
  isConnected: boolean
  sendHeartbeat: (sceneIndex: number, playheadMs: number) => void
}

// Generate a unique ID per browser tab, persisted for the tab's lifetime
function initViewerId(): string {
  try {
    const key = '__timeline_viewer_id'
    let id = sessionStorage.getItem(key)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(key, id)
    }
    return id
  } catch {
    // SSR or sessionStorage unavailable
    return ''
  }
}

export function usePresence({
  timelineId,
  enabled = true,
}: UsePresenceOptions): UsePresenceReturn {
  const [viewers, setViewers] = useState<Viewer[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [viewerId] = useState(initViewerId)
  const positionRef = useRef({ sceneIndex: 0, playheadMs: 0 })
  const inFlightRef = useRef(false)

  const sendHeartbeat = useCallback(
    (sceneIndex: number, playheadMs: number) => {
      positionRef.current = { sceneIndex, playheadMs }
    },
    [],
  )

  useEffect(() => {
    if (!enabled || !viewerId) return

    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function tick() {
      if (stopped || inFlightRef.current) return
      inFlightRef.current = true

      try {
        // POST heartbeat with current position
        const res = await fetch(`/api/timelines/${timelineId}/presence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            viewerId,
            ...positionRef.current,
          }),
        })

        if (res.ok) {
          const data = await res.json()
          // POST returns the full viewer list, no need for a separate GET
          if (!stopped) {
            setViewers(data.viewers ?? [])
            setIsConnected(true)
          }
        }
      } catch {
        if (!stopped) setIsConnected(false)
      } finally {
        inFlightRef.current = false
        // Schedule next tick only after current one finishes
        if (!stopped) timer = setTimeout(tick, POLL_INTERVAL_MS)
      }
    }

    // Pause when tab is hidden, resume immediately when visible
    function onVisibility() {
      if (document.visibilityState === 'visible') {
        if (!timer && !stopped) tick()
      } else {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    // Start the first tick
    tick()

    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (timer) clearTimeout(timer)
    }
  }, [timelineId, viewerId, enabled])

  return { viewers, viewerId, isConnected, sendHeartbeat }
}
