import { Track } from 'livekit-client'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'

// Node identity for the session canvas.
//
// Each participant has ONE primary tile — their camera + microphone, managed by
// LiveKit's defaults (setCameraEnabled / setMicrophoneEnabled), with the camera
// and mic controls living on the tile itself. That primary camera keeps the
// stable `${identity}/${source}` id so its placeholder (camera-off → avatar) never
// recreates the node, and the mic is NOT a node — it's controlled from the tile.
//
// Beyond that, a participant can add extra feeds (a second camera, a screen
// share, …). Those we publishTrack() ourselves with a name prefixed by
// EXTRA_PREFIX, so both we and remote peers can tell them apart deterministically
// and give each a unique node id. The user's label (device name) is encoded in the
// track name so peers can show it without extra signalling:
//   pp-extra:<uri-encoded label>:<uuid>

export const EXTRA_PREFIX = 'pp-extra:'

export function extraTrackName(label: string): string {
  return `${EXTRA_PREFIX}${encodeURIComponent(label)}:${crypto.randomUUID()}`
}

export function isExtraTrackName(name: string | undefined | null): name is string {
  return !!name && name.startsWith(EXTRA_PREFIX)
}

/** The human label encoded into an extra track's name, or null for primary tracks. */
export function extraLabel(name: string | undefined | null): string | null {
  if (!isExtraTrackName(name)) return null
  const encoded = name.slice(EXTRA_PREFIX.length).split(':')[0] ?? ''
  try {
    return decodeURIComponent(encoded) || null
  } catch {
    return encoded || null
  }
}

export const trackName = (t: TrackReferenceOrPlaceholder): string | undefined =>
  'publication' in t ? t.publication?.trackName : undefined

export const trackSid = (t: TrackReferenceOrPlaceholder): string | undefined =>
  'publication' in t ? t.publication?.trackSid : undefined

export const isAudioSource = (source: Track.Source): boolean => source === Track.Source.Microphone

// One node per track. Extra tracks get a unique id off their name; the primary
// camera (and any placeholder) keeps the per-source id so camera-off never
// recreates the tile.
export const mediaNodeId = (t: TrackReferenceOrPlaceholder): string => {
  const name = trackName(t)
  const base = `${t.participant.identity}/${t.source}`
  return isExtraTrackName(name) ? `${base}/${name}` : base
}

// A signature that also changes when a placeholder becomes a real track (or the
// underlying track is swapped), so the reconcile effect refreshes the trackRef.
export const mediaNodeSig = (t: TrackReferenceOrPlaceholder): string => {
  const sid = 'publication' in t && t.publication ? t.publication.trackSid : 'ph'
  return `${mediaNodeId(t)}:${sid}`
}
