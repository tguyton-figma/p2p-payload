# 01 — Data Architecture

> **Reconciled with DECISIONS.md (2026-07-12):** The L1/L2 split here is now formalized as the
> **two mandatory planes** — **EPHEMERAL** (L1 presence, broadcast-only, never logged) and
> **PERSISTENT** (L2 events, the CQRS log). Every action/state MUST be flagged as one (Q11b).
> The event log is **CQRS, log-as-authority** — all participants publish idempotently; Payload is
> a read/archival **projection**, not the write authority (Q8). Candidate tooling (tool-agnostic,
> OSS/Railway-biased): NATS/JetStream (durable log), IndexedDB (client write-ahead), Datastar /
> Supabase-Realtime (ephemeral broadcast). See spec 04 for the full model.

## The Problem

Our canvas has data moving at wildly different speeds and with different persistence needs. Cursor positions update 60 times per second and should never touch a database. A menu selection is a meaningful event that should be stored forever. A sprite sheet is a static asset loaded once per session. Treating all of this the same way — either by persisting everything (slow) or persisting nothing (no replay) — doesn't work.

## The Layered Stack

We organize all data into four layers based on **velocity** (how fast it changes) and **persistence** (whether it survives the session).

```
┌──────────────────────────────────────────────────────┐
│  Layer 0: Media Streams                              │
│  Audio/video tracks via LiveKit WebRTC               │
│  Velocity: continuous │ Persistence: none            │
│  Owner: LiveKit SFU                                  │
├──────────────────────────────────────────────────────┤
│  Layer 1: Ephemeral Presence                         │
│  Cursor position, gesture, menu state, typing...     │
│  Velocity: 10-60 Hz │ Persistence: none              │
│  Owner: LiveKit data channel (unreliable)            │
├──────────────────────────────────────────────────────┤
│  Layer 2: Session Events (Event Source)              │
│  State transitions: menu opened, selection made...   │
│  Velocity: 0.1-5 Hz │ Persistence: immutable log    │
│  Owner: LiveKit data channel (reliable) → Payload    │
├──────────────────────────────────────────────────────┤
│  Layer 3: Assets & Configuration                     │
│  Sprites, models, user prefs, session config...      │
│  Velocity: static │ Persistence: Payload CMS         │
│  Owner: Payload collections + media library          │
└──────────────────────────────────────────────────────┘
```

## Layer 0: Media Streams

**What**: Raw audio and video tracks — camera feeds, microphone audio, screen shares.

**Transport**: LiveKit WebRTC (SFU-routed). We never touch these directly for state purposes. LiveKit handles encoding, routing, simulcast, and bandwidth adaptation.

**Persistence**: None during session. Recording is a separate concern that *consumes* all layers rather than adding one — a server-side recorder participant renders our own canvas app and composites it. See [08-recording-muxing.md](08-recording-muxing.md). (The current client-side Canvas 2D + MediaRecorder recorder is being replaced by this.)

**What we already have**: This layer is fully implemented. `useTracks()`, `<RoomAudioRenderer />`, track publishing, multi-feed support.

## Layer 1: Ephemeral Presence

**What**: High-frequency state that describes "what is happening right now" but has no long-term value. This is the hot path — it must be fast, cheap, and lossy-tolerant.

**Examples**:
- Cursor position `{ x, y }` — 20-60 Hz per participant
- Cursor gesture state `'point' | 'grab' | 'open' | 'fist'`
- Cursor rotation angle
- Whether a participant is currently dragging something
- Typing indicator
- Hover state (what is the cursor currently over?)
- Menu visibility state (is a radial menu currently open?)

**Transport**: LiveKit data channel with `kind: 'lossy'` (UDP-like). Messages are small (~50-100 bytes), high frequency, and stale data is worse than missing data. If a cursor position update is dropped, the next one arrives in 16-50ms anyway.

**Message format** (single topic, discriminated union):
```typescript
type PresenceMessage =
  | { t: 'c'; x: number; y: number; g: GestureState; r: number }  // cursor
  | { t: 'd'; id: string; x: number; y: number }                   // dragging
  | { t: 'h'; id: string | null }                                  // hover target
  | { t: 'm'; open: boolean; items?: string[] }                    // menu state
```

**Not persisted. Not event-sourced. Not replayed.** This data exists only in the moment.

**What we already have**: The `canvas-layout` data channel topic handles tile position sync. We extend this pattern with a new `presence` topic for cursor/gesture/menu state.

## Layer 2: Session Events (Event Source)

**What**: Discrete, meaningful state transitions that together tell the story of what happened in a session. This is the **immutable event log** — append-only, never modified, always replayable.

**Examples**:
- `cursor:menu:open` — TJ opened a radial menu at position (400, 300)
- `cursor:menu:select` — Alex selected "screen share" from TJ's menu
- `tile:move` — TJ moved their camera feed to position (200, 150)
- `tile:add` — A new screen share appeared on the canvas
- `session:join` — Participant joined with identity and name
- `session:leave` — Participant disconnected
- `recording:start` — Host started recording
- `embed:add` — A Figma embed was placed on the canvas

**Event shape**:
```typescript
interface SessionEvent {
  id: string            // UUID
  seq: number           // monotonic sequence number within session
  ts: number            // server-assigned timestamp (ms since epoch)
  actor: string         // participant identity
  type: string          // dot-namespaced event type
  position?: { x: number; y: number }  // canvas position where it happened
  payload: Record<string, unknown>     // event-specific data
}
```

**Transport**: LiveKit data channel with `kind: 'reliable'` (TCP-like) for real-time broadcast to all participants. Simultaneously written to a Payload collection by the session host (or a designated "scribe" participant).

**Persistence**: Payload CMS `session-events` collection. Each event is a document. Indexed by session ID + sequence number for efficient replay.

**Replay**: Given a session ID, query all events ordered by `seq`, apply them sequentially to reconstruct canvas state at any point in time. Cursor positions are NOT in this log (too much data, too little value) — but cursor *actions* are (menu opened, selection made, gesture triggered).

**What we already have**: Room metadata updates (open/closed, recording state) are proto-events. We formalize this into a proper event sourcing system.

## Layer 3: Assets & Configuration

**What**: Static or slowly-changing data that supports the experience — loaded at session start or on demand, cached aggressively.

**Examples**:
- Cursor sprite sheets / Rive files for hand gestures
- Participant avatars (already loaded from Figma)
- Session configuration (spatial audio parameters, physics settings)
- Asset manifests (what sprites are available, what gestures exist)
- User preferences (preferred hand style, accessibility settings)

**Persistence**: Payload CMS collections and media library. Served via Next.js API routes or direct S3 URLs.

**Caching**: Aggressive. Sprite sheets are immutable once published — cache forever with content-hash URLs. Session config changes rarely — cache per session. Avatars already use CSS-based caching (mount once, reveal on demand).

**What we already have**: Payload Media collection for recordings, avatar loading pipeline, session configuration via room metadata.

## Data Flow Diagram

```
                   ┌─────────────┐
                   │   Payload   │
                   │    CMS      │
                   └──────┬──────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
         L3: Assets   L2: Events   Recordings
         (sprites,    (session      (S3 blobs)
          config)      log)
              │           ▲
              │           │ persist
              ▼           │
┌─────────────────────────────────────┐
│          Client (Browser)           │
│                                     │
│  ┌─────────┐    ┌────────────────┐  │
│  │ Asset    │    │ Event Buffer   │  │
│  │ Cache    │    │ (write-ahead)  │  │
│  └─────────┘    └───────┬────────┘  │
│                         │ flush     │
│  ┌──────────────────────┴────────┐  │
│  │     LiveKit Data Channel      │  │
│  │  reliable (events) + lossy    │  │
│  │        (presence)             │  │
│  └──────────────┬────────────────┘  │
│                 │                   │
│  ┌──────────────┴────────────────┐  │
│  │     LiveKit Room (WebRTC)     │  │
│  │  L0: audio/video tracks       │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Open Questions

1. **Event scribe**: Who writes events to Payload — the host only, or every participant? Host-only is simpler but creates a single point of failure. Every participant writing creates duplicates that need dedup.

2. **Event batching**: Should events be written to Payload individually or in batches? Individual writes are simpler but create many small documents. Batching reduces write load but adds complexity and latency.

3. **Sequence numbering**: How do we assign monotonic sequence numbers in a distributed system? Options: host assigns (simple, single authority), vector clocks (complex, no single authority), or server-assigned on persist (eventual, not real-time).

4. **Presence topic separation**: Should cursor presence use the same data channel topic as layout sync, or a separate one? Separate is cleaner but adds a second message stream to manage.

5. **Event granularity**: Where exactly is the line between "ephemeral presence" and "session event"? Is a drag-start an event? A drag-end? Only if the tile actually moved?
