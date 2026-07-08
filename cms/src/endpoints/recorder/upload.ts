/**
 * Recorder Upload Endpoint
 *
 * POST /api/recorder/upload
 *
 * The only upload path for the recorder Make app. Authenticates via
 * the session token issued during OAuth, then creates the media document.
 *
 * Headers:
 *   Authorization: Bearer <sessionToken>
 *
 * Body: multipart/form-data
 *   file: the recording blob
 *   _payload: JSON string with { alt: string, anchor?: string }
 */

import type { Endpoint } from 'payload'
import { addDataAndFileToRequest } from 'payload'
import type { Media } from '../../payload-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ACCOUNTS = 'accounts' as any

export const recorderUpload: Endpoint = {
  path: '/recorder/upload',
  method: 'post',
  handler: async (req) => {
    // Extract session token from Authorization header
    const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization')
    const sessionToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null

    if (!sessionToken) {
      return Response.json({ error: 'Authorization required' }, { status: 401 })
    }

    // Look up account by session token
    const { docs } = await req.payload.find({
      collection: ACCOUNTS,
      where: { sessionToken: { equals: sessionToken } },
      limit: 1,
      overrideAccess: true,
    })

    if (!docs.length) {
      return Response.json({ error: 'Invalid or expired session token' }, { status: 401 })
    }

    // Parse multipart body
    await addDataAndFileToRequest(req)

    if (!req.file) {
      return Response.json({ error: 'No file provided' }, { status: 400 })
    }

    const data = req.data as Record<string, unknown>

    if (!data?.alt) {
      return Response.json({ error: 'alt field is required' }, { status: 400 })
    }

    const account = docs[0] as any

    try {
      const media = await req.payload.create({
        collection: 'media',
        data: {
          alt: String(data.alt),
          uploadedBy: account.id,
          ...(data.anchor ? { anchor: String(data.anchor) as Media['anchor'] } : {}),
        },
        file: req.file,
        overrideAccess: true,
        req,
      })

      // Fire-and-forget log entry — don't fail the upload if logging fails
      req.payload.create({
        collection: 'logs',
        data: {
          subject: 'media.upload',
          source: 'recorder',
          accountId: account.id,
          data: {
            mediaId: media.id,
            filename: media.filename,
            filesize: media.filesize,
            mimeType: media.mimeType,
            accountHandle: account.handle,
            accountEmail: account.email,
          },
        },
        overrideAccess: true,
        req,
      }).catch((err: unknown) => {
        req.payload.logger.warn({ err }, 'Recorder: failed to write upload log')
      })

      return Response.json(media, { status: 201 })
    } catch (err) {
      req.payload.logger.error({ err }, 'Recorder upload error')
      return Response.json({ error: 'Upload failed', details: String(err) }, { status: 500 })
    }
  },
}
