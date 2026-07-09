import { AccessToken } from 'livekit-server-sdk'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getAccountFromRequest } from '@/lib/oauth/server/account-auth'

/**
 * POST /api/livekit/token — mint a short-lived LiveKit access token.
 *
 * Body: { room: string }
 * Returns: { token, url, identity, name }
 *
 * Requires a signed-in Account (the httpOnly `pp_account` cookie set at
 * sign-in). Identity and display name come from the account — server-trusted,
 * never from the request body. The LiveKit API secret stays on the server; the
 * browser receives only a signed, room-scoped JWT plus the server URL (so no
 * NEXT_PUBLIC_ var is needed).
 */

const TTL = '1h'

export async function POST(request: Request) {
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  const url = process.env.LIVEKIT_URL

  if (!apiKey || !apiSecret || !url) {
    const missing = [
      !apiKey && 'LIVEKIT_API_KEY',
      !apiSecret && 'LIVEKIT_API_SECRET',
      !url && 'LIVEKIT_URL',
    ].filter(Boolean)
    return Response.json(
      { error: `LiveKit not configured — missing ${missing.join(', ')}` },
      { status: 500 },
    )
  }

  const body = (await request.json().catch(() => null)) as { room?: string } | null
  const room = body?.room?.trim()
  if (!room) {
    return Response.json({ error: 'room is required' }, { status: 400 })
  }

  // Auth required — identity and name come from the signed-in Account.
  const payload = await getPayload({ config: await config })
  const account = await getAccountFromRequest(payload, request.headers)
  if (!account) {
    return Response.json({ error: 'Sign in required' }, { status: 401 })
  }
  const identity = account.figmaId
  const name = account.handle ?? account.figmaId

  const at = new AccessToken(apiKey, apiSecret, { identity, name, ttl: TTL })
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true })
  const token = await at.toJwt()

  return Response.json({ token, url, identity, name })
}
