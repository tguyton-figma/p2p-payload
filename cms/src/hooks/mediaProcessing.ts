import { createRequire } from 'module'
import { execFile } from 'child_process'
import { createWriteStream } from 'fs'
import { unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join, extname } from 'path'
import { randomUUID } from 'crypto'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { PayloadRequest } from 'payload'
import type { Media } from '@/payload-types'

const _require = createRequire(import.meta.url)

// ── FFmpeg ────────────────────────────────────────────────────────────────────

let ffmpegPath: string | null = null
let ffmpegReady: boolean | null = null

export function ensureFfmpeg(logPrefix = 'media'): boolean {
  if (ffmpegReady !== null) return ffmpegReady

  try {
    const { path } = _require('@ffmpeg-installer/ffmpeg')
    ffmpegPath = path
    ffmpegReady = true
  } catch (err) {
    console.error(`[${logPrefix}] FFmpeg binary not available — skipping processing`, err)
    ffmpegReady = false
  }

  return ffmpegReady
}

export function getFfmpegPath(): string {
  if (!ffmpegPath) throw new Error('FFmpeg not initialized — call ensureFfmpeg() first')
  return ffmpegPath
}

/**
 * Run an ffmpeg command and collect stdout as a Buffer.
 * Rejects on non-zero exit or stderr-only output.
 */
export function spawnFfmpeg(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = execFile(getFfmpegPath(), args, {
      maxBuffer: 200 * 1024 * 1024,
      encoding: 'buffer',
      timeout: 30_000,
    }, (err, stdout) => {
      if (err) return reject(err)
      resolve(stdout as unknown as Buffer)
    })

    proc.on('error', reject)
  })
}

// ── Sharp ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSharp(): any {
  return _require('sharp')
}

// ── URL resolution ────────────────────────────────────────────────────────────

/**
 * The app's own internal origin. Server-side enrichment must hit this rather
 * than the public site host: on SSO-protected deployments Figma's edge
 * intercepts /api/media/file/* and 302-redirects a cookieless request to the
 * Okta auth page, so it never reaches storage. Hitting the local standalone
 * server runs the upload staticHandler in-process, which signs the file and
 * redirects straight to the Content-API URL — no SSO edge involved.
 */
function getInternalOrigin(): string {
  const port = process.env.PORT || '3000'
  return `http://127.0.0.1:${port}`
}

/** Build the public-host URL for a relative media path (fallback only). */
export function resolveMediaUrl(doc: Media, req: PayloadRequest): string {
  if (!doc.url) throw new Error('Media document has no URL')

  if (doc.url.startsWith('http')) return doc.url

  const serverUrl =
    process.env.NEXT_PUBLIC_SERVER_URL || process.env.PAYLOAD_PUBLIC_SERVER_URL

  if (serverUrl) return `${serverUrl}${doc.url}`

  const proto = req.headers.get('x-forwarded-proto') || 'https'
  const host = req.headers.get('host')
  if (!host) {
    throw new Error('Cannot resolve media URL: no server URL configured and no host header')
  }

  return `${proto}://${host}${doc.url}`
}

// Figma's SSO edge redirects unauthenticated requests here; never usable server-side.
const AUTH_REDIRECT = /\/api\/authn|figma\.com\/api\/authn|okta/i

/**
 * Resolves the direct, fetchable URL for a media file.
 *
 * The Payload file route (/api/{collection}/file/{name}) is served by the Figma
 * upload staticHandler, which mints a short-lived signed Content-API URL and
 * 302-redirects to it. We follow that redirect — but issue the request to the
 * app's internal origin first so it bypasses the SSO edge that would otherwise
 * bounce a server-side request to the auth page. FFmpeg/sharp can then stream
 * from the returned signed URL.
 */
export async function resolveDirectMediaUrl(
  doc: Media,
  req: PayloadRequest,
  logPrefix = 'media',
): Promise<string> {
  if (!doc.url) throw new Error('Media document has no URL')

  // Already an absolute (e.g. pre-signed) URL — use as-is.
  if (doc.url.startsWith('http')) return doc.url

  const logger = req.payload.logger

  // Internal origin first (bypasses the SSO edge), then public host as fallback.
  const candidates: string[] = [`${getInternalOrigin()}${doc.url}`]
  try {
    candidates.push(resolveMediaUrl(doc, req))
  } catch {
    // No public host available; the internal origin is our only option.
  }

  let lastError: Error | null = null

  for (const url of candidates) {
    let host = url
    try {
      host = new URL(url).host
    } catch {
      // keep raw url as label
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    try {
      const res = await fetch(url, { redirect: 'manual', signal: controller.signal })
      const location = res.headers.get('location')

      if (location && AUTH_REDIRECT.test(location)) {
        lastError = new Error(
          `File request to ${host} was redirected to the SSO auth gate; server-side access is blocked there`,
        )
        logger.warn(`[${logPrefix}] ${host} redirected to auth gate; trying next origin`)
        continue
      }
      if (location) {
        logger.info(`[${logPrefix}] Resolved signed URL via ${host} (status ${res.status})`)
        return location
      }
      if (res.ok) {
        // Served inline without a redirect.
        return url
      }
      lastError = new Error(`No redirect from ${host} (status ${res.status})`)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      logger.warn(`[${logPrefix}] Failed to reach ${host}: ${lastError.message}`)
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError ?? new Error('Could not resolve a direct media URL')
}

/**
 * Downloads the full media file into memory. Only use this when streaming
 * is not possible (e.g. passing to a library that requires a Buffer).
 */
export async function fetchMediaBuffer(
  doc: Media,
  req: PayloadRequest,
  logPrefix = 'media',
): Promise<Buffer> {
  const directUrl = await resolveDirectMediaUrl(doc, req, logPrefix)
  const res = await fetch(directUrl)
  if (!res.ok) {
    throw new Error(`Failed to download media: ${res.status} ${res.statusText}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  req.payload.logger.info(
    `[${logPrefix}] Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`,
  )
  return buf
}

export interface TempMediaFile {
  path: string
  cleanup: () => Promise<void>
}

/**
 * Streams the media file to a local temp file via Node, returning its path.
 *
 * FFmpeg must read from a local path rather than a remote URL: the bundled
 * static ffmpeg binary cannot perform hostname resolution in the Lambda
 * environment (it fails every `-i https://…` with "Name or service not known"),
 * whereas Node resolves DNS and reaches storage fine. So Node does the network
 * I/O and hands ffmpeg bytes on disk. Caller must invoke cleanup() when done.
 */
export async function fetchMediaToTempFile(
  doc: Media,
  req: PayloadRequest,
  logPrefix = 'media',
): Promise<TempMediaFile> {
  const directUrl = await resolveDirectMediaUrl(doc, req, logPrefix)
  const res = await fetch(directUrl)
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download media: ${res.status} ${res.statusText}`)
  }

  let ext = ''
  try {
    ext = extname(new URL(directUrl).pathname)
  } catch {
    // no usable extension; ffmpeg will probe the container regardless
  }

  const path = join(tmpdir(), `media-${randomUUID()}${ext}`)
  await pipeline(
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(path),
  )

  req.payload.logger.info(`[${logPrefix}] Downloaded media to ${path}`)

  return {
    path,
    cleanup: async () => {
      await unlink(path).catch(() => {})
    },
  }
}
