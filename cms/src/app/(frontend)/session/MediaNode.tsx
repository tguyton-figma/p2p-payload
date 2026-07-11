'use client'

import { memo, useEffect, useState } from 'react'
import { ParticipantTile } from '@livekit/components-react'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import { Track, TrackEvent } from 'livekit-client'
import type { NodeProps, Node } from '@xyflow/react'
import { mediaLabel, trackName } from './mediaTracks'

// A single media feed rendered as a React Flow node — the canvas's atomic unit,
// and the single source of truth for what a participant is publishing. One node
// maps to one LiveKit track: a camera, a screen share, or a microphone. There is
// no privileged "primary" feed and no separate control bar — a feed exists
// because someone added it, and its controls live on the node itself.
//
// LiveKit's <ParticipantTile> handles the video element, name label, and
// mute/speaking indicators for video sources; audio sources render as a compact
// card (playback is handled once by <RoomAudioRenderer> up the tree, so the card
// never attaches audio).
//
// For the local participant's own feeds we inject `onToggleMute` / `onRemove`
// (mute keeps the track published; remove unpublishes it). These are never
// serialized over the wire.

export type MediaNodeData = {
  trackRef: TrackReferenceOrPlaceholder
  // True for the local participant's own feeds — only they get controls.
  local?: boolean
  onRemove?: () => void
  onToggleMute?: () => void
}

// React Flow's Node type is generic over the data payload.
export type MediaFlowNode = Node<MediaNodeData, 'media'>

function displayName(t: TrackReferenceOrPlaceholder): string {
  const p = t.participant
  return (p.name && p.name.trim()) || p.identity
}

// Reactive muted state for a track reference (re-renders on mute/unmute events),
// so an on-node mute button reflects the true state without polling.
function useMuted(trackRef: TrackReferenceOrPlaceholder): boolean {
  const pub = 'publication' in trackRef ? trackRef.publication : undefined
  const [muted, setMuted] = useState(!!pub?.isMuted)
  useEffect(() => {
    setMuted(!!pub?.isMuted)
    if (!pub) return
    const update = () => setMuted(!!pub.isMuted)
    pub.on(TrackEvent.Muted, update)
    pub.on(TrackEvent.Unmuted, update)
    return () => {
      pub.off(TrackEvent.Muted, update)
      pub.off(TrackEvent.Unmuted, update)
    }
  }, [pub])
  return muted
}

function NodeControls({
  muted,
  onToggleMute,
  onRemove,
}: {
  muted: boolean
  onToggleMute?: () => void
  onRemove?: () => void
}) {
  return (
    <div className="media-node__controls nodrag">
      {onToggleMute && (
        <button
          type="button"
          className={`media-node__ctl${muted ? ' media-node__ctl--active' : ''}`}
          onClick={onToggleMute}
          title={muted ? 'Unmute' : 'Mute'}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? '🔇' : '🎙'}
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          className="media-node__ctl media-node__ctl--remove"
          onClick={onRemove}
          title="Remove this feed"
          aria-label="Remove feed"
        >
          ✕
        </button>
      )}
    </div>
  )
}

function MediaNodeImpl({ data }: NodeProps<MediaFlowNode>) {
  const { trackRef, local, onRemove, onToggleMute } = data
  const source = trackRef.source
  const participant = trackRef.participant
  const authenticated = participant.attributes?.authenticated === 'true'
  const [avatarFailed, setAvatarFailed] = useState(false)
  const muted = useMuted(trackRef)
  const label = mediaLabel(trackName(trackRef))

  // Audio feed — a compact card, not a video tile.
  if (source === Track.Source.Microphone) {
    return (
      <div className={`media-node media-node--audio${muted ? ' media-node--muted' : ''}`}>
        <span className="media-node__mic" aria-hidden>
          {muted ? '🔇' : '🎤'}
        </span>
        <span className="media-node__audio-label">
          {displayName(trackRef)}
          {label ? ` · ${label}` : ''}
        </span>
        {local && (
          <NodeControls muted={muted} onToggleMute={onToggleMute} onRemove={onRemove} />
        )}
      </div>
    )
  }

  const isScreenShare = source === Track.Source.ScreenShare

  // For signed-in camera tiles, mount the Figma avatar ONCE and let CSS reveal it
  // when the camera is muted — driven by the tile's reactive `data-lk-video-muted`
  // attribute. Mounting once means it loads a single time, stays browser-cached,
  // and toggling mute never refetches or flickers. Guests / missing avatars fall
  // back to LiveKit's placeholder (img errors → we stop rendering it).
  const showAvatar = !isScreenShare && authenticated && !avatarFailed

  return (
    <div
      className={`media-node participant-node${isScreenShare ? ' participant-node--screen' : ''}${
        showAvatar ? ' participant-node--has-avatar' : ''
      }`}
    >
      {/*
        The tile itself is the drag handle (the whole node moves). Interactive
        controls carry `.nodrag` so a click on them doesn't start a node drag.
      */}
      <ParticipantTile trackRef={trackRef} className="participant-node__tile" />
      {showAvatar && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="participant-node__avatar"
          src={`/api/figma/avatar?figmaId=${encodeURIComponent(participant.identity)}`}
          alt=""
          onError={() => setAvatarFailed(true)}
        />
      )}
      {label && <span className="media-node__badge">{label}</span>}
      {local && <NodeControls muted={muted} onToggleMute={onToggleMute} onRemove={onRemove} />}
    </div>
  )
}

// Memoize: React Flow re-renders nodes often, and the tile only needs to update
// when its track reference or injected handlers change.
export const MediaNode = memo(MediaNodeImpl)
