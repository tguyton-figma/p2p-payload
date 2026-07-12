# 07 — Implementation Phases

> **Reconciled with DECISIONS.md (2026-07-12):**
> - **Build ORDER (Q10) is explicitly DEFERRED** — too early. The phases below are a *dependency map*, not a committed sequence. Do not treat the numbering as the plan.
> - **New foundational work not yet phased here** (from Round 2): the **CQRS event architecture** (spec 04 — the persistent/ephemeral planes + log) underpins nearly everything and is a prerequisite for recording Path B, personal live-rewind, and multiplayer state; **sessions/identity/portals** (spec 10); **session config model** (Q17a). These will slot in when we do build-order.
> - **Phase 3 is now "Event Architecture (CQRS)"**, not a simple event log — see spec 04.
> - Deferred design areas that gate some phases: participant **lifecycle (Q14)** and **staging (Q15)**.
> - Recording phasing here still holds, but read it as the **layered A+B+C capture (Q1)**: composite + ISO tracks + event log, not a single composite.

## Guiding Principle

Each phase delivers a complete, usable capability. No phase is a "setup phase" that only pays off later. Every phase should make the product noticeably better on its own.

## A Note on Recording as a Cross-Cutting Concern

Recording (see [08-recording-muxing.md](08-recording-muxing.md)) is not a single late phase — it's a foundation with a standing obligation. The recorder renders our *actual canvas app* in headless Chrome (LiveKit Room Composite Egress), which means:

- **Phase R** below stands up the server-side recording pipeline and the "recorder view" scaffold, replacing the fragile client-side recorder.
- **Every feature phase thereafter carries a recorder-view obligation**: when you add cursors (Phase 4), menus (Phase 5), or effects (Phase 8), you must ensure they render correctly in the recorder view from shared state alone. This is a small, continuous tax — not a big-bang integration at the end.

The payoff: once Phase R exists, new visual features are recorded automatically, because the recorder is the same app.

## Phase R: Recording Foundation

**Goal**: Replace the fragile client-side canvas recorder with server-side composite egress that renders our own canvas app. Establish durable, progressive recording that survives full sessions.

**Delivers**:
- Server-side recording via LiveKit Room Composite Egress (no host-browser burden)
- A "recorder view" route (`/session/[room]/record`) rendering the canvas headlessly from a recorder token
- Progressive HLS output to a dedicated recordings bucket (crash-resilient)
- Egress webhook → Payload job → `session-recordings` doc with metadata
- Enrichment jobs reusing the existing `enrichMedia` pattern (thumbnail, duration, transcript slot)

**Builds**:
- Recorder view (the key new artifact; every future feature extends it)
- Dedicated recordings bucket (S3 or Cloudflare R2)
- `POST /api/livekit/egress-webhook` (idempotent, JWT-verified) + `ListEgress` reconciliation
- `recording-ingest` + `recording-enrich` Payload jobs
- Egress start/stop wired to the existing host record control + room-metadata recording flag

**Does not build**: 4K (validate at 1080p first), Path B offline replay re-render, Mux integration. Those are later refinements.

**Spec**: [08-recording-muxing.md](08-recording-muxing.md)

**Dependencies**: None on the new feature phases — can be built immediately against the *current* canvas. Should be built early so subsequent features are captured for free. Keep the client recorder as fallback until this is verified on prod.

**Estimated scope**: Large. New infra (bucket, egress, webhook), new route, new jobs. The recorder view is the centerpiece.

**Validation**: "I recorded a 90-minute session at 1080p, closed my laptop mid-session, and the recording survived and landed in the library automatically."

## Phase 1: Cursor Presence

**Goal**: Every participant sees every other participant's cursor in real time on the canvas. This is the foundation for everything that follows.

**Delivers**:
- Multiplayer cursors visible on the canvas (simple labeled arrows initially, like Figma)
- Cursor position broadcasting via LiveKit data channel
- Smooth interpolation of remote cursor positions
- Participant name labels on cursors (colored per participant)

**Builds**:
- `presence` data channel topic (Layer 1 infrastructure)
- `<CursorLayer />` component (overlay above React Flow)
- `useCursorPresence()` hook (broadcast local, receive remote)
- Spring interpolation for smooth remote cursor rendering

**Does not build**: 3D hands, gestures, menus, spatial audio. Just presence.

**Spec**: [02-cursor-system.md](02-cursor-system.md) — network protocol section only

**Dependencies**: None. Additive to current codebase.

**Estimated scope**: Small. One new component, one new hook, one new data channel topic.

---

## Phase 2: Spatial Audio + Visual Proximity

**Goal**: The canvas becomes a spatial environment. Audio volume and visual clarity change based on distance between participants.

**Delivers**:
- Distance-based audio volume (close = loud, far = quiet)
- Left/right audio panning based on relative canvas position
- Visual proximity effects on media tiles (blur, opacity, saturation)
- Configurable proximity parameters

**Builds**:
- `<SpatialAudioController />` replacing `<RoomAudioRenderer />`
- `<SpatialTrackRenderer />` per remote audio track (PannerNode graph)
- `useProximityEffects()` hook (CSS custom property driver)
- Proximity configuration in room metadata

**Does not build**: Full HRTF (start with `equalpower` panning, upgrade to HRTF later), ambient environmental audio, fog of war.

**Spec**: [05-spatial-proximity.md](05-spatial-proximity.md)

**Dependencies**: Requires tile positions to be stable and available (already are via `positionsRef`).

**Estimated scope**: Medium. Replacing audio rendering is the core change. Visual effects are CSS-only.

---

## Phase 3: Event Sourcing Foundation

**Goal**: Every meaningful action in a session is captured as an immutable event, enabling future replay and analysis.

**Delivers**:
- `session-events` Payload collection
- Event broadcasting via reliable data channel
- Host-scribed event persistence (batch writes to Payload)
- Initial event taxonomy (session lifecycle, canvas actions, media toggles)
- Session event viewer (admin-only, list view in Payload)

**Builds**:
- `SessionEvent` type and taxonomy
- `useEventSource()` hook (emit, broadcast, buffer, flush)
- `events` data channel topic (Layer 2 infrastructure)
- `POST /api/session-events/batch` API route
- `session-events` Payload collection with indexes

**Does not build**: Replay viewer, timeline scrubbing, cursor events (cursors are still just presence). Those come after the cursor system is enriched.

**Spec**: [04-event-sourcing.md](04-event-sourcing.md)

**Dependencies**: None technically. Benefits from Phase 1 (cursor events) and Phase 2 (proximity context in events) but can be built independently.

**Estimated scope**: Medium. New collection, new API route, new hook. The event taxonomy is the design challenge, not the code.

---

## Phase 4: 3D Hand Cursor

**Goal**: Cursors transform from flat arrows to 3D hands with gesture states, bringing the canvas to life.

**Delivers**:
- Local and remote cursors rendered as sprite-based 3D hands (single atlas, no new dependency)
- Gesture states: point, open, grab, idle
- Context-sensitive gesture transitions (hover → open, drag → grab)
- Gesture state broadcast as part of cursor presence

**Builds**:
- Sprite atlas of the hand (Blender → pre-rendered gesture × angle frames), stored in Payload CMS Media
- `<HandCursor />` component (local, atlas frame + code-driven smoothing)
- `<RemoteHandCursor />` component (atlas frame selection from presence)
- Gesture state machine (input events → gesture transitions)
- Atlas lookup table: `(gesture, rotation)` → frame coordinates

**Does not build**: Radial menu, cursor interactions (high-five), cursor-as-UI. Just the hand visual and gesture states.

**Spec**: [02-cursor-system.md](02-cursor-system.md) — rendering and gesture sections

**Dependencies**: Phase 1 (cursor presence infrastructure). Presence messages extended with gesture and rotation fields.

**Estimated scope**: Medium-Large. The sprite atlas creation (Blender render pipeline) is the bottleneck, not the code. Code is straightforward once assets exist.

---

## Phase 5: Radial Menu + Multiplayer UI

**Goal**: The cursor becomes the interface. Pressing `/` opens a shared radial menu that anyone can see and interact with.

**Delivers**:
- Radial menu attached to cursor (the "sci-fi bracelet")
- Menu items for core actions (share screen, add camera, react, etc.)
- Menu visible to all participants (multiplayer UI)
- Anyone can hover over and interact with anyone's menu
- Menu open/close and selection are L2 events

**Builds**:
- `<RadialMenu />` component (rendered in cursor layer)
- Multiplayer UI state broadcasting (menu spec, hover state)
- Menu interaction handling (local and remote selections)
- Permission model (self-actions vs shared actions)
- `present` gesture state (hand rotates to show menu)

**Does not build**: Nested sub-menus, property inspectors, or other advanced UI surfaces. Just the primary radial menu.

**Spec**: [02-cursor-system.md](02-cursor-system.md) (radial menu), [03-multiplayer-ui.md](03-multiplayer-ui.md)

**Dependencies**: Phase 4 (3D hand with `present` gesture), Phase 3 (event sourcing for menu events).

**Estimated scope**: Large. The multiplayer interaction model is the complex part — rendering the menu itself is straightforward.

---

## Phase 6: Cursor Interactions

**Goal**: Cursors can interact with each other. Proximity triggers shared animations and events.

**Delivers**:
- Cursor-cursor proximity detection
- High-five interaction when two cursors meet
- Awareness indicators when cursors are nearby (hands orient toward each other)
- Interaction events in the event log
- Extensible interaction trigger system

**Builds**:
- `useCursorProximity()` hook (pairwise distance, threshold triggers)
- Interaction animation system (shared animations between two cursors)
- `cursor:interact` event type
- Interaction configuration (threshold distances, enabled interactions)

**Does not build**: Complex multi-cursor interactions, reaction pickers, or cursor-to-tile interactions beyond drag.

**Spec**: [02-cursor-system.md](02-cursor-system.md) — interaction section

**Dependencies**: Phase 4 (3D hand cursors with gesture states), Phase 1 (cursor presence for position data).

**Estimated scope**: Medium. The proximity detection is trivial; the animation design and coordination are the work.

---

## Phase S: Perspectives & Multi-POV Recording

**Goal**: Recording is no longer host-bound. Any participant can experience — and capture — the session from any point of view. Delivers the "float between players" feeling.

**Delivers** (incrementally — each sub-step is independently valuable):
- **Sa — Decouple recording from host**: recording state moves from the single room-metadata flag to per-participant presence/events; `session-recordings` becomes many-per-room with `owner` + `perspective`; drop the `meta.host` gate.
- **Sb — `renderAs(participant)` primitive**: the canvas can render itself from any participant's spatial POV (their audio-listener position, their proximity visuals, optionally their viewport).
- **Sc — Live spectating**: locally adopt another participant's perspective mid-session (cheap, client-only, high delight — de-risks `renderAs()` before spending egress money).
- **Sd — Live per-perspective recording (Strategy 2)**: point an egress recorder view at `renderAs(X)`, with concurrency/cost guardrails.
- **Se — Offline re-render (Strategy 3, north star)**: reconstruct any perspective after the fact from the event log + raw track egress (this is spec 08's Path B, realized).

**Spec**: [09-recording-perspectives.md](09-recording-perspectives.md)

**Dependencies**: Phase 2 (spatial audio + proximity — this is what makes a perspective meaningful). Sa builds on Phase R. Se builds on mature Phase 3 (event sourcing). Sc is the recommended first deliverable of this phase.

**Estimated scope**: Large overall, but front-loaded with cheap wins (Sa, Sc) and back-loaded with the ambitious re-render pipeline (Se).

**Validation**: "The race ended, so I floated over to watch from Alex's seat — I heard what Alex heard — and hit record to save Alex's perspective of the finish."

## Phase 7: Physics

**Goal**: Canvas objects have physical properties. Drag momentum, collision, and optional gravity make the space feel tangible.

**Delivers**:
- Drag-and-release momentum (tiles slide and decelerate)
- Tile collision (tiles bump each other)
- Configurable gravity modes (none, gentle settle, floor)
- Host-authoritative physics simulation
- Physics state broadcast via existing position sync

**Builds**:
- Matter.js integration (headless, synced to React Flow)
- Physics body ↔ React Flow node sync
- Collision detection and response
- `useCanvasPhysics()` hook
- Session physics configuration in room metadata

**Does not build**: Particle effects, dynamic lighting, environmental sounds. Those are Phase 8+.

**Spec**: [06-physics-environment.md](06-physics-environment.md)

**Dependencies**: Phase 2 (spatial audio — physics-driven movement should update audio positions). Benefits from Phase 3 (physics events in the log).

**Estimated scope**: Medium. The physics engine does the hard math; our job is integration and sync.

---

## Phase 8+: Environmental Polish

**Goal**: The canvas becomes a rich, atmospheric environment with light, sound, and visual effects.

This is a collection of independent enhancements, each deployable separately:

| Feature | Spec Reference | Dependencies |
|---------|---------------|--------------|
| Active speaker glow | [06](06-physics-environment.md) | LiveKit `isSpeaking` |
| Environmental sound effects | [06](06-physics-environment.md) | Web Audio, asset pipeline |
| Particle effects (join, high-five, collision) | [06](06-physics-environment.md) | WebGL overlay or CSS |
| Session replay viewer | [04](04-event-sourcing.md) | Event sourcing (Phase 3) |
| Timeline scrubbing | [04](04-event-sourcing.md) | Event sourcing + replay |
| Dynamic lighting | [06](06-physics-environment.md) | WebGL overlay (Three.js) |
| Fog of war / proximity fog | [05](05-spatial-proximity.md) | CSS or Canvas overlay |

---

## Dependency Graph

```
Phase R: Recording Foundation ──── (parallel, early; every phase below extends the recorder view)
    ┊
Phase 1: Cursor Presence ──────────────────────────────────┐
    │                                                       │
    ├── Phase 2: Spatial Audio + Visual Proximity            │
    │                                                       │
    ├── Phase 3: Event Sourcing Foundation ──────┐           │
    │                                           │           │
    └── Phase 4: 3D Hand Cursor ────────────────┤           │
         │                                      │           │
         ├── Phase 5: Radial Menu + MP UI ──────┘           │
         │                                                  │
         └── Phase 6: Cursor Interactions                   │
                                                            │
Phase 7: Physics ───────────────────────────────────────────┘
    │
    └── Phase 8+: Environmental Polish
```

Phase R can start immediately against the current canvas — it does not depend on the feature phases, and building it early means every subsequent feature is recorded for free (at the cost of a small recorder-view obligation per phase).
Phases 1, 2, and 3 can be developed in parallel after Phase 1 is proven.
Phase 4 requires Phase 1.
Phase 5 requires Phases 3 and 4.
Phase 6 requires Phase 4.
Phase S (perspectives/multi-POV) requires Phase 2 (spatial audio is what makes a perspective meaningful); its Sa step builds on Phase R, its Se step on a mature Phase 3.
Phase 7 can begin any time after Phase 1 but benefits from all prior phases.
Path B (offline replay re-render, spec 08) = Phase S step Se; requires Phase 3 (event sourcing) to be mature.

## Validation Approach

Each phase should be validated in a real multiplayer session before the next begins:

1. **Phase 1**: "I can see everyone's cursor moving in real time. It feels responsive."
2. **Phase 2**: "Moving closer to someone makes them louder. Moving away makes them fade. It feels natural."
3. **Phase 3**: "After a session, I can see a log of everything that happened."
4. **Phase 4**: "My cursor is a hand. It grabs things. It looks alive."
5. **Phase 5**: "I pressed / and a menu appeared on my hand. My friend saw it and selected an option on it."
6. **Phase 6**: "Our cursors got close and they high-fived. It was delightful."
7. **Phase 7**: "I threw a tile across the canvas and it bounced off another one."
