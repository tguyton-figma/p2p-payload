import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

// ── Types ────────────────────────────────────────────────────────────────────

export type SymbolState = 'active' | 'resting' | 'error'

export interface NaviSymbol {
  id: string
  /** CSS gradient string for the symbol's fill, e.g. 'linear-gradient(135deg, oklch(0.6 0.2 250), oklch(0.5 0.18 145))' */
  gradient: string
  state: SymbolState
  /** Label for accessibility */
  label: string
}

interface NaviState {
  dialogue: string
  symbols: NaviSymbol[]

  setDialogue: (text: string) => void
  spawnSymbol: (symbol: Omit<NaviSymbol, 'state'>) => void
  resolveSymbol: (id: string) => void
  errorSymbol: (id: string) => void
  removeSymbol: (id: string) => void
  clearSymbols: () => void
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useNaviStore = create<NaviState>()(
  subscribeWithSelector((set) => ({
    dialogue: 'I like when things are quiet..',
    symbols: [],

    setDialogue: (text) => set({ dialogue: text }),

    spawnSymbol: (symbol) =>
      set((s) => ({
        symbols: [...s.symbols, { ...symbol, state: 'active' as SymbolState }],
      })),

    resolveSymbol: (id) =>
      set((s) => ({
        symbols: s.symbols.map((sym) =>
          sym.id === id ? { ...sym, state: 'resting' as SymbolState } : sym,
        ),
      })),

    errorSymbol: (id) =>
      set((s) => ({
        symbols: s.symbols.map((sym) =>
          sym.id === id ? { ...sym, state: 'error' as SymbolState } : sym,
        ),
      })),

    removeSymbol: (id) =>
      set((s) => ({
        symbols: s.symbols.filter((sym) => sym.id !== id),
      })),

    clearSymbols: () => set({ symbols: [] }),
  })),
)
