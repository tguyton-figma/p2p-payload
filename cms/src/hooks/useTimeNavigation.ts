'use client'

import { useEffect, useRef, type RefObject } from 'react'
import type { TimeStore } from '@/stores/time'
import { useTimeStore as defaultStore } from '@/stores/time'

/**
 * Keyboard and gamepad navigation for the time carousel.
 *
 * Keyboard events are **scoped to the container** — only fires when the
 * container element (or a descendant) has focus. This prevents multiple
 * Time instances on the same page from all responding to the same keypress.
 *
 * Keyboard:
 *   Tab        → next item
 *   Shift+Tab  → previous item
 *   ]          → warp to last item
 *   [          → warp to first item
 *
 * Gamepad polling remains global (only one gamepad context at a time).
 */
export function useTimeNavigation(
  store: TimeStore = defaultStore,
  containerRef?: RefObject<HTMLElement | null>,
) {
  const lastGamepadShift = useRef(0)

  // Keyboard — scoped to container
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const { next, prev, warpFirst, warpLast } = store.getState()
      switch (e.key) {
        case 'Tab':
          e.preventDefault()
          if (e.shiftKey) prev()
          else next()
          break
        case ']':
          e.preventDefault()
          warpLast()
          break
        case '[':
          e.preventDefault()
          warpFirst()
          break
      }
    }

    const el = containerRef?.current
    if (el) {
      // Scoped: listen on the container element only
      el.addEventListener('keydown', handleKeyDown)
      return () => el.removeEventListener('keydown', handleKeyDown)
    } else {
      // Fallback for single-instance usage (e.g. /book fullscreen)
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [store, containerRef])

  // Gamepad polling (global — only one gamepad context at a time)
  useEffect(() => {
    let rafId: number
    const DEADZONE = 0.4
    const COOLDOWN_MS = 200

    function poll() {
      const gamepads = navigator.getGamepads?.()
      if (!gamepads) {
        rafId = requestAnimationFrame(poll)
        return
      }

      const now = performance.now()
      for (const gp of gamepads) {
        if (!gp) continue

        const dpadLeft = gp.buttons[14]?.pressed
        const dpadRight = gp.buttons[15]?.pressed
        const stickX = gp.axes[0] ?? 0

        let direction = 0
        if (dpadRight || stickX > DEADZONE) direction = 1
        else if (dpadLeft || stickX < -DEADZONE) direction = -1

        if (direction !== 0 && now - lastGamepadShift.current > COOLDOWN_MS) {
          lastGamepadShift.current = now
          const { next, prev } = store.getState()
          if (direction > 0) next()
          else prev()
        }
      }

      rafId = requestAnimationFrame(poll)
    }

    rafId = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(rafId)
  }, [store])
}
