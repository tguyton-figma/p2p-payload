'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Moment } from '@/payload-types'
import { useTokensStore, EASING_PRESETS, hydrateTokens } from '@/stores/tokens'
import { Time } from './Time'
import './dev-panel.css'

// ─── Mock data ───────────────────────────────────────────────────────────────────────────────

function devTitle(i: number): string {
  const letter = String.fromCharCode(65 + (i % 26))
  const cycle = Math.floor(i / 26)
  return cycle === 0 ? letter : `${letter}${cycle + 1}`
}

function makeMoments(count: number): Moment[] {
  const base = Date.now()
  return Array.from({ length: count }, (_, i) => ({
    id: `dev-${i}`,
    name: devTitle(i),
    slug: `dev-${i}`,
    generateSlug: false,
    start: new Date(base + i * 3_600_000).toISOString(),
    end: new Date(base + i * 3_600_000 + 1_800_000).toISOString(),
    access: 'internal' as const,
    status: 'confirmed' as const,
    updatedAt: new Date(base).toISOString(),
    createdAt: new Date(base).toISOString(),
  }))
}

// ─── Variants ─────────────────────────────────────────────────────────────────────────────

const VARIANTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 30, 500, 1000, 10000] as const
type Variant = (typeof VARIANTS)[number]

function devFocusIndex(count: number): number {
  return count > 7 ? Math.min(3, count - 1) : 0
}

// Tokens are now managed by the Zustand tokens store (src/stores/tokens.ts)
// with automatic localStorage persistence.

// ─── FPS counter ──────────────────────────────────────────────────────────────────────────

function useFps() {
  const [fps, setFps] = useState(0)
  const frames = useRef(0)
  const last = useRef(performance.now())

  useEffect(() => {
    let raf: number

    function tick() {
      frames.current++
      const now = performance.now()
      const elapsed = now - last.current

      if (elapsed >= 500) {
        setFps(Math.round((frames.current / elapsed) * 1000))
        frames.current = 0
        last.current = now
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return fps
}

// ─── Compact slider control ───────────────────────────────────────────────────────────────

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}) {
  return (
    <label data-dev-slider="">
      <span data-dev-slider-label="">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span data-dev-slider-value="">
        {step < 1 ? value.toFixed(2) : value}
        {unit ?? ''}
      </span>
    </label>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────────────────

interface DevPanelProps {
  realMoments: Moment[]
  realFocusIndex: number
}

export function DevPanel({ realMoments, realFocusIndex }: DevPanelProps) {
  const [open, setOpen] = useState(false)
  const [variant, setVariant] = useState<Variant | null>(null)
  const tokens = useTokensStore()
  const setToken = tokens.setToken
  const resetTokens = tokens.resetTokens
  const fps = useFps()
  const [loadMs, setLoadMs] = useState<number | null>(null)
  const loadStart = useRef(0)

  // Hydrate persisted dev tokens from localStorage after mount
  // (deferred so SSR and first client render both use DEFAULTS).
  useEffect(() => {
    hydrateTokens()
  }, [])

  // Cmd+. toggles the panel
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey && e.key === '.') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const switchVariant = useCallback((v: Variant | null) => {
    loadStart.current = performance.now()
    setLoadMs(null)
    setVariant(v)
  }, [])

  // Measure first paint after Time remounts on variant change
  useEffect(() => {
    if (!loadStart.current) return
    const raf = requestAnimationFrame(() => {
      setLoadMs(Math.round(performance.now() - loadStart.current))
      loadStart.current = 0
    })
    return () => cancelAnimationFrame(raf)
  }, [variant])

  const moments = variant !== null ? makeMoments(variant) : realMoments
  const focusIndex = variant !== null ? devFocusIndex(variant) : realFocusIndex

  return (
    <>
      <Time
        key={variant !== null ? `dev-${variant}` : 'live'}
        moments={moments}
        initialFocusIndex={focusIndex}
      />

      {open && (
        <div data-dev-panel="" role="toolbar" aria-label="Dev controls">
          {/* ── Moments ── */}
          <div data-dev-section="">
            <span data-dev-eyebrow="">moments</span>
            <div data-dev-buttons="">
              <button
                type="button"
                data-active={variant === null ? '' : undefined}
                onClick={() => switchVariant(null)}
              >
                live
              </button>
              {VARIANTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  data-active={variant === n ? '' : undefined}
                  onClick={() => switchVariant(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div data-dev-divider="" />

          {/* ── Shape ── */}
          <div data-dev-section="">
            <span data-dev-eyebrow="">shape</span>
            <Slider
              label="gap"
              value={tokens.gap}
              min={0}
              max={27}
              step={0.1}
              unit="vm"
              onChange={(v) => setToken('gap', v)}
            />
            <Slider
              label="pad"
              value={tokens.padding}
              min={0}
              max={27}
              step={0.1}
              unit="vm"
              onChange={(v) => setToken('padding', v)}
            />
            <Slider
              label="r"
              value={tokens.radius}
              min={0}
              max={27}
              step={0.1}
              unit="vm"
              onChange={(v) => setToken('radius', v)}
            />
            <Slider
              label="cr"
              value={tokens.cellRadius}
              min={0}
              max={27}
              step={0.1}
              unit="vm"
              onChange={(v) => setToken('cellRadius', v)}
            />
          </div>

          <div data-dev-divider="" />

          {/* ── Motion ── */}
          <div data-dev-section="">
            <span data-dev-eyebrow="">motion</span>
            <Slider
              label="dur"
              value={tokens.duration}
              min={0}
              max={1200}
              step={25}
              unit="ms"
              onChange={(v) => setToken('duration', v)}
            />
            <label data-dev-select="">
              <span data-dev-slider-label="">ease</span>
              <select
                value={tokens.easing}
                onChange={(e) => setToken('easing', e.target.value)}
              >
                {Object.entries(EASING_PRESETS).map(([name, value]) => (
                  <option key={name} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div data-dev-divider="" />

          {/* ── Contrast ── */}
          <div data-dev-section="">
            <span data-dev-eyebrow="">contrast</span>
            <Slider
              label="L₀"
              value={tokens.l0}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => setToken('l0', v)}
            />
            <Slider
              label="L±1"
              value={tokens.l1}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => setToken('l1', v)}
            />
            <Slider
              label="L±2"
              value={tokens.l2}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => setToken('l2', v)}
            />
            <Slider
              label="L±3"
              value={tokens.l3}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => setToken('l3', v)}
            />
            <Slider
              label="base"
              value={tokens.lBase}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => setToken('lBase', v)}
            />
          </div>

          <div data-dev-divider="" />

          <span data-dev-fps="" data-fps-warn={fps < 30 ? '' : undefined}>
            {fps} fps
          </span>

          {loadMs !== null && (
            <span data-dev-load="" data-load-warn={loadMs > 100 ? '' : undefined}>
              {loadMs}ms
            </span>
          )}

          <div data-dev-divider="" />

          <button
            type="button"
            data-dev-reset=""
            onClick={resetTokens}
          >
            reset
          </button>
        </div>
      )}
    </>
  )
}
