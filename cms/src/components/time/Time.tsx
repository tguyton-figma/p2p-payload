'use client'

import React, { useEffect, useRef } from 'react'
import type { TimeStore } from '@/stores/time'
import { useTimeStore as defaultTimeStore } from '@/stores/time'
import { useTokensStore, tokensToCSSVars } from '@/stores/tokens'
import { useTimeNavigation } from '@/hooks/useTimeNavigation'
import { usePointerSpin } from '@/hooks/usePointerSpin'
import { buildTemplate } from './buildTemplate'

const CHUNK = 500
const LOAD_AHEAD = 100

interface TimeProps<T> {
  items: T[]
  renderCell: (item: T, position: number, onSelect: () => void) => React.ReactNode
  keyExtractor?: (item: T, index: number) => string | number
  store?: TimeStore
  direction?: 'x' | 'y'
  initialFocusIndex?: number
  /** When true, apply tunable tokens from the tokens store as inline styles.
   *  Only needed for the /book DevPanel. Admin panels use CSS defaults. */
  useTokens?: boolean
}

export function Time<T>({
  items,
  renderCell,
  keyExtractor,
  store,
  direction: directionProp,
  initialFocusIndex = 0,
  useTokens = false,
}: TimeProps<T>) {
  const timeStore = store ?? defaultTimeStore
  const containerRef = useRef<HTMLElement>(null)

  // Initialize store on mount
  const init = timeStore((s) => s.init)
  useEffect(() => {
    init(items.length, initialFocusIndex)
  }, [items.length, initialFocusIndex, init])

  // Set direction if provided
  useEffect(() => {
    if (directionProp) {
      const current = timeStore.getState().direction
      if (current !== directionProp) {
        timeStore.setState({ direction: directionProp })
      }
    }
  }, [directionProp, timeStore])

  const focusIndex = timeStore((s) => s.focusIndex)
  const direction = timeStore((s) => s.direction)
  const toggleDirection = timeStore((s) => s.toggleDirection)
  const jumpTo = timeStore((s) => s.jumpTo)

  // Subscribe unconditionally to satisfy the rules of hooks, but only apply the
  // tokens when useTokens is enabled (avoids hydration mismatch from
  // localStorage-persisted DevPanel values differing from server defaults).
  const tokens = useTokensStore()
  const tokenStyle = useTokens ? tokensToCSSVars(tokens) : {}

  const n = items.length

  useTimeNavigation(timeStore, containerRef)
  usePointerSpin({ containerRef, store: timeStore })

  // ── Progressive chunking ──────────────────────────────────────────────────
  const loaded = useRef({ start: 0, end: 0, init: false })

  if (!loaded.current.init) {
    const s = Math.max(0, initialFocusIndex - Math.floor(CHUNK / 2))
    loaded.current = { start: s, end: Math.min(n, s + CHUNK), init: true }
  }

  let { start: ls, end: le } = loaded.current

  if (n > 0 && (focusIndex < ls || focusIndex >= le)) {
    ls = Math.max(0, focusIndex - Math.floor(CHUNK / 2))
    le = Math.min(n, ls + CHUNK)
  }

  if (focusIndex - ls < LOAD_AHEAD && ls > 0) {
    ls = Math.max(0, ls - CHUNK)
  }
  if (le - focusIndex < LOAD_AHEAD && le < n) {
    le = Math.min(n, le + CHUNK)
  }

  loaded.current = { start: ls, end: le, init: true }

  const slice = items.slice(ls, le)
  const focusInSlice = focusIndex - ls

  let gridTemplate: string
  let cells: React.ReactNode

  if (n === 0) {
    gridTemplate = '1fr'
    cells = <div data-no-moments="">No items</div>
  } else {
    gridTemplate = buildTemplate(slice.length, focusInSlice)
    cells = slice.map((item, i) => {
      const position = i - focusInSlice
      const key = keyExtractor ? keyExtractor(item, ls + i) : ls + i
      return (
        <React.Fragment key={key}>
          {renderCell(item, position, () => jumpTo(ls + i))}
        </React.Fragment>
      )
    })
  }

  return (
    <section
      ref={containerRef}
      data-time=""
      data-direction={direction}
      data-carousel={n > 7 ? '' : undefined}
      onKeyDown={(e) => {
        if (e.key === '\\') {
          e.preventDefault()
          toggleDirection()
        }
      }}
      tabIndex={0}
      style={{
        ...tokenStyle,
        gridTemplateColumns: direction === 'x' ? gridTemplate : '1fr',
        gridTemplateRows: direction === 'y' ? gridTemplate : '1fr',
      }}
    >
      {cells}
    </section>
  )
}
