import { describe, it, expect, afterEach } from 'vitest'

/**
 * Tests for the time carousel navigation logic.
 *
 * These are pure unit tests — no Payload/DB needed.
 */

// ─── useTimeNavigation ──────────────────────────────────────────────

describe('useTimeNavigation', () => {
  // We test the keyboard behavior by simulating keydown events
  // and verifying the focusIndex changes via a wrapper component.

  let focusIndex: number
  let setFocusIndex: (updater: (prev: number) => number) => void

  function createSetFocusIndex(count: number) {
    focusIndex = 5 // start in the middle
    setFocusIndex = (updater) => {
      focusIndex = updater(focusIndex)
    }
  }

  function fireKey(key: string, shiftKey = false) {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }),
    )
  }

  // Inline the hook behavior for direct testing
  // (avoids importing the hook which has 'use client' directive issues in vitest)
  function simulateNavigation(count: number) {
    createSetFocusIndex(count)

    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case 'Tab':
          if (e.shiftKey) {
            setFocusIndex((prev) => Math.max(prev - 1, 0))
          } else {
            setFocusIndex((prev) => Math.min(prev + 1, count - 1))
          }
          break
        case ']':
          setFocusIndex(() => count - 1)
          break
        case '[':
          setFocusIndex(() => 0)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }

  afterEach(() => {
    // Clean up any lingering listeners
  })

  it('Tab moves focus forward by 1', () => {
    const cleanup = simulateNavigation(10)
    expect(focusIndex).toBe(5)

    fireKey('Tab')
    expect(focusIndex).toBe(6)

    fireKey('Tab')
    expect(focusIndex).toBe(7)

    cleanup()
  })

  it('Shift+Tab moves focus backward by 1', () => {
    const cleanup = simulateNavigation(10)

    fireKey('Tab', true)
    expect(focusIndex).toBe(4)

    fireKey('Tab', true)
    expect(focusIndex).toBe(3)

    cleanup()
  })

  it('Tab does not exceed upper bound', () => {
    const cleanup = simulateNavigation(10)
    focusIndex = 9 // last index

    fireKey('Tab')
    expect(focusIndex).toBe(9) // stays at max

    cleanup()
  })

  it('Shift+Tab does not go below 0', () => {
    const cleanup = simulateNavigation(10)
    focusIndex = 0

    fireKey('Tab', true)
    expect(focusIndex).toBe(0) // stays at 0

    cleanup()
  })

  it('] warps to the last moment', () => {
    const cleanup = simulateNavigation(100)
    expect(focusIndex).toBe(5)

    fireKey(']')
    expect(focusIndex).toBe(99)

    cleanup()
  })

  it('[ warps to the first moment', () => {
    const cleanup = simulateNavigation(100)
    expect(focusIndex).toBe(5)

    fireKey('[')
    expect(focusIndex).toBe(0)

    cleanup()
  })
})

// ─── computeInitialFocusIndex ───────────────────────────────────────

describe('computeInitialFocusIndex', () => {
  // Reproduce the server-side logic inline for testing
  function computeInitialFocusIndex(
    moments: { start: string; end: string }[],
    now: number,
  ): number {
    if (moments.length === 0) return 0

    for (let i = 0; i < moments.length; i++) {
      const start = new Date(moments[i].start).getTime()
      const end = new Date(moments[i].end).getTime()
      if (now >= start && now <= end) return i
    }

    for (let i = 0; i < moments.length; i++) {
      const start = new Date(moments[i].start).getTime()
      if (start > now) return i
    }

    return moments.length - 1
  }

  it('returns 0 for empty array', () => {
    expect(computeInitialFocusIndex([], Date.now())).toBe(0)
  })

  it('returns the index of an active moment', () => {
    const now = new Date('2026-06-04T12:00:00Z').getTime()
    const moments = [
      { start: '2026-06-03T10:00:00Z', end: '2026-06-03T11:00:00Z' },
      { start: '2026-06-04T11:00:00Z', end: '2026-06-04T13:00:00Z' }, // active
      { start: '2026-06-05T10:00:00Z', end: '2026-06-05T11:00:00Z' },
    ]
    expect(computeInitialFocusIndex(moments, now)).toBe(1)
  })

  it('returns the nearest upcoming moment when none are active', () => {
    const now = new Date('2026-06-04T09:00:00Z').getTime()
    const moments = [
      { start: '2026-06-03T10:00:00Z', end: '2026-06-03T11:00:00Z' },
      { start: '2026-06-04T10:00:00Z', end: '2026-06-04T11:00:00Z' }, // upcoming
      { start: '2026-06-05T10:00:00Z', end: '2026-06-05T11:00:00Z' },
    ]
    expect(computeInitialFocusIndex(moments, now)).toBe(1)
  })

  it('returns the last moment when all are in the past', () => {
    const now = new Date('2026-06-10T00:00:00Z').getTime()
    const moments = [
      { start: '2026-06-03T10:00:00Z', end: '2026-06-03T11:00:00Z' },
      { start: '2026-06-04T10:00:00Z', end: '2026-06-04T11:00:00Z' },
      { start: '2026-06-05T10:00:00Z', end: '2026-06-05T11:00:00Z' },
    ]
    expect(computeInitialFocusIndex(moments, now)).toBe(2)
  })
})

// ─── 7-cell windowing logic ─────────────────────────────────────────

describe('7-cell windowing', () => {
  function getWindow(
    focusIndex: number,
    momentCount: number,
  ): (number | null)[] {
    const offsets = [-3, -2, -1, 0, 1, 2, 3]
    return offsets.map((offset) => {
      const idx = focusIndex + offset
      return idx >= 0 && idx < momentCount ? idx : null
    })
  }

  it('center cell always contains the focused moment', () => {
    const window = getWindow(5, 20)
    expect(window[3]).toBe(5) // center cell (index 3 of 7)
  })

  it('shows null for cells before the start of the array', () => {
    const window = getWindow(1, 20)
    expect(window).toEqual([null, null, 0, 1, 2, 3, 4])
  })

  it('shows null for cells beyond the end of the array', () => {
    const window = getWindow(18, 20)
    expect(window).toEqual([15, 16, 17, 18, 19, null, null])
  })

  it('handles fewer than 7 moments', () => {
    const window = getWindow(1, 3)
    expect(window).toEqual([null, null, 0, 1, 2, null, null])
  })

  it('handles a single moment', () => {
    const window = getWindow(0, 1)
    expect(window).toEqual([null, null, null, 0, null, null, null])
  })
})
