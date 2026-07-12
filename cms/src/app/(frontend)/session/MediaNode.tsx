'use client'

import { memo, useState } from 'react'
import { ParticipantTile, useTrackToggle } from '@livekit/components-react'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import { Track } from 'livekit-client'
import type { NodeProps, Node } from '@xyflow/react'
import { extraLabel, trackName } from './mediaTracks'

// A media feed rendered as a React Flow node.
//
// The primary node for each participant is their camera tile — LiveKit's
// <ParticipantTile> (video, name, mic-muted + speaking indicators), and for the
// LOCAL participant, camera + microphone toggles right on the tile. This is the
// familiar, unified interface: one tile per person, camera and mic together. The
// mic control drives the participant's microphone (not this tile's video track),
// via LiveKit's own useTrackToggle.
//
// Extra feeds (a second camera, a screen share) are their own nodes with a remove
// control. They never carry mic controls — the mic lives on the primary tile.

export type MediaNodeData = {
  trackRef: TrackReferenceOrPlaceholder
  // True for the local participant's own feeds.
  local?: boolean
  // True for a participant's primary camera tile (the one that owns camera+mic).
  isPrimary?: boolean
  // Present only for the local participant's own *extra* feeds.
  onRemove?: () => void
}

export type MediaFlowNode = Node<MediaNodeData, 'media'>

// Camera + mic toggles for the local participant's primary tile. Uses LiveKit's
// useTrackToggle so the mic button toggles the microphone and the camera button
// toggles the camera — each acting on the right source, not on this tile's track.
function LocalTileControls() {
  const camera = useTrackToggle({ source: Track.Source.Camera })
  const mic = useTrackToggle({ source: Track.Source.Microphone })
  return (
    <div className="media-node__controls nodrag">
      <button
        type="button"
        className={`media-node__ctl${camera.enabled ? '' : ' media-node__ctl--off'}`}
        onClick={() => void camera.toggle()}
        disabled={camera.pending}
        title={camera.enabled ? 'Turn camera off' : 'Turn camera on'}
        aria-label={camera.enabled ? 'Turn camera off' : 'Turn camera on'}
      >
        {camera.enabled ? '🎥' : '📷'}
      </button>
      <button
        type="button"
        className={`media-node__ctl${mic.enabled ? '' : ' media-node__ctl--off'}`}
        onClick={() => void mic.toggle()}
        disabled={mic.pending}
        title={mic.enabled ? 'Mute microphone' : 'Unmute microphone'}
        aria-label={mic.enabled ? 'Mute microphone' : 'Unmute microphone'}
      >
        {mic.enabled ? '🎙️' : '🔇'}
      </button>
    </div>
  )
}

function MediaNodeImpl({ data }: NodeProps<MediaFlowNode>) {
  const { trackRef, local, isPrimary, onRemove } = data
  const source = trackRef.source
  const isScreenShare = source === Track.Source.ScreenShare
  const participant = trackRef.participant
  const authenticated = participant.attributes?.authenticated === 'true'
  const [avatarFailed, setAvatarFailed] = useState(false)
  const label = extraLabel(trackName(trackRef))

  // For signed-in camera tiles, mount the Figma avatar ONCE and let CSS reveal it
  // when the camera is off — driven by the tile's reactive `data-lk-video-muted`
  // attribute. Mounting once means it loads a single time, stays browser-cached,
  // and toggling the camera never refetches or flickers. Guests / missing avatars
  // fall back to LiveKit's placeholder (img errors → we stop rendering it).
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
      {/* Local primary camera tile → unified camera + mic controls. */}
      {local && isPrimary && !isScreenShare && <LocalTileControls />}
      {/* Local extra feed (second camera / screen share) → remove. */}
      {local && onRemove && (
        <div className="media-node__controls nodrag">
          <button
            type="button"
            className="media-node__ctl media-node__ctl--remove"
            onClick={onRemove}
            title="Remove this feed"
            aria-label="Remove feed"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

// Memoize: React Flow re-renders nodes often, and the tile only needs to update
// when its track reference or injected handlers change.
export const MediaNode = memo(MediaNodeImpl)
