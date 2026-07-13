# Technical Implementation Report

> Synthesized from specs 00–10, DECISIONS.md, and the current codebase.
> Purpose: a single document describing how the target architecture gets built on top of what exists today.

---

## 1. System Model

The application is a real-time multiplayer canvas where participants share video, audio, and interaction in a spatial environment. The architecture separates all state into four velocity layers and two durability planes.

### Velocity Layers

| Layer | Content | Rate | Transport | Persistence |
|-------|---------|------|-----------|-------------|
| **L0 Media** | WebRTC audio/video tracks | Continuous | LiveKit SFU | None (streamed) |
| **L1 Ephemeral Presence** | Cursor position, gesture, rotation, menu hover, typing indicators | 10–60 Hz | LiveKit data channel (lossy) | Never persisted |
| **L2 Session Events** | Semantic state transitions (join, leave, feed moved, menu selected, recording started) | 0.1–5 Hz | LiveKit data channel (reliable) → CQRS log | Immutable event log (authority) → Payload projection |
| **L3 Assets & Config** | Sprites, avatars, session config, user prefs | Static | HTTP / Payload API | Payload CMS (aggressive CDN cache) |

### Durability Planes

Every piece of state is tagged to one of two planes:

- **PERSISTENT** — Canvas/node mutations, session lifecycle, recording consent. Written to the CQRS event log, projected to Payload, replayable.
- **EPHEMERAL** — Cursor position, gesture-in-motion, audio levels, hover highlights, in-progress drag. Broadcast-only, lossy-tolerant, never logged.

**Straddle rule**: an action that starts ephemeral (e.g. dragging a tile) becomes persistent on commit (the final `core.feed.moved` event).

---

## 2. Current State → Target State

### What exists today

| Capability | Implementation |
|-----------|----------------|
| Realtime A/V | LiveKit SFU, token issuance, room service client |
| Canvas layout | React Flow with `media` and `figmaEmbed` node types |
| Position sync | Data channel (`canvas-layout` topic): move, request, state, embed-add/remove |
| Recording | Client-side: off-screen 2D `<canvas>` re-renders tiles at 720p, WebAudio mixes all mics, MediaRecorder → WebM → S3 presigned upload → SessionRecordings doc |
| Media pipeline | Async Figma Cloud jobs: FFmpeg thumbnails/waveforms/duration, Sharp dominant color |
| Auth | Figma OAuth → Accounts collection (cookie `pp_account`); Payload Users for admin |
| Data model | 10 collections: Users, Accounts, Sessions, Timelines, Moments, Memories, Media, Recordings, SessionRecordings, Logs |
| Deployment | Figma Cloud (Lambda + S3), `p2p-payload.figma.site` |

### What the target adds

| Capability | Key change |
|-----------|-----------|
| 3D hand cursors | Sprite atlas (Blender renders), gesture state machine, L1 presence extension |
| Multiplayer UI | Shared radial menus, anyone-can-interact model, UI surfaces as canvas nodes |
| Spatial proximity | Web Audio PannerNode for spatial audio, CSS-driven visual zones (blur/opacity/saturation by distance) |
| Event sourcing (CQRS) | Immutable log as session authority, Payload becomes read-side projection, typed event vocabulary |
| Physics | Matter.js (or Planck.js) simulation synced to React Flow nodes, host-authoritative |
| Server-side recording | LiveKit Room Composite Egress replaces client canvas recorder |
| Multi-POV capture | `renderAs(participant)` primitive, layered capture (composite + ISO tracks + event log) |
| Portals | Session-to-session linking via portal canvas nodes, room handoff on activation |
| Arrival/departure choreography | Data-driven entrance/exit animations as first-class L2 events |
| Personal live rewind | Client-side timeline scrub against buffered event log + media |

---

## 3. Unified Event Architecture

This is the spine of the system. Every persistent state change flows through one path.

### Command → Event Flow

```
Participant intent (click, drag, toggle)
  → Command (validated, may be rejected)
    → Event (immutable fact, assigned sequence number)
      → Broadcast (reliable data channel, all participants)
      → CQRS log (durable authority — NATS/JetStream candidate)
      → Payload projection (queryable archive)
```

### Event Shape (Semantic Triple)

```typescript
interface SessionEvent {
  id: string                    // UUID
  v: number                     // schema version (additive-only)
  type: string                  // dot-namespaced past-tense: "core.feed.moved"
  actor: string                 // participant identity (figmaId or anon-*)
  verb: string                  // redundant with type for readability
  object: {
    kind: string                // "feed" | "menu" | "session" | "recording" | ...
    id: string                  // target entity
    [key: string]: unknown      // kind-specific payload
  }
  context: {
    session: string             // room name
    seq: number                 // monotonic within session
    ts: number                  // wall-clock ms
    x?: number                  // spatial position at time of event
    y?: number
    causationId?: string        // which event caused this
    correlationId?: string      // thread of related events
  }
}
```

### Core Event Vocabulary

The event set is intentionally small. It defines the product's capability surface.

| Namespace | Events |
|-----------|--------|
| `core.session.*` | started, configured, ended |
| `core.participant.*` | arrived, departed, consentGranted, consentRevoked |
| `core.feed.*` | added, removed, moved, resized |
| `core.embed.*` | added, removed |
| `core.menu.*` | opened, closed, selected |
| `core.cursor.*` | bumped, waved (point events); rested/slept (bracket enter/exit) — emergent, condition-triggered expressions (see Gap 21) |
| `core.camera.*` | toggled |
| `core.screen.*` | started, stopped |
| `core.recording.*` | started, stopped |
| `ext.*` | Open namespace for experimental/playful actions, Zod-validated, not core state |

### Tiered Vocabulary

- **`core.*`** — Closed set, TypeScript discriminated unions, versioned, drives state reconstruction.
- **`ext.*`** — Open, registrable, best-effort. Extensions cannot mutate core state. Validated via Zod schemas at publish time.

### Replay & State Reconstruction (Fold)

Session state is reconstructed by folding PERSISTENT events in order: `(state, event) => state`. Ephemeral presence (cursor position, hover, in-motion drag) never enters the fold — it's never logged.

**Design choice**: monolithic state object with logically grouped sub-objects (not per-domain reducer slices). At our event count, this gives the clarity of separation without the wiring overhead. The shape is kept cleanly serializable so periodic snapshotting (see Gap 13) is trivial to add later without reshaping.

**Draft `SessionState` (the fold target)** — initial shape, not the final end-to-end schema:

```typescript
interface SessionState {
  // ── Lifecycle ──
  session: {
    id: string
    status: 'active' | 'ended'
    config: SessionConfig | null      // from core.session.configured
    startedAt: number
    endedAt: number | null
  }

  // ── Participants (keyed by identity) ──
  participants: Record<string, {
    id: string                        // figmaId or anon-*
    arrivedAt: number
    departedAt: number | null         // null = still present
    entranceStyle: string
    cameraOn: boolean                 // reflects toggles, not the media itself
    screenSharing: boolean
  }>

  // ── Canvas nodes (keyed by nodeId) ──
  feeds: Record<string, {
    id: string
    owner: string                     // participant id
    kind: 'camera' | 'screen'
    position: { x: number; y: number }
    size: { w: number; h: number }
  }>
  embeds: Record<string, {
    id: string
    addedBy: string
    url: string
    position: { x: number; y: number }
  }>

  // ── Recordings (keyed by recordingId) ──
  recordings: Record<string, {
    id: string
    owner: string
    startedAt: number
    endedAt: number | null
    // consent timeline per participant — feeds the mux consent filter (Gap 4, Option A)
    consent: Record<string, Array<{ grantedAt: number; revokedAt: number | null }>>
  }>
}
```

**The fold is a discriminated-union switch** — one arm per core event:

```typescript
function fold(state: SessionState, e: CoreEvent): SessionState {
  switch (e.type) {
    case 'core.feed.moved':
      return set(state, ['feeds', e.object.id, 'position'], e.object.position)
    case 'core.participant.arrived':
      return set(state, ['participants', e.actor], newParticipant(e))
    case 'core.participant.departed':
      return set(state, ['participants', e.actor, 'departedAt'], e.context.ts)
    case 'core.recording.consentGranted':
      return pushConsentWindow(state, e.object.recordingId, e.actor, e.context.ts)
    // ...one arm per core event
  }
}
```

**Two deliberate calls in this draft**:

1. **Menus are not in the fold state.** `core.menu.opened/selected/closed` are logged (they matter for recording/replay), but a menu is transient UI — the recorder re-renders menus by watching the event stream in sequence, not by reading reconstructed state. Keeps the state lean. Open to revisit if a persistent menu concept emerges.

2. **Consent is a timeline of windows inside the recording.** The fold produces exactly the per-participant consent windows that the mux pipeline (Gap 4, Option A) consumes. The event-sourcing fold and the consent-filtering pipeline meet here.

### Implementation on Current Codebase

**Today**: The `canvas-layout` data channel topic sends untyped JSON messages (`move`, `request`, `state`, `embed-add`, `embed-remove`). These messages are the embryonic form of L2 events but lack the semantic triple shape, sequence numbering, and durability.

**Migration path**:
1. Define `SessionEvent` types and `core.*` vocabulary as a TypeScript module with Zod schemas.
2. Replace `canvas-layout` message types with proper Command → Event flow. Each current message type maps to a core event: `move` → `core.feed.moved`, `embed-add` → `core.embed.added`, etc.
3. Add a `session-events` Payload collection as read-side projection (Phase 3).
4. Client-side: write-ahead buffer (IndexedDB) for offline tolerance, flush to Payload on reconnect.
5. Durable authority is the append-only Payload `session-events` collection (Gap 1) — no external log service (NATS/JetStream not needed). Ordering via `(ts, actorId)` composite key (Gap 2); event `type` doubles as a NATS-style subject for prefix queries. Client-side state held in Zustand (Gap 12).

---

## 4. Cursor System

### Current → Target

**Today**: No multiplayer cursors. Participants are represented only by their media tiles on the React Flow canvas.

**Target**: A 3D hand cursor is each participant's primary embodiment — always visible, gesture-aware, rotation-tracked, and interactive.

### Sprite Atlas Pipeline

```
Figma cursor design
  → Export sprite sheet: 7 gestures × 16–24 rotation angles = 112–168 frames
    → PNG/WebP texture atlas (frames organized as gesture × rotation grid)
      → Upload to Payload Media (CDN-cached, content-hash URL)
        → Client lookup table: (gesture, angle) → atlas coordinates
        → Base properties (color/tint, size) applied at render time
```

No 3D toolchain required. Figma is the source of truth for cursor art. Default sprite sets ship with the product; per-user customization of base properties (tint, scale) is exposed in-app. Custom spritesheet upload is deferred.

**Gesture states** (7): point (idle), open (hover), grab (drag), pinch (precision), present (menu open), react (high-five/wave), idle (breathing animation).

**Transitions**: context-sensitive — hovering a feed → open; dragging → grab; opening menu → present. Pre-rendered in-betweens optional; snapping (RTS-game style) is acceptable and responsive.

### L1 Presence Protocol

Cursor data rides L1 (ephemeral, lossy, ~20 Hz):

```
Binary-encoded message (~15 bytes):
  participantId (varint)
  x, y          (float16 × 2)
  gesture       (3 bits, enum)
  rotation      (uint8, 0–255 maps to 0°–360°)
  menuState     (4 bits)
  hoverTarget   (varint, node ID or 0)
```

**Bandwidth**: 15 bytes × 20 Hz × 20 participants = ~6 KB/sec total. Well within data channel budget.

**Rendering**: Spring/lerp interpolation from 20 Hz input → 60 fps display. CSS `rotate()` bridges between discrete atlas rotation angles (15° steps).

### Radial Menu (Cursor-as-UI)

The cursor IS the interface. No separate toolbar.

- `/` key (or gesture) opens radial menu, anchored to cursor position.
- Menu spec (items, position) broadcast as L1 presence → all participants render it independently.
- Anyone can hover and select items on anyone's menu (Q9: full co-op default).
- Selection → L2 event (`core.menu.selected`) → system processes action.
- Permission tiers (encoded in menu item metadata): self-only, shared (default), suggestion (owner confirms).

---

## 5. Multiplayer UI Model

### Principle

If visible, it's shared. If interactive, anyone can interact. This applies to radial menus, reaction pickers, property panels, and tool palettes.

### Data Model

UI surfaces are canvas-level entities:

```typescript
interface UISurface {
  id: string
  owner: string           // who opened it
  type: 'radial-menu' | 'panel' | 'picker'
  anchor: 'cursor' | 'fixed'
  position: { x: number; y: number }
  spec: MenuSpec | PanelSpec  // items, layout
  state: Record<string, unknown>
}
```

**State flow**: Owner opens surface → broadcasts spec as L1 presence → all clients render independently → hover/interaction state broadcast as L1 → selection triggers L2 event.

### Conflict Resolution

First-click-wins for discrete actions. For continuous interactions (slider, drag), owner takes priority. Creative mechanics replace permission gates: instant undo, two-hand confirm (both participants must agree), tug-of-war (competing drags average), reversibility-by-default.

### Performance Budget

Sparse surfaces (~1–3 open at once). Spec ~100 bytes, hover state ~20 bytes. At 20 Hz with 5 concurrent surfaces and 10 participants: ~600 bytes/sec per participant. Negligible.

---

## 6. Spatial Proximity System

### Spatial Audio

**Implementation**: Web Audio API `PannerNode` per remote participant.

```
Canvas coordinates → Web Audio 3D space:
  canvas X → positionX
  canvas Y → positionZ
  fixed positionY = 0

Listener = local participant's tile position on canvas
Source   = remote participant's tile position (offset from listener)
```

**Parameters** (configurable per session via room metadata):
- `refDistance`: 100 (full volume within this radius)
- `maxDistance`: 500 (silent beyond this)
- `rolloffFactor`: 2 (inverse-square falloff)
- `panningModel`: HRTF (head-related transfer function for spatial realism)

**Smooth updates**: `setTargetAtTime()` with 20ms time constant prevents clicks/pops during position changes.

**Bandwidth optimization**: Unsubscribe from audio tracks beyond `maxDistance` (with hysteresis band to prevent flapping at boundary).

**Chrome quirk**: Hidden muted `<audio>` element required to route WebRTC audio through Web Audio graph. Already documented; needs implementation.

### Visual Proximity Zones

CSS custom properties driven by distance calculation:

| Zone | Distance | Effects |
|------|----------|---------|
| Intimate | 0–80 | Glow border |
| Near | 80–200 | Full clarity |
| Mid | 200–350 | blur(2–4px) |
| Far | 350–500 | blur(6–10px), desaturate |
| Beyond | 500+ | Greyscale, low opacity |

**Performance**: O(N) distance calc per participant (each calculates distance to every other), not O(N²). CSS `filter` and `opacity` are GPU-composited, so transitions are free. Recalculate on position change, not per frame.

**Zoom as a proximity axis (see Gap 14)**: effective distance factors in zoom level, not just canvas XY — zoom is movement. The same distance scalar drives audio, visual effects, *and* render LOD/culling: Far/Beyond zones downscale nodes, drop to static avatars, and unsubscribe from video tracks, so hundreds of nodes hold 120fps. Note the listener-position refinement: the audio listener may be the participant's viewport (eyes/ears) rather than their tile (body/source) — see Gap 14 sub-question.

### What Exists Today

- Audio tracks accessible via `useTracks()` (LiveKit React components)
- Tile positions stored in `positionsRef` and synced via data channel
- Room config via room metadata
- Per-track volume control via LiveKit SDK

**Gap**: No spatial audio processing, no proximity-based visual effects. The data (positions, tracks) is available; the processing layer needs to be built.

---

## 7. Physics Engine Integration

### Engine Selection

**Start with**: Matter.js (JavaScript, simple API, adequate for <50 bodies).
**Upgrade path**: Planck.js (Box2D port, same API surface, better performance) if Matter.js bottlenecks. Rapier (WASM) only if body count exceeds 100, which is unlikely for this product.

### React Flow ↔ Physics Sync

```
User starts drag → set body to kinematic (physics ignores it)
  → drag updates body position directly
    → user releases → switch body to dynamic, apply release velocity
      → physics sim: momentum, collision, damping
        → body settles → update React Flow node position from body
          → if settled/collided past threshold → emit L2 event
```

**Sim loop**: Fixed 60 fps timestep. Each tick: step physics → read body positions → update React Flow nodes. O(N) bodies; trivial for <50 tiles.

### Multiplayer Physics

**Host-authoritative**: One client (session host) runs the physics simulation. Physics state (positions + velocities) broadcast via data channel at lower frequency (~10 Hz). Other clients interpolate. Divergence corrected on next broadcast.

**Events**: Physics outcomes that cross significance thresholds become L2 events: `core.feed.settled`, `core.feed.collided`. Logged for replay.

### Behaviors

- **Momentum**: Release a tile and it slides, decelerating. Feels like pushing furniture.
- **Collision**: Elastic bounce between tiles, visual ripple feedback.
- **Gravity modes** (per-session config): none (floating), gentle-settle (drift to rest), floor (fall to bottom), orbit (gravitate toward center).
- **Springs**: Related tiles (camera + screen share from same participant) connected by invisible spring constraints; they loosely follow each other.

---

## 8. Recording Architecture

### Current Implementation (Being Replaced)

Client-side `useCanvasRecorder.ts`: off-screen 2D `<canvas>` re-renders all tiles at 720p, WebAudio mixes all mics, `MediaRecorder` → WebM → S3 → SessionRecordings doc. Host-only, fragile, all-or-nothing, 720p fixed, burdens host browser, canvas renderer falls out of sync with the actual React Flow canvas as features are added.

### Target: Layered Capture

Three capture layers run in parallel:

| Layer | What | How | Cost |
|-------|------|-----|------|
| **A — Live Composite** | Full canvas render (video + audio + cursors + menus + effects) | LiveKit Room Composite Egress (headless Chrome loads recorder view, egress encodes server-side) | ~$0.02/video-min (Ship tier) |
| **B — ISO Tracks** | Raw individual audio/video per participant | LiveKit Track Egress (one file per track) | ~$0.001/min per track |
| **C — Event Log** | Complete L2 event stream + L1 presence snapshots | CQRS log (already captured by event architecture) | Storage only |

**Key insight**: The recorder IS the app. Room Composite Egress loads a headless Chrome at a URL we provide (`/session/[room]/record`). That URL renders the same React Flow canvas, same cursors, same menus, same spatial effects. Every feature is recorded for free. The renderer never falls out of sync.

### Recorder View Contract

Route: `/session/[room]/record`

Requirements:
- Publicly reachable (egress service must load it)
- Reads `url`, `token`, `layout` from query params
- Joins as a hidden participant (recorder identity, not visible to others)
- Renders complete canvas: media nodes, cursors, menus, proximity effects, physics
- Emits `START_RECORDING` / `END_RECORDING` to console (egress signals)
- **Critical constraint**: Canvas must render entirely from presence data + events, with zero dependence on local interaction state

### Storage & Enrichment Pipeline

```
Egress writes HLS segments → dedicated bucket (S3 or Cloudflare R2)
  → egress_ended webhook
    → enqueue recording-ingest job (stitch segments, create Payload doc)
      → enqueue recording-enrich job (thumbnail, duration, transcript, renditions)
```

**Canonical format**: HLS (durable, adaptive, supports 12h+ sessions). MP4 generated on demand.

**Mux**: Optional downstream delivery layer for adaptive streaming, captions, analytics. Not a compositor. Takes composited video, returns playback IDs. Start without it; add if delivery UX demands it.

### Multi-Perspective Recording (renderAs)

The `renderAs(participant)` primitive re-parameterizes the canvas to render from any participant's point of view:
- Audio listener position = that participant's tile position → spatial audio mix changes
- Proximity visual effects recalculate from that participant's location
- Viewport optionally follows that participant's pan/zoom

**Three capture strategies, layered**:

1. **S1 — Host perspective** (today's replacement): One composite egress, neutral viewpoint. Simple, low cost.
2. **S2 — Live multi-POV**: Any participant triggers egress at `renderAs(self)`. N participants = N videos, N× cost.
3. **S3 — Offline re-render** (north star): Capture cheap track egress + event log during session. Re-render any perspective offline, on demand. Cost independent of N. No cold-start. 4K possible. Re-renderable with future canvas updates.

**Recommended build order**:
1. Replace client recorder with server-side composite egress (S1).
2. Build `renderAs()` + live spectating (client-only, nearly free, proves the primitive).
3. Add S2 live per-perspective with guardrails (concurrent recording cap, consent).
4. Invest in S3 offline re-render as event source matures.

### Consent Model

- **Opt-in, per-recording, time-segmented** (Q3).
- Any participant can start a recording at any time. Other participants receive a signal and choose to opt in. Non-consented participants are excluded from that recording entirely.
- If a participant opts in mid-session and later opts out, they appear only during that window.
- Multiple participants can record simultaneously, in parallel or offset — each recording is independent.
- Participants grant/revoke consent via `core.participant.consentGranted` / `consentRevoked` events, carrying the `recordingId` they apply to.
- Recording indicator is mandatory and always visible to all participants in the session.

### Consent Filtering: Option A vs Option B

The open question is *when and where* consent boundaries are enforced in the rendered output. Two viable approaches:

#### Option A — Post-processing (Mux-time Filtering)

Capture everything during the session. Enforce consent during muxing/re-render by replaying the event log.

**How it works**:
1. Layer A (composite egress) captures the full room render — all participants, all feeds.
2. Layer B (ISO tracks) captures raw per-participant audio/video.
3. Layer C (event log) contains all `consentGranted` / `consentRevoked` events with precise timestamps and `recordingId`.
4. During offline re-render (Path B/S3): the renderer walks the event log, checks each participant's consent state at each timestamp, and only mixes their ISO tracks and renders their feeds during consented windows.
5. Non-consented participants are composited out — their feeds are blank, their audio tracks excluded.

**Advantages**:
- Consent logic lives in one place (mux pipeline), not distributed across live rendering.
- Retroactive consent decisions are possible (e.g., a participant consents after the fact — you re-render and they appear).
- The event log is the single source of truth; no real-time filtering complexity.
- Aligns with the north-star S3 offline re-render model naturally.

**Trade-offs**:
- Non-consented participants' raw media is still *captured* (ISO tracks, composite egress). This is a privacy concern — even if it's never included in output, it was recorded.
- Requires the offline re-render pipeline (Path B/S3) to be built before consent filtering is fully precise.
- Live composite egress (Path A) cannot retroactively exclude participants — the composite is already rendered.
- Operational complexity: consent filtering must be correctly applied at mux time or the output violates consent.

**Implementation sketch**:
```
During muxing:
  1. Load event log for session, filter to consentGranted/consentRevoked for this recordingId
  2. Build per-participant consent timeline: [(actorId, windowStart, windowEnd), ...]
  3. For each ISO track (Layer B): trim to consent windows, silence/blank outside
  4. Composite trimmed tracks into final render
  5. For re-render (Path B): re-run canvas renderer with consent-aware participant list per timestamp
```

---

#### Option B — Live Filtering in Recorder View

The recorder view is consent-aware. It reads consent state from the event stream in real time and excludes non-consented participants from the render as it goes.

**How it works**:
1. Recorder view subscribes to the L2 event stream.
2. Maintains a live consent state map: `{ [participantId]: boolean }` per `recordingId`.
3. When rendering the canvas, non-consented participants' feeds are not rendered (hidden nodes), their audio tracks are not mixed into the spatial audio graph.
4. The egress encodes only what the recorder view renders — non-consented participants never appear in the output.

**Advantages**:
- Non-consented participants' media is *never captured* in the composite output — stronger privacy guarantee.
- Simpler output: the composite egress (Path A) is already consent-filtered; no post-processing step needed.
- Works without the offline re-render pipeline — live egress is the complete solution.
- Conceptually cleaner: what you see in the recorder view is exactly what's in the recording.

**Trade-offs**:
- Consent state must be maintained correctly in real time inside the recorder view — a stateful, event-driven component, not a passive renderer.
- If consent state is wrong at any moment (event delivery delay, replay gap), the wrong participants appear or disappear in the recording.
- Retroactive consent is impossible — if a participant consents after the fact, you cannot retroactively include them in a live composite.
- More complexity in the recorder view itself: it must be a full event-stream consumer, not just a canvas renderer.
- ISO tracks (Layer B) still capture all participants unless LiveKit track subscriptions are toggled per consent state (possible but adds latency on toggle).

**Implementation sketch**:
```
In recorder view:
  1. Join room as recorder participant, subscribe to L2 event channel
  2. Initialize consentState = {} — all participants non-consented until granted
  3. On core.participant.consentGranted (matching recordingId): mark participant consented
  4. On core.participant.consentRevoked: mark non-consented
  5. Canvas renderer: skip rendering feeds for non-consented participants
  6. Web Audio graph: unsubscribe from / mute tracks for non-consented participants
  7. Consent state changes appear as seamless transitions in the composite output
```

---

#### Decision Status: Open

Option A is the architectural north star — aligns with layered capture, enables retroactive decisions, event log is authoritative. Option B provides stronger real-time privacy guarantees and simpler output but requires a stateful recorder view and forecloses retroactive consent.

**Likely resolution**: Option B for live composite egress (Path A) near-term — simple to implement, strong privacy. Option A for offline re-render (Path B/S3) — enables retroactive consent and 4K re-render. Both can coexist: the recorder view does live filtering, and the offline pipeline also respects consent boundaries from the event log.

---

## 9. Identity & Session Model

### Unified Identity

Single identity bound to Payload `Accounts` collection. Multiple visual projections:

| Projection | When | Visual |
|-----------|------|--------|
| Hand cursor | Always (primary embodiment) | Sprite atlas hand with identity color |
| Media feed | When publishing camera/screen | React Flow node with identity border |
| Avatar | Camera off | Static avatar image |
| Staging silhouette | Pre-join (future) | Threshold zone presence indicator |

All projections share identity color and display name.

**Guests**: `anon-*` identity prefix (already implemented). Ephemeral, limited capabilities. Full identity requires an Account (Figma OAuth).

**User memory**: Per-user projection over their own event history. A durable personal sense of experience, not a database table — reconstructed by folding events where `actor = userId`.

### Session Lifecycle

**Ephemeral sessions** (Q12): Sessions exist only while occupied. When the last participant leaves, the session is gone. No persistent rooms, no rejoining after empty.

**History**: Lives in recordings (event log + captured video), not in the room itself.

### Session Configuration (Q17)

Access is defined along three independent axes:

| Axis | Options |
|------|---------|
| Anonymous | Allow unauthenticated participants (yes/no) |
| Audience/Tenant | Any authenticated user / org-only |
| Discoverability | Private / unlisted / public-in-directory |

**Addressing**: Hidden backend UUID (system-facing) + semantic handle/slug (user-facing). Handles can be renamed; old handles become aliases with redirects.

### Portals & Sub-Sessions (Q18)

Sessions interlink via **portal nodes** on the canvas — explicit links, not spatial adjacency. Activating a portal = LiveKit room handoff (leave current room → join linked room), with arrival/departure choreography as the transition.

Sub-sessions (breakouts) spawn within a session and surface as portal nodes. One participant per session at a time (lean model).

### Arrival & Departure (Q16)

First-class, configurable, recordable events — not mere animation.

```typescript
// L2 events
{ type: "core.participant.arrived", object: { kind: "participant", id, entranceStyle: "knock" | "footsteps" | "flourish" | "greeting" } }
{ type: "core.participant.departed", object: { kind: "participant", id, exitStyle: "wave" | "fade" | "poof" } }
```

Entrance/exit styles are data-driven: the event carries the style, the renderer plays the choreography. Configurable per session. Recorded and replayable.

---

## 10. Transport & Infrastructure

### Data Channel Topology

```
LiveKit SFU
├── L0: WebRTC media tracks (audio, video)
├── L1: Lossy data channel — cursor presence (binary, ~20 Hz)
├── L2: Reliable data channel — session events (JSON, 0.1–5 Hz)
└── Room metadata — session config (JSON, updated via server SDK)
```

**Today**: Single `canvas-layout` topic handles both position sync and embed operations. **Target**: Split into dedicated topics per velocity layer.

### CQRS Authority (Deferred Infrastructure)

The target CQRS stack (NATS/JetStream or equivalent) is explicitly deferred. The initial implementation path:

1. **Phase 3 (near-term)**: Host-scribe pattern — one client (host) aggregates events, assigns sequence numbers, writes to Payload `session-events` collection. All participants publish commands; host validates and broadcasts events.
2. **Later**: Replace host-scribe with durable log service (NATS/JetStream). Payload remains read-side projection. All participants publish idempotently; log service deduplicates and orders.

### Client-Side Resilience

Write-ahead buffer (IndexedDB candidate): client writes events locally before network send. On reconnect, flushes buffered events. Sequence gaps detected and filled from authority.

### Deployment

No changes to deployment model. Figma Cloud (Lambda + S3) remains the target. Recording egress adds:
- A dedicated recordings bucket (S3 or Cloudflare R2 — R2 has no egress fees)
- Webhook endpoint for egress completion notifications
- Background jobs for recording ingest and enrichment (existing Figma Cloud Jobs pattern)

---

## 11. Build Phases & Dependencies

```
Phase R (Recording Foundation) ─── runs early, in parallel ──────────────────────┐
                                                                                  │
Phase 1 (Cursor Presence) ──┬── Phase 2 (Spatial Audio + Visual Proximity) ──┐   │
                             │                                                │   │
                             ├── Phase 3 (Event Sourcing Foundation) ──┐      │   │
                             │                                         │      │   │
                             └── Phase 4 (3D Hand Cursor) ─────────┬──┘      │   │
                                                                    │         │   │
                                              Phase 5 (Radial Menu + Multiplayer UI)
                                                                    │         │
                                              Phase 6 (Cursor Interactions)   │
                                                                              │
                                              Phase S (Perspectives + POV) ───┘
                                                                    │
                                              Phase 7 (Physics) ────┘
                                                                    │
                                              Phase 8+ (Environmental Polish)
```

**Phase R** can start immediately and runs independently.
**Phases 1, 2, 3** can run in parallel after Phase 1 establishes cursor presence.
**Phase 4** requires Phase 1 (upgrades arrow cursors to 3D hands).
**Phase 5** requires Phases 3 + 4 (events for menu actions + hand cursor for menu anchor).
**Phase 6** requires Phase 4 (hand gestures for interactions).
**Phase S** requires Phase 2 (spatial audio for perspective rendering).
**Phase 7** can start after Phase 2 (physics affects spatial relationships).

---

## 12. Identified Gaps

These were areas where the documentation established intent but did not yet specify implementation details sufficient to build from. All 21 were worked through in a decision review (2026-07-13). Status legend: **RESOLVED** (decided, ready to build), **PARTIALLY RESOLVED** (shape decided, detail work remains), **DEFERRED** (intentionally backlogged with trigger noted).

Summary: 1 ✅, 2 ✅, 3 ✅ (non-issue), 4 ✅, 5 (folded into 4), 6 ✅, 7 ✅, 8 ✅, 9 ✅, 10 ✅, 11 ◐, 12 ✅, 13 ⏸, 14 ✅, 15 ✅, 16 ✅, 17 ◐/⏸, 18 ✅, 19 ✅, 20 ✅ (scoped), 21 ✅.

### Transport & Infrastructure

1. **CQRS log technology selection** — NATS/JetStream is named as a candidate but not committed. The host-scribe → durable-log migration path needs a concrete technology decision and deployment plan, especially given Figma Cloud (Lambda) constraints. Can NATS run on Lambda? Does it need a sidecar service?

2. **Sequence numbering strategy** — How are sequence numbers assigned in the host-scribe phase? What happens during host migration (host leaves, new host takes over)? How are gaps detected and recovered?

3. **Data channel topic architecture** — The split from single `canvas-layout` topic to per-layer topics is implied but not specified. Topic naming, message routing, and backward compatibility during migration need definition.

### Recording

4. **Recorder view auth model** — The recorder URL must be publicly reachable for egress, but sessions may be private. How is the recorder authenticated? Token-in-URL? Separate auth path? This has security implications.

5. **Egress hosting model** — LiveKit Cloud (managed) vs self-hosted egress. The free-tier cap is acknowledged but the production hosting decision (and its cost model) is not made. This affects whether the recorder view needs to be internet-reachable or only LAN-reachable.

6. **Recording storage lifecycle** — **RESOLVED.** Recordings stored in Payload CMS on Figma Cloud (not a separate bucket). Access controlled entirely via Payload access control functions on the `session-recordings` collection with three visibility tiers:
   - **Private (default)**: viewable only by the Account that created the recording + Accounts explicitly invited + Payload admins.
   - **Org/domain**: viewable by any authenticated user sharing the creator's email domain (e.g. figma.com only).
   - **Public**: viewable by anyone with the link; optional `expiresAt` timestamp resets visibility to private/invite-only when passed.
   
   Required collection fields: `visibility` (enum: private | org | public), `invitedAccounts` (relationship array), `expiresAt` (date, nullable). Access control function checks visibility + expiry at read time. No external TTL or archival tier needed — deletion is explicit, admin-controlled.

7. **Offline re-render pipeline (Path B/S3)** — **RESOLVED.** Implemented as a Payload Job (same pattern as `enrich-media`). Job is enqueued after session ends, accesses ISO tracks + event log via Payload local API (no HTTP overhead). For long sessions, job is chunked into segments to stay within Lambda timeout constraints. Payload's job queue handles retries and status tracking.

### Cursor & Interaction

8. **Cursor asset pipeline** — **RESOLVED.** Cursor spritesheets are designed and exported from Figma (not Blender — no 3D toolchain required). Frames organized as gesture × rotation grid, exported as PNG/WebP, uploaded to Payload Media collection, consumed by the client via lookup table. Client exposes base customization properties on default sprite sets (color/tint, size) applied at render time. Custom spritesheet upload by users is descoped and deferred — easy to add later as an extension of the same pipeline.

9. **Hand customization** — **RESOLVED.** Each Account has a user-configured personal palette (starts with a single primary color). This color drives cursor tint and cascades as a CSS custom property through all identity-bearing UI surfaces: cursor sprite, focus borders, name badges, presence indicators. Applied at render time via CSS `--identity-color` on the participant's root element — no atlas variants needed per user. Color picker with curated presets; no multiple hand model variants for now. Palette stored on the Account doc; extended later if needed.

10. **Input & accessibility** — **RESOLVED.** Use the Pointer Events API (`pointerdown`, `pointermove`, `pointerup`) everywhere — unifies mouse, touch, and stylus in one event model with no platform-specific branches. Gesture state machine reads pointer input regardless of device type.

   Keyboard-only support is a first-class requirement:
   - Cursor position for keyboard users tracks the currently focused element (cursor renders at focus anchor, not arbitrary canvas position)
   - Radial menu: open with `/` or `Space`, navigate segments with arrow keys, confirm with `Enter`, dismiss with `Escape`
   - All interactive canvas nodes are focusable and reachable via `Tab`
   - Cursor interactions (high-five, ping) have keyboard equivalents
   - Full ARIA roles, labels, and live region announcements for dynamic canvas changes
   
   A11y is non-negotiable — every affordance must have an intuitive keyboard path alongside the pointer/gesture path. Design gesture states and menu interactions with keyboard ergonomics in mind from the start, not as a retrofit.

### Event Sourcing

11. **Event replay correctness** — **PARTIALLY RESOLVED.** Draft `SessionState` shape and fold function defined in §3 (Replay & State Reconstruction). Monolithic serializable state, discriminated-union fold, one arm per core event. Menus deliberately excluded from fold state; consent modeled as per-participant window timeline inside each recording. Remaining work: complete the fold arm coverage for every core event, and validate the shape against real recorded sessions.

12. **Conflict resolution in CQRS** — **RESOLVED (data layer); product mechanics deferred.**

   **Data layer**: Deterministic last-write-wins via the ordering key `(ts, actorId)` from Gap 2. Every client folds the same events in the same order into the same store → guaranteed convergence. No operational transform, no CRDT — the event count and rates don't warrant it.

   **State mechanism**: Zustand. The reconstructed `SessionState` fold writes into a Zustand store; `subscribe()` provides pub/sub fan-out to components and the recorder view. Pattern-matches React Flow (Zustand internally), so canvas node state and session state share one idiom. **Committed.**

   **No tick / no fixed timestep in the state layer.** The system is purely event-driven: an event arrives → fold applies it → subscribers react. Concurrency is resolved by ordering, not by quantizing events into a global timestep window (a deliberate data-oriented-design choice). The only fixed-timestep loop in the system is the physics integrator internal to Matter.js/Planck.js (Gap 16), which is scoped to physics bodies and is not a world-tick — events never quantize to it.

   **Product mechanics (deferred to feature phases)**: LWW can feel janky on *continuous contested actions* (two people dragging one tile snaps to whoever sorts last). This is a client-side UX concern, not a data-layer one — solved with mechanics like two-hand confirm, tug-of-war, reversibility. Which mechanic feels best is a playtesting question (what produces the most fun/magic), addressed when the relevant interaction ships, not decided up front.

13. **Event retention and compaction** — **DEFERRED (mechanism), trigger noted.** The fold state (Gap 11) was designed cleanly serializable specifically so snapshotting is trivial to add. When sessions get long enough to matter: snapshot the folded `SessionState` on a cadence (every N events or M minutes) into a `session-snapshots` collection; reconstruction becomes `latest snapshot + fold forward over events since`. Events are never discarded (the log stays immutable and complete for re-render/audit); snapshots are purely a read-side optimization. Not built until session length demands it.

### Spatial & Physics

14. **Zoom interaction with proximity** — **RESOLVED: zoom is movement, a third axis of proximity.** Effective distance from observer factors in zoom level, not just canvas XY. Zooming in = moving closer (louder, clearer, higher fidelity); zooming out = pulling back (quieter, abstracted, downscaled).

   **Key unification**: a single "effective distance" scalar drives three systems at once —
   - **Audio**: volume, panning, track subscription
   - **Visual**: blur / saturation / opacity zones (spec 05)
   - **Render LOD & culling**: the emphasis here. Proximity zones (Intimate → Near → Mid → Far → Beyond) double as level-of-detail tiers. Far/Beyond nodes downscale, drop to static avatars, and unsubscribe from video tracks (mirroring the existing audio-unsubscribe-past-maxDistance behavior). Combined with React Flow's `onlyRenderVisibleElements` viewport culling, this is how hundreds of nodes hold 120fps — render only what's in view, at fidelity proportional to closeness. Follows the games/Figma LOD playbook.

   One computation, three consumers.

   **Resolves an open question in spec 09**: viewport (position + zoom) IS part of a recording perspective. `renderAs(participant)` captures their zoom.

   **Surfaced sub-question (feel, playtest-decided)**: spec 05 sets the audio *listener* at the participant's tile position. Zoom-as-movement moves the observation point, so "ears" (viewport) and "mouth"/source (tile) may decouple. Two models: **(a) decouple** — tile = body/source, viewport = eyes/ears (RTS-commander feel, fits spec 00's game-UI language; current lean), or **(b) tile follows viewport** — whole embodiment moves on zoom. Lean (a); confirm via playtesting.

15. **New participant positioning** — **RESOLVED: click-to-spawn on a staging minimap.** Spawn position is a deliberate, embodied choice made in staging, not an algorithm. This unifies Gap 15 (positioning) and Gap 17 (staging) into one screen.

   **The staging minimap**: a pre-join screen showing a simplified real-time view of the session — participant/feed positions as identity-colored dots/avatars, cursor movement for liveness. No full video (cheaper, and correct fidelity for someone outside the session). Data source: the folded `SessionState` (Gap 11) + optional L1 presence (Gap 3).

   **How a not-yet-joined user gets live data**: reuses the "recorder is just a participant" insight. The staging user joins the LiveKit room in a **limited observing role** — subscribes to data channels to drive the minimap, publishes no media, spawns no tile. Present in the data plane, absent from the world. Maps to Q14 lifecycle: **Discovering → Staging → Present**.

   **Click-to-spawn = the join trigger** (the magic):
   ```
   In staging, viewing live minimap:
     click location (x, y)
       → core.participant.arrived { position: {x,y}, entranceStyle }
         → Staging → Present transition
           → tile spawns at chosen position
             → others see arrival choreography (Q16) at that spot
   ```
   Spawn position becomes part of the arrival choreography — satisfies Q16 (arrival as first-class moment) directly.

   **Canvas-as-world-map**: the minimap doubles as an in-session navigation affordance (RTS minimap, fits spec 00's game-UI language). Portals (Q18) can surface as map locations.

   **Two constraints flagged**:
   - **Privacy gating**: minimap fidelity is config-gated (ties to Q15 + Gap 6 visibility tiers). Private session → coarse metadata only ("3 people here," featureless dots). Open/public → full simplified view. Staging user is outside the trust boundary until spawn.
   - **LiveKit slot**: staging = data-only room participant, consuming a connection (answers Gap 17's open question). Fine at our scale; lighter Payload-poll path exists if ever needed, at the cost of realtime feel.

16. **Deterministic physics replay** — **RESOLVED: log outcomes as authoritative data, never re-simulate.** Physics outcome events (`core.feed.settled`, `core.feed.collided`) carry the final `{x, y}` position. Replay and offline re-render play back the *recorded positions* — they do not re-run the Matter.js/Planck.js sim. This sidesteps floating-point non-determinism entirely: we're replaying results, not recomputing them. Physics is a live-feel feature (momentum, bounce), not a system that needs deterministic reproduction. The physics integrator's fixed timestep (Gap 12) stays confined to the live client; the log captures only its meaningful outputs.

### Identity & Sessions

17. **Staging/pre-join experience** — **CORE RESOLVED (via Gap 15); embodiment DEFERRED (backlog).** The staging mechanism is the click-to-spawn minimap from Gap 15: staging user joins as a data-only observing participant (consumes a LiveKit slot — acceptable at our scale), views a config-gated live minimap, and spawns on click. The one remaining piece — *what present participants see of a staging user before they spawn* (Q15's "embodied pre-join": threshold silhouettes/vignettes vs. invisible-until-spawn) — is **earmarked and deferred as a backlog item**. Not critical; a sidequest to rescope once the system matures. Near-term behavior: staging users are invisible to present participants until they spawn.

18. **Participant lifecycle states** — **RESOLVED: two orthogonal axes.** The original Q14 list mixed three grammatical categories (activities like "Discovering," a condition "Present," a past-tense event "Departed"). Untangling them is the fix: **states are conditions** (one consistent register), **transitions are the past-tense events we already have** (`core.participant.arrived`, `core.participant.departed`). "Arriving"/"Leaving" were never states — they're the *choreography of* those transition events (Q16).

   **Two independent state fields** (data-oriented — orthogonal dimensions, not one enum):
   - **Lifecycle** (position in the session journey): `away → staged → present → gone`. All adjectival conditions, single register. `staged` = data-only observer viewing the minimap (Gap 15); `present` = embodied on canvas. Transitions between them are the past-tense events.
   - **Connectivity** (transport status): `online | offline`. Maps to LiveKit's `reconnecting`/`reconnected` events.

   They compose. The meaningful cell is **`present` + `offline`**: embodied but connection dropped — tile greys/freezes, others see "connection lost," reconnect flips back to `online` without changing lifecycle position. Cramming online/offline into the lifecycle enum would make "present but offline" inexpressible; two fields keeps each single-purpose.

   **Observing**: dropped. Not motivated by any committed decision. (A passive-watching *mode* can be added later as an attribute of `present` if a feature ever needs it — but not as a lifecycle state.)

19. **Portal room handoff latency** — **RESOLVED: video-game transition cards + choreography.** Activating a portal (leave LiveKit room → join linked room, ~1–3s cold start) is masked by a two-part sequence borrowed from game design:
   - **Departure choreography** (Q16) — the optimistic UX beat that starts the transition.
   - **Transition card** — a beautiful loading screen with a *real progress bar* plus hints/tips/shortcuts/info, exactly like a game loading card. This is the primary latency absorber: unlike a fixed-length animation, a progress-driven card holds gracefully for however long the actual join takes (fast join → quick card; slow join → card waits with progress + something to read). Then arrival choreography in the destination room.

   Pre-connection (begin joining the destination during the card) becomes an *optional* optimization underneath the card, not a requirement — the card already covers the gap.

   **App-default cards** ship with the product. **Backlog (future feature)**: custom transition cards, so people can compose interesting nested sessions with bespoke transition screens — turning the handoff moment into a design surface. Ties to the portals/sub-sessions graph (Q18).

### Product & UX

20. **Personal live rewind implementation** — **RESOLVED (scoped): event-log/canvas-state rewind first, media later.** Scrubbing replays the fold state (Gap 11) — tile positions, arrivals/departures, menu actions, cursor interactions — reconstructed from the event log + snapshots (Gap 13). This is nearly free (the fold and snapshots already exist), delivers the core "rewind" magic, and sidesteps expensive client-side media buffering. Historical *media* playback (video/audio at past timestamps) is a later enhancement that leans on the recording pipeline (§8), not built into v1 rewind.

   **Behavior during rewind**:
   - Participant stays `present` (Gap 18) but carries a `rewinding` mode flag — a subtle indicator on their live tile so others aren't confused by their frozen/absent cursor.
   - Live audio keeps running (optionally ducks) — they don't fall out of the live conversation while scrubbing canvas history.
   - Rewind is private and client-only: it re-renders their local view from historical fold state without emitting events or affecting anyone else.
   - Scope of history: whole session (bounded by snapshot + event availability); rolling-window optimization deferred until session length demands it (ties to Gap 13).

21. **Expression system** — **RESOLVED: emergent, condition-triggered expressions (not manually-invoked emotes).** The key design choice: expressions arise from how the cursor naturally behaves, not from a reaction menu. Nobody commands a high-five — the cursor becomes expressive on its own. Fits "the cursor IS the interface" far better than canned reactions.

   **Core set (4, novel, condition-triggered)**:
   | Expression | Trigger |
   |-----------|---------|
   | **bump** | Two cursors collide (proximity/collision detection, spec 02/05 interaction zones) |
   | **rest** | Cursor idle past a short threshold |
   | **sleep** | Cursor idle past a long threshold |
   | **wave** | Rapid shake (velocity-reversal recognition over a short window) |

   **Detection vs. firing (straddle rule)**: detection runs on ephemeral L1 cursor motion (live), but the *recognized* expression fires as a logged core event — cursor motion itself is never logged, so replay/recording has nothing to re-derive from unless the recognized expression is committed. Motion = ephemeral; recognized expression = persistent fact.
   - **bump, wave** → instantaneous **point events** (`core.cursor.bumped`, `core.cursor.waved`)
   - **rest, sleep** → **bracket events** (enter/exit, like consent windows) so replay knows the state span without logging continuous idle motion

   (Refines the earlier `core.cursor.interacted` placeholder; drops manually-invoked high-five/ping/emoji from the *core* set — those can live in `ext.*`.)

   **Rendering contract — two composable layers**:
   1. **Spritesheet/GIF registry** — expression kind → triggered animation asset (proven pattern from prior projects). Anchored to the actor's cursor, visible to all, auto-expiring (point events) or sustained (bracket events).
   2. **Procedural primitives** — math-based building blocks provided for composing cursor animations/emotes, alongside or within sprite-based expressions.

   **`ext.*` long tail**: custom emotes and playful one-offs register their own assets; unknown expressions degrade gracefully (generic indicator). Keeps the *core* set small (Q11) while leaving expression open-ended.

---

## 13. Technology Decisions (Committed vs. Open)

### Committed

| Decision | Choice | Source |
|----------|--------|--------|
| Realtime transport | LiveKit SFU | ADR-0001 |
| Canvas framework | React Flow (@xyflow/react) | Implemented |
| CMS | Payload CMS 3.x | Implemented |
| Framework | Next.js 15 (React 19) | Implemented |
| State management | Zustand | Implemented |
| Deployment | Figma Cloud (Lambda + S3) | Implemented |
| Cursor rendering | Sprite atlas (pre-rendered 3D) | Spec 02 |
| Event model | CQRS, semantic triple, typed core + open ext | Q8, Q11, Spec 04 |
| Recording | Server-side composite egress | Spec 08, Q1 |
| Session model | Ephemeral (no persistent rooms) | Q12 |
| Identity | Single unified, Payload Accounts | Q13 |
| Multiplayer UI model | Full co-op default, anyone can interact | Q9 |
| Consent | Opt-in, per-recording, time-segmented | Q3 |
| Topology | Portals (not spatial edges) | Q18 |

### Open

| Decision | Candidates | Blocking |
|----------|-----------|----------|
| CQRS log service | NATS/JetStream, custom, or Payload-only (deferred) | Phase 3 (partially — can start with host-scribe) |
| Physics engine | Matter.js → Planck.js → Rapier (escalation path) | Phase 7 |
| Recordings bucket | S3 vs Cloudflare R2 | Phase R |
| Egress hosting | LiveKit Cloud vs self-hosted | Phase R |
| Mux adoption | Optional downstream delivery | Post-Phase R |
| Offline re-render runtime | Headless Chrome, custom, unknown | Phase S (late) |
| Hand customization | Tinting, multiple models, user uploads | Phase 4 |

---

*Generated 2025-07-12 from specs 00–10, DECISIONS.md, and codebase survey. Gaps numbered for tracking. This document is a snapshot; DECISIONS.md remains the authority when they disagree.*
