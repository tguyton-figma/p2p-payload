'use client'

import { useEffect, useRef } from 'react'
import type { Media } from '@/payload-types'

/** Positions beyond this threshold have their video src cleared entirely. */
const VIDEO_SRC_THRESHOLD = 3

/** Only cells within this distance of focus actually play video. */
const VIDEO_PLAY_THRESHOLD = 1

interface PaintMediaProps {
  media: Media
  /** Position relative to focus: negative = before, 0 = focused, positive = after */
  position: number
  paintL?: number | null
  paintC?: number | null
  paintH?: number | null
}

// ── Video ─────────────────────────────────────────────────────────────────────

/** Convert anchor enum (e.g. 'top-left') to CSS object-position (e.g. 'top left'). */
function anchorToObjectPosition(anchor?: string | null): string | undefined {
  if (!anchor) return undefined
  return anchor.replace('-', ' ')
}

function VideoMedia({ media, position }: { media: Media; position: number }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const absPos = Math.abs(position)
  const anchor = anchorToObjectPosition(media.anchor)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Beyond threshold: unload src entirely to free memory/bandwidth
    if (absPos >= VIDEO_SRC_THRESHOLD) {
      if (video.src) {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
      return
    }

    // Load src if not already loaded
    if (media.url && video.getAttribute('data-src') !== media.url) {
      video.setAttribute('data-src', media.url)
      video.src = media.url
      video.load()
    }

    // Play/pause based on proximity to focus
    if (absPos <= VIDEO_PLAY_THRESHOLD) {
      video.play().catch(() => {/* autoplay blocked — fine, poster shows */})
    } else {
      video.pause()
    }
  }, [absPos, media.url])

  // IntersectionObserver: pause when scrolled offscreen regardless of position
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (entry.isIntersecting) {
          if (Math.abs(position) <= VIDEO_PLAY_THRESHOLD) {
            video.play().catch(() => {})
          }
        } else {
          video.pause()
        }
      },
      { threshold: 0.1 },
    )

    observer.observe(video)
    return () => observer.disconnect()
  }, [position])

  return (
    <video
      ref={videoRef}
      data-paint-video=""
      poster={media.thumbnailURL ?? undefined}
      style={anchor ? { objectPosition: anchor } : undefined}
      muted
      loop
      playsInline
      preload={absPos <= VIDEO_PLAY_THRESHOLD ? 'auto' : 'none'}
    />
  )
}

// ── Audio waveform ─────────────────────────────────────────────────────────────

function AudioMedia({
  media,
  paintL,
  paintC,
  paintH,
}: {
  media: Media
  paintL?: number | null
  paintC?: number | null
  paintH?: number | null
}) {
  const waveform = (media as unknown as Record<string, unknown>).waveform as
    | number[]
    | null
    | undefined

  const samples = Array.isArray(waveform) && waveform.length > 0
    ? waveform
    : Array.from({ length: 128 }, () => Math.random() * 0.3 + 0.1) // placeholder bars

  const width = 400
  const height = 120
  const midY = height / 2
  const barWidth = width / samples.length

  // Build a centered bar chart as a series of rects
  const bars = samples.map((amp, i) => {
    const barH = Math.max(1, amp * height)
    return (
      <rect
        key={i}
        x={i * barWidth + barWidth * 0.1}
        y={midY - barH / 2}
        width={barWidth * 0.8}
        height={barH}
        rx={barWidth * 0.2}
      />
    )
  })

  const l = paintL ?? 0.7
  const c = paintC ?? 0.1
  const h = paintH ?? 0

  return (
    <svg
      data-paint-waveform=""
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{
        fill: `oklch(${l} ${c} ${h} / 0.4)`,
      }}
    >
      {bars}
    </svg>
  )
}

// ── Image / GIF ───────────────────────────────────────────────────────────────

function ImageMedia({ media }: { media: Media }) {
  const anchor = anchorToObjectPosition(media.anchor)

  return (
    <img
      data-paint-image=""
      src={media.url ?? undefined}
      alt={media.alt}
      loading="lazy"
      decoding="async"
      style={anchor ? { objectPosition: anchor } : undefined}
    />
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PaintMedia({ media, position, paintL, paintC, paintH }: PaintMediaProps) {
  const mime = media.mimeType ?? ''

  if (mime.startsWith('video/')) {
    return <VideoMedia media={media} position={position} />
  }

  if (mime.startsWith('audio/')) {
    return <AudioMedia media={media} paintL={paintL} paintC={paintC} paintH={paintH} />
  }

  if (mime.startsWith('image/')) {
    return <ImageMedia media={media} />
  }

  return null
}
