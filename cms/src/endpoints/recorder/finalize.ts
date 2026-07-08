/**
 * Recorder Finalize Endpoint
 *
 * POST /api/recorder/finalize
 *
 * Creates the Payload media document after the file has already been
 * uploaded directly to S3 via the presigned URL from /api/recorder/upload-url.
 * This request contains only JSON metadata — no file binary — so it is well
 * under Lambda's payload limit regardless of recording length.
 *
 * Body (JSON):
 *   { alt, filename, mimeType, filesize }
 *   - filename: the safe filename returned by /api/recorder/upload-url
 *   - filesize: byte length of the recording (available from the Blob)
 *
 * Headers:
 *   Authorization: Bearer <sessionToken>
 */

import type { Endpoint } from 'payload'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ACCOUNTS = 'accounts' as any

export const recorderFinalize: Endpoint = {
  path: '/recorder/finalize',
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

    const account = docs[0] as any

    // Parse JSON body — no file binary
    const body = (await req.json?.()) as {
      alt?: string
      filename?: string
      mimeType?: string
      filesize?: number
    } | undefined

    const { alt, filename, mimeType, filesize } = body ?? {}

    if (!alt || !filename || !mimeType || filesize === undefined) {
      return Response.json(
        { error: 'alt, filename, mimeType, and filesize are required' },
        { status: 400 },
      )
    }

    try {
      // Create the media document with file metadata from the already-uploaded S3 file.
      // filesRequiredOnCreate: false on the Media collection means Payload accepts
      // creates without req.file and uses data fields directly.
      const media = await req.payload.create({
        collection: 'media',
        data: {
          alt,
          filename,
          mimeType,
          filesize,
          uploadedBy: account.id,
        },
        overrideAccess: true,
        req,
      })

      // Fire-and-forget log entry
      req.payload
        .create({
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
              uploadMethod: 'presigned',
            },
          },
          overrideAccess: true,
          req,
        })
        .catch((err: unknown) => {
          req.payload.logger.warn({ err }, 'Recorder: failed to write finalize log')
        })

      return Response.json(media, { status: 201 })
    } catch (err) {
      req.payload.logger.error({ err }, 'Recorder finalize error')
      return Response.json({ error: 'Failed to create media document', details: String(err) }, { status: 500 })
    }
  },
}
