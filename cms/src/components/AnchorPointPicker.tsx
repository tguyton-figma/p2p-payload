'use client'

import React from 'react'
import { useField } from '@payloadcms/ui'
import type { SelectFieldClientComponent } from 'payload'

const POSITIONS = [
  'top-left',    'top-center',    'top-right',
  'center-left', 'center',        'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
] as const

type AnchorValue = typeof POSITIONS[number]

export const AnchorPointPicker: SelectFieldClientComponent = ({ path, field }) => {
  const { value, setValue } = useField<AnchorValue>({ path })
  const current = value ?? 'center'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      <label style={{ fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {(field as { label?: string }).label ?? 'Anchor Point'}
      </label>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1.5rem)',
          gridTemplateRows: 'repeat(3, 1.5rem)',
          gap: '3px',
          width: 'fit-content',
        }}
      >
        {POSITIONS.map((pos) => (
          <button
            key={pos}
            type="button"
            onClick={() => setValue(pos)}
            aria-label={pos}
            aria-pressed={current === pos}
            style={{
              appearance: 'none',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer',
              background: current === pos ? 'currentColor' : 'rgba(128,128,128,0.25)',
              opacity: current === pos ? 1 : 0.5,
              transition: 'background 120ms, opacity 120ms',
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  )
}
