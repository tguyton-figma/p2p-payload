'use client'

import { useEffect, useRef, type RefObject } from 'react'
import type { TimeStore } from '@/stores/time'
import { useTimeStore as defaultStore } from '@/stores/time'

interface UsePointerSpinOptions {
  /** Ref to the [data-time] container element */
  containerRef: RefObject<HTMLElement | null>
  /** Optional store instance (defaults to the singleton) */
  store?: TimeStore
}

interface Sample {
  position: number
  time: number
}

/** Tuning constants */
const FRICTION = 0.94
const MIN_VELOCITY = 0.3
const VELOCITY_SCALE = 0.15
const SAMPLE_WINDOW = 5

/**
 * Pointer drag-to-spin with inertia for the time carousel.
 *
 * Press and drag to slide items through the grid 1:1.
 * Release with velocity to flick — carousel continues spinning
 * with friction-based deceleration until it settles.
 */
export function usePointerSpin({ containerRef, store = defaultStore }: UsePointerSpinOptions) {
  const stateRef = useRef({
    dragging: false,
    startPos: 0,
    accumulator: 0,
    samples: [] as Sample[],
    inertiaRaf: 0,
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function getPosition(e: PointerEvent): number {
      return store.getState().direction === 'x' ? e.clientX : e.clientY
    }

    function getCellSize(): number {
      if (!el) return 100
      const total = store.getState().direction === 'x' ? el.clientWidth : el.clientHeight
      // The fr scale sums to 1+3+7+15+7+3+1 = 37
      // The center cell is 15/37 of total, but for drag sensitivity
      // we use the average cell size as the step threshold
      return total / 7
    }

    function shift(delta: number) {
      store.getState().shift(-delta)
    }

    function stopInertia() {
      if (stateRef.current.inertiaRaf) {
        cancelAnimationFrame(stateRef.current.inertiaRaf)
        stateRef.current.inertiaRaf = 0
      }
    }

    function startInertia(velocity: number) {
      let v = velocity
      let residual = 0

      function tick() {
        v *= FRICTION
        if (Math.abs(v) < MIN_VELOCITY) {
          stateRef.current.inertiaRaf = 0
          return
        }

        residual += v
        const steps = Math.trunc(residual)
        if (steps !== 0) {
          residual -= steps
          // Negative velocity = dragging in positive direction = go forward
          shift(-steps)
        }

        stateRef.current.inertiaRaf = requestAnimationFrame(tick)
      }

      stateRef.current.inertiaRaf = requestAnimationFrame(tick)
    }

    function onPointerDown(e: PointerEvent) {
      // Only primary button
      if (e.button !== 0) return

      stopInertia()

      const s = stateRef.current
      s.dragging = true
      s.startPos = getPosition(e)
      s.accumulator = 0
      s.samples = [{ position: getPosition(e), time: performance.now() }]

      el!.setPointerCapture(e.pointerId)
      el!.setAttribute('data-dragging', '')
    }

    function onPointerMove(e: PointerEvent) {
      const s = stateRef.current
      if (!s.dragging) return

      const pos = getPosition(e)
      const delta = pos - s.startPos
      const cellSize = getCellSize()

      s.accumulator += delta
      s.startPos = pos

      // Track samples for velocity computation
      const now = performance.now()
      s.samples.push({ position: pos, time: now })
      if (s.samples.length > SAMPLE_WINDOW) {
        s.samples.shift()
      }

      // Step when accumulator crosses cell threshold
      const steps = Math.trunc(s.accumulator / cellSize)
      if (steps !== 0) {
        s.accumulator -= steps * cellSize
        // Drag right (positive delta) = go backward in time (prev moments)
        shift(-steps)
      }
    }

    function onPointerUp(e: PointerEvent) {
      const s = stateRef.current
      if (!s.dragging) return

      s.dragging = false
      el!.removeAttribute('data-dragging')

      // Compute release velocity from recent samples
      if (s.samples.length >= 2) {
        const first = s.samples[0]
        const last = s.samples[s.samples.length - 1]
        const dt = last.time - first.time
        if (dt > 0) {
          const dp = last.position - first.position
          const velocity = (dp / dt) * VELOCITY_SCALE * 16 // normalize to ~per-frame
          if (Math.abs(velocity) > MIN_VELOCITY) {
            startInertia(velocity)
          }
        }
      }
    }

    function onPointerCancel(e: PointerEvent) {
      const s = stateRef.current
      s.dragging = false
      el!.removeAttribute('data-dragging')
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)

    return () => {
      stopInertia()
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [containerRef, store])
}
