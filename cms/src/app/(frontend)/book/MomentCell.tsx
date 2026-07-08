import React from 'react'
import type { Moment, Media } from '@/payload-types'
import { PaintMedia } from './PaintMedia'

interface MomentCellProps {
  /** The Moment to display, or null for an empty cell */
  moment: Moment | null
  /** Position relative to center: -3 to +3, where 0 is the focused center */
  position: number
  /** Callback when this cell is clicked (only for non-empty cells) */
  onSelect?: () => void
}

export function MomentCell({ moment, position, onSelect }: MomentCellProps) {
  if (!moment) {
    return (
      <button
        data-cell=""
        data-position={position}
        data-empty=""
        type="button"
        disabled
        aria-hidden="true"
      />
    )
  }

  const mediaItems = Array.isArray(moment.media) ? moment.media : []
  const primaryEntry = mediaItems[mediaItems.length - 1]
  const primaryMedia = primaryEntry && typeof primaryEntry.media === 'object'
    ? (primaryEntry.media as Media)
    : null

  const paintStyle = {
    '--paint-l': moment.paintL ?? 0.15,
    '--paint-c': moment.paintC ?? 0,
    '--paint-h': moment.paintH ?? 0,
    '--paint-dim': (moment.paintDim ?? 15) / 100,
    '--paint-lit': (moment.paintLit ?? 15) / 100,
  } as React.CSSProperties

  return (
    <button
      data-cell=""
      data-position={position}
      data-media-type={primaryMedia?.mimeType?.split('/')[0] ?? undefined}
      type="button"
      onClick={onSelect}
      aria-label={moment.name}
      aria-current={position === 0 ? 'true' : undefined}
      style={paintStyle}
    >
      {primaryMedia && (
        <PaintMedia
          media={primaryMedia}
          position={position}
          paintL={moment.paintL}
          paintC={moment.paintC}
          paintH={moment.paintH}
        />
      )}
      <span data-cell-content="">
        <span data-cell-title="">{moment.name}</span>
      </span>
    </button>
  )
}
