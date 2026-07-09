/**
 * Figma Content API helpers.
 *
 * The Media collection is backed by Figma Cloud storage. We never hold raw S3
 * credentials — instead the Content API mints a short-lived presigned S3 PUT URL
 * so large files upload directly to storage, bypassing Lambda's ~6MB request
 * body limit. This helper is shared by the recorder endpoints and the
 * session-recording upload flow so the sign request lives in exactly one place.
 */

// Production Figma Content API base URL (matches constants.js in @payloadcms/figma)
const CONTENT_API_BASE =
  process.env.FIGMA_CONTENT_API_URL ||
  'https://us-east-1.cms-tenants-001-production.figmacontent.com'

export interface SignedUpload {
  /** Presigned S3 PUT URL — upload the file bytes here, once. */
  uploadUrl: string
  /** The (possibly sanitized) filename the file is stored under. */
  filename: string
}

/**
 * Request a presigned upload URL for a Media file.
 *
 * @throws if FIGMA_CONTENT_API_ACCESS_KEY is unset or the sign call fails, so
 * callers can surface a clear 500.
 */
export async function signMediaUpload(filename: string, mimeType: string): Promise<SignedUpload> {
  const apiKey = process.env.FIGMA_CONTENT_API_ACCESS_KEY
  if (!apiKey) {
    throw new Error('Content API not configured — FIGMA_CONTENT_API_ACCESS_KEY missing')
  }

  const res = await fetch(`${CONTENT_API_BASE}/api/v0/uploads/sign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      collectionId: 'media',
      contentType: mimeType,
      expiresIn: 3600,
      filename,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Failed to get presigned URL: ${res.status} ${detail}`)
  }

  const { url, filename: safeFilename } = (await res.json()) as {
    url: string
    filename: string
  }
  return { uploadUrl: url, filename: safeFilename ?? filename }
}
