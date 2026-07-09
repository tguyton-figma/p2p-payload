import { RoomServiceClient } from 'livekit-server-sdk'

/**
 * Shared server-side LiveKit helpers.
 *
 * The token route and the session-config route both need the LiveKit env, a
 * RoomServiceClient, and a way to read a room's "Open Session" state. Room
 * metadata is our source of truth for per-session access: a JSON blob
 * `{ openSession, host }` where `host` is the creating account's figmaId.
 */

export interface LiveKitEnv {
  apiKey: string
  apiSecret: string
  url: string
}

/** Room metadata schema (stored as a JSON string on the LiveKit room). */
export interface RoomMeta {
  openSession: boolean
  host: string // figmaId of the account that created the room
  // Recording state, broadcast to every client via RoomMetadataChanged so all
  // participants see the "recording" indicator. Only the host may flip it.
  recording?: boolean
  recordingStartedAt?: string // ISO timestamp, set when recording turns on
}

// Anonymous participants get an `anon-<uuid>` identity (authed users get their
// figmaId). The prefix is set server-side, so it can't be spoofed by clients —
// it's how we tell guests apart when enforcing a closed session.
export const ANON_PREFIX = 'anon-'
export const isAnonIdentity = (identity: string): boolean => identity.startsWith(ANON_PREFIX)

/**
 * Read the LiveKit env, throwing a labelled error naming any missing var. Callers
 * catch this and return a 500 so misconfiguration fails loudly (never silently).
 */
export function getLiveKitEnv(): LiveKitEnv {
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  const url = process.env.LIVEKIT_URL
  const missing = [
    !apiKey && 'LIVEKIT_API_KEY',
    !apiSecret && 'LIVEKIT_API_SECRET',
    !url && 'LIVEKIT_URL',
  ].filter(Boolean)
  if (missing.length) {
    throw new Error(`LiveKit not configured — missing ${missing.join(', ')}`)
  }
  return { apiKey: apiKey!, apiSecret: apiSecret!, url: url! }
}

/**
 * A RoomServiceClient for server-side room ops (create, metadata, list/remove
 * participants). Its host is the HTTP(S) form of LIVEKIT_URL (which is a
 * `wss://` websocket URL for the client SDK).
 */
export function getRoomService(env: LiveKitEnv = getLiveKitEnv()): RoomServiceClient {
  const httpUrl = env.url.replace(/^ws/, 'http') // wss:// -> https://, ws:// -> http://
  return new RoomServiceClient(httpUrl, env.apiKey, env.apiSecret)
}

/**
 * Read a room's metadata, or null if the room doesn't exist yet. `listRooms`
 * with a name filter returns an empty array for an unknown room.
 */
export async function readRoomMeta(
  room: string,
  svc: RoomServiceClient = getRoomService(),
): Promise<RoomMeta | null> {
  const [info] = await svc.listRooms([room])
  if (!info) return null
  if (!info.metadata) return { openSession: false, host: '' }
  try {
    const parsed = JSON.parse(info.metadata) as Partial<RoomMeta>
    return {
      openSession: Boolean(parsed.openSession),
      host: parsed.host ?? '',
      recording: Boolean(parsed.recording),
      recordingStartedAt: parsed.recordingStartedAt,
    }
  } catch {
    return { openSession: false, host: '' }
  }
}
