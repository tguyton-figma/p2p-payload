/**
 * Recorder Finalize Session Endpoint
 *
 * POST /api/recorder/finalize-session
 *
 * Called by the client app after all individual media files have been
 * uploaded (via upload-url → S3 PUT → finalize). Creates a Recordings
 * document that groups the media tracks with sync offsets for playback.
 *
 * Headers:
 *   Authorization: Bearer <sessionToken>
 *
 * Body (JSON):
 *   {
 *     startedAt: string,          // ISO 8601 — when the recording session began
 *     tracks: [
 *       {
 *         mediaId: string,        // ID of the media document created by /finalize
 *         sourceType: string,     // camera | microphone | screen | window | tab
 *         label?: string,         // human-readable source name
 *         offsetMs: number,       // ms between session t=0 and this track's first frame
 *         durationMs: number      // track length in ms
 *       }
 *     ]
 *   }
 */

import type { Endpoint } from 'payload'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ACCOUNTS = 'accounts' as any

const VALID_SOURCE_TYPES = ['camera', 'microphone', 'screen', 'window', 'tab'] as const
type SourceType = (typeof VALID_SOURCE_TYPES)[number]

interface TrackInput {
  mediaId: string
  sourceType: SourceType
  label?: string
  offsetMs: number
  durationMs: number
}

interface FinalizeSessionBody {
  startedAt: string
  tracks: TrackInput[]
}

export const recorderFinalizeSession: Endpoint = {
  path: '/recorder/finalize-session',
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

    // Parse body
    const body = (await req.json?.()) as FinalizeSessionBody | undefined

    if (!body?.startedAt || !Array.isArray(body?.tracks) || body.tracks.length === 0) {
      return Response.json(
        { error: 'startedAt and at least one track are required' },
        { status: 400 },
      )
    }

    for (const track of body.tracks) {
      if (!track.mediaId || !track.sourceType || track.durationMs === undefined) {
        return Response.json(
          { error: 'Each track requires mediaId, sourceType, and durationMs' },
          { status: 400 },
        )
      }
      if (!VALID_SOURCE_TYPES.includes(track.sourceType)) {
        return Response.json(
          { error: `Invalid sourceType "${track.sourceType}". Must be one of: ${VALID_SOURCE_TYPES.join(', ')}` },
          { status: 400 },
        )
      }
    }

    try {
      const recording = await req.payload.create({
        collection: 'recordings',
        data: {
          account: account.id,
          startedAt: body.startedAt,
          tracks: body.tracks.map((t) => ({
            media: t.mediaId,
            sourceType: t.sourceType,
            label: t.label,
            offsetMs: t.offsetMs ?? 0,
            durationMs: t.durationMs,
          })),
        },
        overrideAccess: true,
        req,
      })

      // Fire-and-forget log
      req.payload
        .create({
          collection: 'logs',
          data: {
            subject: 'recording.created',
            source: 'recorder',
            accountId: account.id,
            data: {
              recordingId: recording.id,
              trackCount: body.tracks.length,
              accountHandle: account.handle,
              accountEmail: account.email,
            },
          },
          overrideAccess: true,
          req,
        })
        .catch((err: unknown) => {
          req.payload.logger.warn({ err }, 'Recorder: failed to write finalize-session log')
        })

      return Response.json(recording, { status: 201 })
    } catch (err) {
      req.payload.logger.error({ err }, 'Recorder finalize-session error')
      return Response.json(
        { error: 'Failed to create recording', details: String(err) },
        { status: 500 },
      )
    }
  },
}
