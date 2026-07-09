import { getPayload } from 'payload'
import config from '@payload-config'
import { getAccountFromRequest } from '@/lib/oauth/server/account-auth'
import { getLiveKitEnv, getRoomService, readRoomMeta } from '@/lib/livekit/server'

/**
 * POST /api/livekit/session/recording — host-only recording-state flip.
 *
 * Body: { room: string; recording: boolean }
 * Returns: { ok: true }
 *
 * This only broadcasts recording *state* to every client (via a `recording`
 * flag in room metadata, which propagates instantly through RoomMetadataChanged
 * so all participants see the indicator). The actual capture happens in the
 * host's browser; the CMS document is created separately by the finalize
 * endpoint once the file is uploaded. Mirrors the Open Session gate: only the
 * account that created the room may change it.
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
    recording?: boolean
  } | null
  const room = body?.room?.trim()
  if (!room || typeof body?.recording !== 'boolean') {
    return Response.json({ error: 'room and recording are required' }, { status: 400 })
  }
  const recording = body.recording

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
    return Response.json({ error: 'Only the host can record this session' }, { status: 403 })
  }

  const next = {
    ...meta,
    recording,
    // Stamp a fresh start time when turning on; clear it when turning off so
    // every client's elapsed timer stays in sync off a single source.
    recordingStartedAt: recording ? new Date().toISOString() : undefined,
  }
  await svc.updateRoomMetadata(room, JSON.stringify(next))

  return Response.json({ ok: true })
}
