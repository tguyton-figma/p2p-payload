'use client'

import { useState, useCallback, useMemo, useEffect, useId } from 'react'
import type { Timeline, Media } from '@/payload-types'
import { usePresence } from '@/hooks/usePresence'
import { useLogBuffer } from '@/hooks/useLogBuffer'
import { SceneRenderer } from './SceneRenderer'
import { PresenceMarkers } from './PresenceMarkers'

interface TimelinePlayerProps {
  timeline: Timeline
}

export function TimelinePlayer({ timeline }: TimelinePlayerProps) {
  const sessionId = useId()
  const scenes = timeline.scenes ?? []

  const [activeSceneIndex, setActiveSceneIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const [sceneDurationsMs, setSceneDurationsMs] = useState<number[]>(
    () => scenes.map(() => 0),
  )

  const totalDurationMs = useMemo(
    () => sceneDurationsMs.reduce((sum, d) => sum + d, 0),
    [sceneDurationsMs],
  )

  const handleSceneDuration = useCallback(
    (sceneIndex: number, durationMs: number) => {
      setSceneDurationsMs((prev) => {
        if (prev[sceneIndex] >= durationMs) return prev
        const next = [...prev]
        next[sceneIndex] = durationMs
        return next
      })
    },
    [],
  )

  // Preload all scene durations on mount so nav sizing is stable
  useEffect(() => {
    const cleanups: (() => void)[] = []

    scenes.forEach((scene, i) => {
      const items = scene.items ?? []
      const mediaItem = items.find((item) => item.blockType === 'video' || item.blockType === 'audio')
      if (!mediaItem || !('media' in mediaItem)) return

      const media = mediaItem.media
      const url = typeof media === 'string' ? null : (media as Media).url
      if (!url) return

      const el = document.createElement(mediaItem.blockType === 'video' ? 'video' : 'audio')
      el.preload = 'metadata'
      el.src = url

      el.addEventListener('loadedmetadata', () => {
        if (isFinite(el.duration)) {
          const startMs = ((mediaItem as { startTime?: number | null }).startTime ?? 0) * 1000
          handleSceneDuration(i, startMs + el.duration * 1000)
        }
        el.removeAttribute('src')
        el.load()
      }, { once: true })

      cleanups.push(() => {
        el.removeAttribute('src')
        el.load()
      })
    })

    return () => cleanups.forEach((fn) => fn())
  }, [scenes, handleSceneDuration])

  const sceneStartOffsetMs = useMemo(() => {
    let offset = 0
    for (let i = 0; i < activeSceneIndex; i++) {
      offset += sceneDurationsMs[i]
    }
    return offset
  }, [activeSceneIndex, sceneDurationsMs])

  const { viewers, viewerId, sendHeartbeat } = usePresence({
    timelineId: timeline.id,
  })

  const { log } = useLogBuffer({
    timelineId: timeline.id,
    sessionId,
  })

  const handleTimeUpdate = useCallback(
    (ms: number) => {
      sendHeartbeat(activeSceneIndex, sceneStartOffsetMs + ms)
    },
    [activeSceneIndex, sceneStartOffsetMs, sendHeartbeat],
  )

  const goToScene = useCallback(
    (index: number) => {
      if (index < 0 || index >= scenes.length) return
      setActiveSceneIndex(index)
      log('scene.transition', { from: activeSceneIndex, to: index })
    },
    [scenes.length, activeSceneIndex, log],
  )

  const handleSceneEnded = useCallback(() => {
    const next = activeSceneIndex < scenes.length - 1 ? activeSceneIndex + 1 : 0
    setActiveSceneIndex(next)
    log('scene.transition', { from: activeSceneIndex, to: next, auto: true })
  }, [activeSceneIndex, scenes.length, log])

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev)
  }, [])

  const activeScene = scenes[activeSceneIndex]

  return (
    <article data-timeline data-timeline-id={timeline.id}>
      {/* Display — click video to play/pause */}
      {activeScene && (
        <SceneRenderer
          scene={activeScene}
          sceneIndex={activeSceneIndex}
          isPlaying={isPlaying}
          onTimeUpdate={handleTimeUpdate}
          onDurationDetected={(ms) => handleSceneDuration(activeSceneIndex, ms)}
          onSceneEnded={handleSceneEnded}
          onTogglePlay={togglePlay}
        />
      )}

      {/* Nav — Data + Scenes */}
      <nav data-nav aria-label="Timeline navigation">
        {/* Data row — presence markers */}
        <section data-data>
          <PresenceMarkers
            viewers={viewers}
            totalDurationMs={totalDurationMs}
            currentViewerId={viewerId}
          />
        </section>

        {/* Scenes row — proportional blocks */}
        <section data-scenes>
          {scenes.map((scene, i) => {
            const grow = sceneDurationsMs[i] > 0 ? sceneDurationsMs[i] : 1
            return (
              <button
                key={scene.id ?? i}
                type="button"
                onClick={() => goToScene(i)}
                data-scene-index={i}
                data-active={i === activeSceneIndex || undefined}
                aria-current={i === activeSceneIndex ? 'true' : undefined}
                aria-label={scene.title ?? `Scene ${i + 1}`}
                style={{ flexGrow: grow }}
              />
            )
          })}
        </section>
      </nav>
    </article>
  )
}
