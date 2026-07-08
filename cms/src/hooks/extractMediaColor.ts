import type { CollectionAfterChangeHook } from 'payload'
import type { Media } from '@/payload-types'
import {
  ensureFfmpeg,
  spawnFfmpeg,
  getSharp,
  fetchMediaBuffer,
  fetchMediaToTempFile,
} from './mediaProcessing'

// ── OKLCH conversion ──────────────────────────────────────────────────────────
// sRGB → linear → OKLab → OKLCH. Embedded math, no color library needed.

function linearize(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function srgbToOklch(r: number, g: number, b: number): { l: number; c: number; h: number } {
  const lr = linearize(r)
  const lg = linearize(g)
  const lb = linearize(b)

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb

  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const bv = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_

  const C = Math.sqrt(a * a + bv * bv)
  let H = (Math.atan2(bv, a) * 180) / Math.PI
  if (H < 0) H += 360

  return {
    l: Math.round(L * 1000) / 1000,
    c: Math.round(C * 1000) / 1000,
    h: Math.round(H * 10) / 10,
  }
}

// ── Color extractors ──────────────────────────────────────────────────────────

async function colorFromImageBuffer(
  buf: Buffer,
): Promise<{ l: number; c: number; h: number }> {
  try {
    const sharp = getSharp()
    const { data } = await sharp(buf)
      .resize(1, 1, { fit: 'cover' })
      .raw()
      .toBuffer({ resolveWithObject: true })

    return srgbToOklch(data[0]!, data[1]!, data[2]!)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Surface the real Sharp/libvips failure instead of swallowing it,
    // so the orchestrator records it to _processingErrors.
    throw new Error(`Sharp failed on image buffer: ${msg}`)
  }
}

async function colorFromVideoThumbnail(
  doc: Media,
  req: Parameters<CollectionAfterChangeHook<Media>>[0]['req'],
): Promise<{ l: number; c: number; h: number }> {
  const { docs } = await req.payload.find({
    collection: 'media',
    where: { _parentMediaId: { equals: doc.id } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const thumbDoc = docs[0] as Media | undefined
  if (!thumbDoc) {
    // Video color depends on the thumbnail; if it's absent the thumbnail
    // job failed first. Surface that rather than silently producing nothing.
    throw new Error(`No thumbnail doc found for video ${doc.id} (thumbnail job likely failed)`)
  }

  const buf = await fetchMediaBuffer(thumbDoc, req, 'color')
  return colorFromImageBuffer(buf)
}

async function audioPcmFromFile(inputPath: string): Promise<Buffer> {
  return spawnFfmpeg([
    '-t', '30',
    '-i', inputPath,
    '-ac', '1',
    '-ar', '8000',
    '-acodec', 'pcm_s16le',
    '-f', 's16le',
    'pipe:1',
  ])
}

/**
 * Derive OKLCH color from audio using PCM signal features:
 * zero-crossing rate approximates brightness/frequency, RMS approximates
 * energy, and crest factor nudges chroma.
 */
async function colorFromAudio(
  doc: Media,
  req: Parameters<CollectionAfterChangeHook<Media>>[0]['req'],
): Promise<{ l: number; c: number; h: number } | null> {
  if (!ensureFfmpeg('color')) return null

  const logger = req.payload.logger

  try {
    const src = await fetchMediaToTempFile(doc, req, 'color')
    let pcm: Buffer
    try {
      pcm = await audioPcmFromFile(src.path)
    } finally {
      await src.cleanup()
    }
    const totalSamples = Math.floor(pcm.length / 2)

    if (totalSamples < 2) {
      logger.warn('[color] Audio PCM was empty; using fallback audio color')
      return { l: 0.5, c: 0.12, h: 270 }
    }

    let crossings = 0
    let sumSquares = 0
    let peak = 0
    let previous = pcm.readInt16LE(0)

    for (let i = 0; i < totalSamples; i++) {
      const sample = pcm.readInt16LE(i * 2)
      const normalized = sample / 32768
      sumSquares += normalized * normalized
      peak = Math.max(peak, Math.abs(normalized))

      if (i > 0 && ((previous < 0 && sample >= 0) || (previous >= 0 && sample < 0))) {
        crossings++
      }

      previous = sample
    }

    const zcr = crossings / totalSamples
    const rms = Math.sqrt(sumSquares / totalSamples)
    const crest = peak > 0 && rms > 0 ? peak / rms : 1

    const frequencyT = Math.max(0, Math.min(1, (zcr - 0.02) / 0.2))
    const energyT = Math.max(0, Math.min(1, rms / 0.35))
    const dynamicT = Math.max(0, Math.min(1, (crest - 1) / 9))

    const hue = Math.round(20 + frequencyT * 240)
    const lightness = Math.round((0.42 + energyT * 0.22) * 1000) / 1000
    const chroma = Math.round((0.09 + dynamicT * 0.1) * 1000) / 1000

    logger.info(
      `[color] Audio features zcr=${zcr.toFixed(4)} rms=${rms.toFixed(4)} crest=${crest.toFixed(2)} -> hue=${hue}`,
    )

    return { l: lightness, c: chroma, h: hue }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ err }, '[color] Audio PCM analysis failed')
    throw new Error(`Audio PCM analysis failed: ${msg}`)
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export async function extractColorAsync(
  doc: Media,
  req: Parameters<CollectionAfterChangeHook<Media>>[0]['req'],
): Promise<void> {
  const logger = req.payload.logger
  logger.info(`[color] Starting for media ${doc.id} (${doc.mimeType})`)

  let color: { l: number; c: number; h: number } | null = null
  const mime = doc.mimeType ?? ''

  if (mime.startsWith('image/')) {
    const buf = await fetchMediaBuffer(doc, req, 'color')
    color = await colorFromImageBuffer(buf)
  } else if (mime.startsWith('video/')) {
    color = await colorFromVideoThumbnail(doc, req)
  } else if (mime.startsWith('audio/')) {
    color = await colorFromAudio(doc, req)
  }

  if (!color) {
    // Throw so the orchestrator records this to _processingErrors instead of
    // leaving the job silently unresolved.
    throw new Error(`Color extraction produced no result for ${mime || 'unknown mime type'}`)
  }

  logger.info(`[color] Extracted oklch(${color.l} ${color.c} ${color.h}) for ${doc.id}`)

  // Defense-in-depth: this is a metadata-only write on the (possibly video)
  // parent doc. If any earlier step left a file buffer on `req`, updating an
  // upload-collection doc would re-persist it under this doc's filename. Clear
  // it so this write only touches `dominantColor`. (See generateVideoThumbnail
  // for the full corruption story this guards against.)
  if ((req as unknown as { file?: { name?: string } }).file) {
    logger.warn(
      `[color] req carried a file before parent update: ${
        (req as unknown as { file?: { name?: string } }).file?.name
      }`,
    )
  }
  req.file = undefined

  await req.payload.update({
    collection: 'media',
    id: doc.id,
    data: {
      dominantColor: color,
    } as Record<string, unknown>,
    context: {
      skipEnrichment: true,
      skipColorExtraction: true,
      skipThumbnailGeneration: true,
      skipWaveformGeneration: true,
    },
    req,
  })
}
