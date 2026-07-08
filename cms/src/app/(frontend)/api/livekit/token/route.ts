import { AccessToken } from 'livekit-server-sdk'
import { getPayload } from 'payload'
import config from '@payload-config'

/**
 * POST /api/livekit/token — mint a short-lived LiveKit access token.
 *
 * Body: { room: string, identity?: string, name?: string }
 * Returns: { token, url, identity, name }
 *
 * The LiveKit API secret never leaves the server; the browser receives only a
 * signed, room-scoped JWT plus the server URL to connect to (so no
 * NEXT_PUBLIC_ var is needed).
 *
 * Auth: if an `Authorization: Bearer <sessionToken>` header is present it is
 * validated against the Accounts collection and the identity/name are taken
 * from the account (server-trusted). Without it, the caller's `identity`/`name`
 * are used — this open path exists so the /session test harness (which has no
 * account auth yet) can connect. Require auth before production.
 */

const TTL = '1h'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ACCOUNTS = 'accounts' as any

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

  const body = (await request.json().catch(() => null)) as
    | { room?: string; identity?: string; name?: string }
    | null
  const room = body?.room?.trim()
  if (!room) {
    return Response.json({ error: 'room is required' }, { status: 400 })
  }

  // Prefer a server-trusted identity when a session token is supplied.
  let identity = body?.identity?.trim()
  let name = body?.name?.trim()

  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization')
  const sessionToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  if (sessionToken) {
    const payload = await getPayload({ config: await config })
    const { docs } = await payload.find({
      collection: ACCOUNTS,
      where: { sessionToken: { equals: sessionToken } },
      limit: 1,
      overrideAccess: true,
    })
    if (!docs.length) {
      return Response.json({ error: 'Invalid or expired session token' }, { status: 401 })
    }
    const account = docs[0] as { figmaId: string; handle?: string }
    identity = account.figmaId
    name = account.handle ?? name
  }

  // Fall back to a generated identity for the unauthenticated test path.
  if (!identity) identity = crypto.randomUUID()
  if (!name) name = identity

  const at = new AccessToken(apiKey, apiSecret, { identity, name, ttl: TTL })
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true })
  const token = await at.toJwt()

  return Response.json({ token, url, identity, name })
}
