'use client'

import React from 'react'
import { useFormFields } from '@payloadcms/ui'
import './styles/hero.scss'

function anchorToObjectPosition(anchor: string | null | undefined): string {
  if (!anchor || anchor === 'center') return 'center center'
  const [vertical, horizontal] = anchor.split('-')
  return `${horizontal ?? 'center'} ${vertical ?? 'center'}`
}

function formatFilesize(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function WaveformSvg({
  waveform,
  fill,
  progress,
}: {
  waveform: number[] | null | undefined
  fill: string
  progress?: number
}) {
  const samples =
    Array.isArray(waveform) && waveform.length > 0
      ? waveform
      : new Array(64).fill(0).map((_, i) => 0.14 + Math.sin(i * 0.55) * 0.08)

  const width = 640
  const height = 220
  const midY = height / 2
  const barWidth = width / samples.length

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-label="Audio waveform"
      role="img"
      style={{ display: 'block', width: '100%', height: 220 }}
    >
      <rect width="100%" height="100%" fill="oklch(0.08 0 0)" />
      {/* Progress underlay */}
      {progress != null && progress > 0 && (
        <rect
          x={0}
          y={0}
          width={progress * width}
          height={height}
          fill="oklch(0.12 0 0)"
        />
      )}
      <g opacity={0.88}>
        {samples.map((amp, i) => {
          const barH = Math.max(4, Math.min(1, Math.abs(amp)) * height * 0.78)
          const cx = i * barWidth + barWidth * 0.5
          const played = progress != null && cx / width <= progress
          return (
            <rect
              key={i}
              x={i * barWidth + barWidth * 0.15}
              y={midY - barH / 2}
              width={Math.max(2, barWidth * 0.7)}
              height={barH}
              rx={Math.max(1, barWidth * 0.25)}
              fill={played ? fill : undefined}
              opacity={played ? 1 : 0.55}
              style={played ? undefined : { fill }}
            />
          )
        })}
      </g>
    </svg>
  )
}

export const MediaHero: React.FC = () => {
  const { mimeType, url, thumbnailURL, waveform, dominantColor, anchor, filename, filesize } =
    useFormFields(([fields]) => ({
      mimeType: fields.mimeType?.value as string | null | undefined,
      url: fields.url?.value as string | null | undefined,
      thumbnailURL: fields.thumbnailURL?.value as string | null | undefined,
      waveform: fields.waveform?.value as number[] | null | undefined,
      dominantColor: fields.dominantColor?.value as
        | { l?: number | null; c?: number | null; h?: number | null }
        | null
        | undefined,
      anchor: fields.anchor?.value as string | null | undefined,
      filename: fields.filename?.value as string | null | undefined,
      filesize: fields.filesize?.value as number | null | undefined,
    }))

  const [audioProgress, setAudioProgress] = React.useState<number>(0)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const audioRef = React.useRef<HTMLAudioElement | null>(null)

  const mime = mimeType ?? ''
  const isImage = mime.startsWith('image/')
  const isVideo = mime.startsWith('video/')
  const isAudio = mime.startsWith('audio/')

  // No preview possible without a URL or recognized type
  if (!url && !isAudio) return null
  if (!isImage && !isVideo && !isAudio) return null

  const l = dominantColor?.l ?? 0.52
  const c = dominantColor?.c ?? 0.12
  const h = dominantColor?.h ?? 270
  const fill = `oklch(${l} ${c} ${h})`

  const sizeLabel = formatFilesize(filesize)

  // Audio playback handlers
  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !url) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audioRef.current.currentTime = pct * audioRef.current.duration
    if (!isPlaying) {
      audioRef.current.play()
      setIsPlaying(true)
    }
  }

  const toggleAudioPlayback = () => {
    if (!audioRef.current || !url) return
    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.play()
      setIsPlaying(true)
    }
  }

  return (
    <div className="hero-card">
      <div className="hero-card__media">
        {isImage && url && (
          <img
            src={url}
            alt={filename ?? ''}
            style={{ objectPosition: anchorToObjectPosition(anchor) }}
          />
        )}

        {isVideo && (
          <video
            src={url ?? undefined}
            poster={thumbnailURL ?? undefined}
            controls
            preload="metadata"
            style={{ maxHeight: 420, width: '100%', background: 'oklch(0.06 0 0)' }}
          />
        )}

        {isAudio && (
          <>
            <div
              style={{ width: '100%', cursor: 'pointer' }}
              onClick={handleWaveformClick}
              role="slider"
              aria-label="Audio waveform scrubber"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(audioProgress * 100)}
              tabIndex={0}
            >
              <WaveformSvg waveform={waveform} fill={fill} progress={audioProgress} />
            </div>
            {url && (
              <audio
                ref={audioRef}
                src={url}
                preload="metadata"
                onTimeUpdate={() => {
                  if (audioRef.current && audioRef.current.duration) {
                    setAudioProgress(audioRef.current.currentTime / audioRef.current.duration)
                  }
                }}
                onEnded={() => {
                  setIsPlaying(false)
                  setAudioProgress(0)
                }}
              />
            )}
          </>
        )}

        {/* Overlay with filename, filesize, and play button for audio */}
        <div className="hero-card__overlay">
          <span className="hero-card__overlay-text">
            {filename}
            {sizeLabel ? ` · ${sizeLabel}` : ''}
          </span>
          {isAudio && url && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggleAudioPlayback()
              }}
              style={{
                pointerEvents: 'auto',
                appearance: 'none',
                border: 'none',
                background: 'oklch(0.2 0 0 / 0.7)',
                color: 'oklch(0.9 0 0)',
                borderRadius: '50%',
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: '1rem',
                flexShrink: 0,
              }}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
