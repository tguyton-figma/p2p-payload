import type { CollectionBeforeChangeHook } from 'payload'
import type { Moment, Media } from '@/payload-types'

/**
 * beforeChange hook for Moments.
 *
 * Auto-fills paintL, paintC, paintH from the primary media's
 * dominantColor when:
 *   a) paint values are absent (first time or cleared), OR
 *   b) the primary media (last item in the media array) has changed.
 *
 * If the author has manually set paint values AND the primary media hasn't
 * changed, the existing values are left untouched.
 */
export const populateMomentPaint: CollectionBeforeChangeHook<Moment> = async ({
  data,
  originalDoc,
  req,
  operation,
}) => {
  // Primary media is the last element in the media array
  const mediaItems = Array.isArray(data.media) ? data.media : []
  const lastEntry = mediaItems[mediaItems.length - 1]
  const incomingPrimaryId = lastEntry
    ? typeof lastEntry.media === 'object' && lastEntry.media !== null
      ? (lastEntry.media as { id: string }).id
      : (lastEntry.media as string | null | undefined)
    : null

  const existingItems = Array.isArray(originalDoc?.media) ? originalDoc.media : []
  const existingLastEntry = existingItems[existingItems.length - 1]
  const existingPrimaryId = existingLastEntry
    ? typeof existingLastEntry.media === 'object' && existingLastEntry.media !== null
      ? (existingLastEntry.media as { id: string }).id
      : (existingLastEntry.media as string | null | undefined)
    : null

  const primaryChanged = incomingPrimaryId !== existingPrimaryId

  // No primary media set — nothing to derive from
  if (!incomingPrimaryId) return data

  // Paint values are already manually set AND primary hasn't changed — preserve them
  const hasManualPaint =
    data.paintL != null && data.paintC != null && data.paintH != null

  if (hasManualPaint && !primaryChanged && operation === 'update') return data

  // Fetch the media doc to read its dominantColor
  let mediaDoc: Media | null = null
  try {
    mediaDoc = await req.payload.findByID({
      collection: 'media',
      id: incomingPrimaryId,
      depth: 0,
    }) as Media
  } catch {
    // Media might not exist yet (race) — return data unchanged
    return data
  }

  const color = (mediaDoc as unknown as Record<string, unknown>).dominantColor as
    | { l?: number; c?: number; h?: number }
    | null
    | undefined

  if (!color?.l) {
    // dominantColor not yet extracted (hook is still running) — skip for now.
    // The color will be populated via populateMomentPaint when the moment is
    // next saved, or the author can set it manually.
    return data
  }

  // When primary changed, force-overwrite paint from the new media's color.
  // When primary is the same (first save, paint cleared), only fill missing values.
  return {
    ...data,
    paintL: primaryChanged ? color.l : (data.paintL ?? color.l),
    paintC: primaryChanged ? color.c : (data.paintC ?? color.c),
    paintH: primaryChanged ? color.h : (data.paintH ?? color.h),
  }
}
