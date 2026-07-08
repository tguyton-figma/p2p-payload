'use client'

import React from 'react'
import type { Media } from '@/payload-types'
import { PaintMedia } from '@/app/(frontend)/book/PaintMedia'

interface ResolvedMediaEntry {
  id?: string | null
  media: Media
}

interface MediaCellProps {
  item: ResolvedMediaEntry
  position: number
  onSelect: () => void
  paintL?: number | null
  paintC?: number | null
  paintH?: number | null
}

export function MediaCell({ item, position, onSelect, paintL, paintC, paintH }: MediaCellProps) {
  const mediaDoc = item.media

  const l = paintL ?? 0.15
  const c = paintC ?? 0
  const h = paintH ?? 0

  const paintStyle = {
    '--paint-l': l,
    '--paint-c': c,
    '--paint-h': h,
    '--paint-dim': 0.15,
    '--paint-lit': 0.15,
  } as React.CSSProperties

  return (
    <button
      data-cell=""
      data-position={position}
      data-media-type={mediaDoc.mimeType?.split('/')[0] ?? undefined}
      type="button"
      onClick={onSelect}
      aria-label={mediaDoc.filename ?? mediaDoc.id}
      aria-current={position === 0 ? 'true' : undefined}
      style={paintStyle}
    >
      <PaintMedia
        media={mediaDoc}
        position={position}
        paintL={l}
        paintC={c}
        paintH={h}
      />
      {position === 0 && mediaDoc.filename && (
        <span data-cell-content="">
          <span data-cell-title="">{mediaDoc.filename}</span>
        </span>
      )}
    </button>
  )
}
