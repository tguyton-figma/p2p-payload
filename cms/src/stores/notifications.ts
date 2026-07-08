import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

// ── Types ────────────────────────────────────────────────────────────────────

export type NotificationType = 'success' | 'error' | 'info' | 'warning' | 'loading' | 'default'

export type NotificationPhase = 'entering' | 'visible' | 'exiting' | 'dismissed'

export interface Notification {
  id: string
  type: NotificationType
  message: string
  description?: string
  phase: NotificationPhase
  createdAt: number
}

// ── Config ───────────────────────────────────────────────────────────────────

const ENTER_MS = 300      // entering → visible
const AUTO_DISMISS_MS = 4000  // visible → exiting (for non-loading toasts)
const EXIT_MS = 300       // exiting → dismissed (removed from array)

// ── Store ────────────────────────────────────────────────────────────────────

interface NotificationState {
  notifications: Notification[]
  push: (n: Omit<Notification, 'phase' | 'createdAt'>) => void
  transition: (id: string, phase: NotificationPhase) => void
  dismiss: (id: string) => void
  clear: () => void
}

export const useNotificationStore = create<NotificationState>()(
  subscribeWithSelector((set, get) => ({
    notifications: [],

    push: (n) => {
      // Dedupe — if the same id is already present, skip
      if (get().notifications.some((existing) => existing.id === n.id)) return

      set((s) => ({
        notifications: [
          ...s.notifications,
          { ...n, phase: 'entering' as const, createdAt: Date.now() },
        ],
      }))
    },

    transition: (id, phase) => {
      set((s) => ({
        notifications: phase === 'dismissed'
          ? s.notifications.filter((n) => n.id !== id)
          : s.notifications.map((n) => (n.id === id ? { ...n, phase } : n)),
      }))
    },

    dismiss: (id) => {
      const n = get().notifications.find((n) => n.id === id)
      if (!n || n.phase === 'exiting' || n.phase === 'dismissed') return
      get().transition(id, 'exiting')
    },

    clear: () => set({ notifications: [] }),
  })),
)

// ── Lifecycle timers (runs outside React) ────────────────────────────────────
// Subscribe to the notifications array and manage phase transitions with timers.

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function clearTimer(id: string) {
  const t = timers.get(id)
  if (t) {
    clearTimeout(t)
    timers.delete(id)
  }
}

useNotificationStore.subscribe(
  (s) => s.notifications,
  (notifications) => {
    const { transition } = useNotificationStore.getState()

    for (const n of notifications) {
      // Skip if we already have a timer for this notification in this phase
      const timerKey = `${n.id}:${n.phase}`
      if (timers.has(timerKey)) continue

      switch (n.phase) {
        case 'entering':
          timers.set(timerKey, setTimeout(() => {
            clearTimer(timerKey)
            transition(n.id, 'visible')
          }, ENTER_MS))
          break

        case 'visible':
          // Loading toasts don't auto-dismiss — they stay until explicitly dismissed
          if (n.type !== 'loading') {
            timers.set(timerKey, setTimeout(() => {
              clearTimer(timerKey)
              transition(n.id, 'exiting')
            }, AUTO_DISMISS_MS))
          }
          break

        case 'exiting':
          timers.set(timerKey, setTimeout(() => {
            clearTimer(timerKey)
            transition(n.id, 'dismissed')
          }, EXIT_MS))
          break
      }
    }

    // Clean up timers for dismissed/removed notifications
    const activeIds = new Set(notifications.map((n) => n.id))
    for (const key of timers.keys()) {
      const id = key.split(':')[0]
      if (!activeIds.has(id)) {
        clearTimer(key)
      }
    }
  },
)
