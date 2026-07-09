import { getPayload } from 'payload'
import config from '@payload-config'
import { getAccountFromRequest } from '@/lib/oauth/server/account-auth'
import { getLiveKitEnv, getRoomService, isAnonIdentity, readRoomMeta } from '@/lib/livekit/server'

/**
 * POST /api/livekit/session/config — host-only live reconfigure of a session.
 *
 * Body: { room: string; openSession: boolean }
 * Returns: { ok: true, removed: number }
 *
 * Only the room's host (the account that created it) may change its access.
 * Updating room metadata propagates to every connected client instantly via
 * LiveKit's RoomMetadataChanged event. Turning a session OFF also immediately
 * removes any anonymous participants already in the room — booted clients see a
 * PARTICIPANT_REMOVED disconnect, which the UI explains.
 */

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
  } | null
  const room = body?.room?.trim()
  if (!room || typeof body?.openSession !== 'boolean') {
    return Response.json({ error: 'room and openSession are required' }, { status: 400 })
  }
  const openSession = body.openSession

  const payload = await getPayload({ config: await config })
  const account = await getAccountFromRequest(payload, request.headers)
  if (!account) {
    return Response.json({ error: 'Sign in required' }, { status: 401 })
  }

  const svc = getRoomService(env)
  const meta = await readRoomMeta(room, svc)
  if (!meta) {
    return Response.json({ error: 'Session not found' }, { status: 404 })
  }
  if (meta.host !== account.figmaId) {
    return Response.json({ error: 'Only the host can change this session' }, { status: 403 })
  }

  await svc.updateRoomMetadata(room, JSON.stringify({ ...meta, openSession }))

  let removed = 0
  if (!openSession) {
    // Boot everyone who joined anonymously; signed-in participants stay.
    const participants = await svc.listParticipants(room)
    await Promise.all(
      participants
        .filter((p) => isAnonIdentity(p.identity))
        .map(async (p) => {
          await svc.removeParticipant(room, p.identity)
          removed++
        }),
    )
  }

  return Response.json({ ok: true, removed })
}
