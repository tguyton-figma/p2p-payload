# 09 — Recording Perspectives (Multi-POV Capture)

> Companion to [08-recording-muxing.md](08-recording-muxing.md). Spec 08 establishes *how* we
> record (server-side composite egress rendering our own canvas). This spec decides *whose
> experience* a recording captures and *who* may capture it.

## The Question

Two paths:

- **Path 1 — Host perspective (today).** One recording per session, initiated by the host, capturing a single shared/neutral view. Classic WebRTC.
- **Path 2 — Any participant, any perspective (the vision).** Any participant can start/stop a recording at any moment, capturing *their* perspective of the scene. Like a modern game where, once your race ends, you float between players' viewpoints. Richer, multi-perspective captures of one session.

## Reframing: The Host-Binding Is Already Gone

Two facts collapse the "is Path 2 even possible" question:

1. **SFU, not mesh.** LiveKit routes all media through the server; no participant is topologically privileged. The old mesh made the host special — that's retired (see [[webrtc-status]]).
2. **Egress records server-side.** Under spec 08, recording is a headless recorder participant rendering a URL — not the host's browser compositing. Nothing about the recording is bound to the host anymore.

So the current host-gating (`meta.host` check in the recording routes) is a **permission choice and a leftover from client capture**, not a technical wall. Path 2 is architecturally available the moment we adopt egress. The real work is deciding the model and building the perspective primitive.

## Why Perspective Is Meaningful Here

In a normal grid call, every participant sees the same tiles at the same volume — "perspective" is cosmetic. In this canvas it is substantive, because the experience is spatial:

| Dimension | Varies per participant? | Source |
|-----------|------------------------|--------|
| Spatial audio mix | **Yes** — you hear who's near *you* | PannerNode listener = your position ([05](05-spatial-proximity.md)) |
| Visual proximity (blur/opacity/scale) | **Yes** — distant feeds fade *for you* | CSS distance from your position |
| Viewport (pan/zoom/framing) | **Potentially** | Your React Flow viewport |
| Cursors / menus / interactions | No — shared | Broadcast presence ([02](02-cursor-system.md)) |
| Media content itself | No — same tracks | LiveKit |

Two of the most defining dimensions of the experience — the audio mix and the proximity visuals — are **per-participant**. That is exactly why capturing multiple perspectives produces materially different, valuable recordings rather than N copies of the same video.

## The Unifying Primitive: `renderAs(participant)`

Everything below reduces to one capability: **the canvas can render itself from any participant's point of view.** Given a participant X, the app can compute "the scene as X experiences it" — X's listener position for spatial audio, X's distance-based visual effects, X's viewport. Cursors and media are shared, so only the perspective-dependent layers re-parameterize.

**Focus is a first-class primitive (Q2).** The prototype's magical UX ≈ everyone soft-following a shared **auto-fit** focus (Figma follow-focus, but on by default). Camera/viewport behavior is config-driven per session + per-participant override, with modes `auto-fit` (shared default) / `free` / `follow(participant)`. `renderAs(X)` and `follow(X)` are the same primitive seen from recording vs live.

Build this parameter once and it powers three distinct features:

1. **Live spectating** — locally adopt X's perspective during the session (the "float around" feeling).
2. **Live per-perspective recording** — point an egress recorder view at `renderAs(X)` and capture X's POV to a file.
3. **Offline re-render** — reconstruct *any* perspective after the fact from the event log + raw tracks, including perspectives nobody chose live.

The recorder view from spec 08 already needs a "who am I rendering as" input. `renderAs(participant)` *is* that input. This is the clean seam.

## Three Capture Strategies

### Strategy 1 — Host/Neutral Composite (today, spec 08 default)
One egress, one perspective (neutral observer or host), one video.
- **Pro**: simplest; one job per session; lowest cost.
- **Con**: throws away the per-perspective richness that defines the product.

### Strategy 2 — Multi-Perspective Live Egress
Any participant starts an egress pointed at `renderAs(themselves)`. N participants recording = N concurrent composite egress jobs = N videos.
- **Pro**: concrete per-POV videos; direct extension of spec 08; each participant "owns" their clip.
- **Con**: **linear cost/concurrency multiplier** (N × egress minutes; capped at 100 concurrent on Ship, 500 on Scale, or N self-hosted instances). Egress **cold-start latency** (headless Chrome spin-up is seconds) means "record this moment *now*" misses the first few seconds.

### Strategy 3 — Perspective-Agnostic Capture + Offline Re-render (the Mario Kart model)
Continuously capture the cheap raw ingredients — per-participant **track egress** (raw audio/video, ~$0.001/min) + the complete **event source** ([04](04-event-sourcing.md)) — for the whole session. Then re-render *any* perspective offline, on demand, decoupled from real time.
- **Pro**: this is literally the game-replay model the vision describes — float to *any* viewpoint after the fact, even one no one recorded live; **cost is decoupled from the number of perspectives**; no cold-start (you can "save the last 30 seconds from my POV" retroactively because the ingredients were always being captured); re-render at 4K with no realtime deadline; re-render old sessions with a newer canvas look.
- **Con**: depends on **event-source completeness** (everything visually meaningful must be reconstructable) and a **re-render pipeline** (this is spec 08's Path B). Highest capability, highest rigor.

### Comparison

| | S1 Host | S2 Live multi-POV | S3 Offline re-render |
|---|---|---|---|
| Perspectives captured | 1 (neutral) | N chosen live | Any, unlimited, after the fact |
| Cost model | 1× egress | N× composite egress | N× cheap track egress + compute at render time |
| Cold-start on "record now" | n/a | Seconds (misses intro) | None (retroactive) |
| Playback perspective switching | No | Only among recorded POVs | Yes — arbitrary |
| Depends on | egress | egress + `renderAs` | event source + track egress + re-render pipeline |
| Complexity | Low | Medium | High |
| Matches the vision | Weakly | Partially | **Fully** |

## Live Spectating (Cheapest, Highest Delight, Possibly First)

The "float between players" part of your analogy doesn't require recording at all — it's a **real-time client feature**. To spectate X, the local client re-parameterizes to `renderAs(X)`:
- adopt X's viewport (needs X's viewport in presence)
- move the spatial-audio listener to X's position (may require re-subscribing to mics near X instead of near you)
- recompute proximity visual effects relative to X

This is almost entirely client-side and cheap. It's arguably the most delightful, lowest-cost expression of the whole idea — and it de-risks `renderAs()` before we spend egress money on it. Strong candidate to ship *before* multi-perspective recording.

## Data Model Changes

Path 2 breaks assumptions baked into the current code:

- **`session-recordings`** today implies one-per-session, host-owned. It must become **many-per-room**, each with:
  - `owner` (the participant who initiated it) — not `host`
  - `perspective` (whose POV it captures — may differ from owner if we allow "record Alex's view")
  - independent `startedAt` / `endedAt` (clips overlap and offset freely)
  - a link back to the session/room so the event source can align multiple clips on one timeline
- **Recording state** currently lives as a single `recording` boolean in room metadata. That can't represent N concurrent recordings. It moves to **per-participant presence/events**: each active recording is broadcast so everyone sees *who* is recording (see privacy below), and start/stop become L2 events (`recording:start` / `recording:stop`) tagged with owner + perspective.
- **Finalize / permission routes** drop the `meta.host` gate; any authenticated participant may own a recording (subject to session policy).

## Permissions, Privacy, Consent

"Anyone can record" raises real questions the host model sidestepped:

- **Visibility**: everyone must see who is currently recording and from what perspective (the current single badge becomes a per-recorder indicator). This is presence data.
- **Consent** → **DECIDED (Q3): OPT-IN, time-segmented.** You are NOT in any recording unless you opt IN to that specific recording (invitational; inverse of the industry norm; zero friction — one objector can't block the room). Inclusion lasts only between your `core.recording.consentGranted` and `consentRevoked` events (spec 04). Session config (Q17) can restrict what recording is allowed. Explicit per-session approve/decline prompts are **rejected**.
- **Ownership & access**: a perspective clip belongs to its owner. Who can view/share it later — just the owner, all participants, the host? Payload access control on `session-recordings`.
- **Abuse guardrails**: a cap on concurrent recordings per room (cost + privacy), and rate limits on start/stop.

## Feasibility Concerns (Stated Honestly)

1. **Cost & concurrency multiplier (S2).** N simultaneous composite egresses is N× cost and hits concurrency caps. Needs explicit limits (e.g., max K concurrent perspective recordings per room) and a cost projection. S3 sidesteps this by capturing cheap tracks once and paying compute only at render time.
2. **Egress cold-start (S2).** Composite egress takes seconds to launch. Spontaneous "capture that moment!" will clip the start. Mitigations: pre-warm a recorder, or prefer S3 for retroactive capture.
3. **Audio-perspective fidelity.** Does the recorded mix match what X actually heard? Only if the recorder view reproduces X's PannerNode state at X's position *over time*. Since the recorder is the app and follows X's position via presence/events, this is feasible — but must be validated, and X's mic-subscription set may need to follow X's proximity, not the recorder's.
4. **Viewport ambiguity.** Pan/zoom is currently disabled and the canvas auto-fits everyone. Is viewport part of "perspective," or do all perspectives share the auto-fit frame and differ only in audio + proximity visuals? A product decision that simplifies or complicates `renderAs()`.
5. **Event-source completeness (S3).** The re-render is only as faithful as the log. This raises the bar on [04](04-event-sourcing.md) — a cost worth taking on deliberately, not by accident.

## Recommendation

Pursue a **layered path that treats S3 as the north star while banking cheap wins first**:

1. **Decouple recording from host now.** Under egress this is nearly free and removes a legacy constraint. Recording state → presence/events; `session-recordings` → owner + many-per-room.
2. **Build `renderAs(participant)`** as the perspective primitive. Prove it with **live spectating** (client-only, cheap, delightful) before spending egress money.
3. **Add Strategy 2 (live per-perspective egress)** on top of `renderAs()`, with hard concurrency/cost guardrails, for concrete per-POV clips.
4. **Invest in Strategy 3 (offline re-render)** as the event source matures — this is the full realization of the Mario Kart vision and the reason to keep the event log complete and the canvas headlessly re-renderable.

This ordering means each step is independently valuable, cost grows only as the feature proves itself, and we never build a throwaway: `renderAs()` serves spectating, live recording, and offline re-render alike.

## Open Questions

1. **Is viewport part of perspective?** Shared auto-fit frame (simpler) vs per-participant pan/zoom (richer, requires enabling zoom and syncing viewports).
2. **Consent model?** Session policy, per-participant opt-out, or explicit prompts — what fits the product's social contract?
3. **Concurrency cap per room** for live multi-POV recording — what's the number, and does it scale with tier?
4. **Do we ever need S2 at all**, or does live spectating + S3 offline re-render cover every real use case, letting us skip the N× live-egress cost entirely?
5. **Retroactive capture** ("save the last 30s of my POV") — this strongly favors S3; is it a priority use case? If so, it may leapfrog S2 entirely.
6. **Who owns a perspective clip and who can see it** — owner-only, all participants, or host-controlled?
7. **Alignment on playback** — when multiple offset/overlapping clips exist for one session, how does the player present them? Timeline with per-perspective tracks? Picture-in-picture? Switchable single view?
