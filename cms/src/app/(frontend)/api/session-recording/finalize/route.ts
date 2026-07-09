import { getPayload } from 'payload'
import config from '@payload-config'
import { getAccountFromRequest } from '@/lib/oauth/server/account-auth'
import { getLiveKitEnv, getRoomService, readRoomMeta } from '@/lib/livekit/server'

/**
 * POST /api/session-recording/finalize
 *
 * Body (JSON, no binary — the file is already in S3 via the presigned PUT):
 *   { room, filename, mimeType, filesize, startedAt, durationMs, participants[] }
 *
 * Creates the Media doc (Media's afterChange enrichment fills in
 * thumbnail/duration asynchronously) and the SessionRecordings doc that points
 * at it. Only the room's host may finalize. As a safety net it also clears the
 * `recording` flag in room metadata, so the indicator never gets stuck on if the
 * host's explicit stop call was lost.
 */

interface ParticipantSnapshot {
  identity?: string
  name?: string
}

export async function POST(request: Request) {
  const payload = await getPayload({ config: await config })
  const account = await getAccountFromRequest(payload, request.headers)
  if (!account) {
    return Response.json({ error: 'Sign in required' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    room?: string
    filename?: string
    mimeType?: string
    filesize?: number
    startedAt?: string
    durationMs?: number
    participants?: ParticipantSnapshot[]
  } | null

  const { room, filename, mimeType, filesize, startedAt, durationMs } = body ?? {}
  if (!room || !filename || !mimeType || filesize === undefined || !startedAt) {
    return Response.json(
      { error: 'room, filename, mimeType, filesize, and startedAt are required' },
      { status: 400 },
    )
  }

  // Host-gate: only the account that created the room may store its recording.
  let env
  try {
    env = getLiveKitEnv()
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
  const svc = getRoomService(env)
  const meta = await readRoomMeta(room, svc)
  if (!meta) {
    return Response.json({ error: 'Session not found' }, { status: 404 })
  }
  if (meta.host !== account.figmaId) {
    return Response.json({ error: 'Only the host can record this session' }, { status: 403 })
  }

  const startedDate = new Date(startedAt)
  const titleStamp = startedDate.toISOString().slice(0, 16).replace('T', ' ')

  try {
    // Create the media doc from the already-uploaded S3 file (metadata only;
    // filesRequiredOnCreate: false lets Payload accept a create without req.file).
    const media = await payload.create({
      collection: 'media',
      data: {
        alt: `Session recording ${titleStamp}`,
        filename,
        mimeType,
        filesize,
        uploadedBy: account.id,
      },
      overrideAccess: true,
    })

    const participants = Array.isArray(body?.participants)
      ? body!.participants
          .filter((p) => p && (p.identity || p.name))
          .slice(0, 50)
          .map((p) => ({ identity: p.identity ?? '', name: p.name ?? '' }))
      : []

    const recording = await payload.create({
      collection: 'session-recordings',
      data: {
        video: media.id,
        host: account.id,
        room,
        status: 'ready',
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: typeof durationMs === 'number' ? durationMs : undefined,
        participants,
      },
      overrideAccess: true,
    })

    // Safety net: make sure the recording indicator is cleared for everyone.
    if (meta.recording) {
      await svc
        .updateRoomMetadata(room, JSON.stringify({ ...meta, recording: false, recordingStartedAt: undefined }))
        .catch((err: unknown) => payload.logger.warn({ err }, 'failed to clear recording flag'))
    }

    return Response.json(recording, { status: 201 })
  } catch (err) {
    payload.logger.error({ err }, 'session-recording finalize error')
    return Response.json({ error: 'Failed to save recording', details: String(err) }, { status: 500 })
  }
}
