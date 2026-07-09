import { getPayload } from 'payload'
import config from '@payload-config'
import { getAccountFromRequest } from '@/lib/oauth/server/account-auth'
import { signMediaUpload } from '@/lib/figmaContent'

/**
 * POST /api/session-recording/upload-url
 *
 * Body: { filename: string; mimeType: string }
 * Returns: { uploadUrl, filename }
 *
 * Browser-facing sibling of the recorder's upload-url endpoint: authenticates
 * via the `pp_account` cookie (the session canvas runs in the browser, where the
 * recorder's Bearer session token isn't readable) and returns a presigned S3 PUT
 * URL so the composited recording uploads straight to storage.
 */

export async function POST(request: Request) {
  const payload = await getPayload({ config: await config })
  const account = await getAccountFromRequest(payload, request.headers)
  if (!account) {
    return Response.json({ error: 'Sign in required' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    filename?: string
    mimeType?: string
  } | null
  const filename = body?.filename
  const mimeType = body?.mimeType
  if (!filename || !mimeType) {
    return Response.json({ error: 'filename and mimeType are required' }, { status: 400 })
  }

  try {
    const signed = await signMediaUpload(filename, mimeType)
    return Response.json(signed)
  } catch (err) {
    payload.logger.error({ err }, 'session-recording upload-url error')
    return Response.json({ error: 'Failed to get upload URL' }, { status: 500 })
  }
}
