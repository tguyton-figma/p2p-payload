import type { CollectionAfterChangeHook } from 'payload'
import type { Media } from '@/payload-types'
import { spawnFfmpeg, fetchMediaToTempFile } from './mediaProcessing'

const SAMPLES = 128

/**
 * Streams an audio file through FFmpeg, converting it to 16-bit signed
 * little-endian mono PCM at 8kHz. Returns a Buffer of raw PCM bytes.
 * Using 8kHz keeps memory usage low while retaining enough resolution
 * for a visually meaningful 128-sample waveform.
 */
async function audioPcmFromFile(inputPath: string): Promise<Buffer> {
  return spawnFfmpeg([
    '-t', '120',
    '-i', inputPath,
    '-ac', '1',
    '-ar', '8000',
    '-acodec', 'pcm_s16le',
    '-f', 's16le',
    'pipe:1',
  ])
}

/**
 * Reduces a raw PCM Buffer (16-bit LE, mono) to `count` evenly-spaced
 * peak amplitude samples, normalised to [0, 1].
 */
function pcmToWaveform(pcm: Buffer, count: number): number[] {
  const totalSamples = Math.floor(pcm.length / 2)
  if (totalSamples === 0) return new Array(count).fill(0)

  const chunkSize = Math.max(1, Math.floor(totalSamples / count))
  const waveform: number[] = []

  for (let i = 0; i < count; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, totalSamples)

    let peak = 0
    for (let j = start; j < end; j++) {
      const sample = Math.abs(pcm.readInt16LE(j * 2))
      if (sample > peak) peak = sample
    }

    waveform.push(Math.round((peak / 32767) * 1000) / 1000)
  }

  return waveform
}

export async function generateWaveformAsync(
  doc: Media,
  req: Parameters<CollectionAfterChangeHook<Media>>[0]['req'],
): Promise<void> {
  const logger = req.payload.logger
  logger.info(`[waveform] Starting for audio ${doc.id} (${doc.filename})`)

  // Download in Node (ffmpeg can't resolve DNS in the Lambda) then decode
  // PCM from the local file.
  const src = await fetchMediaToTempFile(doc, req, 'waveform')
  let pcm: Buffer
  try {
    pcm = await audioPcmFromFile(src.path)
  } finally {
    await src.cleanup()
  }
  logger.info(`[waveform] Decoded ${(pcm.length / 1024).toFixed(0)} KB PCM`)

  const waveform = pcmToWaveform(pcm, SAMPLES)

  await req.payload.update({
    collection: 'media',
    id: doc.id,
    data: {
      waveform,
    } as Record<string, unknown>,
    context: { skipEnrichment: true, skipWaveformGeneration: true, skipColorExtraction: true, skipThumbnailGeneration: true },
    req,
  })

  logger.info(`[waveform] Stored ${SAMPLES} samples for audio ${doc.id}`)
}
