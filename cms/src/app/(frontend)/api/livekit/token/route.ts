import { AccessToken } from 'livekit-server-sdk'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getAccountFromRequest } from '@/lib/oauth/server/account-auth'
import { ANON_PREFIX, getLiveKitEnv, getRoomService, readRoomMeta } from '@/lib/livekit/server'

/**
 * POST /api/livekit/token — mint a short-lived LiveKit access token.
 *
 * Body: { room: string; openSession?: boolean; name?: string }
 * Returns: { token, url, identity, name }
 *
 * Access depends on the room's "Open Session" state (stored in room metadata):
 *  - Room does not exist yet → the caller is CREATING it and must be signed in;
 *    they become the host and `openSession` from the body is applied.
 *  - Room is open  → anyone may join (signed-in OR anonymous guest/agent).
 *  - Room is closed → only signed-in accounts may join (401 otherwise).
 *
 * Identity/name for signed-in users are server-trusted (from the Account); guests
 * get an unspoofable `anon-<uuid>` identity and a sanitized display name. The API
 * secret stays on the server; the browser receives only a room-scoped JWT + URL.
 */

const TTL = '1h'

// Keep guest display names short and single-line.
function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\r\n]/g, ' ').trim().slice(0, 40)
}

export async function POST(request: Request) {
  let env
  try {
    env = getLiveKitEnv()
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }

  const body = (await request.json().catch(() => null)) as {
    room?: string
    openSession?: boolean
    name?: string
  } | null
  const room = body?.room?.trim()
  if (!room) {
    return Response.json({ error: 'room is required' }, { status: 400 })
  }

  const payload = await getPayload({ config: await config })
  const account = await getAccountFromRequest(payload, request.headers)

  const svc = getRoomService(env)
  const meta = await readRoomMeta(room, svc)

  if (!meta) {
    // Creating the room — must be signed in; caller becomes the host.
    if (!account) {
      return Response.json({ error: 'Sign in to start a session' }, { status: 401 })
    }
    await svc.createRoom({
      name: room,
      metadata: JSON.stringify({ openSession: Boolean(body?.openSession), host: account.figmaId }),
    })
  } else if (!meta.openSession && !account) {
    // Existing, closed session — members only.
    return Response.json(
      { error: 'This session is members-only — sign in with Figma to join.' },
      { status: 401 },
    )
  }

  // Build identity/name: server-trusted for accounts, anonymous for guests.
  const identity = account ? account.figmaId : `${ANON_PREFIX}${crypto.randomUUID()}`
  const name = account ? (account.handle ?? account.figmaId) : sanitizeName(body?.name) || 'Guest'

  const at = new AccessToken(env.apiKey, env.apiSecret, {
    identity,
    name,
    ttl: TTL,
    attributes: { authenticated: account ? 'true' : 'false' },
  })
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true })
  const token = await at.toJwt()

  return Response.json({ token, url: env.url, identity, name })
}
