# Production Plan

> Resolves Q10 (build order). Synthesized from specs 00–10, DECISIONS.md (Rounds 1–3), TECHNICAL-REPORT.md, and the current codebase.
>
> Authority: DECISIONS.md governs when this plan and specs disagree.

---

## Current Baseline

What ships today at `p2p-payload.figma.site`:

| Capability | State |
|-----------|-------|
| LiveKit SFU + token issuance | Production |
| React Flow canvas (media + figmaEmbed nodes) | Production |
| Position sync (data channel, `canvas-layout` topic) | Production |
| Client-side recording (host browser, 720p, WebM → S3) | Production (fragile) |
| Media pipeline (FFmpeg thumbnails/waveforms/duration, Sharp color) | Production |
| Figma OAuth → Accounts, Payload Users for admin | Production |
| Moments (calendar/scheduling), Timelines (playback), Memories (audit) | Production |
| Sessions collection | **Stub** (exists, not auto-created on join) |
| Multiplayer cursors | Not built |
| Spatial audio | Not built |
| Event sourcing / CQRS | Not built |
| Server-side recording | Not built |

---

## Sequencing Principles

1. **Each milestone ships a complete capability.** No "setup" milestones that only pay off later.
2. **Foundation before features.** Event architecture and domain wiring underpin everything — do them early so they compound.
3. **Recording tax is continuous.** Once Phase R ships, every subsequent feature must render in the recorder view. This is cheap (same app) but non-negotiable.
4. **Figma design work gates cursor phases.** Sprite atlas creation is design work, not code — schedule it ahead of the code phases that consume it.
5. **Open decisions don't have to block.** Build to the interface; swap implementations when the decision lands.

---

## Production Sequence

```
M1  Cursor Presence ─────────────────────────────────────────────────────── quick visual win
M2  Event Architecture ──────────────────────────────────────────────────── backbone
M3  Recording Foundation ────────────────────────────────────────────────── replaces fragile recorder
    ┊ (M1–M3 captured for free from here forward)
M4  Spatial Audio + Visual Proximity ────────────────────────────────────── canvas becomes spatial
M5  3D Hand Cursors ─────────────────────────────────────────────────────── cursor becomes alive
M6  Radial Menu + Multiplayer UI ────────────────────────────────────────── cursor becomes interface
M7  Cursor Interactions + Expressions ───────────────────────────────────── cursors interact
M8  Perspectives + Multi-POV ────────────────────────────────────────────── recording becomes multi-perspective
M9  Physics ─────────────────────────────────────────────────────────────── canvas becomes physical
M10 World: Portals, Staging, Session Config ─────────────────────────────── sessions become connected
M11 Polish + Rewind + Environmental ─────────────────────────────────────── ongoing refinement
```

---

## M1 — Cursor Presence

> Phase 1 from spec 07. Small scope, high visual impact. The single fastest way to make the canvas feel multiplayer.

**Delivers**: Every participant sees every other participant's cursor moving in real time on the canvas. Smooth, labeled, colored per identity.

**What exists**: Tile positions sync via `canvas-layout` data channel. `positionsRef` holds all participant tile positions. Identity color/name available from Accounts.

**What to build**:
- `presence` data channel topic (L1, lossy, ~20 Hz) — separate from existing `canvas-layout`
- Binary-encoded cursor message (~15 bytes: participantId, x, y, reserved fields for later gesture/rotation)
- `useCursorPresence()` hook — broadcast local pointer position, receive + buffer remote positions
- `<CursorLayer />` overlay component above React Flow — renders remote cursors with spring/lerp interpolation from 20 Hz → 60 fps
- Simple labeled arrow cursors with identity color + participant name (3D hands come later in M5)
- Local cursor hidden when pointer leaves canvas

**Does not build**: 3D hands, gestures, radial menu, spatial audio. Just presence.

**Depends on**: Nothing. Additive to current codebase.

**Open decisions**: None.

**Validation**: "I can see everyone's cursor moving in real time. It feels responsive and smooth."

**Scope**: Small (1 component, 1 hook, 1 data channel topic).

---

## M2 — Event Architecture

> Phase 3 from spec 07, plus domain wiring. This is the backbone — every subsequent feature emits events through this system.

**Delivers**: Every meaningful action in a session is captured as a typed, immutable event. Sessions are properly wired in the domain model. The event log enables future replay, recording enrichment, and state reconstruction.

**What exists**: Untyped `canvas-layout` messages (`move`, `request`, `state`, `embed-add`, `embed-remove`). Sessions collection (stub). Logs collection (generic event log).

**What to build**:

### 2a — Event Types (the product's capability surface)

Define the `SessionEvent` TypeScript types and Zod schemas. This is a design task as much as a code task — the event set defines what the product can do.

```
Core event vocabulary (from TECHNICAL-REPORT §3):
  core.session.*       started, configured, ended
  core.participant.*   arrived, departed, consentGranted, consentRevoked
  core.feed.*          added, removed, moved, resized
  core.embed.*         added, removed
  core.menu.*          opened, closed, selected
  core.cursor.*        bumped, waved, rested, slept (bracket events for rest/sleep)
  core.camera.*        toggled
  core.screen.*        started, stopped
  core.recording.*     started, stopped
  ext.*                open namespace, Zod-validated, not core state
```

Produce a `session-events.ts` module: discriminated union of `CoreEvent` types, Zod schemas for wire validation, `SessionState` interface (the fold target from §3), and the `fold(state, event)` function.

### 2b — Session Wiring

Wire the Sessions collection into the live session lifecycle:
- Auto-create a Session document when a LiveKit room is created (or on first join)
- Link Session to its events, recordings, and optionally to a Moment
- Session config schema: `anonymous` (boolean), `audience` (enum: any | org), `discoverability` (enum: private | unlisted | public), `semanticHandle` (slug)
- Session status: `active` → `ended` (set when last participant leaves — ephemeral, Q12)

### 2c — Event Pipeline

- `session-events` Payload collection — append-only, indexed by `(session, context.ts, actor)`, with `type` as a filterable field
- `events` data channel topic (L2, reliable) — replaces relevant `canvas-layout` messages with proper Command → Event flow
- `useEventSource()` hook: emit events locally (optimistic), broadcast via reliable data channel, batch-write to Payload
- Migrate existing `canvas-layout` operations: `move` → `core.feed.moved`, `embed-add` → `core.embed.added`, etc. Keep `canvas-layout` temporarily for backward compat during migration, then remove
- Client-side Zustand store holding the reconstructed `SessionState` from the fold

**Depends on**: Nothing technically. Benefits from M1 (cursor events) but doesn't require it.

**Open decisions**: None blocking. Gap 11 (fold arm coverage) is "remaining work" that happens organically as events are added per milestone. Gap 13 (snapshotting) is deferred until session length demands it.

**Validation**: "After a session, I can see a structured log of everything that happened — who joined, what moved, what was shared — in the admin panel."

**Scope**: Medium-Large. The event taxonomy design is the hard part, not the infrastructure code. The fold function starts small (a few arms) and grows with each milestone.

---

## M3 — Recording Foundation

> Phase R from spec 07. Replaces the fragile client-side recorder with server-side composite egress. Large scope, but the centerpiece of the recording architecture.

**Delivers**: Server-side recording via LiveKit Room Composite Egress. Host hits record → egress spins up a headless Chrome that loads our canvas app → renders everything server-side → HLS segments land in storage → webhook triggers ingest → session-recording doc created automatically. Survives laptop close, browser crash, 12-hour sessions.

**What exists**: Client-side `useCanvasRecorder` (off-screen canvas, 720p, WebM → S3 presigned upload → SessionRecordings). `enrichMedia` job pattern. Host record control + `recording` room-metadata flag. LiveKit server SDK for room service.

**What to build**:

### 3a — Recorder View

- `/session/[room]/record` route — the key new artifact
- Joins LiveKit room as a hidden participant (recorder identity)
- Renders the complete canvas from shared state: media nodes, cursor layer (M1), embed nodes
- Reads `url`, `token`, `layout` from query params
- Emits `START_RECORDING` / `END_RECORDING` to console (egress signals)
- Zero dependence on local interaction state — everything from presence data + events
- Must be reachable by the egress service (authentication: short-lived token-in-URL, see Gap 4)

### 3b — Egress Pipeline

- Egress start: when host hits record, call LiveKit `startRoomCompositeEgress` with the recorder view URL, HLS output config (1080p, segments to storage)
- Egress stop: when host stops recording or session ends, call `stopEgress`
- `POST /api/livekit/egress-webhook` — idempotent, JWT-verified webhook handler for egress lifecycle events (`egress_started`, `egress_updated`, `egress_ended`)
- `ListEgress` reconciliation on session end (catch missed webhooks)

### 3c — Ingest + Enrichment

- `recording-ingest` Payload job: triggered by `egress_ended` webhook, stitches HLS segments, creates Media doc + SessionRecordings doc with metadata (duration, room, participants, start/end timestamps)
- `recording-enrich` Payload job: reuses existing `enrichMedia` pattern (thumbnail, duration, waveform, dominant color)
- Storage: Payload CMS on Figma Cloud (existing S3 backend). Visibility tiers on session-recordings (private/org/public + optional expiresAt) per Gap 6 resolution

### 3d — Transition

- Keep client-side recorder as fallback until server-side is verified on prod
- Feature-flag: `useServerRecording` (room metadata or session config)
- Once verified, remove `useCanvasRecorder` and client-side recording pipeline

**Depends on**: Technically nothing — can be built against the current canvas. But building after M1 means cursors are captured for free. Building after M2 means events are captured in the log alongside the video.

**Open decisions**:
- **Q7 (egress hosting)**: LiveKit Cloud free tier vs self-hosted on Railway. **Decision criteria**: does the free tier (60 egress min/month, 2 concurrent) cover our usage? If yes, start with managed. If we exceed it, self-host. **Recommendation**: start with LiveKit Cloud free tier (zero ops), migrate to self-hosted if/when we hit limits.
- **Gap 4 (recorder auth)**: recorder URL must be reachable by egress. Short-lived, single-use token in the URL query param, validated server-side. Acceptable because the URL is never user-facing and tokens expire.

**Validation**: "I recorded a 90-minute session at 1080p, closed my laptop mid-session, and the recording survived and landed in the library automatically."

**Scope**: Large. New route, new API endpoint, new jobs, egress integration. The recorder view is the centerpiece and carries an ongoing obligation.

---

## M4 — Spatial Audio + Visual Proximity

> Phase 2 from spec 07. The canvas becomes a spatial environment.

**Delivers**: Audio volume and panning change based on distance between participants. Visual clarity (blur, saturation, opacity) scales with proximity. The canvas feels like a physical space.

**What exists**: Audio tracks accessible via `useTracks()` (LiveKit React components). Tile positions in `positionsRef`. Room config via room metadata. Per-track volume control via LiveKit SDK.

**What to build**:

- `<SpatialAudioController />` — replaces `<RoomAudioRenderer />`
- Per remote audio track: `AudioContext` → `createMediaStreamSource` → `PannerNode` → destination
- Canvas X → positionX, canvas Y → positionZ, fixed positionY = 0
- `refDistance: 100`, `maxDistance: 500`, `rolloffFactor: 2`, `panningModel: 'equalpower'` (upgrade to HRTF later)
- `setTargetAtTime()` with 20ms time constant for smooth position updates
- Hidden muted `<audio>` element trick for Chrome WebRTC → WebAudio routing
- Track subscription management: unsubscribe audio beyond maxDistance (with hysteresis)

- `useProximityEffects()` hook — calculates effective distance (factoring zoom per Gap 14), sets CSS custom properties per tile
- Proximity zones: Intimate (0–80, glow), Near (80–200, full), Mid (200–350, blur 2–4px), Far (350–500, blur + desaturate), Beyond (500+, greyscale + low opacity)
- Render LOD: Far/Beyond nodes downscale, drop to static avatars, unsubscribe from video tracks
- Configurable proximity parameters in session config (from M2's session wiring)

**Depends on**: Tile positions (already exist). Benefits from M2 (events for proximity config changes).

**Open decisions**: None blocking. Gap 14 sub-question (audio listener = viewport vs tile) is a playtesting call — start with viewport, adjust by feel.

**Validation**: "Moving closer to someone makes them louder. Moving away makes them fade and blur. It feels natural."

**Scope**: Medium. Replacing audio rendering is the core change. Visual effects are CSS custom properties — GPU-composited, performant.

**Recorder view obligation**: Spatial audio in the recorder view means the recorder needs a "listener position" — likely center-of-canvas or auto-fit viewport. Visual proximity effects render automatically (CSS).

---

## M5 — 3D Hand Cursors

> Phase 4 from spec 07. The cursor transforms from a flat arrow to a living hand.

**Delivers**: Local and remote cursors rendered as sprite-based 3D hands with gesture states. Context-sensitive gesture transitions (hover → open, drag → grab, idle → breathing). Identity color tinting.

**What exists**: M1's cursor presence infrastructure (position broadcasting, CursorLayer, interpolation).

**Pre-work (design, not code)**: Design and export the hand cursor spritesheet in Figma. 7 gestures × 16–24 rotation angles = 112–168 frames. Export as PNG/WebP texture atlas. Upload to Payload Media. This is **design work that should start during M3 or M4** so assets are ready when code begins.

**What to build**:

- Sprite atlas uploaded to Payload Media (CDN-cached)
- Atlas lookup table: `(gesture, rotation)` → frame coordinates
- `<HandCursor />` component (local) — renders atlas frame based on gesture state machine + pointer angle
- `<RemoteHandCursor />` component — renders atlas frame from presence data (gesture + rotation fields added to presence message in M1)
- Gesture state machine: pointer events → gesture transitions
  - idle: breathing animation (subtle scale/rotation oscillation)
  - point: default, moving
  - open: hovering over interactive element
  - grab: dragging
  - present: menu open (M6)
  - react: expression triggered (M7)
- CSS `rotate()` bridges discrete atlas rotation angles (15° steps)
- Identity color tinting via `--identity-color` CSS custom property (per Gap 9)
- Extend presence message: add gesture (3 bits) and rotation (uint8) fields

**Depends on**: M1 (cursor presence).

**Open decisions**: None blocking. Custom spritesheet upload is deferred.

**Validation**: "My cursor is a hand. It grabs things. It looks alive."

**Scope**: Medium. Code is straightforward once assets exist. The sprite atlas creation (Figma design work) is the bottleneck.

**Recorder view obligation**: HandCursor components render in the recorder view from presence data. No special work needed — same components, same data.

---

## M6 — Radial Menu + Multiplayer UI

> Phase 5 from spec 07. The cursor becomes the interface.

**Delivers**: Pressing `/` opens a shared radial menu anchored to the cursor. All participants see it. Anyone can hover over and interact with anyone's menu. Menu actions fire L2 events.

**What exists**: M5's gesture state machine (adds `present` gesture), M2's event pipeline (menu events).

**What to build**:

- `<RadialMenu />` component — rendered in cursor layer, anchored to cursor position
- Menu items for core actions: share screen, toggle camera, add embed, react
- Menu spec broadcast as L1 presence (all participants render independently)
- Hover state broadcast (who's hovering which item)
- Selection → L2 event (`core.menu.opened`, `core.menu.selected`, `core.menu.closed`)
- Permission model: default B (anyone can activate anything — full co-op, Q9). Permission tiers encoded in menu item metadata for the rare C escape hatch
- `present` gesture state triggers when menu opens (hand rotates to show menu)
- Keyboard: open with `/` or `Space`, navigate with arrow keys, confirm `Enter`, dismiss `Escape` (Gap 10)

- UISurface data model (from TECHNICAL-REPORT §5): id, owner, type, anchor, position, spec, state
- First-click-wins for discrete actions; creative mechanics (two-hand confirm, tug-of-war) for contested continuous actions — designed per interaction, not as a framework

**Depends on**: M5 (3D hand cursor with gesture states), M2 (event pipeline for menu events).

**Open decisions**: None blocking. Specific creative mechanics for destructive actions (Q9a) designed when those interactions ship.

**Validation**: "I pressed / and a menu appeared on my hand. My friend saw it and selected an option on it."

**Scope**: Large. The multiplayer interaction model (broadcasting specs, coordinating hover/selection across participants) is the complex part.

**Recorder view obligation**: Radial menus render in the recorder view from presence data (menu spec + hover state). Menu events logged for replay.

---

## M7 — Cursor Interactions + Expressions

> Phase 6 from spec 07, plus Gap 21 expression system.

**Delivers**: Cursors interact with each other through emergent, condition-triggered expressions. No reaction menu — the cursor becomes expressive on its own.

**What exists**: M5's cursor presence with gesture states, M2's event pipeline, M4's proximity system.

**What to build**:

- `useCursorProximity()` hook — pairwise distance between all cursors, threshold triggers
- Four core expressions (emergent, condition-triggered):
  - **bump**: two cursors collide (proximity threshold) → `core.cursor.bumped` (point event)
  - **wave**: rapid shake (velocity-reversal detection over short window) → `core.cursor.waved` (point event)
  - **rest**: cursor idle past short threshold → `core.cursor.rested` (bracket enter/exit)
  - **sleep**: cursor idle past long threshold → `core.cursor.slept` (bracket enter/exit)
- Detection runs on ephemeral L1 cursor motion; recognized expression fires as a logged L2 event (straddle rule)
- Expression rendering: spritesheet/GIF registry (expression → animation asset, anchored to cursor, visible to all, auto-expiring or sustained) + procedural math primitives
- `ext.*` namespace for custom emotes — registers own assets, degrades gracefully (generic indicator for unknown expressions)

**Depends on**: M5 (3D hand cursors), M4 (proximity for bump detection).

**Open decisions**: None.

**Validation**: "Our cursors got close and they bumped. I left my cursor still and it fell asleep. It was delightful."

**Scope**: Medium. Proximity detection is trivial; animation design and expression rendering are the work.

---

## M8 — Perspectives + Multi-POV Recording

> Phase S from spec 07. Recording becomes perspective-aware.

**Delivers**: The canvas can render from any participant's spatial point of view. Live spectating lets you "float to someone's seat." Per-perspective recording captures what they saw and heard.

**What exists**: M3's server-side recording pipeline, M4's spatial audio, M2's event log.

**What to build (incrementally — each sub-step ships independently)**:

### 8a — Decouple Recording from Host
- Recording state moves from single room-metadata flag to per-participant events
- `session-recordings` supports many-per-room with `owner` + `perspective`
- Drop the `meta.host` gate — any participant can start a recording
- Consent model: opt-in per recording (Q3), `core.participant.consentGranted/consentRevoked` events with `recordingId`
- Recording indicator mandatory and visible to all

### 8b — `renderAs(participant)` Primitive
- Canvas re-renders from any participant's spatial POV
- Audio listener position = that participant's position → spatial audio mix changes
- Proximity visual effects recalculate from that participant's location
- Viewport optionally follows participant's pan/zoom (Q2: focus is first-class)

### 8c — Live Spectating (the cheap, high-delight win)
- Locally adopt another participant's perspective mid-session
- Client-only, emits no events, costs nothing
- De-risks `renderAs()` before spending egress money
- **Ship this first within M8**

### 8d — Live Per-Perspective Recording (Strategy 2)
- Point an egress recorder view at `renderAs(X)` URL
- Concurrency guardrails (max N simultaneous egress jobs)
- Cost guardrails (track egress minutes, alert on runaway)

### 8e — Offline Re-Render (Strategy 3, north star)
- Reconstruct any perspective after the fact from event log + ISO tracks
- Payload Job (like `enrich-media`), chunked for long sessions
- Depends on mature event sourcing (M2) and ISO track capture

**Depends on**: M4 (spatial audio makes a perspective meaningful), M3 (recording pipeline), M2 (event log for re-render).

**Open decisions**:
- **Gap 4 / Q3b (consent filtering)**: Option B (live filtering in recorder view) for live composite, Option A (mux-time filtering) for offline re-render. Both coexist. Not blocking — M8a builds the consent event model, filtering implementation follows.

**Validation**: "The session ended, so I floated over to watch from Alex's seat — I heard what Alex heard — and hit record to save Alex's perspective."

**Scope**: Large overall, but front-loaded with cheap wins (8a, 8c). 8e is the ambitious north star.

---

## M9 — Physics

> Phase 7 from spec 07. The canvas becomes physical.

**Delivers**: Drag momentum (tiles slide and decelerate), collision (tiles bump each other), configurable gravity modes. The canvas feels tangible.

**What exists**: React Flow nodes with positions, M2's event pipeline, M4's spatial audio.

**What to build**:

- Matter.js integration (headless, synced to React Flow nodes)
- Physics body ↔ React Flow node sync: user drag → kinematic body → release → dynamic body with velocity → settle → update node position
- Collision detection and elastic bounce with visual ripple feedback
- `useCanvasPhysics()` hook
- Gravity modes (per-session config): none, gentle-settle, floor, orbit
- Spring constraints between related tiles (camera + screen share from same participant)
- Host-authoritative: one client runs sim, broadcasts positions at ~10 Hz, others interpolate
- Physics outcome events: `core.feed.settled`, `core.feed.collided` (carry final `{x,y}` — replay plays back positions, never re-simulates, per Gap 16)

**Depends on**: Tile positions (exist). Benefits from M2 (physics events in log) and M4 (spatial audio updates on physics movement).

**Open decisions**: Matter.js → Planck.js escalation only if body count exceeds ~50 (unlikely). Rapier (WASM) only if 100+ bodies.

**Validation**: "I threw a tile across the canvas and it bounced off another one. It felt like pushing furniture."

**Scope**: Medium. The physics engine does the hard math; our work is integration and sync.

**Recorder view obligation**: Physics affects tile positions which are already synced — recorder sees the results automatically.

---

## M10 — World: Portals, Staging, Session Config

> Specs 10 (world & identity), Gaps 15/17/19, Q17/Q18. Sessions become interconnected spaces.

**Delivers**: Portals link sessions together. A staging minimap lets participants choose where to spawn. Sessions have rich configurable identities with semantic handles.

**What to build**:

### 10a — Session Identity + Config
- Hidden backend UUID + auto-generated semantic handle/slug (Q17)
- Handle aliasing + redirects (old handle → current)
- Full session config schema: anonymous access, audience/tenant, discoverability, camera defaults, proximity params, recording policy, physics on/off
- Config surface in radial menu or dedicated host panel

### 10b — Staging Minimap
- Pre-join screen showing simplified real-time view of the session (Gap 15)
- Staging user joins LiveKit room as data-only observing participant (subscribes to data channels, publishes no media)
- Minimap renders fold state: participant positions as identity-colored dots, cursor movement for liveness
- Privacy-gated: private sessions → coarse metadata ("3 people here"), open/public → full simplified view
- Click-to-spawn = join trigger: click location → `core.participant.arrived { position }` → Staging→Present transition → arrival choreography (Q16)

### 10c — Portals
- Portal canvas node (like media/embed nodes) carrying a target session reference (UUID/handle)
- Activation triggers room handoff: leave current LiveKit room → transition card (progress bar + tips, Gap 19) → join linked room → arrival choreography
- Sub-sessions/breakouts: spawn a portal within a session
- One participant per session at a time (lean model, Q18)

### 10d — Arrival/Departure Choreography
- `core.participant.arrived` / `core.participant.departed` events carry `entranceStyle` / `exitStyle` (Q16)
- Data-driven: event carries the style, renderer plays the choreography
- Entrance styles: knock, footsteps, flourish, greeting (catalog designed later)
- Configurable per session

**Depends on**: M2 (event architecture), M5 (3D hands for choreography), M4 (spatial audio for portal transitions).

**Open decisions**: Q17b (handle generation algorithm), Q17d (tenant/org model), Q18b (sub-session nesting depth). None blocking initial implementation.

**Validation**: "I clicked a portal and whooshed into another session with a beautiful loading card. My friend saw me leave with a wave animation and arrive in the new room with a flourish."

**Scope**: Large. Multiple independent features, each substantial.

---

## M11 — Polish + Rewind + Environmental

> Phase 8+ from spec 07. Ongoing refinement, not a single milestone.

**Features** (each deployable independently):

| Feature | Description | Depends on |
|---------|-------------|------------|
| Personal live rewind | Private scrub through fold state while session continues; `rewinding` mode flag on live tile; audio keeps running | M2 (event log + fold) |
| Session replay viewer | Full replay from event log + recording; admin + participant access | M2, M3 |
| Active speaker glow | Visual indicator on speaking participant's tile | LiveKit `isSpeaking` (exists) |
| Environmental sound effects | Collision sounds, arrival chimes, ambient | Web Audio (M4) |
| Particle effects | Join sparkles, bump ripples, collision dust | CSS/Canvas overlay |
| Dynamic lighting | Mood/atmosphere via WebGL overlay | Three.js (future) |
| Fog of war | Proximity-driven fog/atmosphere | CSS (M4 proximity) |
| Event snapshotting | Periodic `SessionState` snapshots for fast replay of long sessions | M2 (Gap 13, deferred until needed) |
| Custom transition cards | Bespoke portal loading screens | M10 portals |

---

## Open Decisions by Milestone

Decisions that must be resolved before or during the milestone they affect:

| Decision | Status | Blocks | Recommendation |
|----------|--------|--------|----------------|
| Q7 — Egress hosting (Cloud vs self-host) | Open | M3 | Start with LiveKit Cloud free tier; migrate if limits hit |
| Gap 4 — Recorder auth model | Open | M3 | Short-lived token-in-URL, server-validated |
| Gap 4 / Q3b — Consent filtering A vs B | Open | M8 | B for live, A for offline; both coexist |
| Q17b — Handle generation algorithm | Open | M10 | Word-based (adjective-noun), collision-safe |
| Q17d — Tenant/org model | Open | M10 | Derive from Figma org via OAuth; extend Accounts |
| Matter.js → Planck.js escalation | Open | M9 | Start Matter.js; escalate only if >50 bodies |

All other decisions from Rounds 1–3 are resolved and documented in DECISIONS.md.

---

## Cross-Cutting Concerns

### Recorder View Obligation

Starting from M3, every feature milestone carries a small tax: ensure new visual elements render correctly in the recorder view from shared state alone. This is cheap because the recorder is the same app, but it's non-negotiable.

| Milestone | Recorder View Impact |
|-----------|---------------------|
| M1 | Cursor layer renders from presence data |
| M4 | Spatial effects render from CSS custom properties |
| M5 | Hand cursors render from presence data (gesture + rotation) |
| M6 | Radial menus render from presence data (menu spec + hover) |
| M7 | Expressions render from event stream |
| M9 | Physics outcomes already reflected in tile positions |
| M10 | Portals/choreography N/A (recorder stays in one room) |

### Accessibility (Gap 10)

Every interactive element must have a keyboard path alongside the pointer/gesture path. This is designed in from M1, not retrofitted:
- Pointer Events API everywhere (unifies mouse/touch/stylus)
- Cursor tracks focused element for keyboard users
- Radial menu: `/` or `Space` to open, arrows to navigate, `Enter` to confirm, `Escape` to dismiss
- All canvas nodes focusable via `Tab`
- Full ARIA roles, labels, live region announcements

### Identity System (Q13)

One identity (Accounts collection), many projections. The `--identity-color` CSS custom property cascades to all identity-bearing UI:
- Cursor tint (M5)
- Focus borders and name badges (M1)
- Presence indicators (M4)
- Menu highlights (M6)

Extend the Accounts schema incrementally as features need it (preferences, saved assets, personal palette).

---

## Design Work Schedule

Some milestones require design assets that should be produced **ahead** of the code work:

| Asset | Needed for | Start by | Format |
|-------|-----------|----------|--------|
| Hand cursor spritesheet | M5 | During M3 | 7 gestures × 16–24 rotations, PNG/WebP atlas |
| Radial menu layout + iconography | M6 | During M5 | Figma component |
| Expression animations (bump, wave, rest, sleep) | M7 | During M6 | Sprite/GIF assets |
| Arrival/departure choreography catalog | M10 | During M8 | Motion specs |
| Transition card designs | M10 | During M9 | Figma frames |
| Proximity zone visual language | M4 | During M2 | CSS specs (blur/saturation/opacity values) |

---

## Dependency Graph

```
M1 Cursor Presence ──────────────────────────────────────────────────────┐
│                                                                        │
├── M2 Event Architecture ──────────────────────────────────────────┐    │
│   │                                                               │    │
│   └── M3 Recording Foundation ────────────────────────────────┐   │    │
│                                                               │   │    │
├── M4 Spatial Audio + Proximity ───────────────────────────┐   │   │    │
│                                                           │   │   │    │
└── M5 3D Hand Cursors ────────────────────────────────┐    │   │   │    │
    │                                                  │    │   │   │    │
    ├── M6 Radial Menu + Multiplayer UI ───────────────┤    │   │   │    │
    │   (requires M2 + M5)                             │    │   │   │    │
    │                                                  │    │   │   │    │
    └── M7 Interactions + Expressions ─────────────────┤    │   │   │    │
        (requires M4 + M5)                             │    │   │   │    │
                                                       │    │   │   │    │
M8 Perspectives + Multi-POV ───────────────────────────┘    │   │   │    │
    (requires M3 + M4)                                      │   │   │    │
                                                            │   │   │    │
M9 Physics ─────────────────────────────────────────────────┘   │   │    │
    (benefits from M2 + M4)                                     │   │    │
                                                                │   │    │
M10 World: Portals, Staging, Config ────────────────────────────┘   │    │
    (requires M2 + M5)                                              │    │
                                                                    │    │
M11 Polish + Rewind + Environmental ────────────────────────────────┘    │
    (requires M2, benefits from all)                                     │
                                                                         │
◄──── recorder view obligation: every milestone from M3 onward ─────────┘
```

---

*Resolves Q10 (build order). Generated 2026-07-13 from the full specification corpus.*
