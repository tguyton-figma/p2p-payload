import { execFile } from 'child_process'
import type { CollectionAfterChangeHook } from 'payload'
import type { Media } from '@/payload-types'
import { getFfmpegPath, fetchMediaToTempFile } from './mediaProcessing'

export interface ProbedMeta {
  durationSeconds?: number
  mediaWidth?: number
  mediaHeight?: number
}

/**
 * Runs `ffmpeg -i <file>` and parses stderr for duration and stream dimensions.
 * FFmpeg prints this info even without an output file (it exits with code 1 but
 * the metadata is in stderr). This avoids needing a separate ffprobe binary.
 */
function parseStderr(stderr: string): ProbedMeta {
  const meta: ProbedMeta = {}

  const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/)
  if (durMatch) {
    const hours = parseInt(durMatch[1], 10)
    const minutes = parseInt(durMatch[2], 10)
    const seconds = parseInt(durMatch[3], 10)
    const centis = parseInt(durMatch[4], 10)
    meta.durationSeconds = Math.round(hours * 3600 + minutes * 60 + seconds + centis / 100)
  }

  const dimMatch = stderr.match(/Stream.*Video.*\s(\d{2,5})x(\d{2,5})/)
  if (dimMatch) {
    meta.mediaWidth = parseInt(dimMatch[1], 10)
    meta.mediaHeight = parseInt(dimMatch[2], 10)
  }

  return meta
}

function probeFile(inputPath: string): Promise<ProbedMeta> {
  return new Promise((resolve) => {
    execFile(
      getFfmpegPath(),
      ['-i', inputPath, '-hide_banner'],
      { timeout: 10_000 },
      (_err, _stdout, stderr) => {
        // FFmpeg exits non-zero when no output file is given — that's expected.
        resolve(parseStderr(String(stderr)))
      },
    )
  })
}

export async function probeMediaMetaAsync(
  doc: Media,
  req: Parameters<CollectionAfterChangeHook<Media>>[0]['req'],
  tempPath?: string,
): Promise<void> {
  const logger = req.payload.logger
  logger.info(`[probe] Starting for ${doc.id} (${doc.filename})`)

  let meta: ProbedMeta
  if (tempPath) {
    meta = await probeFile(tempPath)
  } else {
    const src = await fetchMediaToTempFile(doc, req, 'probe')
    try {
      meta = await probeFile(src.path)
    } finally {
      await src.cleanup()
    }
  }

  const updates: Record<string, unknown> = {}
  if (meta.durationSeconds != null) updates.durationSeconds = meta.durationSeconds
  if (meta.mediaWidth != null) updates.mediaWidth = meta.mediaWidth
  if (meta.mediaHeight != null) updates.mediaHeight = meta.mediaHeight

  if (Object.keys(updates).length === 0) {
    logger.warn(`[probe] No metadata extracted for ${doc.id}`)
    return
  }

  req.file = undefined

  await req.payload.update({
    collection: 'media',
    id: doc.id,
    data: updates,
    context: { skipEnrichment: true },
    req,
  })

  logger.info(
    `[probe] ${doc.id}: ${Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(', ')}`,
  )
}
