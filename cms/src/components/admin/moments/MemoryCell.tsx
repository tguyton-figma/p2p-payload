'use client'

import React from 'react'
import type { Memory, Account } from '@/payload-types'

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const TYPE_LABELS: Record<string, string> = {
  system: 'System',
  message: 'Message',
  activity: 'Activity',
  artifact: 'Artifact',
}

interface MemoryCellProps {
  item: Memory
  position: number
  onSelect: () => void
}

export function MemoryCell({ item, position, onSelect }: MemoryCellProps) {
  const author = typeof item.author === 'object' ? (item.author as Account) : null
  const origin = author?.handle ?? author?.email ?? 'System'
  const typeLabel = TYPE_LABELS[item.type] ?? item.type
  const timestamp = relativeTime(item.createdAt)

  return (
    <button
      data-cell=""
      data-position={position}
      type="button"
      onClick={onSelect}
      aria-label={`${typeLabel} — ${timestamp}`}
      aria-current={position === 0 ? 'true' : undefined}
      style={{
        '--paint-l': 0.15,
        '--paint-c': 0,
        '--paint-h': 0,
        '--paint-dim': 0.15,
        '--paint-lit': 0.15,
      } as React.CSSProperties}
    >
      <span data-cell-content="" data-memory-cell="">
        <span data-memory-type="">{typeLabel}</span>
        <span data-memory-time="">{timestamp}</span>
        <span data-memory-origin="">{origin}</span>
      </span>
    </button>
  )
}
