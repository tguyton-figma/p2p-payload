/**
 * Recorder Upload URL Endpoint
 *
 * POST /api/recorder/upload-url
 *
 * Returns a presigned S3 URL so the Make app can upload the recording
 * DIRECTLY to S3, bypassing Lambda entirely. This avoids Lambda's ~6MB
 * request body limit, which would otherwise reject recordings longer than
 * ~30s (CORS error is the misleading browser symptom of that rejection).
 *
 * Flow:
 *   1. Make app calls this endpoint with { filename, mimeType }
 *   2. This endpoint validates the session token + calls the Figma Content API
 *   3. Returns { uploadUrl, filename } — uploadUrl is a presigned S3 PUT URL
 *   4. Make app PUTs the file directly to S3 (no Lambda)
 *   5. Make app calls POST /api/recorder/finalize with the metadata
 *
 * Requires FIGMA_CONTENT_API_ACCESS_KEY to be set in Figma Cloud env vars.
 */

import type { Endpoint } from 'payload'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ACCOUNTS = 'accounts' as any

// Production Figma Content API base URL (matches constants.js in @payloadcms/figma)
const CONTENT_API_BASE =
  process.env.FIGMA_CONTENT_API_URL ||
  'https://us-east-1.cms-tenants-001-production.figmacontent.com'

export const recorderUploadUrl: Endpoint = {
  path: '/recorder/upload-url',
  method: 'post',
  handler: async (req) => {
    // Validate session token
    const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization')
    const sessionToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null

    if (!sessionToken) {
      return Response.json({ error: 'Authorization required' }, { status: 401 })
    }

    const { docs } = await req.payload.find({
      collection: ACCOUNTS,
      where: { sessionToken: { equals: sessionToken } },
      limit: 1,
      overrideAccess: true,
    })

    if (!docs.length) {
      return Response.json({ error: 'Invalid or expired session token' }, { status: 401 })
    }

    // Parse body
    const body = (await req.json?.()) as { filename?: string; mimeType?: string } | undefined
    const filename = body?.filename
    const mimeType = body?.mimeType

    if (!filename || !mimeType) {
      return Response.json({ error: 'filename and mimeType are required' }, { status: 400 })
    }

    const apiKey = process.env.FIGMA_CONTENT_API_ACCESS_KEY
    if (!apiKey) {
      return Response.json(
        { error: 'Content API not configured — FIGMA_CONTENT_API_ACCESS_KEY missing' },
        { status: 500 },
      )
    }

    // Call Figma Content API to get a presigned S3 upload URL
    const signRes = await fetch(`${CONTENT_API_BASE}/api/v0/uploads/sign`, {
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

    if (!signRes.ok) {
      const err = await signRes.text()
      req.payload.logger.error(`Failed to get presigned URL: ${signRes.status} ${err}`)
      return Response.json({ error: 'Failed to get upload URL' }, { status: 500 })
    }

    const { url, filename: safeFilename } = (await signRes.json()) as {
      url: string
      filename: string
    }

    return Response.json({
      uploadUrl: url,
      filename: safeFilename ?? filename,
    })
  },
}
