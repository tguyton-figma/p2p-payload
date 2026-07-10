# LiveKit Skill — p2p-payload

Use when working with LiveKit in this project: realtime audio/video sessions, participant tiles, room management, component customization, recording, data channels, or any `@livekit/*` imports.

---

## Quick Orientation

This project uses LiveKit as an SFU for many-to-many A/V sessions (1-10 participants). The decision is documented in `cms/docs/adr/0001-livekit-sfu-for-realtime-av.md`. Key facts:

- **Deployment**: LiveKit Cloud (free "Build" tier now; self-hosted or paid tier for production).
- **Recording**: Client-side `MediaRecorder` + canvas capture (no LiveKit Egress yet; deferred to self-hosted).
- **Auth model**: Payload `Account` sessionToken -> server mints LiveKit JWT -> browser gets room-scoped token.
- **Single deployable**: Everything lives in `cms/` (no separate signaling server).

### Packages (pinned versions in `cms/package.json`)

| Package | Version | Purpose |
|---|---|---|
| `@livekit/components-react` | ^2.9.21 | React components + hooks |
| `@livekit/components-styles` | ^1.2.0 | Default CSS theme (optional, currently imported) |
| `livekit-client` | ^2.20.1 | Core client SDK (Room, Track, events) |
| `livekit-server-sdk` | ^2.17.0 | Server-side token minting + RoomServiceClient |

### File Map

```
cms/src/
  app/(frontend)/
    session/
      page.tsx              # Entry: auth check, lobby, PreJoin, -> SessionCanvas
      SessionCanvas.tsx     # <LiveKitRoom> wraps <ReactFlow>; tracks, data channel, controls
      ParticipantNode.tsx   # Video tile (React Flow node using <ParticipantTile>)
      FigmaEmbedNode.tsx    # Figma iframe embed (React Flow node)
      useCanvasRecorder.ts  # Client-side recording hook (canvas capture + audio mix)
      sessionNodes.ts       # Type union for React Flow node types
      figmaEmbed.ts         # Figma URL parser for EmbedKit
      session.css           # Lobby + pre-join styles
      canvas.css            # In-call canvas + tile + embed styles
    api/
      livekit/
        token/route.ts              # POST — mint JWT (identity, room, permissions)
        session/config/route.ts     # POST — toggle Open Session (host-only)
        session/recording/route.ts  # POST — flip recording flag in room metadata
      session-recording/
        upload-url/route.ts         # Presigned S3 URL for recording blob
        finalize/route.ts           # Create SessionRecordings doc after upload
  lib/livekit/
    server.ts               # getLiveKitEnv, getRoomService, readRoomMeta, RoomMeta type
```

### Environment Variables (server-side only)

```
LIVEKIT_API_KEY      — from LiveKit Cloud dashboard
LIVEKIT_API_SECRET   — never exposed to browser
LIVEKIT_URL          — wss://your-project.livekit.cloud
```

---

## Architecture: How LiveKit Fits Into the Session

```
page.tsx (auth + lobby)
  |
  v
PreJoin (device preview, @livekit/components-react prefab)
  |
  v   POST /api/livekit/token -> { token, url }
  |
SessionCanvas.tsx
  <LiveKitRoom token={...} serverUrl={...} data-lk-theme="default">
    <RoomAudioRenderer />           # all remote audio, rendered once
    <ReactFlowProvider>
      <ReactFlow>
        ParticipantNode             # per-participant video tile (React Flow node)
          <ParticipantTile />       # LiveKit component inside React Flow node
        FigmaEmbedNode              # iframe embed
        <ControlBar variation="minimal" />   # bottom panel
        SessionControls             # Open Session toggle
        RecordingControls           # Record/Stop button
      </ReactFlow>
    </ReactFlowProvider>
  </LiveKitRoom>
```

Key architectural choices:
- `<LiveKitRoom>` wraps the entire `<ReactFlow>` canvas, so LiveKit hooks work inside any React Flow custom node.
- Participant tiles are React Flow nodes, not LiveKit layout components — positioning is custom (draggable, synced via data channel).
- The `useCanvasRecorder` hook draws every frame onto an off-screen canvas for recording (not screen capture).

---

## LiveKit React Components Reference

Docs: https://docs.livekit.io/reference/components/react/

### Component Hierarchy

LiveKit components are organized in five categories. Almost every component has a corresponding `use`-prefixed hook.

**Essential** — the room context and audio rendering:
- [`LiveKitRoom`](https://docs.livekit.io/reference/components/react/component/livekitroom/) — root context provider. Wraps the entire UI. Accepts `token`, `serverUrl`, `connect`, `video`, `audio`, `data-lk-theme`, `onDisconnected`, etc. All props extend `React.HTMLAttributes<HTMLDivElement>`.
- [`RoomAudioRenderer`](https://docs.livekit.io/reference/components/react/component/roomaudiorenderer/) — renders all remote audio tracks. Mount once, outside any loop.

**Participant** — individual participant display:
- [`ParticipantTile`](https://docs.livekit.io/reference/components/react/component/participanttile/) — video + name + mute/speaking indicators for one track. Accepts `trackRef: TrackReferenceOrPlaceholder`. Used in our `ParticipantNode`.
- [`ParticipantName`](https://docs.livekit.io/reference/components/react/component/participantname/) — participant display name.
- [`ConnectionQualityIndicator`](https://docs.livekit.io/reference/components/react/component/connectionqualityindicator/) — signal-bar icon driven by `data-lk-quality`.
- [`TrackMutedIndicator`](https://docs.livekit.io/reference/components/react/component/trackmoutedindicator/) — mic/camera muted badge.

**Layouts & Loops** — iterating over participants/tracks:
- [`TrackLoop`](https://docs.livekit.io/reference/components/react/component/trackloop/) — iterates track references, creates `TrackRefContext` per child. Takes `tracks: TrackReferenceOrPlaceholder[]`.
- [`ParticipantLoop`](https://docs.livekit.io/reference/components/react/component/participantloop/) — iterates participants, creates `ParticipantContext` per child.
- [`FocusLayout`](https://docs.livekit.io/reference/components/react/component/focuslayout/) — spotlight one track, gallery for the rest.
- [`GridLayout`](https://docs.livekit.io/reference/components/react/component/gridlayout/) — CSS grid of tracks.
- [`CarouselLayout`](https://docs.livekit.io/reference/components/react/component/carousellayout/) — scrollable strip of tracks.

**Controls** — user interaction:
- [`ControlBar`](https://docs.livekit.io/reference/components/react/component/controlbar/) — mute/camera/screenshare/leave buttons. `variation="minimal"` hides labels.
- [`TrackToggle`](https://docs.livekit.io/reference/components/react/component/tracktoggle/) — toggle a single track source (camera, mic, screenshare).
- [`DisconnectButton`](https://docs.livekit.io/reference/components/react/component/disconnectbutton/) — leave the room.
- [`MediaDeviceSelect`](https://docs.livekit.io/reference/components/react/component/mediadeviceselect/) — device picker dropdown.

**Prefabs** — opinionated, composited UIs (not meant for extension):
- [`VideoConference`](https://docs.livekit.io/reference/components/react/component/videoconference/) — full video conference layout (grid + focus + controls).
- [`AudioConference`](https://docs.livekit.io/reference/components/react/component/audioconference/) — audio-only conference.
- [`PreJoin`](https://docs.livekit.io/reference/components/react/component/prejoin/) — device preview + name entry before connecting. Accepts `defaults`, `onSubmit`, `onError`, `joinLabel`.
- [`Chat`](https://docs.livekit.io/reference/components/react/component/chat/) — text chat overlay.

> **This project does NOT use `VideoConference` or other layout prefabs.** We use `<LiveKitRoom>` + individual components + hooks inside a React Flow canvas. This is the right approach for custom layouts.

### Building Blocks Concept

Docs: https://docs.livekit.io/reference/components/react/concepts/building-blocks/

Components are thin wrappers around standard HTML elements enriched with LiveKit state. Props extend `React.HTMLAttributes<HTMLDivElement>` (or the appropriate element), so `className`, `style`, event handlers, and refs all pass through.

Prefabs are composites built atop base components. They are **not designed for extension** — if you need to customize behavior beyond CSS, decompose the prefab into its constituent base components and hooks.

### Contexts

Docs: https://docs.livekit.io/reference/components/react/concepts/contexts/

The two critical contexts:
- **`RoomContext`** — provided by `<LiveKitRoom>`. Access via `useRoomContext()`. Returns the `Room` object from `livekit-client`.
- **`ParticipantContext`** — provided by `<ParticipantLoop>` and `<TrackLoop>` on each iteration. Access via `useParticipantContext()`.
- **`TrackRefContext`** — provided by `<TrackLoop>` on each iteration. Access via `useTrackRefContext()`.

> The docs now recommend `RoomContext.Provider` directly for more lifecycle control, but `<LiveKitRoom>` is NOT deprecated and works fine. **This project uses `<LiveKitRoom>` and should continue to.**

---

## Hooks Reference

Docs: https://docs.livekit.io/reference/components/react/ (hooks section)

### Track & Participant Hooks

| Hook | Returns | Use Case |
|---|---|---|
| [`useTracks`](https://docs.livekit.io/reference/components/react/hook/usetracks/) | `TrackReferenceOrPlaceholder[]` | Get all tracks matching source filters. **This is the primary hook for building custom layouts.** |
| [`useLocalParticipant`](https://docs.livekit.io/reference/components/react/hook/uselocalparticipant/) | `{ localParticipant }` | Access the local participant object. |
| [`useParticipants`](https://docs.livekit.io/reference/components/react/hook/useparticipants/) | `Participant[]` | All participants (local + remote). |
| [`useRemoteParticipants`](https://docs.livekit.io/reference/components/react/hook/useremoteparticipants/) | `RemoteParticipant[]` | Remote participants only. |
| [`useParticipantTile`](https://docs.livekit.io/reference/components/react/hook/useparticipanttile/) | Element props + state | Builds the props that `<ParticipantTile>` would apply — use for fully custom tiles. |

### Room & Connection Hooks

| Hook | Returns | Use Case |
|---|---|---|
| [`useRoomContext`](https://docs.livekit.io/reference/components/react/hook/useroomcontext/) | `Room` | Direct access to the livekit-client Room object. |
| [`useRoomInfo`](https://docs.livekit.io/reference/components/react/hook/useroominfo/) | `{ name, metadata }` | Room name + metadata (re-renders on `RoomMetadataChanged`). |
| [`useConnectionState`](https://docs.livekit.io/reference/components/react/hook/useconnectionstate/) | `ConnectionState` | Connection lifecycle state. |
| [`useDataChannel`](https://docs.livekit.io/reference/components/react/hook/usedatachannel/) | `{ send, message }` | Send/receive data messages on a named topic. |

### Media Device Hooks

| Hook | Returns | Use Case |
|---|---|---|
| [`useMediaDeviceSelect`](https://docs.livekit.io/reference/components/react/hook/usemediadeviceselect/) | Device list + setter | Build custom device pickers. |
| [`useTrackToggle`](https://docs.livekit.io/reference/components/react/hook/usetracktoggle/) | Toggle state + handler | Build custom mute buttons. |

### How This Project Uses Hooks

```typescript
// SessionCanvas.tsx — track sources driving the React Flow node list
const tracks = useTracks([
  { source: Track.Source.Camera, withPlaceholder: true },
  { source: Track.Source.ScreenShare, withPlaceholder: false },
])

// Data channel for layout sync
const { send } = useDataChannel('canvas-layout', handleMessage)

// Connection state gating
const connectionState = useConnectionState()

// Room metadata for session controls
const { name, metadata } = useRoomInfo()
const { localParticipant } = useLocalParticipant()

// useCanvasRecorder.ts — direct Room access for audio mixing
const lkRoom = useRoomContext()
```

---

## Track Management

Docs: https://docs.livekit.io/reference/components/react/concepts/rendering-video/

### Track Sources (from `livekit-client`)

```typescript
import { Track } from 'livekit-client'

Track.Source.Camera        // webcam video
Track.Source.Microphone    // mic audio
Track.Source.ScreenShare   // screen share video
Track.Source.ScreenShareAudio  // screen share audio
```

### TrackReferenceOrPlaceholder

The fundamental type flowing through the component tree:
```typescript
type TrackReferenceOrPlaceholder = {
  participant: Participant
  source: Track.Source
  publication?: TrackPublication  // undefined for placeholders
}
```

A **placeholder** means the participant exists but hasn't published that source (camera off, not screen sharing). `withPlaceholder: true` in `useTracks` keeps a slot so the UI doesn't jump when tracks toggle.

### useTracks — The Layout Driver

```typescript
// Camera with placeholders + screen share without
const tracks = useTracks([
  { source: Track.Source.Camera, withPlaceholder: true },
  { source: Track.Source.ScreenShare, withPlaceholder: false },
])
```

This returns a reactive array that updates on publish/unpublish/mute events. The array drives whatever custom layout you build (React Flow nodes in our case, but could be a grid, focus layout, etc.).

Docs: https://docs.livekit.io/reference/components/react/hook/usetracks/

### Screen Sharing

Docs: https://docs.livekit.io/transport/media/screenshare/

Screen sharing is just another published track. To start/stop:

```typescript
// Via ControlBar (has a built-in screen share button)
<ControlBar variation="minimal" />

// Or programmatically:
const room = useRoomContext()
await room.localParticipant.setScreenShareEnabled(true)
```

### Track Subscriptions

Docs: https://docs.livekit.io/transport/media/subscribe/

By default, all published tracks are auto-subscribed. For large rooms, you can manage subscriptions manually via `Room.options.autoSubscribe: false` and `participant.setTrackSubscriptionPermissions()`.

---

## Component Customization & Theming

This is the most important section for our product. LiveKit's component library offers three tiers of customization, from lightest to deepest.

### Tier 1: Override CSS Custom Properties

Docs: https://docs.livekit.io/reference/components/react/concepts/style-components/

The default theme activates via `data-lk-theme="default"` on `<LiveKitRoom>` or any parent HTML element. It defines `--lk-*` CSS custom properties you can override. The customization cascade is:

1. **CSS custom properties** (`--lk-*`) — global palette, affects all components
2. **Data attribute selectors** (`[data-lk-*]`) — state-based conditional styling
3. **className / style props** — per-instance overrides on individual components

```css
/* Override the default theme's variables for our dark theme */
[data-lk-theme="default"] {
  --lk-bg: #0a0a0a;
  --lk-fg: #f4f4f4;
  --lk-accent-bg: #8b5cf6;        /* purple accent for our brand */
  --lk-accent-fg: #ffffff;
  --lk-danger: #f91f31;
  --lk-success: #1ff968;
  --lk-control-bg: rgba(20, 20, 20, 0.92);
  --lk-control-hover-bg: #262626;
  --lk-border-radius: 0.75rem;
  --lk-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
```

**Known `--lk-*` custom properties** — the default theme ships as a light theme (the SCSS source generates from `$bg: #111`, `$fg: #fff` but the compiled CSS output is light-mode). Our project overrides these for a dark theme. Below are the shipped defaults from the docs page, plus the full set from the SCSS source:

| Category | Properties | Default Values (light theme) |
|---|---|---|
| Foreground | `--lk-fg`, `--lk-fg-secondary`, `--lk-fg-tertiary` | `#111`, `#333`, `#555` |
| Background | `--lk-bg`, `--lk-bg-secondary`, `--lk-bg-tertiary` | `#fff`, `#f5f5f5`, `#fafafa` |
| Accent | `--lk-accent-bg`, `--lk-accent-fg` | `#1f8cf9`, `#fff` |
| Danger | `--lk-danger`, `--lk-danger-fg`, `--lk-danger-text`, `--lk-danger-bg` | `#f91f31`, `#fff`, `#6d0311`, `#fecdd4` |
| Success | `--lk-success`, `--lk-success-fg`, `--lk-success-text`, `--lk-success-bg` | `#1ff968`, `#fff`, `#036d26`, `#cdfedd` |
| Controls | `--lk-control-fg`, `--lk-control-bg` | `var(--lk-fg)`, `var(--lk-bg-secondary)` |
| Connection | `--lk-connection-excellent`, `--lk-connection-good`, `--lk-connection-poor` | `#06db4d`, `#f9b11f`, `#f91f31` |
| Layout | `--lk-font-family`, `--lk-font-size`, `--lk-line-height`, `--lk-border-radius`, `--lk-grid-gap`, `--lk-control-bar-height`, `--lk-chat-header-height` | (see SCSS source) |

The full palette is generated from six Sass base variables using `color.adjust()` for lightness scales. Additional variables exist beyond this table — see the SCSS source for the complete set.

- Docs page: https://docs.livekit.io/reference/components/react/concepts/style-components/
- Default theme SCSS source: https://github.com/livekit/components-js/blob/main/packages/styles/scss/themes/default.scss

### Tier 2: Target data-lk-* Attributes in CSS

LiveKit components are fundamentally thin wrappers around HTML elements with hooks that manage state. For example, `TrackMutedIndicator` is "just a div with some hooks." These components expose their internal state via `data-lk-*` attributes, enabling pure-CSS state-driven styling without any JavaScript.

All data attributes start with `data-lk-` (the same PostCSS prefix pipeline). **The docs explicitly acknowledge these are NOT comprehensively documented per component** — use browser DevTools inspector to discover which attributes a specific component exposes. The table below lists known attributes from the docs and from our own codebase usage:

| Attribute | Component(s) | Values | Use Case |
|---|---|---|---|
| `data-lk-theme` | LiveKitRoom / parent | `"default"` or custom | Activate theme styles |
| `data-lk-video-muted` | ParticipantTile | `"true"` / `"false"` | Show/hide camera-off overlays |
| `data-lk-audio-muted` | ParticipantTile | `"true"` / `"false"` | Show muted badge |
| `data-lk-speaking` | ParticipantTile | `"true"` / `"false"` | Speaking indicator ring |
| `data-lk-local-participant` | ParticipantTile | `"true"` / `"false"` | Style local vs remote differently |
| `data-lk-source` | ParticipantTile | `"camera"`, `"screen_share"`, etc. | Source-specific tile styles |
| `data-lk-facing-mode` | ParticipantTile | `"user"` / `"environment"` | Mirror selfie camera |
| `data-lk-quality` | ConnectionQualityIndicator | `"unknown"`, `"poor"`, `"good"`, `"excellent"` | Color-coded signal bars |

**CSS targeting examples from the docs:**
```css
/* Connection quality badges */
[data-lk-quality='excellent'] { background-color: green; }
[data-lk-quality='poor'] { background-color: red; }

/* Use theme variables in custom elements */
button { background: var(--lk-danger); }
```

**How this project uses data attributes for styling:**

```css
/* Reveal avatar overlay when camera is off */
.participant-node__tile[data-lk-video-muted='true'] ~ .participant-node__avatar {
  opacity: 1;
}

/* Suppress LiveKit's generic placeholder when we have a custom avatar */
.participant-node--has-avatar .lk-participant-placeholder {
  display: none;
}
```

### Tier 2.5: Pass className and style Props Directly

Because components are thin HTML wrappers, they accept `className`, `style`, and all standard `React.HTMLAttributes`. This is the simplest per-instance override:

```tsx
<TrackMutedIndicator className="my-muted-badge" style={{ padding: '1rem' }} />
<ParticipantTile trackRef={trackRef} className="my-custom-tile" />
<ControlBar variation="minimal" className="my-controls" />
```

### Tier 3: Go Headless — Build Custom UI with Hooks Only

For maximum control, skip LiveKit's components entirely and use hooks to wire your own DOM.

**The key hook for fully custom tiles is `useParticipantTile`:**

```typescript
import { useParticipantTile } from '@livekit/components-react'

function CustomTile({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  const { elementProps } = useParticipantTile({ trackRef })
  // elementProps contains data-lk-* attributes, event handlers, etc.
  // Spread onto your container, then render your own video/audio/UI

  const videoEl = useRef<HTMLVideoElement>(null)
  // Attach the track to a <video> manually:
  useEffect(() => {
    const track = trackRef.publication?.track
    if (track && videoEl.current) {
      track.attach(videoEl.current)
      return () => { track.detach(videoEl.current!) }
    }
  }, [trackRef.publication?.track])

  return (
    <div {...elementProps} className="my-custom-tile">
      <video ref={videoEl} />
      {/* your own overlays, badges, controls */}
    </div>
  )
}
```

**Other hooks for headless builds:**

```typescript
// Custom mute button
const { buttonProps, enabled } = useTrackToggle({ source: Track.Source.Microphone })

// Custom device picker
const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind: 'audioinput' })

// Custom connection indicator
const { quality } = useConnectionQualityIndicator({ participant })
```

### CSS Architecture of @livekit/components-styles

Source: https://github.com/livekit/components-js/tree/main/packages/styles

The styles package uses a **PostCSS build pipeline** with three plugins that auto-prefix everything with the `lk` namespace:

| Source (SCSS) | Output (CSS) |
|---|---|
| `.button` | `.lk-button` |
| `--border-color` | `--lk-border-color` |
| `[data-active]` | `[data-lk-active]` |

The CSS bundle has four layers:
1. **Preflight** — resets/normalize (applied globally)
2. **Themes** — scoped under `[data-lk-theme]` (the `--lk-*` variables)
3. **Components** — structural CSS for base components (applied regardless of theme)
4. **Prefabs** — styles for VideoConference, PreJoin, etc.

**To completely replace the theme:** either override all `--lk-*` variables under `[data-lk-theme="default"]`, OR don't import `@livekit/components-styles` at all and write everything from scratch using hooks (Tier 3).

**To partially restyle:** import the styles, then override specific `.lk-*` classes with higher specificity or later in the cascade.

### What This Project Currently Customizes

The project uses Tier 1 + Tier 2 (CSS overrides + data attributes) plus selective wrapping:

1. **Dark theme** — `#0a0a0a` background, `#f4f4f4` text (in `session.css` and `canvas.css`)
2. **Participant tiles** — fixed dimensions (320x240 camera, 480x270 screen share) inside React Flow nodes
3. **Avatar overlays** — Figma profile images revealed via `data-lk-video-muted` attribute
4. **Control bar** — floated to bottom-center React Flow panel with backdrop blur
5. **PreJoin** — avatar injected via CSS custom property `--pp-avatar` to replace `.lk-camera-off-note`

---

## Server-Side: Token Generation

Docs: https://docs.livekit.io/home/server/generating-tokens/
API ref: https://docs.livekit.io/reference/server-sdk-js/AccessToken/

### AccessToken API

```typescript
import { AccessToken } from 'livekit-server-sdk'

const at = new AccessToken(apiKey, apiSecret, {
  identity: 'user-123',          // unique, stable identifier
  name: 'Display Name',          // shown in UI
  ttl: '1h',                     // token lifetime
  attributes: {                  // custom key-value pairs, visible to all participants
    authenticated: 'true',
  },
})

at.addGrant({
  roomJoin: true,
  room: 'room-name',
  canPublish: true,              // can publish tracks
  canSubscribe: true,            // can subscribe to others' tracks
  canPublishData: true,          // can send data messages (default true if canPublish)
})

const jwt = await at.toJwt()
```

### RoomServiceClient

```typescript
import { RoomServiceClient } from 'livekit-server-sdk'

const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret)

// Create a room with metadata
await svc.createRoom({
  name: 'room-id',
  metadata: JSON.stringify({ openSession: true, host: 'figma-id' }),
})

// List rooms (filter by name)
const [room] = await svc.listRooms(['room-id'])

// Update room metadata
await svc.updateRoomMetadata('room-id', JSON.stringify(newMeta))

// Remove a participant
await svc.removeParticipant('room-id', 'participant-identity')

// List participants
const participants = await svc.listParticipants('room-id')
```

Docs: https://docs.livekit.io/reference/server-sdk-js/RoomServiceClient/

### How This Project Mints Tokens

See `cms/src/app/(frontend)/api/livekit/token/route.ts`:
- Authenticates via Account `sessionToken` cookie
- If room doesn't exist, creates it (caller becomes host, stored in metadata)
- Signed-in users get `identity: account.figmaId`, guests get `identity: anon-<uuid>`
- `attributes: { authenticated: 'true' | 'false' }` lets the client distinguish members from guests
- Returns `{ token, url, identity, name }` to the browser

---

## Data Channels

Docs: https://docs.livekit.io/transport/data/data-messages/ (data messages)

### useDataChannel Hook

```typescript
const { send, message } = useDataChannel('topic-name', (msg) => {
  const data = JSON.parse(new TextDecoder().decode(msg.payload))
  // handle incoming message
})

// Send to all participants
await send(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true })
```

### How This Project Uses Data Channels

Topic: `canvas-layout` — all layout synchronization:
- `move` — a tile was dragged to a new position
- `request` — a new joiner asks for the current layout
- `state` — full layout snapshot (positions + embeds), sent in reply to `request`
- `embed-add` / `embed-remove` — Figma embed added/removed

All messages are JSON-over-Uint8Array with reliable delivery. See `SessionCanvas.tsx` for the full protocol.

---

## Room Metadata

Room metadata is a JSON string stored on the LiveKit room, accessible via `useRoomInfo()` which re-renders on `RoomMetadataChanged`.

### This Project's Schema

```typescript
interface RoomMeta {
  openSession: boolean          // anyone can join vs members-only
  host: string                  // figmaId of the account that created the room
  recording?: boolean           // recording in progress (drives the indicator for all)
  recordingStartedAt?: string   // ISO timestamp
}
```

Updated server-side via `svc.updateRoomMetadata()` in the session/config and session/recording routes.

---

## Recording (Client-Side)

See `useCanvasRecorder.ts`. This is NOT LiveKit Egress — it's browser-native `MediaRecorder`.

### How It Works

1. Off-screen `<canvas>` (1280x720, 30fps)
2. Every `requestAnimationFrame`: draw all participant video tiles + Figma embed snapshots onto the canvas, fit-to-view
3. WebAudio `AudioContext` mixes all remote audio tracks + host mic into one destination
4. `canvas.captureStream(30)` + mixed audio -> `MediaRecorder` (VP9/VP8 + Opus, 2.5 Mbps)
5. On stop: blob -> presigned S3 upload -> create `SessionRecordings` doc

### Future: LiveKit Egress

Docs: https://docs.livekit.io/transport/media/ingress-egress/egress/composite-recording/

When we self-host or move to a paid tier:
- **Room Composite Egress** — server renders all tracks into one video (like a Zoom recording)
- **Track Composite Egress** — server renders specific tracks with a custom layout
- **Track Egress** — raw individual track recording

Egress can output to S3, GCS, or Azure Blob. Requires a self-hosted LiveKit deployment or Enterprise plan.

Server SDK: https://docs.livekit.io/server-sdk-js/classes/EgressClient.html

---

## Pre-join / Lobby Pattern

Docs: https://docs.livekit.io/reference/components/react/component/prejoin/

This project uses the `<PreJoin>` prefab for device preview:

```tsx
<PreJoin
  defaults={{
    username: account?.handle ?? '',
    videoEnabled: true,
    audioEnabled: true,
  }}
  onSubmit={(choices: LocalUserChoices) => {
    // choices.username, choices.videoEnabled, choices.audioEnabled
    // -> fetch token -> connect
  }}
  onError={(e) => setError(e.message)}
  joinLabel="Join call"
/>
```

For a fully custom pre-join, use `usePreviewTracks` + `useMediaDeviceSelect` hooks instead.

---

## Room Configuration

Docs: https://docs.livekit.io/reference/client-sdk-js/interfaces/RoomOptions.html

```typescript
const roomOptions: RoomOptions = {
  adaptiveStream: true,           // auto-adjust video quality based on subscriber viewport
  dynacast: true,                 // only send video layers that are actually needed
  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution,
  },
  audioCaptureDefaults: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
}

// Pass to LiveKitRoom or Room constructor
<LiveKitRoom options={roomOptions} ... />
```

Advanced media settings: https://docs.livekit.io/transport/media/advanced/

---

## LiveKit Cloud

Docs: https://docs.livekit.io/intro/cloud/

Dashboard: https://cloud.livekit.io

### Free "Build" Tier Limits
- 5,000 connection-minutes/month
- 50 GB downstream bandwidth/month
- 100 concurrent connections
- No Egress/recording
- No Agents

### Graduating to Production
- Self-host on Railway/Fly/AWS (open source, same client SDK)
- OR upgrade to a paid LiveKit Cloud tier
- Client code is identical across all deployment modes

---

## LiveKit Agents Framework

Docs: https://docs.livekit.io/agents/
Getting started: https://docs.livekit.io/agents/start/voice-ai/
GitHub: https://github.com/livekit/agents

Agents are server-side participants that can join rooms, publish/subscribe tracks, and process media. Python-first SDK with Node.js SDK available.

Use cases:
- Voice AI (STT -> LLM -> TTS pipeline)
- Real-time transcription
- AI moderation
- Custom recording/processing

Requires self-hosted LiveKit or Enterprise plan. Not currently used in this project.

---

## Common Patterns & Recipes

### Fully Custom Video Tile (Headless)

When `<ParticipantTile>` doesn't give enough control:

```tsx
import { useParticipantTile, VideoTrack, AudioTrack } from '@livekit/components-react'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'

function CustomVideoTile({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  const { elementProps, metadata } = useParticipantTile({ trackRef })

  return (
    <div {...elementProps} className="my-tile">
      {trackRef.publication?.track ? (
        <VideoTrack trackRef={trackRef} />
      ) : (
        <div className="my-placeholder">
          {/* custom camera-off state */}
        </div>
      )}
      <span className="my-name">{trackRef.participant.name}</span>
    </div>
  )
}
```

### Custom Layout with useTracks

```tsx
function MyLayout() {
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ])

  const screenShares = tracks.filter(t => t.source === Track.Source.ScreenShare)
  const cameras = tracks.filter(t => t.source === Track.Source.Camera)

  return (
    <div className="my-layout">
      {screenShares.length > 0 && (
        <div className="spotlight">
          <CustomVideoTile trackRef={screenShares[0]} />
        </div>
      )}
      <div className="gallery">
        {cameras.map(t => (
          <CustomVideoTile key={`${t.participant.identity}/${t.source}`} trackRef={t} />
        ))}
      </div>
    </div>
  )
}
```

### Custom Mute Button

```tsx
import { useTrackToggle } from '@livekit/components-react'
import { Track } from 'livekit-client'

function MicButton() {
  const { buttonProps, enabled } = useTrackToggle({ source: Track.Source.Microphone })
  return (
    <button {...buttonProps} className={enabled ? 'mic-on' : 'mic-off'}>
      {enabled ? 'Mute' : 'Unmute'}
    </button>
  )
}
```

### Reading Participant Attributes

```typescript
// Set server-side in the token
attributes: { authenticated: 'true', role: 'host' }

// Read client-side
const { localParticipant } = useLocalParticipant()
const isAuthenticated = localParticipant.attributes?.authenticated === 'true'

// On remote participants
const participants = useRemoteParticipants()
participants.forEach(p => {
  const role = p.attributes?.role
})
```

---

## Key Documentation Links

| Topic | URL |
|---|---|
| Components overview | https://docs.livekit.io/reference/components/react/ |
| Building blocks concept | https://docs.livekit.io/reference/components/react/concepts/building-blocks/ |
| Contexts (RoomContext, etc.) | https://docs.livekit.io/reference/components/react/concepts/contexts/ |
| Styling components | https://docs.livekit.io/reference/components/react/concepts/style-components/ |
| Rendering video | https://docs.livekit.io/reference/components/react/concepts/rendering-video/ |
| useTracks hook | https://docs.livekit.io/reference/components/react/hook/usetracks/ |
| ParticipantTile | https://docs.livekit.io/reference/components/react/component/participanttile/ |
| PreJoin | https://docs.livekit.io/reference/components/react/component/prejoin/ |
| ControlBar | https://docs.livekit.io/reference/components/react/component/controlbar/ |
| Token generation | https://docs.livekit.io/home/server/generating-tokens/ |
| AccessToken API | https://docs.livekit.io/reference/server-sdk-js/AccessToken/ |
| RoomServiceClient | https://docs.livekit.io/reference/server-sdk-js/RoomServiceClient/ |
| RoomOptions | https://docs.livekit.io/reference/client-sdk-js/interfaces/RoomOptions.html |
| Screen sharing | https://docs.livekit.io/transport/media/screenshare/ |
| Track subscriptions | https://docs.livekit.io/transport/media/subscribe/ |
| Advanced media | https://docs.livekit.io/transport/media/advanced/ |
| Egress/recording | https://docs.livekit.io/transport/media/ingress-egress/egress/composite-recording/ |
| EgressClient SDK | https://docs.livekit.io/server-sdk-js/classes/EgressClient.html |
| Agents framework | https://docs.livekit.io/agents/ |
| LiveKit Cloud | https://docs.livekit.io/intro/cloud/ |
| Styles package source | https://github.com/livekit/components-js/tree/main/packages/styles |
| Default theme SCSS | https://github.com/livekit/components-js/blob/main/packages/styles/scss/themes/default.scss |
| Components monorepo | https://github.com/livekit/components-js |

---

## Gotchas & Notes

1. **data-lk-* attributes are not comprehensively documented.** Use browser inspector to discover which attributes a component exposes. The docs acknowledge this gap.

2. **@livekit/components-styles is technically optional** (not a peerDependency). Components work without it — they render unstyled/headless. Import it for defaults, or skip it for a fully custom theme.

3. **The PostCSS prefix is hardcoded to `lk`**. You cannot change it without forking the styles package. All classes are `.lk-*`, all custom properties `--lk-*`, all data attributes `data-lk-*`.

4. **Prefabs (VideoConference, PreJoin, ControlBar) are not meant for extension.** If you need to customize beyond CSS overrides, decompose into base components + hooks.

5. **Font gotcha**: LiveKit's default `--lk-font-family` is `system-ui`. Our project overrides to `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`.

6. **Room metadata is a string**, not a typed object. Always parse with try/catch and provide fallback defaults (see `readRoomMeta` in `lib/livekit/server.ts`).

7. **Participant attributes are string-only key-value pairs.** Set them in the token and read them on the client via `participant.attributes`.

8. **Session-based APIs** (`useSession`, `useSessionContext`, `useAgent`) were introduced in @livekit/components-react v2.9.16 for agent-based workflows. We don't use these yet but may when adding Agents support.
