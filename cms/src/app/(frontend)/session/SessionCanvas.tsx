'use client'

import { useCallback, useEffect, useRef } from 'react'
import {
  ControlBar,
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useDataChannel,
  useTracks,
} from '@livekit/components-react'
import type { LocalUserChoices, TrackReferenceOrPlaceholder } from '@livekit/components-react'
import { ConnectionState, Track } from 'livekit-client'
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import type { NodeChange, NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ParticipantNode } from './ParticipantNode'
import type { ParticipantFlowNode } from './ParticipantNode'
import './canvas.css'

// The session canvas. <LiveKitRoom> wraps <ReactFlow> so that every custom node
// is a descendant of the room context — LiveKit hooks/components inside nodes
// (video tiles, mute state) just work, and React Flow mounting/unmounting tiles
// as they scroll in and out of view never touches the connection. Each
// participant's camera is a draggable node; positions are shared across everyone
// over LiveKit's data channel, so moving a tile moves it for all peers.

interface Connection {
  room: string
  token: string
  url: string
  choices: LocalUserChoices
}

// nodeTypes must be a stable, module-scope object — React Flow re-registers (and
// warns) if it sees a new object identity on every render.
const nodeTypes: NodeTypes = { participant: ParticipantNode }

const DATA_TOPIC = 'canvas-layout'

// --- layout sync message shapes (JSON over the data channel) ---
type XY = { x: number; y: number }
type LayoutMessage =
  | { type: 'move'; id: string; position: XY }
  | { type: 'request' }
  | { type: 'state'; positions: Record<string, XY> }

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const encode = (m: LayoutMessage) => encoder.encode(JSON.stringify(m))
const decode = (bytes: Uint8Array): LayoutMessage | null => {
  try {
    return JSON.parse(decoder.decode(bytes)) as LayoutMessage
  } catch {
    return null
  }
}

// Stable node id (one camera per participant). Placeholders (camera off) share
// the same id, so a tile persists as a participant toggles their camera.
const nodeId = (t: TrackReferenceOrPlaceholder) => `${t.participant.identity}/camera`
// A signature that also changes when a placeholder becomes a real track, so the
// reconcile effect refreshes the tile's trackRef.
const nodeSig = (t: TrackReferenceOrPlaceholder) =>
  `${nodeId(t)}:${'publication' in t && t.publication ? t.publication.trackSid : 'ph'}`

// Compact default placement: lay tiles out in a tidy grid near the origin,
// slotted by the participant's position in the sorted id list. Sorting makes it
// deterministic across clients (everyone agrees on where a newcomer lands before
// any drag), while keeping tiles clustered instead of scattered across the plane.
const COLS = 3
const TILE_W = 360 // node width + gap
const TILE_H = 300 // node height + gap
function gridPosition(index: number): XY {
  return { x: (index % COLS) * TILE_W, y: Math.floor(index / COLS) * TILE_H }
}

function CanvasFlow() {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }])
  const [nodes, setNodes, onNodesChange] = useNodesState<ParticipantFlowNode>([])
  const { fitView } = useReactFlow()

  // Known positions for every node id we've seen (from defaults, local drags, or
  // peers). A ref because it's shared, mutable state that shouldn't trigger
  // renders on its own — the nodes array is the render source of truth.
  const positionsRef = useRef<Record<string, XY>>({})
  // Latest tracks, read by the reconcile effect (keyed on a light signature).
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks
  // `send` lives in a ref so the message handler can reply to `request` without
  // creating a circular dependency with useDataChannel (which takes the handler).
  const sendRef = useRef<((p: Uint8Array, o: { reliable: boolean }) => Promise<void>) | null>(null)
  const hadNodesRef = useRef(false)

  // --- data channel: broadcast local moves, apply remote moves, answer late joiners ---
  const handleMessage = useCallback(
    (msg: { payload: Uint8Array }) => {
      const data = decode(msg.payload)
      if (!data) return
      if (data.type === 'move') {
        positionsRef.current[data.id] = data.position
        setNodes((prev) =>
          prev.map((n) => (n.id === data.id ? { ...n, position: data.position } : n)),
        )
      } else if (data.type === 'state') {
        // Merge a peer's full layout, but don't clobber ids we already know
        // (our own moves win over a stale snapshot).
        for (const [id, pos] of Object.entries(data.positions)) {
          if (!(id in positionsRef.current)) positionsRef.current[id] = pos
        }
        setNodes((prev) =>
          prev.map((n) =>
            n.id in positionsRef.current ? { ...n, position: positionsRef.current[n.id] } : n,
          ),
        )
      } else if (data.type === 'request') {
        // A peer just joined and wants the current layout. Reply with everything
        // we know; several peers answering is fine (self-healing, LWW merge).
        void sendRef.current?.(encode({ type: 'state', positions: positionsRef.current }), {
          reliable: true,
        })
      }
    },
    [setNodes],
  )

  const { send } = useDataChannel(DATA_TOPIC, handleMessage)
  sendRef.current = send

  // Ask peers for the current layout once we're actually connected (send before
  // connect would throw).
  const connectionState = useConnectionState()
  const requestedRef = useRef(false)
  useEffect(() => {
    if (connectionState === ConnectionState.Connected && !requestedRef.current) {
      requestedRef.current = true
      void send(encode({ type: 'request' }), { reliable: true })
    }
  }, [connectionState, send])

  // --- reconcile LiveKit tracks -> React Flow nodes (preserving positions) ---
  const trackSig = tracks.map(nodeSig).join('|')
  useEffect(() => {
    const wanted = new Map(tracksRef.current.map((t) => [nodeId(t), t]))
    // Stable ordering so grid slots are consistent across clients.
    const sortedIds = [...wanted.keys()].sort()
    setNodes((prev) => {
      // Update/keep existing nodes; drop nodes whose participant left.
      const next: ParticipantFlowNode[] = prev
        .filter((n) => wanted.has(n.id))
        .map((n) => ({ ...n, data: { trackRef: wanted.get(n.id)! } }))
      const existing = new Set(next.map((n) => n.id))
      // Add nodes for new tracks, reusing a known position (default/drag/peer) or
      // slotting into the compact grid by sorted order.
      for (const [id, t] of wanted) {
        if (existing.has(id)) continue
        const position = positionsRef.current[id] ?? gridPosition(sortedIds.indexOf(id))
        positionsRef.current[id] = position
        next.push({ id, type: 'participant', position, data: { trackRef: t } })
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackSig, setNodes])

  // Fit the view once the first tiles are measured. Gating on nodesInitialized
  // (rather than a bare rAF) guarantees the nodes have real dimensions, so
  // fitView can actually compute bounds and bring them into view.
  const nodesInitialized = useNodesInitialized()
  useEffect(() => {
    if (!hadNodesRef.current && nodesInitialized && nodes.length > 0) {
      hadNodesRef.current = true
      fitView({ maxZoom: 1, padding: 0.2 })
    }
  }, [nodesInitialized, nodes.length, fitView])

  // --- broadcast local drags ---
  const onNodesChangeSync = useCallback(
    (changes: NodeChange<ParticipantFlowNode>[]) => {
      onNodesChange(changes)
      for (const c of changes) {
        // Broadcast the final resting position when a drag ends.
        if (c.type === 'position' && c.dragging === false && c.position) {
          positionsRef.current[c.id] = c.position
          void send(encode({ type: 'move', id: c.id, position: c.position }), { reliable: true })
        }
      }
    },
    [onNodesChange, send],
  )

  return (
    <ReactFlow
      nodes={nodes}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChangeSync}
      minZoom={0.25}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      className="session-canvas__flow"
    >
      <Background gap={24} color="#1f1f1f" />
      <Controls showInteractive={false} />
      <Panel position="bottom-center">
        <ControlBar variation="minimal" />
      </Panel>
    </ReactFlow>
  )
}

export default function SessionCanvas({
  connection,
  onLeave,
}: {
  connection: Connection
  onLeave: () => void
}) {
  return (
    <LiveKitRoom
      className="session-canvas"
      token={connection.token}
      serverUrl={connection.url}
      connect
      video={connection.choices.videoEnabled}
      audio={connection.choices.audioEnabled}
      data-lk-theme="default"
      onDisconnected={onLeave}
    >
      {/* All remote audio, rendered once outside the canvas (per-node audio would
          duplicate/echo). */}
      <RoomAudioRenderer />
      <ReactFlowProvider>
        <CanvasFlow />
      </ReactFlowProvider>
    </LiveKitRoom>
  )
}
