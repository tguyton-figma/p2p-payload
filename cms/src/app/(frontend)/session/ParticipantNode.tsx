'use client'

import { memo } from 'react'
import { ParticipantTile } from '@livekit/components-react'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
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
  return (
    <div className="participant-node">
      {/*
        The tile itself is the drag handle (the whole node moves). Interactive
        LiveKit controls inside the tile carry the `.nodrag` class so a click on
        them doesn't start a node drag.
      */}
      <ParticipantTile trackRef={data.trackRef} className="participant-node__tile" />
    </div>
  )
}

// Memoize: React Flow re-renders nodes often, and the tile only needs to update
// when its track reference changes.
export const ParticipantNode = memo(ParticipantNodeImpl)
