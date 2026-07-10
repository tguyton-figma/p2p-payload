'use client'

import { memo, useState } from 'react'
import { ParticipantTile } from '@livekit/components-react'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import { Track } from 'livekit-client'
import type { NodeProps, Node } from '@xyflow/react'

// A single participant's camera, rendered as a React Flow node. LiveKit's
// <ParticipantTile> handles the video element, name label, and mute/speaking
// indicators for us — it reads everything it needs from the track reference,
// which is supplied by <LiveKitRoom> higher up the tree (the room context wraps
// the whole canvas, so hooks/components inside nodes just work).

export type ParticipantNodeData = { trackRef: TrackReferenceOrPlaceholder }

// React Flow's Node type is generic over the data payload.
export type ParticipantFlowNode = Node<ParticipantNodeData, 'participant'>

function ParticipantNodeImpl({ data }: NodeProps<ParticipantFlowNode>) {
  const trackRef = data.trackRef
  // Screen shares are landscape — give them a wider 16:9 tile than camera feeds.
  const isScreenShare = trackRef.source === Track.Source.ScreenShare
  const participant = trackRef.participant
  const authenticated = participant.attributes?.authenticated === 'true'
  const [avatarFailed, setAvatarFailed] = useState(false)

  // For signed-in camera tiles, mount the Figma avatar ONCE and let CSS reveal it
  // when the camera is off — driven by the tile's reactive `data-lk-video-muted`
  // attribute. Mounting once (rather than only while the camera is off) means it
  // loads a single time, stays browser-cached, and toggling the camera never
  // refetches or flickers. Guests / missing avatars fall back to LiveKit's
  // placeholder (img errors → we stop rendering it).
  const showAvatar = !isScreenShare && authenticated && !avatarFailed

  return (
    <div
      className={`participant-node${isScreenShare ? ' participant-node--screen' : ''}${
        showAvatar ? ' participant-node--has-avatar' : ''
      }`}
    >
      {/*
        The tile itself is the drag handle (the whole node moves). Interactive
        LiveKit controls inside the tile carry the `.nodrag` class so a click on
        them doesn't start a node drag.
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
    </div>
  )
}

// Memoize: React Flow re-renders nodes often, and the tile only needs to update
// when its track reference changes.
export const ParticipantNode = memo(ParticipantNodeImpl)
