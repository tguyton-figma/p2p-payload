import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

// ── Types ────────────────────────────────────────────────────────────────────

export type Direction = 'x' | 'y'

export interface TimeState {
  focusIndex: number
  direction: Direction
  itemCount: number

  /** Initialize with item count and starting focus. Call once on mount. */
  init: (itemCount: number, initialFocusIndex: number) => void

  /** Jump to a specific item index. */
  jumpTo: (index: number) => void

  /** Move focus by a delta (positive = forward, negative = backward). */
  shift: (delta: number) => void

  /** Move to the next item. */
  next: () => void

  /** Move to the previous item. */
  prev: () => void

  /** Warp to the first item. */
  warpFirst: () => void

  /** Warp to the last item. */
  warpLast: () => void

  /** Toggle between horizontal and vertical layout. */
  toggleDirection: () => void
}

export type TimeStore = UseBoundStore<StoreApi<TimeState>>

export function createTimeStore(): TimeStore {
  return create<TimeState>()(
    subscribeWithSelector((set, get) => ({
      focusIndex: 0,
      direction: 'x' as Direction,
      itemCount: 0,

      init: (itemCount, initialFocusIndex) => {
        set({ itemCount, focusIndex: initialFocusIndex })
      },

      jumpTo: (index) => {
        const { itemCount } = get()
        set({ focusIndex: Math.max(0, Math.min(itemCount - 1, index)) })
      },

      shift: (delta) => {
        const { focusIndex, itemCount } = get()
        set({ focusIndex: Math.max(0, Math.min(itemCount - 1, focusIndex + delta)) })
      },

      next: () => get().shift(1),
      prev: () => get().shift(-1),
      warpFirst: () => set({ focusIndex: 0 }),
      warpLast: () => set((s) => ({ focusIndex: Math.max(0, s.itemCount - 1) })),
      toggleDirection: () => set((s) => ({ direction: s.direction === 'x' ? 'y' : 'x' })),
    })),
  )
}

/** Default singleton instance for backwards compatibility (used by /book) */
export const useTimeStore = createTimeStore()
