import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { readFile, unlink } from 'fs/promises'
import type { CollectionAfterChangeHook } from 'payload'
import type { Media } from '@/payload-types'
import { getFfmpegPath, fetchMediaToTempFile } from './mediaProcessing'
import { execFile } from 'child_process'

/**
 * Extracts the first JPEG frame from a locally-downloaded video file.
 * FFmpeg reads from the local path because the static ffmpeg binary cannot
 * resolve DNS in the Lambda; Node downloads the file beforehand.
 */
async function extractFrame(inputPath: string): Promise<Buffer> {
  const thumbPath = join(tmpdir(), `thumb-${randomUUID()}.jpg`)

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        getFfmpegPath(),
        [
          '-ss', '0',
          '-i', inputPath,
          '-frames:v', '1',
          '-q:v', '2',
          '-an',
          '-vf', 'scale=640:-2',
          '-y',
          thumbPath,
        ],
        { timeout: 15_000 },
        (err, _stdout, stderr) => {
          if (err) {
            // ffmpeg writes diagnostics to stderr; include the tail so the
            // real failure (protocol, timeout, decode) reaches _processingErrors.
            const tail = stderr ? ` | ffmpeg: ${String(stderr).slice(-500)}` : ''
            return reject(new Error(`${err.message}${tail}`))
          }
          resolve()
        },
      )
    })

    return await readFile(thumbPath)
  } finally {
    await unlink(thumbPath).catch(() => {})
  }
}

/**
 * Async worker that generates a thumbnail and links it to the original doc.
 * Runs fire-and-forget so it doesn't block the upload response.
 */
export async function generateThumbnailAsync(
  doc: Media,
  req: Parameters<CollectionAfterChangeHook<Media>>[0]['req'],
): Promise<void> {
  const logger = req.payload.logger

  logger.info(`[thumbnail] Starting for video ${doc.id} (${doc.filename})`)

  // Download in Node (ffmpeg can't resolve DNS in the Lambda) then extract
  // the frame from the local file.
  const src = await fetchMediaToTempFile(doc, req, 'thumbnail')
  let thumbBuffer: Buffer
  try {
    thumbBuffer = await extractFrame(src.path)
  } finally {
    await src.cleanup()
  }
  logger.info(`[thumbnail] Extracted frame: ${thumbBuffer.length} bytes`)

  // CRITICAL — do NOT reuse the caller's `req` for this file-upload create.
  //
  // `media` is an upload collection backed by the Figma Content-API storage
  // adapter. When a create/update carries a file, the adapter writes the buffer
  // to S3 under the DOC's filename. Payload attaches the uploaded file to the
  // request it's handed and it lingers there — so if we passed the caller's
  // `req`, the thumbnail buffer would still be on it when the enrich pipeline
  // later writes to the PARENT video doc (the thumbnailURL update below, the
  // `color` sub-job's update, `writeErrors`). Those writes would then re-persist
  // the thumbnail buffer under the VIDEO's own filename, overwriting the real
  // video in S3 with the ~30-55 KB JPEG frame (served as video/mp4 → unplayable).
  //
  // Merely clearing `req.file` after the create proved insufficient in
  // production (the buffer still reached the parent write), so we isolate the
  // upload to a throwaway request clone and keep the caller's `req` pristine for
  // every parent-doc write. The clone shares the transaction id, so both stay in
  // the same transaction.
  const uploadReq = Object.assign(Object.create(Object.getPrototypeOf(req)), req)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const thumbDoc = await (req.payload.create as any)({
    collection: 'media',
    data: {
      alt: `Thumbnail for ${doc.filename || doc.id}`,
      _parentMediaId: doc.id,
    },
    file: {
      data: thumbBuffer,
      name: `thumb-${doc.id}.jpg`,
      mimetype: 'image/jpeg',
      size: thumbBuffer.length,
    },
    draft: false,
    context: { skipEnrichment: true },
    req: uploadReq,
  })

  // Defensive: guarantee the caller's request carries no file before any
  // parent-doc write, whatever Payload did with `uploadReq`. If this ever logs,
  // the isolation above failed and needs revisiting.
  if ((req as unknown as { file?: { name?: string } }).file) {
    logger.warn(
      `[thumbnail] caller req unexpectedly carries a file after isolated create: ${
        (req as unknown as { file?: { name?: string } }).file?.name
      }`,
    )
  }
  req.file = undefined

  if (!thumbDoc?.url) {
    // The child doc exists but storage produced no URL — under the Figma Cloud
    // client-upload flow this means the buffer never landed in S3.
    throw new Error(
      `Thumbnail doc ${thumbDoc?.id ?? '?'} created without a URL — cloud storage upload may have failed`,
    )
  }

  await req.payload.update({
    collection: 'media',
    id: doc.id,
    data: {
      thumbnailURL: thumbDoc.url,
    } as Record<string, unknown>,
    context: { skipEnrichment: true },
    req,
  })

  logger.info(`[thumbnail] Created ${thumbDoc.id} for video ${doc.id}`)
}
