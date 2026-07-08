import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

// ── Types ────────────────────────────────────────────────────────────────────

export interface Tokens {
  duration: number
  easing: string
  gap: number
  padding: number
  radius: number
  cellRadius: number
  l0: number
  l1: number
  l2: number
  l3: number
  lBase: number
}

export const DEFAULTS: Tokens = {
  duration: 300,
  easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
  gap: 0.9,
  padding: 0.9,
  radius: 1.1,
  cellRadius: 0.7,
  l0: 0.85,
  l1: 0.55,
  l2: 0.35,
  l3: 0.20,
  lBase: 0.15,
}

export const EASING_PRESETS: Record<string, string> = {
  'ease-out-quint': 'cubic-bezier(0.22, 1, 0.36, 1)',
  'ease-out (default)': 'cubic-bezier(0.25, 1, 0.5, 1)',
  'ease-in-out': 'cubic-bezier(0.42, 0, 0.58, 1)',
  'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  'linear': 'linear',
  'ease': 'ease',
  'snappy': 'cubic-bezier(0.2, 0, 0, 1)',
}

const STORAGE_KEY = 'p2p-payload-dev-tokens'

// ── Store ────────────────────────────────────────────────────────────────────

interface TokensState extends Tokens {
  setToken: <K extends keyof Tokens>(key: K, value: Tokens[K]) => void
  resetTokens: () => void
}

// Always initialise with DEFAULTS so SSR and first client render match.
// Call `hydrateTokens()` inside a useEffect to load persisted values after hydration.
export const useTokensStore = create<TokensState>()(
  subscribeWithSelector((set) => ({
    ...DEFAULTS,

    setToken: (key, value) => set({ [key]: value } as Partial<Tokens>),
    resetTokens: () => set(DEFAULTS),
  })),
)

/** Load persisted tokens from localStorage into the store (client-only, post-hydration). */
export function hydrateTokens() {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      useTokensStore.setState({ ...DEFAULTS, ...JSON.parse(raw) })
    }
  } catch {
    // localStorage unavailable — silently skip
  }
}

// ── Persist to localStorage via subscribe ────────────────────────────────────

/** Convert tokens state to CSS custom property style object */
export function tokensToCSSVars(t: Tokens): React.CSSProperties {
  return {
    '--time-duration': `${t.duration}ms`,
    '--time-easing': t.easing,
    '--time-gap': `${t.gap}vmin`,
    '--time-padding': `${t.padding}vmin`,
    '--time-radius': `${t.radius}vmin`,
    '--cell-radius': `${t.cellRadius}vmin`,
    '--cell-l-0': String(t.l0),
    '--cell-l-1': String(t.l1),
    '--cell-l-2': String(t.l2),
    '--cell-l-3': String(t.l3),
    '--cell-l-base': String(t.lBase),
  } as React.CSSProperties
}

if (typeof window !== 'undefined') {
  useTokensStore.subscribe(
    (s) => ({
      duration: s.duration,
      easing: s.easing,
      gap: s.gap,
      padding: s.padding,
      radius: s.radius,
      cellRadius: s.cellRadius,
      l0: s.l0,
      l1: s.l1,
      l2: s.l2,
      l3: s.l3,
      lBase: s.lBase,
    }),
    (tokens) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens))
      } catch {
        // localStorage unavailable — silently skip
      }
    },
  )
}
