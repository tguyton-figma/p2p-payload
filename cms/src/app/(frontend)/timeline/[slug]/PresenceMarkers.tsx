'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import type { Viewer } from '@/hooks/usePresence'

interface PresenceMarkersProps {
  viewers: Viewer[]
  totalDurationMs: number
  currentViewerId?: string
}

const COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
]

const FADE_OUT_MS = 350
const FADE_IN_MS  = 550

function hashViewer(viewerId: string): number {
  let hash = 0
  for (let i = 0; i < viewerId.length; i++) {
    hash = (hash << 5) - hash + viewerId.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function colorForViewer(viewerId: string): string {
  return COLORS[hashViewer(viewerId) % COLORS.length]
}

// Stable per-viewer blink delay (0–0.9s) so marks twinkle at different times
function blinkDelay(viewerId: string): number {
  return ((hashViewer(viewerId) % 1000) / 1000) * 900
}

// Remote viewer mark: fade out → snap to new position → fade in
function TeleportMark({
  pct, color, viewerId, displayName,
}: {
  pct: number
  color: string
  viewerId: string
  displayName: string
}) {
  const [displayPct, setDisplayPct] = useState(pct)
  const [visible, setVisible]       = useState(true)
  const latestPct = useRef(pct)
  const delay     = blinkDelay(viewerId)

  useEffect(() => {
    latestPct.current = pct

    const t1 = setTimeout(() => {
      setVisible(false)
      const t2 = setTimeout(() => {
        setDisplayPct(latestPct.current)
        setVisible(true)
      }, FADE_OUT_MS)
      return () => clearTimeout(t2)
    }, delay)

    return () => clearTimeout(t1)
  }, [pct, delay])

  return (
    <li
      data-viewer-id={viewerId}
      style={{
        left: `${displayPct}%`,
        opacity: visible ? 1 : 0,
        transition: visible
          ? `opacity ${FADE_IN_MS}ms ease-in`
          : `opacity ${FADE_OUT_MS}ms ease-out`,
      }}
      title={displayName}
    >
      <mark style={{ backgroundColor: color }} aria-label={displayName} />
    </li>
  )
}

export function PresenceMarkers({
  viewers,
  totalDurationMs,
  currentViewerId,
}: PresenceMarkersProps) {
  const allViewers = useMemo(
    () => viewers.map((v) => ({
      ...v,
      isSelf: v.viewerId === currentViewerId,
      color: colorForViewer(v.viewerId),
      pct: totalDurationMs > 0 ? Math.min((v.playheadMs / totalDurationMs) * 100, 100) : 0,
    })),
    [viewers, totalDurationMs, currentViewerId],
  )

  if (allViewers.length === 0) return null

  return (
    <nav aria-label="Active viewers" data-presence-markers>
      <ol>
        {allViewers.map((viewer) =>
          viewer.isSelf ? (
            // Own mark: no animation, always snaps to current position
            <li
              key={viewer.viewerId}
              data-viewer-id={viewer.viewerId}
              data-self
              style={{ left: `${viewer.pct}%` }}
              title={viewer.displayName}
            >
              <mark style={{ backgroundColor: viewer.color }} aria-label={viewer.displayName} />
            </li>
          ) : (
            <TeleportMark
              key={viewer.viewerId}
              pct={viewer.pct}
              color={viewer.color}
              viewerId={viewer.viewerId}
              displayName={viewer.displayName}
            />
          )
        )}
      </ol>
    </nav>
  )
}
