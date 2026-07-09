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
import { signMediaUpload } from '@/lib/figmaContent'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ACCOUNTS = 'accounts' as any

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

    try {
      const signed = await signMediaUpload(filename, mimeType)
      return Response.json(signed)
    } catch (err) {
      req.payload.logger.error({ err }, 'Failed to get presigned URL')
      return Response.json({ error: 'Failed to get upload URL' }, { status: 500 })
    }
  },
}
