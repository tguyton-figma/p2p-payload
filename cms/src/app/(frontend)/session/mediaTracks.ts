import { Track } from 'livekit-client'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'

// Canvas-driven media identity.
//
// There is no "primary" track. Every feed on the canvas is a track we published
// explicitly — the node's presence IS the published state. Add a node → publish;
// remove it → unpublish. Because we publish every track ourselves, we control
// every track name, and we use it for two things:
//   1. A stable node id for the track's whole life (mute never changes it), and
//   2. A human label peers can render without any extra signalling.
// The name format is:  <uri-encoded label>:<uuid>
// (encodeURIComponent escapes ':' and '/', so neither collides with our id
// separators or the label/uuid split.)

export function mediaTrackName(label: string): string {
  return `${encodeURIComponent(label)}:${crypto.randomUUID()}`
}

/** The human label encoded into a track name (device name), or null. */
export function mediaLabel(name: string | undefined | null): string | null {
  if (!name) return null
  const encoded = name.split(':')[0] ?? ''
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

// One node per track, keyed by the name we assigned at publish (stable across
// mute). Falls back to sid for any unnamed track we didn't publish (defensive).
export const mediaNodeId = (t: TrackReferenceOrPlaceholder): string => {
  const key = trackName(t) || trackSid(t) || 'pending'
  return `${t.participant.identity}/${t.source}/${key}`
}

// A signature that changes when the underlying track is swapped, so the reconcile
// effect refreshes the node's trackRef.
export const mediaNodeSig = (t: TrackReferenceOrPlaceholder): string =>
  `${mediaNodeId(t)}:${trackSid(t) ?? 'ph'}`
