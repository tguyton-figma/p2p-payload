# 08 — Recording & Muxing

> **Status note**: This spec revisits a previously-documented decision. In July 2026 we chose
> client-side canvas capture and explicitly rejected LiveKit Egress. That decision was correct
> for a free-tier prototype. Our new requirements — 4K, production-grade reliability, capturing
> the entire enriched canvas — invalidate the assumptions behind it. This document argues for
> server-side compositing and states honestly what that costs. The prior decision and its
> reasoning are preserved below so we're changing course deliberately, not silently.

## Reconciliation with DECISIONS.md (2026-07-12)

Decisions that refine this spec (authoritative in `DECISIONS.md`):
- **Q1 — Layered capture is the target**, not one strategy. Capture **three layers in parallel**: **(A) composite** (this spec's egress path), **(B) ISO tracks** (each participant's raw stream, cheap track egress, in parallel), **(C) event/layout log** (spec 04). Multi-POV, re-edit, retroactive "save last 30s," and 4K re-render are all *derived* from B + C (spec 09). This mirrors the broadcast "program + ISO" pattern and games' "record the event stream."
- **Q5 — HLS is canonical**, MP4 generated on demand.
- **Q6 — ABR is a firm requirement** (render a downscaled rendition ladder from the 4K master); Mux deferred/under-eval as the encode/deliver/enrich layer (not a compositor).
- **Q7 / Q4 — Tool + bucket deferred**, with a **cost/OSS bias**: prefer free / open-source self-hosted on Railway over paid managed tiers (would self-host LiveKit + egress on Railway before paying LiveKit managed). Goal = production-*grade*, not production-*scale*.
- **Q3 — Consent is OPT-IN and time-segmented** (supersedes any opt-out language here): a participant is in a recording only between their `consentGranted`/`consentRevoked` events (spec 04). Recorder shown on the cursor.

## The Problem

The current recorder (`useCanvasRecorder.ts`) works, but it is structurally fragile and fundamentally limited. From inspection of the actual code:

- **It re-implements the canvas by hand.** An off-screen Canvas 2D context redraws every tile each frame with hardcoded dimensions (`CAMERA_W=320`, `SCREEN_W=480`, `AUDIO_W=220`, `EMBED_W=640`) that must be kept in sync with `canvas.css` manually. Every new node type requires a new branch in the `draw()` loop, new size constants, and synchronized CSS. This is why it breaks every time we add a feature — **the recorder is a second, parallel renderer that must mirror the real one.**
- **It's locked to 720p at 2.5 Mbps.** The output canvas is fixed at 1280×720. 4K is not reachable without a proportional increase in the host's CPU/memory burden while that same host is also participating in the call.
- **It's all-or-nothing.** The entire recording accumulates in browser memory as chunks and produces one WebM blob at the end. A crash, tab close, or memory exhaustion at minute 44 loses all 44 minutes. This forces the ~45-minute cap.
- **It burdens one participant.** The host's browser composites, encodes, and mixes audio for everyone while also rendering the live experience. As we add cursors, physics, and effects, this burden grows exactly as the thing we're recording gets richer.

The core architectural flaw: **as the live experience gets more magical, the hand-mirrored recorder gets more fragile and more expensive.** These move in opposite directions. We need the recorder to get *simpler* as the experience gets richer.

## Requirements

1. **Capture everything on the canvas** — every media feed, every cursor, every menu, every effect — composited into one video, exactly as it appeared.
2. **Up to 4K** (3840×2160), reliably, as an aspiration to validate — not a hard guarantee day one.
3. **Production-grade durability** — a crash mid-session must not lose the whole recording. Recording must survive the full session length.
4. **Progressive** — write continuously to durable storage, not buffered-and-flushed-at-end.
5. **Automatic upload to Payload** — the finished video lands as a Payload document with metadata.
6. **Enrichment on arrival** — upload triggers a job queue: thumbnails, duration, transcript, waveform, adaptive-streaming renditions.
7. **Decoupled from the live experience** — recording load must not degrade the session for participants.

## The Key Insight: The Recorder Is Just Another Participant

LiveKit Room Composite Egress works by launching a **headless Chrome instance that loads a URL you control**, joins the room as a hidden recorder participant, renders whatever that page renders, and encodes it server-side. ([LiveKit custom templates](https://docs.livekit.io/home/egress/custom-template/))

This changes everything. Instead of maintaining a second hand-coded renderer, **the recorder runs our actual canvas app.** We build one thing — a "recorder view" of the session — and:

- Every feature we add (cursors, menus, physics, proximity effects) is recorded automatically, because the recorder renders the same components.
- The host's browser is freed entirely — compositing and encoding happen on LiveKit's infrastructure.
- Resolution is a server-side encoding parameter, not a client burden — 4K becomes a config value, not a rewrite.
- The recorder never falls out of sync with the live canvas, because it *is* the canvas.

This is the architectural payoff that justifies revisiting the egress decision. It also means **"the canvas must be renderable headlessly from a recorder token" becomes a first-class design constraint** for every feature going forward.

## Reframing the Original Egress Rejection

The two documented blockers, re-examined against current facts:

### Blocker 1: "Free-tier egress minutes are hard-capped"
**Resolved by the requirement change.** A production 4K recording system is not a free-tier product. ADR-0001 already anticipates graduating to a paid tier or self-hosting for prod scale. On LiveKit Cloud's Ship tier, egress is $0.02/video-minute with 100 concurrent; Scale is $0.015/min with 500 concurrent. Self-hosted egress has no per-minute cap at all. The cap was a prototype constraint, not a production one.

### Blocker 2: "Egress only writes to a bucket you own; Figma-managed Media has no raw S3 creds"
**True, and it turns out to be the right thing anyway.** Multi-gigabyte 4K session videos should *not* be forced through the Figma Content API presign and stored in the same Media collection as small images. Instead:

- Egress writes directly to a **dedicated recordings bucket we control** (S3, or Cloudflare R2 which has no egress fees — LiveKit supports any S3-compatible endpoint).
- The Payload `session-recordings` document stores **metadata and a storage reference** (bucket key or a Mux playback ID), not the raw file inside Figma-managed Media.
- Enrichment reads from that bucket.

So Blocker 2 isn't a blocker — it's a signpost pointing at the correct storage topology for large media. The "re-upload hop" the original decision wanted to avoid is replaced by "don't re-upload at all; reference the file where egress put it."

**What it genuinely costs** (stated honestly): a new dedicated storage bucket with real credentials, egress billing or a self-hosted egress service (headless Chrome + GStreamer + Redis, 4 CPU / 4 GB per instance, one room per instance), a publicly-reachable recorder-view deployment, and a webhook handler. This is real infrastructure. It is the price of production-grade recording, and there is no cheaper path to reliable 4K.

## Two Complementary Recording Paths

Recording splits into two paths that serve different needs. We should build Path A first and treat Path B as the quality ceiling enabled by event sourcing.

### Path A — Live Composite Egress (primary)

Real-time server-side compositing of the session as it happens.

```
Session running
   │
   ├─ LiveKit Room Composite Egress starts
   │     │
   │     ├─ Headless Chrome loads: https://<app>/record?token=…&url=…&layout=…
   │     │     └─ renders the recorder view (our canvas app, hidden participant)
   │     │
   │     └─ GStreamer encodes → HLS segments → dedicated S3/R2 bucket (progressive)
   │
   ├─ egress_ended webhook → POST /api/livekit/egress-webhook
   │     └─ enqueue Payload job: ingest + enrich
   │
   └─ Job: stitch segments → final MP4, register session-recordings doc, kick enrichment
```

- **Composites the live experience exactly as it happened**, including real-time media, cursor motion, and interactions.
- **Progressive/durable** via HLS segmented output — segments land in the bucket continuously; a crash loses only the in-flight segment. HLS also raises the duration ceiling to 12 hours (vs 3 hours for direct MP4 file output).
- **Zero host burden** — the host's browser does nothing recording-related.

> **Perspective**: whose experience does a recording capture? Because this canvas is spatial
> (per-participant audio mix + proximity visuals), that's a real architectural decision, not a
> cosmetic one — and it's why any-participant, multi-POV recording is worth building. It's spec'd
> separately in [09-recording-perspectives.md](09-recording-perspectives.md). The recorder view's
> "who am I rendering as" input is the `renderAs(participant)` primitive defined there.

### Path B — Offline Replay Re-render (quality ceiling, later)

Because the session is **event-sourced** (see [04-event-sourcing.md](04-event-sourcing.md)), we can reconstruct it after the fact. Combine the immutable event log with per-participant raw track recordings (cheap Track Egress) and replay the whole session in a headless browser **decoupled from real time** — no 60fps deadline, so we can render at 4K, high bitrate, even slower-than-realtime if needed, then encode a pristine master.

- **Deterministic** — same events + same tracks → same render, every time.
- **Highest possible quality** — not bound by live encoding throughput.
- **Re-renderable** — improve the canvas, re-render old sessions with the new look.
- **Depends entirely on event-source completeness** — this is why recording "informs the rest of the architecture": it raises the bar on the event log to *everything visually meaningful must be reconstructable.*

Path B is a strong future capability, not a v1 requirement. But designing the event source and the recorder view with Path B in mind now costs little and preserves the option.

## The Recorder View Contract

A dedicated route — e.g. `/session/[room]/record` — renders the canvas in "recorder mode." This is the single most important new artifact.

**Requirements** ([LiveKit template SDK](https://docs.livekit.io/home/egress/custom-template/)):
- **Publicly reachable** by LiveKit's headless Chrome (host it on a static/edge deployment).
- Reads `url`, `token`, `layout` query params; connects to the room using the recorder token via `@livekit/egress-sdk` `EgressHelper`.
- Joins **hidden** (recorder participant, publishes nothing).
- Renders the full canvas: all media nodes, cursors, menus, effects — identical to the live view, minus local-only UI chrome (the host's own control dock, prejoin, etc.).
- Emits `START_RECORDING` to the console when the first frame is painted and `END_RECORDING` when the room ends. `EgressHelper.setRoom(room)` auto-ends on disconnect.

**Design constraints this imposes on every feature:**
- The canvas must render correctly from presence + event data alone, without local interaction state (the recorder never clicks anything).
- Cursors must render for all participants from broadcast presence (the recorder is a passive observer — it has no local cursor).
- Any effect driven by local-only state (hover, local audio context) must degrade gracefully or derive from shared state.
- No feature may depend on being "the host's browser" to appear on the canvas.

This constraint is healthy: it forces a clean separation between shared canvas state and local UI, which benefits the whole architecture.

## Storage Topology

```
Dedicated recordings bucket (S3 or Cloudflare R2)
   │  ← egress writes HLS segments + final artifacts here (we own creds)
   │
   ├─ Payload session-recordings doc  ← stores bucket key / Mux playbackId + metadata
   │
   └─ Enrichment job reads from here (thumbnails, transcript, renditions)
```

- **Recordings do NOT go into the Figma-managed Media collection.** They live in our bucket; Payload holds the reference. This decouples large-media storage from the CMS asset pipeline and sidesteps the presign size/creds limitation entirely.
- **Cloudflare R2 is worth considering** over S3 for the recordings bucket — no egress bandwidth fees, S3-compatible API (works with LiveKit egress via `force_path_style` + custom endpoint), cheap storage. Relevant when serving many recordings for playback.

## Enrichment & Job Queue

Payload 3.x has a first-class **Jobs Queue** (tasks, workflows, jobs, queues), and this codebase **already uses it** — the `enrichMedia` `afterChange` hook enqueues an `enrich-media` job that runs FFmpeg on Figma Cloud serverless to extract thumbnails, waveforms, OKLCH color, duration, and dimensions. We extend this proven pattern rather than inventing anything.

### Serverless constraint (important)
`autoRun` is forbidden on serverless — Lambda has no long-running worker. Jobs execute via the `GET /api/payload-jobs/run` endpoint, invoked by an **external scheduler** (EventBridge/CloudWatch cron on Figma Cloud's Lambda), secured with a bearer secret checked in `jobs.access.run`. Per-invocation work must stay within the Lambda timeout — so heavy transcode work should be **offloaded**, not run inline in a Lambda job (see Mux below).

### Enrichment flow
```
egress_ended webhook
   │
   └─ enqueue job: recording-ingest
         ├─ stitch HLS segments → final MP4 (ffmpeg concat) [or keep HLS for streaming]
         ├─ create/update session-recordings doc (status: processing → ready)
         └─ enqueue: recording-enrich
               ├─ thumbnail (poster frame)
               ├─ duration / dimensions (probe)
               ├─ transcript (the descoped slot in SessionRecordings — now fillable)
               └─ [optional] hand off to Mux for adaptive renditions
```

## Playback & Delivery — Where Mux Fits (Optional)

**Mux is not a compositor.** It cannot combine our multiple feeds/canvas into one video — that compositing is exactly what egress does upstream. Mux is a **downstream delivery + enrichment layer** and a good optional one:

- Feed Mux the composited MP4 (Create Asset **from the S3/R2 URL** — a fast API call, Lambda-friendly).
- Mux returns adaptive HLS/DASH renditions (up to 4K), on-demand thumbnails via URL params, auto-generated transcripts/captions (20+ languages), and signed playback for access control.
- `video.asset.ready` webhook → write `playbackId` + thumbnails + duration back onto the `session-recordings` doc.
- This keeps all heavy transcode off Lambda — the job just fires an API call.

**Decision**: Mux is optional. If we output HLS from egress directly, we already have adaptive streaming and can serve from R2 with our own player, doing transcript/thumbnail enrichment via the existing FFmpeg jobs. Mux buys managed convenience (per-title encoding, captions, analytics) at a per-minute cost. Start without it; add it if playback quality/scale or transcript quality demands it.

## Fitting the Layered Data Architecture

Recording spans every layer of [01-data-architecture.md](01-data-architecture.md), consuming them rather than adding a new one:

- **L0 Media** — the recorder participant subscribes to the same tracks.
- **L1 Presence** — the recorder renders cursors/menus from the same presence broadcasts.
- **L2 Events** — the event log drives Path B replay and provides the recording's chapter/timeline metadata.
- **L3 Assets** — the recorder loads the same sprites/config.

The finished recording is itself an **L3 asset** (referenced in Payload), and the act of recording start/stop generates **L2 events** (`recording:start`, `recording:save`).

## Migration Path from the Current Recorder

1. **Keep the current client recorder working** as the fallback while building egress — do not remove it until Path A is verified end-to-end on prod.
2. Build the **recorder view** route (biggest new artifact; also the thing that future-proofs all feature work).
3. Stand up the **dedicated recordings bucket** + egress (Cloud egress first — zero infra — to validate; self-host later if volume/cost warrants).
4. Add the **egress webhook** + `recording-ingest`/`recording-enrich` jobs, reusing the `enrichMedia` pattern.
5. Point `session-recordings` at the bucket reference; fill the transcript slot via enrichment.
6. Validate at 1080p, then push toward 4K via advanced `EncodingOptions` (no built-in 4K preset exists — this must be load-tested).
7. Retire the client recorder once Path A is proven.

## Hard Facts to Design Around

- **No built-in 4K egress preset.** Presets top out at 1080p; 4K requires explicit `EncodingOptions` (width/height/bitrate/fps) and is not documented/guaranteed by LiveKit at that resolution. **Validate before promising 4K.**
- **MP4 file output capped at 3 hours; HLS segmented output at 12 hours.** Prefer HLS for durability *and* length.
- **Egress webhooks are not guaranteed delivery** — retried, must be idempotent; back up with periodic `ListEgress` reconciliation.
- **Self-hosted egress** = separate service, Redis, headless Chrome (`--cap-add=SYS_ADMIN`), GStreamer, 4 CPU / 4 GB, one room per instance, autoscale on `livekit_egress_available`.
- **Recorder view must be public** and emit the `START_RECORDING`/`END_RECORDING` console signals or nothing records.

## Open Questions

1. **Cloud egress vs self-hosted for prod?** Cloud = zero infra, per-minute cost, resolution ceiling unverified. Self-host = full control, no per-minute cost, real ops burden (Chrome+GStreamer+Redis, autoscaling). Start Cloud, revisit at volume?

2. **Dedicated bucket: S3 or R2?** R2's zero egress fees matter if recordings are frequently played back. Any reason to stay on AWS S3 specifically?

3. **HLS vs MP4 as the canonical artifact?** HLS is durable + adaptive + long-session-capable but is many files; MP4 is one portable file but capped at 3h and finalized-at-end. Keep HLS as source of truth and generate MP4 on demand?

4. **Do we adopt Mux, or serve HLS ourselves?** Managed convenience + captions vs cost + another vendor.

5. **When do we invest in Path B (replay re-render)?** It's the quality ceiling but depends on event-source completeness. Is it worth the event-log rigor now, or a later chapter?

6. **Recorder-view auth** — the recorder token is room-scoped and hidden; do we need any additional gating on the `/record` route to prevent it being loaded by anyone with a token, or is room-scoping sufficient?

7. **Cost model** — at what session volume does egress billing (or self-host ops) become material? Need a rough per-hour-recorded cost projection to inform the Cloud-vs-self-host call.
