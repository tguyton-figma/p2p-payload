import type { CollectionAfterChangeHook } from 'payload'
import type { Media } from '@/payload-types'

/**
 * Media enrichment producer.
 *
 * Enrichment (thumbnail / waveform / dominant color) runs in the `enrich-media`
 * Figma Cloud Job — not inline in the upload request. This afterChange hook is a
 * thin producer: when a media doc still needs enrichment it queues the job and
 * returns immediately, so uploads stay fast and the heavy ffmpeg/sharp work runs
 * in its own Figma-managed invocation. The admin ProcessingStatus field polls
 * the doc until the job populates the fields (or records `_processingErrors`).
 */

function dominantColorMissing(doc: Media): boolean {
  const color = (doc as unknown as Record<string, unknown>).dominantColor as
    | { l?: number | null }
    | null
    | undefined
  return color?.l == null
}

/** Whether the doc is still missing any enrichment output for its mime type. */
function needsEnrichment(doc: Media): boolean {
  const mime = doc.mimeType ?? ''
  if (mime.startsWith('image/')) return dominantColorMissing(doc)
  if (mime.startsWith('video/')) return !doc.thumbnailURL || dominantColorMissing(doc)
  if (mime.startsWith('audio/')) {
    const waveform = (doc as unknown as Record<string, unknown>).waveform
    const hasWaveform = Array.isArray(waveform) && waveform.length > 0
    return !hasWaveform || dominantColorMissing(doc)
  }
  return false
}

export const enrichMedia: CollectionAfterChangeHook<Media> = async ({ doc, req, context }) => {
  // Skip writes that originate from the enrichment job itself (and the
  // auto-created thumbnail child doc), so the job's own updates never re-queue.
  if (context.skipEnrichment) return doc

  // Auto-generated child docs (e.g. video thumbnails) are never enriched.
  if ((doc as unknown as Record<string, unknown>)._parentMediaId) return doc

  // Nothing to do if every expected field is already populated.
  if (!needsEnrichment(doc)) return doc

  try {
    await req.payload.jobs.queue({
      task: 'enrich-media',
      input: { mediaId: String(doc.id) },
    })
    req.payload.logger.info(`[enrich] Queued enrich-media job for ${doc.id}`)
  } catch (err) {
    // A queue failure must never break the upload; the polling UI will simply
    // show the fields as unpopulated until a later enrichment succeeds.
    req.payload.logger.error({ err }, `[enrich] Failed to queue enrich-media for ${doc.id}`)
  }

  return doc
}
