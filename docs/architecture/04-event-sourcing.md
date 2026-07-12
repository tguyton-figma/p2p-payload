# 04 — Event Architecture (CQRS + Event Sourcing)

> **Reconciled with DECISIONS.md (2026-07-12).** This supersedes the earlier host-scribe draft.
> Authoritative decisions live in `DECISIONS.md` (Q8, Q11, Q16, Q19, Q20).

## The Goal

Every meaningful thing that happens in a session is captured as an immutable event. The log is the session's ground truth — replay it to reconstruct state at any moment, drive recordings, power multi-perspective re-render, and build a per-user "memory."

Not surveillance — a record of collaborative intent (who did what, where, when).

## Two Explicit Planes (Q11b)

Every piece of state MUST be flagged as one of two planes. Never mixed, never ambiguous.

- **PERSISTENT** — canvas/node state: what's on the canvas, positions, node state. Changes irregularly. → goes through the **event log** (durable, replayable, projected to Payload). "Write it down forever."
- **EPHEMERAL** — presence: cursor position, gesture-in-motion, hover, live audio levels. High-frequency, only-matters-now. → **real-time broadcast only**, never logged. Lossy-tolerant.
- **Straddle rule**: one interaction can span both — a drag is *ephemeral while happening* (streamed), *persistent on commit* (final `feed.moved` logged).

Models to borrow: **Datastar** (client action → server, SSE server→client push) and **Supabase Realtime** (ephemeral broadcast/presence) for the ephemeral plane; the CQRS log + Payload projection for the persistent plane.

## CQRS: Commands vs Events (Q8, Q11)

- **Command** — an imperative *intent* that may be validated/rejected (`OpenMenu`, `MoveFeed`). Write-side request.
- **Event** — an immutable *fact* that happened (`cursor.menu.opened`). Past tense.

**The durable, ordered, dedup'd log is the authority** — not any single "scribe" client. Every participant *publishes* events idempotently (message IDs); the log layer handles ordering + dedup + replay, collapsing duplicates into one authoritative ordered stream. No single point of failure.

**Payload is a read/archival PROJECTION** (CQRS read side), not the write authority.

Candidate tooling (patterns to employ; not committed — tool-agnostic, OSS/Railway-biased):
- **NATS / JetStream** — durable subjects, durable consumers, replay-from-sequence, `Nats-Msg-Id` dedup → the write-side log.
- **IndexedDB** — client-side write-ahead buffer (durability across disconnect + local reads/replay; enables personal live rewind, Q20).
- **Datastar** — server→client reactive push for read models.

## Event Shape — Semantic Triple (Q11)

Every event is **actor · verb · object · context** (Activity-Streams shape, honored as a convention — NOT literal JSON-LD):

```typescript
interface SessionEvent {
  id: string            // UUID v7 (time-sortable)
  v: number             // schema version (additive-only, Q11d)
  type: string          // dot-namespaced past-tense verb, tier-prefixed
  actor: string         // identity (Account id or anon-*)
  verb: string          // opened | moved | arrived | ...
  object: { kind: string; id?: string; [k: string]: unknown }
  context: {
    session: string     // session UUID
    seq: number         // ordering within session
    ts: number          // ms since epoch
    x?: number; y?: number          // canvas position (most events are spatial)
    causationId?: string            // the command/event that caused this
    correlationId?: string          // groups related events
  }
}
```

**Typing (Q11c)**: TypeScript discriminated unions for the typed **core**; **Zod** validates the open `ext.*` tier and anything off the wire.

## Tiered Vocabulary (Q11a) — keep it SMALL (Q11d principle)

- **`core.*`** — closed, typed, versioned. The replay/recording/state-critical verbs. Additive-only. **Deliberately small and coherent — the finite event set shapes the product.**
- **`ext.*`** — open, registrable, best-effort. Experimental/expressive actions that don't touch core state (playful emotes, one-off effects).

### Core taxonomy (initial — dot-namespaced, past tense)

**Session & lifecycle**
| Verb | object / notable context | Plane |
|------|--------------------------|-------|
| `core.session.started` | `{ config }` | persistent |
| `core.session.configured` | `{ key, value, previous }` (Q17 axes) | persistent |
| `core.participant.arrived` | `{ style }` — entrance choreography (Q16) | persistent |
| `core.participant.departed` | `{ style, reason }` (Q16) | persistent |

**Canvas**
| Verb | object | Plane |
|------|--------|-------|
| `core.feed.added` / `core.feed.removed` | `{ feedId, source }` | persistent |
| `core.feed.moved` | `{ feedId, from, to }` (commit of a drag) | persistent |
| `core.embed.added` / `core.embed.removed` | `{ embedId, url }` | persistent |
| `core.portal.added` / `core.portal.removed` | `{ portalId, targetSession }` (Q18) | persistent |

**Cursor / UI (multiplayer)**
| Verb | object | Plane |
|------|--------|-------|
| `core.menu.opened` / `core.menu.closed` | `{ surfaceId, items }` | persistent |
| `core.menu.selected` | `{ surfaceId, item, owner }` — anyone may activate (Q9) | persistent |
| `core.cursor.interacted` | `{ partner, interaction }` — e.g. high-five (Q19) | persistent |

**Media**
| Verb | object | Plane |
|------|--------|-------|
| `core.camera.toggled` / `core.mic.toggled` | `{ enabled }` | persistent |
| `core.screen.started` / `core.screen.stopped` | `{}` | persistent |

**Recording & consent (Q1, Q3)**
| Verb | object | Plane |
|------|--------|-------|
| `core.recording.started` / `core.recording.stopped` | `{ recordingId, owner, perspective }` | persistent |
| `core.recording.consentGranted` | `{ recordingId }` — **OPT-IN** (Q3) | persistent |
| `core.recording.consentRevoked` | `{ recordingId }` — ends inclusion window | persistent |

> Consent is opt-in and time-segmented: a participant is included in recording R only between a `consentGranted` and the next `consentRevoked`. These events define the exact inclusion windows any composite/re-render must honor.

**NOT events (ephemeral presence, never logged)**: cursor position, gesture-in-motion, hover target, live audio levels, staging silhouettes, in-motion drag.

## Versioning (Q11d) — additive-only

Events carry `v`. You may add optional fields and new verbs; never remove or repurpose. Old events replay as-is. Upcasters only if a breaking change is ever truly unavoidable; snapshots later for replay performance.

## Persistence: Payload projection

`session-events` collection is a **projection/archive**, queryable and durable on Figma Cloud (our persistence commitment, Q4 deferred otherwise). Shape mirrors the event (id, v, type, actor, verb, object json, context fields; index `session + seq` unique).

## Replay & Time Navigation (Q20)

Reconstruct state by folding events in `seq` order through a reducer. Powers:
- **Recording re-render** (spec 08 Path B / spec 09 Strategy 3) — deterministic re-render of any perspective.
- **Personal live rewind (Q20 = B)** — a participant privately scrubs the event-sourced *state* backward while the live session continues; "return to now" re-syncs to head. Needs local history (IndexedDB). Note: this rewinds STATE; live A/V rewind requires the recording/ISO layer (that's playback).
- **User memory (Q13)** — a per-user projection over their own events.

## Open Questions (remaining)

- Q8a transport (LiveKit data channel vs NATS/JetStream vs both); Q8b truth-vs-projection boundary; Q8c command/event validation authority; Q8d IndexedDB in v1?; Q8e snapshots/checkpoints.
- Clock skew / seq assignment in a distributed publish model (server-assigned on persist? logical clocks?).
- Retention/privacy policy for the log.
