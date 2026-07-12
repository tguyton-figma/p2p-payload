# Architecture Decisions

Working log. We answer one question at a time. Sub-questions spawned by an answer are appended under it.

## Status

| # | Question | Status |
|---|----------|--------|
| 1 | Commit to layered capture (composite + ISO tracks + event log) as target? | ✅ yes — A+B+C, tools chosen per-layer later |
| 2 | Is viewport (pan/zoom) part of "perspective," or shared auto-fit? | ✅ hybrid — configurable; focus is first-class; auto-fit = default (spawned Q2a–d) |
| 3 | Consent/privacy model for any-participant recording? | ✅ OPT-IN per recording, time-segmented; session policy; reject D (spawned Q3a–e) |
| 4 | Recordings storage bucket: AWS S3 or Cloudflare R2? | ✅ DEFERRED — too early; Payload on Figma Cloud primary, Railway fallback |
| 5 | HLS vs MP4 as canonical recording artifact? | ✅ A — HLS canonical, MP4 on demand |
| 6 | Adopt Mux for delivery/transcripts, or self-serve? | ✅ C — defer/evaluate; ABR is a target requirement |
| 7 | Cloud egress vs self-hosted egress for production? | ✅ DEFERRED — bias to free/OSS self-host (Railway) over paid managed |
| 8 | Event scribe: host-only writes, or every participant (dedup)? | ✅ CQRS — durable ordered log is the authority; all publish (idempotent); Payload = projection (spawned Q8a–e) |
| 9 | Cursor menu — who can activate another's menu items (permission model)? | ✅ B by default; C rare/exceptional escape hatch; solve emergent states creatively |
| 10 | Build order: what ships first? | ⏸️ DEFERRED — far too early; revisit after Round 2 |

## Round 2 — World & Experience Design

Focus shifts from stack to the actual target-state experience. Guided by the **design philosophy** below.

| # | Question | Status |
|---|----------|--------|
| 11 | Actions as first-class primitives — formalize an action/verb vocabulary? | ✅ hybrid CQRS+verbs+triple; tiered core/ext; 2 planes; TS+Zod; additive-only; KEEP SMALL (a–d done) |
| 12 | Session: ephemeral call vs persistent place? | ✅ A — ephemeral (dies when empty); history via recordings, not persistent rooms |
| 13 | Participant embodiment & identity — one identity, how many forms? | ✅ A — single identity (bound to Payload Accounts), many projections; hand = anchor; +user memory |
| 14 | Participant lifecycle states? | ⏸️ DEFERRED — TJ unsure; revisit after more decisions |
| 15 | Staging as canvas presence? | ⏸️ DEFERRED — TJ wants the feature; design details TBD |
| 16 | Arrival & departure choreography? | ✅ A — first-class, configurable, recordable events (entrance style is data); specifics designed later |
| 17 | Session discovery & definition? | ✅ C — config-driven visibility; hidden UUID + semantic handle/slug routing + rename redirects |
| 18 | Session stitching & topology? | ✅ PORTALS (not edges) — linkable sessions + sub-sessions/breakouts; portal node on canvas |
| 19 | Expressive vocabulary? | ✅ C — foundational expressions in core, long tail in open ext.* tier |
| 20 | Time as a navigable dimension? | ✅ B — personal live rewind (private scrub while session continues); A included; C aspirational |

---

## Design Philosophy (north star for Round 2)

**Actions compose into expressive multiplayer experiences.** The atomic unit of the system is the individual **action**; rich experiences emerge from how actions combine, and from **enriching individual moments** with smart, coherent, intelligent design and state transformation. We reject the "flatten everything to utility" pattern of current tools.

**Illustrative north-star examples (from TJ):**
- **Joining ≠ spawning at the table.** In the real world you knock, you're heard in the hall, you enter with a flourish and are greeted. Current tools: pick mic/cam → instantly appear. We want to design the *arrival*.
- **Staging as visible presence.** Pre-join participants shouldn't be an invisible "waiting room count." They could appear on the canvas as a silhouette/vignette/proxy — insiders see who's staged; staged users can peer through the "window," read session metadata, decide when/where/how to enter. (Contrast: invite 1000 people → you see a number. We want embodied staging.)
- **Stitching sessions in spacetime.** Separate sessions needn't be absolutely isolated. Move your cursor off the right edge of session A → arrive in session B; off B's left edge → back to A. Sessions as a connected topology, not islands.

These are the *kind* of moments Round 2 exists to define and make whole — before any build-order or stack specifics.

---

## Q11 — Actions as primitives

### ✅ DECISION (2026-07-12) — Hybrid of patterns 1 + 2 + 3
Compose three patterns:
- **(2) CQRS frame** — split **commands** (imperative intent, validatable/rejectable, e.g. `OpenMenu`) from **events** (immutable past-tense facts, e.g. `menu.opened`). Commands are the write-side request; events are what actually happened.
- **(1) Domain-event verb naming** — events named as past-tense, dot-namespaced facts: `cursor.menu.opened`, `participant.staged`, `feed.moved`.
- **(3) Semantic-triple schema** — every event carries **actor · verb · object · context** (Activity-Streams-style): who did it, the verb, the target object, and context (position, timestamp, session, causality). Uniform, spatial, expressive.

Concrete shape (illustrative):
```
Command:  { do: "OpenMenu", actor, target, args }        // intent (may be rejected)
   ↓ (validated → emitted)
Event:    {
  type: "cursor.menu.opened",   // domain-event verb (1)
  actor: "tj",                   // ┐
  verb: "opened",                // │ semantic triple (3)
  object: { kind: "menu", id },  // ┘
  context: { x, y, ts, session, causationId, correlationId }
}
```
This is the atomic unit the whole system composes from (events → projections → UI, recording, replay, expressiveness). Sits on the CQRS log-as-authority from Q8.

### Spawned sub-decisions (resolving next, in order)
- **Q11a — Verb set** → ✅ **C, tiered.** A closed, typed **core** vocabulary for things replay/recording/state depend on (session lifecycle, canvas, media, recording, consent) + an open **extension** namespace for experimental/expressive actions that don't touch core state. Core is versioned/guaranteed; extensions are free-form and best-effort. Namespacing likely encodes the tier (e.g. `core.*` vs `ext.*` / `x.*`).
- **Q11b — Granularity** → ✅ **Two explicit planes: PERSISTENT vs EPHEMERAL, and every action/state MUST be flagged as one.** (Principle A, enforced by explicit per-thing tagging C.) Making the distinction first-class — never mixed/ambiguous — is itself the decision, so the system stays easy to reason about.
  - **PERSISTENT** = canvas/node state: what's on the canvas, its position, its node state. Changes irregularly / less frequently. → goes through the **CQRS event log** (durable, replayable, projected to Payload). This is the "write it down forever" plane.
  - **EPHEMERAL** = cursor/presence state: cursor position, gesture-in-motion, hover, live audio levels. High-frequency, only-matters-now. → **real-time broadcast only** to clients that need it; NOT durably logged. Lossy-tolerant.
  - **Straddle pattern (the drag case)**: a single interaction can span both planes — *ephemeral during* (drag motion streamed live), *persistent on commit* (final `feed.moved` position logged). "Ephemeral while happening, persistent at the meaningful result."
  - Directly reinforces the layered data arch (spec 01): EPHEMERAL = L1 presence; PERSISTENT = L2 events. And maps onto CQRS (Q8): persistent plane = events/projections; ephemeral plane = presence, outside the log.
  - **Prior-art influences to borrow** (patterns, tools tbd): **Datastar** (client actions → server, SSE server→client push; great perf) and **Supabase Realtime** (purpose-built ephemeral high-speed broadcast/presence stream). These model the ephemeral plane well; the persistent plane is the CQRS log + Payload projection.
  - Cross-link: transport for each plane = Q8a (e.g. ephemeral over a Supabase-realtime-like / LiveKit data channel; persistent over the durable log).
- **Q11c — Typing/serialization** → ✅ **TS discriminated unions for the typed core + Zod validation at the extension/wire boundary.** Compiler-checked core events (best DX in our TS/Next/Payload stack, trivial pattern-matching); **Zod** validates the open `ext.*` tier and anything arriving off the wire (untrusted). The **Activity-Streams actor·verb·object·context shape is honored as a schema CONVENTION**, not adopted literally as JSON-LD. protobuf/binary rejected for now (codegen overhead, less debuggable log; revisit only if wire size demands it).
- **Q11d — Versioning/evolution** → ✅ **A — additive-only + version field.** Events carry `v`; may add optional fields / new verbs, never remove or repurpose → old events replay as-is. (Upcasters/B only if a breaking change is ever truly unavoidable; snapshots/C later for replay perf.)

### ⭐ GUIDING PRINCIPLE (reinforced by TJ at Q11d) — keep the event set SMALL
The architecture may be described as complex, but the app/code/system logic must stay **simple, lean, finite, coherent**. Explicitly:
- A **finite, small, schema-backed** set of events — resist proliferation and cruft.
- **Type-safe end-to-end.**
- Do NOT let the real-time/event system sprawl. Small + flexible + easy to grasp.
- **Events shape the product**: the event set is a design tool — the finite vocabulary of events defines the features/capabilities/interface of the app. Adding an event is a deliberate product decision, not incidental.

## Q12 — Session: call vs place

### ✅ DECISION (2026-07-12) — A, ephemeral
A session is an **ephemeral call**: it exists only while occupied; empty → gone. Simple, matches today.

Implications / how the spatial vision still holds:
- **Staging & stitching still work** — they operate between *concurrently live* sessions and pre-join participants, which need no persistence.
- **History / "revisiting" is served by RECORDINGS** (the layered capture + event log from Q1/Q8), NOT by durable rooms. You revisit the *recording*, not a still-live place.
- **Precludes**: resuming/rejoining a session after it empties, and rooms that accrue durable state across time. Accepted.

### Spawned
- **Q12a** — If "resume a session later" ever becomes desired, that's a future reconsideration; recordings/event-log replay may cover most of the need without persistent rooms.
- **Q12b** — Session identity/addressing while live (how a session is named/found) → feeds Q17 discovery.

## Q13 — Embodiment & identity

### ✅ DECISION (2026-07-12) — A, single identity → many projections
One **identity** entity (account or guest) that PROJECTS into different visual forms depending on state/context. Forms are views of one entity, not separate objects:
- **Hand cursor = the always-present anchor.** The moment you're present, you exist as a hand. (Blends A's clean model with cursor-primary centricity → fits "the cursor is the interface.")
- **Media feed** (camera/screen) — attaches when publishing.
- **Avatar** — shown when camera-off (already built, Figma avatars).
- **Silhouette/vignette** — the staging/pre-join projection (feeds Q15).
- All forms carry the same identity color/name so a person reads as one being across states.

### ⭐ REFINEMENT (2026-07-12) — identity is bound to the Payload `Accounts` collection
- **Canonical identity = the Payload `Accounts` collection.** One unified identity across the whole app, powered by Payload CMS.
- **Extend `Accounts` as needed** for rich identity config/customization: saved **preferences**, **uploaded assets** (custom hand skins, avatars, etc.), **universal app config**, and more — all against the single identity.
- **User "memory"**: give each user a personal **memory built on the event log / history** (Q8 CQRS log). It's a per-user projection of their own event history — a durable, personal sense of what they've done/experienced. (New concept: `user-memory` as a projection over a participant's events.)

### Spawned
- **Q13a — Identity/Account schema**: extend `Accounts` (auth account vs guest `anon-*`, name, color, avatar, uploaded assets, prefs, universal config, capabilities). Guests are ephemeral/limited; full identity requires an Account.
- **Q13b — Multi-feed under one identity**: multi-feed refactor already allows N feeds per participant; confirm all hang off the single identity/cursor anchor.
- **Q13c — Color/identity assignment**: system-assigned (Figma-style) vs chosen; guaranteed-distinct across a session.
- **Q13d — User memory model**: what does the per-user memory contain, how is it projected from the event log, what's it used for (personalization, continuity, "your history")? Later.

## Q14 — Participant lifecycle states

### ⏸️ DEFERRED (2026-07-12)
TJ not sure yet; revisit after more decisions (esp. Q15 staging, Q16 arrival, Q17 discovery, Q18 stitching — these will shape what states actually exist). Candidate set to revisit: Discovering → Staging → (Arriving) → Present → (Observing) → (Leaving) → Departed, with open questions on whether Arriving/Leaving are states vs choreography and whether Observing is a mode of Present.

## Q15 — Staging as presence

### ⏸️ DEFERRED (2026-07-12)
Confirmed desire: staging IS a wanted feature (pre-join participants embodied on the canvas, not an invisible count). Design details not worked out yet. Candidate directions to revisit: outward = embodied silhouettes/vignettes clustered in a threshold/doorway zone (identity color+name, non-interactive); inward = privacy-gated peek (metadata always, live preview only if session config/consent allows). Ties to Q2 config, Q3 consent, Q13 projections, Q14 lifecycle.

## Q16 — Arrival & departure choreography

### ✅ DECISION (2026-07-12) — A, first-class
Arrival/departure are **first-class, configurable, recordable moments**, not mere animation:
- Core events on the persistent plane: `participant.arrived` / `participant.departed` (fits Q11 core vocabulary, Q8 log).
- Carry an **entrance/exit style** property (data-driven choreography — knock/footsteps/flourish/greeting are configurable options, defined later).
- Configurable per session (Q2 config) and part of history/replay + recordings.
- The *specific* choreography catalog is designed later (ties to deferred Q14 lifecycle + Q15 staging).

## Q17 — Session discovery & definition

### ✅ DECISION (2026-07-12) — C, config-driven, enriched
Discoverability is a **session config property**; directory for public sessions, links for private. Enriched with:

**Session config must scale coherently.** Add configurable properties intuitively/simply so they work well in reality. Today's open/closed (= can unauthenticated users join) is the seed. Distinct config axes to model (keep them clean, not tangled):
- **Access — anonymous**: allow unauthenticated/anonymous users? (today's open/closed)
- **Access — audience**: any authenticated user, vs only authenticated users within your **tenant/organization**.
- **Discoverability**: private-link / unlisted / public-in-directory.
- (access control and discoverability are SEPARATE axes — a session can be publicly discoverable but tenant-only to join, etc.)

**Identifier & routing model (semantic, "the app talks to you"):**
- Every session has a **hidden backend UUID** — the system builds with it; NEVER user-facing.
- Auto-generate a **semantic handle** (alias) for every session — intelligent/human, used to join.
- **URL routes per session use the handle as slug**; sharing = a link whose slug is the semantic handle.
- **Rename anytime**: because UUID is stable and handles are aliases, renaming is supported via **aliasing + redirects** (old handle → current). Keeps the semantic system ergonomic across many active/stitched sessions.

### Spawned
- **Q17a — Session config schema** (merges with Q2b): full set of axes (anonymous, audience/tenant, discoverability, + camera/proximity/recording/etc. from other Qs) and how host sets/changes them. Needs a coherent, scalable shape.
- **Q17b — Handle generation**: semantic-handle algorithm (word-based? themed?), uniqueness/collision handling, profanity/safety, guaranteed-unique per-namespace.
- **Q17c — Alias/redirect model**: store handle history per UUID; resolve current; redirect stale handles. Where it lives (Payload `Sessions` doc + slug index).
- **Q17d — Tenant/org model**: what is a tenant/organization in our data model (ties to Accounts, Figma org)? Needed for the audience access axis.
- **Q17e — Directory UX**: what the public directory/map looks like (feeds Q15 staging + Q18 stitching).

## Q18 — Session stitching & topology

### ✅ DECISION (2026-07-12) — DROP edge-stitching, adopt PORTALS
Edge-based off-screen stitching is dropped (too complicated). Replaced with **portals + interlinked sessions**:
- **Portals** = explicit links between sessions. A portal appears as a **node on the canvas**; moving your cursor into / activating it moves you into the linked session.
- **Sessions can link/interlink** to each other directly (a graph of sessions via portal links, not spatial adjacency).
- **Sub-sessions / breakouts** — spawn a sub-session *within* a session; it surfaces as a portal on the canvas. Works conceptually like breakout rooms in traditional meeting software, but portal-navigated. (Sessions-within-sessions = a hierarchy; exact model TBD.)
- Cleaner + more feasible than edge traversal: a portal is just a canvas node whose activation triggers a **room handoff** (leave current LiveKit room → join linked room), reusing the Q16 arrival/departure choreography as the transition.

### Spawned
- **Q18a — Portal data model**: a canvas node (like media/embed nodes) carrying a target session ref (UUID/handle). Persistent-plane object; who sees it; is it shared/multiplayer (yes, per everything-multiplayer).
- **Q18b — Session hierarchy**: parent ↔ sub-session relationship model; can sub-sessions nest deeper; lifecycle of a sub-session vs parent (ephemeral rules from Q12).
- **Q18c — Traversal mechanics**: the room handoff (pre-connect to target, hand off publish state, choreograph arrival). Can you be in >1 session at once or always exactly one? (lean: one at a time.)
- **Q18d — Who can spawn portals/sub-sessions** and permissions on traversal (ties to session config Q17a, and everything-multiplayer Q9).

## Q19 — Expressive vocabulary

### ✅ DECISION (2026-07-12) — C, split by tier
- **Foundational expressions in the typed CORE** — the ones interactions/recording depend on (e.g. high-five, wave, presence pings). Recordable, replay-safe.
- **Long tail of emotes/reactions in the open `ext.*` tier** — freely addable/experimental playful expansion without touching core (per Q11a tiering).
- **Plane**: expressions are mostly **EPHEMERAL** (a wave happens and is gone → presence broadcast), but become **PERSISTENT events** when they're meaningful moments (a two-person high-five = a recorded `cursor.interact` interaction). Consistent with Q11b straddle rule.

## Q20 — Time as a navigable dimension

### ✅ DECISION (2026-07-12) — B, personal live rewind
During a live session, a participant can **privately scrub back through the timeline** (see earlier state) while the session continues live for everyone else — "check the replay without pausing the game." (A playback-only is the trivial subset, included. C shared-rewind/branching is aspirational north star, deferred — deep CQRS branching/consistency problem.)

- **Private/local** → no shared-consistency problem; your rewind view is yours; "return to now" re-syncs to live head.
- Needs **local access to event history** + a renderer that can paint an arbitrary historical projection independent of live (ties to Q8 IndexedDB client write-ahead / local projection).
- **Nuance — state vs media**: personal live-rewind cleanly rewinds the **event-sourced canvas/cursor STATE**; **live A/V media can't rewind** unless backed by the recording/ISO tracks. Full A/V time-travel = playback of the recording (A). So B = "rewind the event-sourced state view while live"; A/V rewind blurs into playback (recording layer). Flagged.

### Spawned
- **Q20a** — Does personal rewind include A/V (requires recording/ISO playback synced by timestamp) or state-only in v1? Lean state-only first.

---

## ✅ Round 2 complete (Q11–Q20). Deferred: Q10 (build order), Q14 (lifecycle), Q15 (staging). Many spawned sub-decisions (Q2a–d, Q3a–e, Q6a, Q8a–e, Q9a–b, Q11 done, Q12a–b, Q13a–d, Q17a–e, Q18a–d, Q20a) remain for future rounds.

---

## Q1 — Recording strategy

**Research finding**: games, TV broadcast, and cloud WebRTC all converge on the same pattern — capture multiple layers in PARALLEL, derive everything else from them. Not either/or.

The three layers (broadcast "program + ISO", games' "event stream", cloud's "composite + raw + events"):
- **L-A Composite / program feed** — the live canvas composited to one video (what we have today, via egress).
- **L-B ISO tracks** — each participant's raw audio/video recorded separately, in parallel (cheap: ~$0.001/min track egress).
- **L-C Event/layout log** — who was where, positions, menu/layout changes over time (our event source, spec 04).

What each layer unlocks:
- L-A alone = today. One fixed video.
- L-A + L-C = re-frame/scrub, chapter markers, follow-a-participant on playback (viewport is data).
- L-B + L-C = full re-edit and re-composite from any perspective, 4K, retroactive highlights (the Mario Kart / DaVinci-auto-project model).

**Reframed question**: commit to the layered capture pattern (A + B + C) as the TARGET architecture, and treat multi-POV / re-edit / retroactive capture as derived features — rather than picking one "strategy"? (Build ORDER is Q10.)

### ✅ DECISION (2026-07-12)
Committed to layered capture A + B + C as the target architecture. Multi-POV, re-edit, retroactive capture, 4K re-render are DERIVED from the layers, not separate strategies.

**Principle — architecture first, tools second.** We design the target architecture, THEN pick the library/platform per layer. Not bound to LiveKit; it's the current implementation of the media/egress plane and works well on the free tier, but it's swappable. Candidate tools to evaluate per layer (not yet decided):
- **L-A composite**: LiveKit Room Composite Egress (headless Chrome renders our app), OR Mux, OR self-hosted FFmpeg/GStreamer.
- **L-B ISO tracks**: LiveKit Track Egress, OR Mux, OR raw SFU track dump.
- **L-C event log**: our own (Payload + data channel) — platform-agnostic.
- **Post/enrich/deliver**: Mux (encode, adaptive HLS, thumbnails, transcripts, playback), FFmpeg (we already use it), Payload jobs.
- **Mux** flagged as a strong candidate worth deep evaluation — spans encode/mux/deliver/enrich. NOT a live compositor (compositing happens upstream). See Q6.

Tool selection deferred to Q4–Q7 (bucket, HLS/MP4, Mux, egress host).

## Q2 — Perspective & viewport

### ✅ DECISION (2026-07-12)
**Support all of it (hybrid), driven by config.** Per-participant perspective IS supported, but the system is headless + data-oriented: behavior comes from session config with per-participant overrides, not hardcoded.

Key points:
- **Auto-fit/auto-framing is a magical DEFAULT, not a law.** In the prototype it produced an emergent, unified, flowy, playful UX — like Figma with follow-focus always on. Keep it as the default camera behavior, but make it configurable/disable-able.
- **Focus is a FIRST-CLASS PRIMITIVE.** "See what another user sees" (Figma follow-focus) is core — tracked and designed around, not bolted on. Our magical default ≈ everyone soft-following a shared auto-fit focus.
- **Deeply configurable target.** Camera/viewport behavior settable at the SESSION level (applies to all) AND overridable PER-PARTICIPANT. Sessions become tweakable "rooms" with different configured experiences.
- Camera behavior modes (initial set): `auto-fit` (shared, default), `free` (personal pan/zoom), `follow(participant)` (adopt someone's focus). These compose with `renderAs()` from spec 09.

### Spawned sub-decisions (to resolve later)
- **Q2a — Focus primitive data model**: what exactly is "focus"? (viewport rect? a target participant? a canvas region?) Is it presence (L1, ephemeral) or event (L2)? Likely both — live focus is presence; focus *changes* worth replaying are events.
- **Q2b — Session config model**: where does session config live (LiveKit room metadata vs a Payload `sessions` doc vs both)? What's the schema of configurable properties? How do per-participant overrides merge with session defaults?
- **Q2c — Config surface**: what's the full set of configurable knobs for a "room" (camera behavior, proximity params, who-can-record, cursor style, physics on/off…)? This is a design axis of its own.
- **Q2d — Precedence**: when session forces a camera mode vs participant override — who wins? (e.g., host can lock focus for all; or participant can always break free.)

**Note**: propagate this into specs — add "focus" as a primitive to [09-recording-perspectives.md](09-recording-perspectives.md) (renderAs already anticipates it) and a new session-config concept likely deserves its own spec (10-session-config.md) later.

## Q3 — Consent/privacy

### ✅ DECISION (2026-07-12)
**B + C, explicitly reject D.** No session-wide approve/decline gate (D) — the anti-pattern where one objector blocks recording for everyone (e.g. a 1000-person call).

Model:
- **C — Session config** can restrict/control what recording is allowed in the room (ties to Q2 config model).
- **B — Per-participant, per-moment opt in/out at will.** A participant toggles their own visibility in recording on/off dynamically. Defaults come from user profile / personal config; session config can set room defaults.
- **Recorder is visibly indicated** (from the cursor — you can tell someone is recording). Ties to cursor system (spec 02) + presence.
- **Consent is TIME-SEGMENTED.** Example: TJ records; user2 opted out → invisible + actions excluded for minutes 0–5; user2 opts in at 5:00 → visible/recorded from then; opts out again at 7:00 → invisible again. The recording reflects all of this.

**Why this reinforces Q1**: time-segmented per-participant consent is nearly impossible to honor in a single pre-composited video, but NATURAL in the layered model — gate per-participant ISO track + event inclusion by a time-varying flag, render the composite from state. Q3 is strong evidence the A+B+C layered choice is right.

### Spawned sub-decisions
- **Q3a — Scope**: is "recordable" GLOBAL (invisible to all active recordings) or PER-RECORDING (invisible to TJ's but visible in Alex's)? Lean global ("hide myself from reporting" = everywhere). Confirm.
- **Q3b — Capture semantics of opt-out (privacy-critical)**: when opted out, do we NOT CAPTURE that participant's track/events for the window (true privacy — cannot be retroactively un-hidden), vs capture-but-filter (reversible)? Lean DO-NOT-CAPTURE = the privacy guarantee; means opt-out windows are permanently absent even from S3 re-render. Confirm.
- **Q3c — Precedence**: can a session force-include everyone, or does personal opt-out always win? (ties to Q2d.) Lean: personal privacy opt-out always wins.
- **Q3d — Visual of exclusion**: excluded participant is fully ABSENT from the recording (user said "invisible"), not a placeholder. Confirm audio is excluded too (mic out of mix during window).
- **Q3e — Consent transitions are EVENTS (L2)**: opt-in/opt-out toggles must be in the event log so any re-render/composite honors the exact windows. Live state is presence (L1).

**Note**: propagate to [09-recording-perspectives.md](09-recording-perspectives.md) (replace the vaguer consent section) and [04-event-sourcing.md](04-event-sourcing.md) (add `recording:consent` event type).

### ⭐ REFINEMENT (2026-07-12) — OPT-IN, not opt-out
Cleanest model: **default = you are NOT in any recording unless you opt IN to that specific recording.** Inverse of industry norm, but fits our system beautifully — recordings become invitational (participants opt in to join a recording), removing all the friction/problems of opt-out. So:
- Q3a scope leans PER-RECORDING after all (you opt into a specific recording), not global — reconsider with this framing.
- No one is captured by default; presence/events for a participant are only included in recording R once they opt into R, and stop when they opt out. Still time-segmented.
- Recorder cursor indicator + an invite/opt-in affordance become part of the cursor/UX design.

## Q4 — Storage bucket

### ✅ DECISION (2026-07-12) — DEFER
Too early to pick a persistence/storage architecture. Guidance for when we do:
- **Primary target: Payload CMS on Figma Cloud.** User works at Figma, directly with the Payload/Figma Cloud engineers — can file well-defined feature requests or roll additional tooling to provision/deploy what's needed.
- **Fallback: Railway** (user's preferred alt deploy/hosting platform) if Figma Cloud can't do what we need.
- Revisit once egress/Mux tooling (Q6/Q7) is chosen, since some tools bundle storage.

## Q5 — HLS vs MP4

### ✅ DECISION (2026-07-12)
**HLS segmented is the canonical artifact; MP4 generated on demand.** Rationale: crash-resilient (loses only the in-flight segment), supports long sessions (~12h vs MP4's ~3h managed cap), adaptive streaming for playback. Portable single-file MP4 rendered on demand (ffmpeg/Mux) when a user wants to download/share.

## Q6 — Mux

### ✅ DECISION (2026-07-12) — DEFER / EVALUATE
Keep Mux as a live candidate for the encode/deliver/enrich layer alongside LiveKit Egress + FFmpeg; don't commit yet (need a hands-on eval — user wants to understand Mux deeply first). Mux is downstream (not a compositor).

**Firm requirement regardless of tool — Adaptive Bitrate (ABR) streaming.** Sessions target up to 4K composite output, so the pipeline MUST render downscaled renditions (e.g. 2160p/1080p/720p/480p) to enable ABR playback end-to-end. Whoever we pick (Mux managed, or self-serve FFmpeg rendition ladder + HLS) must deliver ABR. Ties to Q5 (HLS canonical).

### Spawned
- **Q6a — rendition ladder**: exact resolutions/bitrates for the ABR ladder. Later.

## Q7 — Cloud vs self-hosted egress

### ✅ DECISION (2026-07-12) — DEFER, with a clear bias
**Guiding bias (applies to ALL tool choices, not just egress):** prefer **free / open-source**, self-hosted on **Railway**, over **paid managed tiers**. Free managed tiers are fine when they give us what we need. The more a path costs in managed fees, the less acceptable it is; the more we'll take on self-host complexity instead. Not scaling to true production volume — the goal is a **production-grade system**, not production scale. Concretely: prefer self-hosting LiveKit (server + egress) on Railway over graduating to LiveKit's paid managed tier.

### A — Managed egress (LiveKit Cloud / Mux / similar)
**Advantages**: zero infra/ops; no Redis/Chrome/GStreamer to run; autoscaling handled; fastest to stand up; reliable delivery + webhooks out of the box.
**Trade-offs**: per-minute cost beyond free allotment (LiveKit Build = 60 egress min, 2 concurrent; overage $0.02/video-min on Ship) — grows with N-perspective recording; 4K NOT a documented preset on LiveKit Cloud (advanced EncodingOptions, unverified); vendor lock-in; less control over encoder settings.
**When it wins for us**: only if the FREE tier covers our (non-scaled) usage.

### B — Self-hosted egress (OSS, on Railway)
**Advantages**: no per-minute cost; full control (encoder settings, true 4K, custom rendition ladder for ABR); open-source aligned; fits Railway comfort; can co-locate with self-hosted LiveKit server.
**Trade-offs**: real ops — separate service running headless Chrome (`--cap-add=SYS_ADMIN`) + GStreamer + shared Redis; ~4 CPU / 4 GB per job; **one room per instance** so must run replicas / autoscale on `livekit_egress_available`; we own reliability, upgrades, monitoring; 4K is CPU-heavy (6+ CPU/job).
**When it wins for us**: whenever managed would cost money, or when we need 4K / custom encoding the managed tier won't verify.

### Decision criteria to apply later
1. Does a FREE managed tier cover our usage? → if yes, A (cheapest total effort). If it would cost money → lean B.
2. Is verified 4K + custom ABR ladder required at record time? → favors B (or S3 offline re-render, which sidesteps live-4K entirely).
3. How many concurrent perspective recordings (Q1 L-B)? High N × per-minute managed cost → B.
4. Ops appetite at the time → Railway self-host is acceptable to us; that lowers B's barrier vs a typical team.

**Revisit** alongside Q6 (Mux eval) and once 4K feasibility is tested.

## Q8 — Event scribe

### ✅ DECISION (2026-07-12) — CQRS, log-as-authority (C, with B-style publishing)
The authority is **the durable, ordered, dedup'd event log itself** — not a single scribe client (rejects the fragile host-scribe). Shape:
- **CQRS**: split **commands** (intents, validated) from **events** (immutable facts). Write side = the event log; read side = projections.
- **Producers**: every participant PUBLISHES events (the "B" resilience), but **idempotently** (message IDs). The log layer handles **ordering + dedup + replay**, collapsing B's duplicate problem into a single authoritative ordered log (the "C" clean truth). No SPOF.
- **Payload = a read/archival PROJECTION** (CQRS read side), not the write authority. Queryable, durable, on Figma Cloud (our persistence commitment).
- **Consumers/projections**: live client UI, the recorder (renders from the log), Payload archive, analytics — all replay the same stream.

### Borrowed patterns / candidate tooling (philosophy to employ; NOT committed — tool-agnostic)
- **NATS / JetStream** — durable subjects, durable consumers, replay-from-sequence, `Nats-Msg-Id` dedup → strong fit for the write-side log / source of truth. OSS + Railway-friendly (fits cost bias).
- **CQRS** — command/event split; projections for each read model.
- **IndexedDB** — client-side write-ahead buffer: persist events locally before ack → durability across disconnect + fast local reads/replay.
- **Datastar.js** — server→client reactive signal/SSE push philosophy for read models/UI patching.

### Spawned sub-decisions
- **Q8a — Transport**: reuse LiveKit reliable data channel for the event stream, add NATS/JetStream as the durable log, or BOTH (LiveKit realtime fanout + JetStream durable/replay)? 
- **Q8b — Source-of-truth vs projection**: is the JetStream-style stream the truth with Payload as queryable projection, or is Payload itself the durable store and the stream just transport? (CQRS leans former; our Payload commitment complicates.)
- **Q8c — Command/event boundary**: what's a command (validated intent) vs an event (fact)? Where does validation/authority live (a server function)?
- **Q8d — Client write-ahead (IndexedDB)**: v1 or later resilience?
- **Q8e — Snapshots/checkpoints** for fast replay (also open in spec 04).

**Note**: this supersedes the host-scribe approach in [04-event-sourcing.md](04-event-sourcing.md); that spec needs a rewrite around CQRS + log-as-authority. Likely warrants a dedicated event-architecture spec (11-event-architecture.md) later.

## Q9 — Cursor menu permissions

### ✅ DECISION (2026-07-12)
**Strong bias to B (anyone can activate anything on anyone's menu).** Full co-op multiplayer is the point. **C (tiered/owner-only/suggestions) is an EXCEPTIONAL, rare escape hatch** — used only where genuinely unavoidable, ideally not at all. Do NOT reach for C as the default safety net.

**Design stance**: emergent/awkward states from B (e.g. someone triggers a destructive action on you) should be solved with **creative, playful mechanics** — not by regressing to permission gates. Examples of the creative-solution space (illustrative, not decided): destructive actions need a playful two-cursor confirm (both hands present), undo is instant + multiplayer-visible, actions are reversible-by-default, "grab"/tug-of-war interactions, cooldowns, visible attribution so griefing is social-not-silent. The bar for using C: no fun mechanic can make the emergent state acceptable.

### Spawned
- **Q9a — Destructive/irreversible actions** (leave session, remove feed): what creative B-compatible mechanic guards them? (This is where C pressure will first appear.)
- **Q9b — Undo/attribution model**: multiplayer undo + who-did-what visibility is core to making B safe-feeling.

## Q10 — Build order

_pending_
