'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  DisconnectButton,
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
  useMediaDeviceSelect,
  useRoomInfo,
  useTracks,
} from '@livekit/components-react'
import type { LocalUserChoices, TrackReferenceOrPlaceholder } from '@livekit/components-react'
import {
  ConnectionState,
  LocalVideoTrack,
  Track,
  createLocalAudioTrack,
  createLocalVideoTrack,
} from 'livekit-client'
import type { DisconnectReason } from 'livekit-client'
import {
  Background,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import type { NodeChange, NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { MediaNode } from './MediaNode'
import type { MediaNodeData } from './MediaNode'
import { FigmaEmbedNode } from './FigmaEmbedNode'
import type { SessionFlowNode } from './sessionNodes'
import { mediaNodeId, mediaNodeSig, mediaTrackName, trackName } from './mediaTracks'
import { useCanvasRecorder } from './useCanvasRecorder'
import { parseFigmaUrl } from './figmaEmbed'
import './canvas.css'

// The session canvas. <LiveKitRoom> wraps <ReactFlow> so that every custom node
// is a descendant of the room context — LiveKit hooks/components inside nodes
// (video tiles, mute state) just work, and React Flow mounting/unmounting tiles
// as they scroll in and out of view never touches the connection.
//
// The canvas is the single source of truth for what a participant publishes:
// there is no privileged "primary" camera/mic and no control bar of toggles.
// Every feed on the canvas is a track someone added — adding a node publishes a
// track, removing it unpublishes. Each feed is a draggable node; positions are
// shared across everyone over LiveKit's data channel, so moving a tile moves it
// for all peers.

interface Connection {
  room: string
  token: string
  url: string
  choices: LocalUserChoices
}

// nodeTypes must be a stable, module-scope object — React Flow re-registers (and
// warns) if it sees a new object identity on every render.
const nodeTypes: NodeTypes = { media: MediaNode, figmaEmbed: FigmaEmbedNode }

const DATA_TOPIC = 'canvas-layout'

// Default size of a freshly added Figma embed (landscape). Users can't resize yet.
const EMBED_W = 640
const EMBED_H = 400

// --- layout sync message shapes (JSON over the data channel) ---
type XY = { x: number; y: number }
// A Figma embed placed on the canvas, shared verbatim with every peer.
type EmbedSpec = {
  id: string
  url: string
  name: string
  fileKey: string
  nodeId: string | null
  position: XY
  width: number
  height: number
}
type LayoutMessage =
  | { type: 'move'; id: string; position: XY }
  | { type: 'request' }
  | { type: 'state'; positions: Record<string, XY>; embeds?: EmbedSpec[] }
  | { type: 'embed-add'; embed: EmbedSpec }
  | { type: 'embed-remove'; id: string }

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

// Live "Open Session" control, shown in a canvas panel. Reads the room metadata
// reactively (useRoomInfo re-renders on RoomMetadataChanged), so every client
// sees the current state instantly. Only the host gets an interactive toggle;
// everyone else sees a read-only badge.
function SessionControls() {
  const { name, metadata } = useRoomInfo()
  const { localParticipant } = useLocalParticipant()
  const [busy, setBusy] = useState(false)

  let openSession = false
  let host = ''
  if (metadata) {
    try {
      const meta = JSON.parse(metadata) as { openSession?: boolean; host?: string }
      openSession = Boolean(meta.openSession)
      host = meta.host ?? ''
    } catch {
      // leave defaults
    }
  }
  const isHost = !!host && localParticipant.identity === host

  const toggle = useCallback(async () => {
    setBusy(true)
    try {
      await fetch('/api/livekit/session/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ room: name, openSession: !openSession }),
      })
      // No local state change needed — the metadata update echoes back via
      // RoomMetadataChanged and re-renders this component.
    } finally {
      setBusy(false)
    }
  }, [name, openSession])

  const label = openSession ? '🔓 Open Session' : '🔒 Members only'

  if (!isHost) {
    return <span className="session-canvas__access session-canvas__access--readonly">{label}</span>
  }
  return (
    <button
      className="session-canvas__access nodrag"
      onClick={toggle}
      disabled={busy}
      title="Toggle whether anyone can join this session"
    >
      {label}
    </button>
  )
}

// Hard cap on a single recording. Bounds the in-memory blob and keeps us well
// inside the upload's limits; the host UI auto-stops at this length.
const MAX_RECORDING_MS = 45 * 60 * 1000

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Recording control (top-right panel, below the Open Session control). Only the
// host gets a Record/Stop button; everyone sees a live "recording" badge driven
// by the `recording` flag in room metadata, so the indicator is consistent for
// all participants. Capture itself runs in the host's browser via the recorder
// hook passed in from the canvas.
function RecordingControls({
  recorder,
  room,
}: {
  recorder: ReturnType<typeof useCanvasRecorder>
  room: string
}) {
  const { metadata } = useRoomInfo()
  const { localParticipant } = useLocalParticipant()
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  let host = ''
  let recording = false
  let recordingStartedAt: string | undefined
  if (metadata) {
    try {
      const meta = JSON.parse(metadata) as {
        host?: string
        recording?: boolean
        recordingStartedAt?: string
      }
      host = meta.host ?? ''
      recording = Boolean(meta.recording)
      recordingStartedAt = meta.recordingStartedAt
    } catch {
      // leave defaults
    }
  }
  const isHost = !!host && localParticipant.identity === host

  const setRecordingState = useCallback(
    async (value: boolean) => {
      await fetch('/api/livekit/session/recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ room, recording: value }),
      }).catch(() => {
        // The badge is best-effort; local capture proceeds regardless.
      })
    },
    [room],
  )

  const handleStart = useCallback(async () => {
    setBusy(true)
    try {
      await recorder.start()
      await setRecordingState(true)
    } finally {
      setBusy(false)
    }
  }, [recorder, setRecordingState])

  const handleStop = useCallback(async () => {
    setBusy(true)
    try {
      await setRecordingState(false)
      await recorder.stop()
    } finally {
      setBusy(false)
    }
  }, [recorder, setRecordingState])

  // Tick the elapsed timer while recording.
  useEffect(() => {
    if (!recording && !recorder.isRecording) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [recording, recorder.isRecording])

  // Host-side hard cap: auto-stop once the recording hits MAX_RECORDING_MS.
  useEffect(() => {
    if (!recorder.isRecording) return
    const startMs = recordingStartedAt ? Date.parse(recordingStartedAt) : Date.now()
    const remaining = Math.max(0, MAX_RECORDING_MS - (Date.now() - startMs))
    const id = setTimeout(() => void handleStop(), remaining)
    return () => clearTimeout(id)
  }, [recorder.isRecording, recordingStartedAt, handleStop])

  // Non-host participants only see the live badge while recording is on.
  if (!isHost) {
    if (!recording) return null
    return (
      <span className="session-canvas__access session-canvas__access--readonly">
        <span className="session-canvas__rec-dot" /> Recording
      </span>
    )
  }

  const active = recorder.isRecording || recording
  const elapsed = recordingStartedAt ? now - Date.parse(recordingStartedAt) : 0

  return (
    <>
      <button
        className={`session-canvas__access session-canvas__record nodrag${
          active ? ' session-canvas__record--active' : ''
        }`}
        onClick={active ? handleStop : handleStart}
        disabled={busy || recorder.isSaving}
        title={active ? 'Stop recording' : 'Record this session'}
      >
        {active ? (
          <>
            <span className="session-canvas__rec-dot" />
            Stop · {formatElapsed(elapsed)}
          </>
        ) : recorder.isSaving ? (
          'Saving…'
        ) : (
          '● Record'
        )}
      </button>
      {recorder.error && (
        <span className="session-canvas__rec-note session-canvas__rec-note--error">
          {recorder.error}
        </span>
      )}
      {recorder.savedId && !recorder.error && !recorder.isSaving && (
        <span className="session-canvas__rec-note">Saved to your Media library ✓</span>
      )}
    </>
  )
}

// Small input for dropping a Figma link onto the canvas. Anyone in the session
// can add one; the embed appears for everyone. Pasting a Figma URL anywhere on
// the canvas also works (see the paste handler), this is the discoverable path.
function AddFigmaEmbed({ onAdd }: { onAdd: (url: string) => string | null }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(
    (e: FormEvent) => {
      e.preventDefault()
      const err = onAdd(value)
      if (err) {
        setError(err)
        return
      }
      setValue('')
      setError(null)
    },
    [onAdd, value],
  )

  return (
    <form className="session-canvas__embed-add nodrag" onSubmit={submit}>
      <input
        className="session-canvas__embed-input"
        type="url"
        inputMode="url"
        placeholder="Paste a Figma link…"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          if (error) setError(null)
        }}
        aria-label="Figma file link"
      />
      <button type="submit" className="session-canvas__embed-btn" disabled={!value.trim()}>
        Add
      </button>
      {error && <span className="session-canvas__rec-note session-canvas__rec-note--error">{error}</span>}
    </form>
  )
}

// The one way feeds get onto the canvas: pick a camera or mic to publish, or
// share a screen. Devices already publishing are hidden so you can't double-add.
// This is the whole "control bar" now — presence of a node is the published state.
function AddMediaControl({
  onAddDevice,
  onAddScreen,
}: {
  onAddDevice: (kind: 'videoinput' | 'audioinput', deviceId: string, label: string) => Promise<void>
  onAddScreen: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const { localParticipant } = useLocalParticipant()
  const cameras = useMediaDeviceSelect({ kind: 'videoinput' })
  const mics = useMediaDeviceSelect({ kind: 'audioinput' })

  // Device ids we're already publishing — offer the rest.
  const usedDeviceIds = new Set<string>()
  for (const pub of localParticipant.trackPublications.values()) {
    const id = pub.track?.mediaStreamTrack.getSettings().deviceId
    if (id) usedDeviceIds.add(id)
  }

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }, [])

  const group = (
    kind: 'videoinput' | 'audioinput',
    heading: string,
    devices: MediaDeviceInfo[],
  ) => {
    const available = devices.filter((d) => d.deviceId && !usedDeviceIds.has(d.deviceId))
    if (available.length === 0) return null
    return (
      <div className="session-canvas__add-group">
        <div className="session-canvas__add-heading">{heading}</div>
        {available.map((d) => (
          <button
            key={d.deviceId}
            type="button"
            className="session-canvas__add-item nodrag"
            disabled={busy}
            onClick={() => void run(() => onAddDevice(kind, d.deviceId, d.label))}
          >
            {d.label || (kind === 'videoinput' ? 'Camera' : 'Microphone')}
          </button>
        ))}
      </div>
    )
  }

  const cameraGroup = group('videoinput', 'Cameras', cameras.devices)
  const micGroup = group('audioinput', 'Microphones', mics.devices)

  return (
    <div className="session-canvas__add nodrag">
      <button
        type="button"
        className="session-canvas__add-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Add a camera, microphone, or screen"
      >
        ＋ Add feed
      </button>
      {open && (
        <div className="session-canvas__add-menu">
          {cameraGroup}
          {micGroup}
          <div className="session-canvas__add-group">
            <div className="session-canvas__add-heading">Screen</div>
            <button
              type="button"
              className="session-canvas__add-item nodrag"
              disabled={busy}
              onClick={() => void run(onAddScreen)}
            >
              Share a screen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CanvasFlow({
  choices,
  figmaClientId,
}: {
  choices: LocalUserChoices
  figmaClientId?: string | null
}) {
  // Every published track becomes a node — no placeholders, because there's no
  // implicit "you always have a camera slot" any more. A source with no track
  // simply has no node.
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: false },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
    { source: Track.Source.Microphone, withPlaceholder: false },
  ])
  const { localParticipant } = useLocalParticipant()
  const [nodes, setNodes, onNodesChange] = useNodesState<SessionFlowNode>([])
  const { fitView } = useReactFlow()

  // A live ref to the current nodes, read by the recorder's draw loop so it
  // captures the same tiles/positions the canvas is showing right now.
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const { name: roomName } = useRoomInfo()
  const recorder = useCanvasRecorder(nodesRef, roomName)

  // Known positions for every node id we've seen (from defaults, local drags, or
  // peers). A ref because it's shared, mutable state that shouldn't trigger
  // renders on its own — the nodes array is the render source of truth.
  const positionsRef = useRef<Record<string, XY>>({})
  // Figma embeds on the canvas, keyed by node id. Source of truth for embeds the
  // same way tracks are for participant tiles; the reconcile effect and add/remove
  // handlers keep the nodes array in sync with this.
  const embedsRef = useRef<Record<string, EmbedSpec>>({})
  // Latest tracks, read by the reconcile effect (keyed on a light signature).
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks
  // `send` lives in a ref so the message handler can reply to `request` without
  // creating a circular dependency with useDataChannel (which takes the handler).
  const sendRef = useRef<((p: Uint8Array, o: { reliable: boolean }) => Promise<void>) | null>(null)

  // --- figma embeds: apply locally, mirror to the nodes array, broadcast ---
  const applyEmbedRemove = useCallback(
    (id: string) => {
      if (!embedsRef.current[id]) return
      delete embedsRef.current[id]
      delete positionsRef.current[id]
      setNodes((prev) => prev.filter((n) => n.id !== id))
    },
    [setNodes],
  )

  const removeEmbed = useCallback(
    (id: string) => {
      applyEmbedRemove(id)
      void sendRef.current?.(encode({ type: 'embed-remove', id }), { reliable: true })
    },
    [applyEmbedRemove],
  )

  // Build a React Flow node from an embed spec. `onRemove` is injected here (never
  // sent over the wire); the header is the drag handle so the iframe stays live.
  const buildEmbedNode = useCallback(
    (spec: EmbedSpec): SessionFlowNode => {
      const position = positionsRef.current[spec.id] ?? spec.position
      positionsRef.current[spec.id] = position
      return {
        id: spec.id,
        type: 'figmaEmbed',
        position,
        dragHandle: '.figma-embed-node__header',
        style: { width: spec.width, height: spec.height },
        data: {
          url: spec.url,
          name: spec.name,
          fileKey: spec.fileKey,
          nodeId: spec.nodeId,
          onRemove: () => removeEmbed(spec.id),
        },
      }
    },
    [removeEmbed],
  )

  const applyEmbedAdd = useCallback(
    (spec: EmbedSpec) => {
      if (embedsRef.current[spec.id]) return
      embedsRef.current[spec.id] = spec
      setNodes((prev) => (prev.some((n) => n.id === spec.id) ? prev : [...prev, buildEmbedNode(spec)]))
    },
    [buildEmbedNode, setNodes],
  )

  // Add an embed from a pasted string; returns an error message, or null on success.
  const addEmbed = useCallback(
    (raw: string): string | null => {
      const parsed = parseFigmaUrl(raw, { clientId: figmaClientId })
      if (!parsed) return 'That doesn’t look like a Figma link.'
      const count = Object.keys(embedsRef.current).length
      const spec: EmbedSpec = {
        id: `embed/${crypto.randomUUID()}`,
        url: parsed.url,
        name: parsed.name,
        fileKey: parsed.fileKey,
        nodeId: parsed.nodeId,
        // Cascade new embeds above the participant grid so they don't stack exactly.
        position: { x: 380 + count * 48, y: -(EMBED_H + 80) + count * 48 },
        width: EMBED_W,
        height: EMBED_H,
      }
      applyEmbedAdd(spec)
      void sendRef.current?.(encode({ type: 'embed-add', embed: spec }), { reliable: true })
      return null
    },
    [applyEmbedAdd, figmaClientId],
  )

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
        // Adopt any embeds we don't already have.
        if (data.embeds) for (const spec of data.embeds) applyEmbedAdd(spec)
      } else if (data.type === 'embed-add') {
        applyEmbedAdd(data.embed)
      } else if (data.type === 'embed-remove') {
        applyEmbedRemove(data.id)
      } else if (data.type === 'request') {
        // A peer just joined and wants the current layout. Reply with everything
        // we know; several peers answering is fine (self-healing, LWW merge).
        void sendRef.current?.(
          encode({
            type: 'state',
            positions: positionsRef.current,
            embeds: Object.values(embedsRef.current),
          }),
          { reliable: true },
        )
      }
    },
    [setNodes, applyEmbedAdd, applyEmbedRemove],
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

  // --- publishing: adding a feed IS publishing a track ----------------------
  // We publish every track ourselves with a name we control, so its node id is
  // stable for the track's life and peers can read a human label. LiveKit fans
  // the track out to everyone; the reconcile effect below turns it into a node on
  // every client. Nothing is "primary" — this is the only path media gets here.
  const addDevice = useCallback(
    async (kind: 'videoinput' | 'audioinput', deviceId: string, label: string) => {
      const idc = deviceId ? { deviceId: { exact: deviceId } } : undefined
      if (kind === 'videoinput') {
        const track = await createLocalVideoTrack(idc)
        await localParticipant.publishTrack(track, {
          name: mediaTrackName(label || 'Camera'),
          source: Track.Source.Camera,
        })
      } else {
        const track = await createLocalAudioTrack(idc)
        await localParticipant.publishTrack(track, {
          name: mediaTrackName(label || 'Microphone'),
          source: Track.Source.Microphone,
        })
      }
    },
    [localParticipant],
  )

  // Share a screen: grab a display stream and publish it as a screen-share track.
  // If the user stops sharing from the browser's native UI, the track ends — we
  // unpublish so the node disappears in lockstep.
  const addScreen = useCallback(async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
    const [msTrack] = stream.getVideoTracks()
    if (!msTrack) return
    const track = new LocalVideoTrack(msTrack)
    msTrack.addEventListener('ended', () => {
      void localParticipant.unpublishTrack(track, true).catch(() => {})
    })
    await localParticipant.publishTrack(track, {
      name: mediaTrackName('Screen'),
      source: Track.Source.ScreenShare,
    })
  }, [localParticipant])

  // Find one of our own publications by the name we assigned it.
  const findLocalPub = useCallback(
    (name: string) => {
      for (const pub of localParticipant.trackPublications.values()) {
        if (pub.trackName === name) return pub
      }
      return undefined
    },
    [localParticipant],
  )

  // Mute/unmute keeps the track published (fast toggle); remove unpublishes it.
  // Both act on the local participant's own feeds only. useTracks updates for
  // everyone on unpublish, so a removed node disappears on every client.
  const toggleMute = useCallback(
    async (name: string) => {
      const track = findLocalPub(name)?.track
      if (!track) return
      if (track.isMuted) await track.unmute()
      else await track.mute()
    },
    [findLocalPub],
  )

  const removeTrack = useCallback(
    async (name: string) => {
      const track = findLocalPub(name)?.track
      if (track) await localParticipant.unpublishTrack(track, true)
    },
    [findLocalPub, localParticipant],
  )

  // Build a media node's data from a track reference. The local participant's own
  // feeds get on-node mute + remove controls; screen shares get remove only.
  const mediaData = useCallback(
    (t: TrackReferenceOrPlaceholder): MediaNodeData => {
      if (!t.participant.isLocal) return { trackRef: t, local: false }
      const name = trackName(t)
      const isScreen = t.source === Track.Source.ScreenShare
      return {
        trackRef: t,
        local: true,
        onRemove: name ? () => void removeTrack(name) : undefined,
        onToggleMute: name && !isScreen ? () => void toggleMute(name) : undefined,
      }
    },
    [removeTrack, toggleMute],
  )

  // Seed the local participant's chosen prejoin devices as their first feeds,
  // once, on connect. There's no auto-published primary track — these are regular
  // nodes like any other, they just happen to be added for you at join time.
  const seededRef = useRef(false)
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected || seededRef.current) return
    seededRef.current = true
    void (async () => {
      if (choices.videoEnabled) {
        await addDevice('videoinput', choices.videoDeviceId ?? '', 'Camera').catch(() => {})
      }
      if (choices.audioEnabled) {
        await addDevice('audioinput', choices.audioDeviceId ?? '', 'Microphone').catch(() => {})
      }
    })()
  }, [connectionState, choices, addDevice])

  // --- reconcile LiveKit tracks -> React Flow nodes (preserving positions) ---
  const trackSig = tracks.map(mediaNodeSig).join('|')
  useEffect(() => {
    // Every published track gets a node (cameras, screen shares, and mics — mics
    // render as compact audio cards). RoomAudioRenderer still handles playback and
    // the recorder still mixes all mics regardless of nodes.
    const wanted = new Map<string, TrackReferenceOrPlaceholder>()
    for (const t of tracksRef.current) {
      wanted.set(mediaNodeId(t), t)
    }
    // Stable ordering so grid slots are consistent across clients.
    const sortedIds = [...wanted.keys()].sort()
    setNodes((prev) => {
      // Keep media nodes whose track is still live (drop those who left);
      // keep embed nodes that still exist in embedsRef.
      const next: SessionFlowNode[] = []
      for (const n of prev) {
        if (n.type === 'media') {
          const t = wanted.get(n.id)
          if (t) next.push({ ...n, data: mediaData(t) })
        } else if (embedsRef.current[n.id]) {
          next.push(n)
        }
      }
      const existing = new Set(next.map((n) => n.id))
      // Add nodes for new tracks, reusing a known position (default/drag/peer) or
      // slotting into the compact grid by sorted order.
      for (const [id, t] of wanted) {
        if (existing.has(id)) continue
        const position = positionsRef.current[id] ?? gridPosition(sortedIds.indexOf(id))
        positionsRef.current[id] = position
        next.push({ id, type: 'media', position, data: mediaData(t) })
      }
      // Re-add any embeds missing from the array (e.g. adopted from a peer before
      // this array existed).
      for (const spec of Object.values(embedsRef.current)) {
        if (existing.has(spec.id)) continue
        next.push(buildEmbedNode(spec))
        existing.add(spec.id)
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackSig, setNodes, mediaData])

  // Auto-fit camera: keep every tile framed in the viewport, re-fitting whenever
  // the canvas geometry settles — a participant joins/leaves, a drag ends, or a
  // remote move arrives. We skip fitting while a node is actively being dragged
  // (that would fight the user), and gate on nodesInitialized so tiles have real
  // measured sizes before we compute bounds.
  const nodesInitialized = useNodesInitialized()
  const anyDragging = nodes.some((n) => n.dragging)
  const geomSig = nodes
    .map((n) => `${n.id}@${Math.round(n.position.x)},${Math.round(n.position.y)}`)
    .join('|')
  const fitOpts = { maxZoom: 1, padding: 0.15, duration: 250 }
  useEffect(() => {
    if (!nodesInitialized || nodes.length === 0 || anyDragging) return
    fitView(fitOpts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geomSig, nodesInitialized, anyDragging, fitView])

  // Re-fit when the viewport itself resizes (window/panel size changes).
  useEffect(() => {
    const onResize = () => fitView(fitOpts)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitView])

  // --- broadcast local drags ---
  const onNodesChangeSync = useCallback(
    (changes: NodeChange<SessionFlowNode>[]) => {
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

  // Paste a Figma link anywhere on the canvas to drop an embed. Ignore pastes
  // aimed at a text field (the add-embed input handles those itself).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return
      }
      const text = e.clipboardData?.getData('text') ?? ''
      if (!parseFigmaUrl(text)) return
      e.preventDefault()
      addEmbed(text)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addEmbed])

  return (
    <ReactFlow
      nodes={nodes}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChangeSync}
      minZoom={0.1}
      maxZoom={1.5}
      // The camera is automatic — disable free pan/zoom so it never fights the
      // auto-fit. Tiles stay draggable (that drives the shared layout).
      panOnDrag={false}
      panOnScroll={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
      className="session-canvas__flow"
    >
      <Background gap={24} color="#1f1f1f" />
      <Panel position="top-right">
        <div className="session-canvas__controls">
          <SessionControls />
          <RecordingControls recorder={recorder} room={roomName} />
          <AddFigmaEmbed onAdd={addEmbed} />
        </div>
      </Panel>
      <Panel position="bottom-center">
        <div className="session-canvas__dock">
          <AddMediaControl onAddDevice={addDevice} onAddScreen={addScreen} />
          <DisconnectButton className="session-canvas__leave nodrag">Leave</DisconnectButton>
        </div>
      </Panel>
    </ReactFlow>
  )
}

export default function SessionCanvas({
  connection,
  onLeave,
  figmaClientId,
}: {
  connection: Connection
  onLeave: (reason?: DisconnectReason) => void
  figmaClientId?: string | null
}) {
  return (
    <LiveKitRoom
      className="session-canvas"
      token={connection.token}
      serverUrl={connection.url}
      connect
      // Don't auto-publish a "primary" camera/mic on connect — the canvas owns
      // publishing. Prejoin device choices are seeded as normal nodes once the
      // room connects (see CanvasFlow).
      video={false}
      audio={false}
      data-lk-theme="default"
      onDisconnected={onLeave}
    >
      {/* All remote audio, rendered once outside the canvas (per-node audio would
          duplicate/echo). */}
      <RoomAudioRenderer />
      <ReactFlowProvider>
        <CanvasFlow choices={connection.choices} figmaClientId={figmaClientId} />
      </ReactFlowProvider>
    </LiveKitRoom>
  )
}
