'use client'

import { useRef, useEffect, useCallback } from 'react'
import type { Timeline, Media } from '@/payload-types'

type Scene = NonNullable<Timeline['scenes']>[number]
type Item = NonNullable<Scene['items']>[number]

const ANCHOR_POSITION: Record<string, string> = {
  'top-left':      '0% 0%',
  'top-center':    '50% 0%',
  'top-right':     '100% 0%',
  'center-left':   '0% 50%',
  'center':        '50% 50%',
  'center-right':  '100% 50%',
  'bottom-left':   '0% 100%',
  'bottom-center': '50% 100%',
  'bottom-right':  '100% 100%',
}

function resolveObjectPosition(media: string | Media): string {
  if (typeof media === 'string') return '50% 50%'
  const anchor = media.anchor
  return (anchor && ANCHOR_POSITION[anchor]) ?? '50% 50%'
}

interface SceneRendererProps {
  scene: Scene
  sceneIndex: number
  isPlaying: boolean
  onTimeUpdate?: (ms: number) => void
  onDurationDetected?: (durationMs: number) => void
  onSceneEnded?: () => void
  onTogglePlay?: () => void
}

function resolveMediaUrl(media: string | Media): string | null {
  if (typeof media === 'string') return null
  return media.url ?? null
}

function resolveMediaAlt(media: string | Media): string {
  if (typeof media === 'string') return ''
  return media.alt ?? ''
}

function isVideoItem(item: Item): item is Extract<Item, { blockType: 'video' }> {
  return item.blockType === 'video'
}

function isAudioItem(item: Item): item is Extract<Item, { blockType: 'audio' }> {
  return item.blockType === 'audio'
}


export function SceneRenderer({
  scene,
  sceneIndex,
  isPlaying,
  onTimeUpdate,
  onDurationDetected,
  onSceneEnded,
  onTogglePlay,
}: SceneRendererProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const items = scene.items ?? []
  const activeVideo = items.find(isVideoItem)
  const activeAudio = items.find(isAudioItem)

  // Report detected media duration upward
  const handleLoadedMetadata = useCallback(
    (el: HTMLVideoElement | HTMLAudioElement, startTimeSec: number) => {
      if (!onDurationDetected || !isFinite(el.duration)) return
      const itemEndMs = (startTimeSec * 1000) + (el.duration * 1000)
      onDurationDetected(itemEndMs)
    },
    [onDurationDetected],
  )

  // Sync video element with playhead
  const handleVideoTimeUpdate = useCallback(() => {
    if (!videoRef.current || !onTimeUpdate) return
    const itemStartMs = (activeVideo?.startTime ?? 0) * 1000
    onTimeUpdate(itemStartMs + videoRef.current.currentTime * 1000)
  }, [onTimeUpdate, activeVideo?.startTime])

  // Play/pause sync — re-run when scene changes (sceneIndex) so new media gets the command
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (isPlaying && video.paused) {
      video.play().catch(() => {})
    } else if (!isPlaying && !video.paused) {
      video.pause()
    }
  }, [isPlaying, sceneIndex])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying && audio.paused) {
      audio.play().catch(() => {})
    } else if (!isPlaying && !audio.paused) {
      audio.pause()
    }
  }, [isPlaying, sceneIndex])

  return (
    <section
      data-display
      data-scene-index={sceneIndex}
      aria-label={scene.title ?? `Scene ${sceneIndex + 1}`}
    >
      {activeVideo && (
        <video
          ref={videoRef}
          src={resolveMediaUrl(activeVideo.media) ?? undefined}
          onClick={onTogglePlay}
          onTimeUpdate={handleVideoTimeUpdate}
          onLoadedMetadata={() => videoRef.current && handleLoadedMetadata(videoRef.current, activeVideo.startTime ?? 0)}
          onEnded={onSceneEnded}
          preload="metadata"
          playsInline
          aria-label={activeVideo.label ?? resolveMediaAlt(activeVideo.media)}
          style={{ objectPosition: resolveObjectPosition(activeVideo.media) }}
        />
      )}

      {activeAudio && (
        <audio
          ref={audioRef}
          src={resolveMediaUrl(activeAudio.media) ?? undefined}
          onLoadedMetadata={() => audioRef.current && handleLoadedMetadata(audioRef.current, activeAudio.startTime ?? 0)}
          onEnded={onSceneEnded}
          preload="metadata"
          aria-label={activeAudio.label ?? resolveMediaAlt(activeAudio.media)}
        />
      )}
    </section>
  )
}
