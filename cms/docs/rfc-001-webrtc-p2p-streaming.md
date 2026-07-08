# RFC-001: WebRTC P2P Realtime Audio/Video Streaming

**Status:** Draft
**Created:** 2026-07-07
**Author:** p2p-payload

---

## Summary

Add a WebRTC-powered peer-to-peer realtime audio/video streaming system to p2p-payload. The system enables live, low-latency media sessions between participants — built on top of the existing Payload CMS stack (Accounts, Media, Recordings) and deployed on Figma Cloud. The architecture starts with pure P2P for 1:1 sessions and is designed to evolve toward an SFU model for small-group (3–10 participant) sessions.

---

## Motivation

The platform already captures, stores, and displays recorded media — video, audio, waveforms, timelines, moments. What it lacks is the **live** layer: the ability for participants to stream to each other in realtime and then seamlessly persist those streams as recordings in the existing media pipeline.

The existing recorder infrastructure (presigned S3 uploads, session tokens, finalize-session endpoint) was designed for **asynchronous capture** — record locally, upload after. A WebRTC layer completes the picture: live presence becomes live participation, and recordings become artifacts of shared experience rather than isolated captures.

### Goals

1. **Realtime P2P audio/video** between authenticated participants
2. **Seamless recording** — live sessions produce Recordings and Media documents identical to the existing recorder flow
3. **Integration with Moments** — live sessions are anchored to Moments (the platform's event/exhibit model)
4. **Progressive architecture** — P2P mesh for 1:1, with a clear upgrade path to SFU for groups
5. **Zero additional infrastructure** in Phase 1 — signaling via Next.js route handlers, STUN/TURN via managed services

### Non-Goals (for now)

- Screen sharing beyond basic `getDisplayMedia` (no remote desktop control)
- Broadcast/webinar mode (1-to-many)
- End-to-end encryption beyond WebRTC's built-in DTLS-SRTP
- Mobile native SDKs (browser-only initially)

---

## Existing Infrastructure We Build On

### Accounts & Auth
- Figma OAuth produces `sessionToken` (32-byte random, stored in DB)
- All recorder endpoints validate via `Bearer <sessionToken>` against `accounts.sessionToken`
- Account records include `figmaId`, `handle`, `email`, `avatarUrl`
- **Reuse:** Session tokens authenticate signaling and stream metadata. Account identity populates participant info.

### Media & Upload Pipeline
- Presigned S3 URLs (`/api/recorder/upload-url`) bypass Lambda's 6MB limit
- Finalize endpoint (`/api/recorder/finalize`) creates Media docs from uploaded files
- Enrichment pipeline (thumbnail, waveform, color, dimensions) runs as async jobs
- **Reuse:** Recorded streams upload via the same presigned URL flow. Same enrichment pipeline processes them.

### Recordings
- Group media tracks with sync offsets: `{ mediaId, sourceType, label, offsetMs, durationMs }`
- `finalize-session` endpoint creates the Recording document
- Source types: `camera | microphone | screen | window | tab`
- **Reuse:** A completed live session calls `finalize-session` with the same track structure. Live tracks become recording tracks.

### Presence System
- Polling-based (`/api/timelines/[id]/presence`): 5s interval, 15s stale threshold
- Viewer records: `{ viewerId, displayName, avatarUrl, sceneIndex, playheadMs, lastSeen }`
- `payload-kv` collection for lightweight key-value state
- **Evolve:** The existing presence model tracks passive viewers. The new system extends it to track active stream participants with connection state.

### Logs
- Append-only structured events (`/api/timelines/[id]/logs`)
- Client-side `useLogBuffer` hook batches and flushes every 5s
- Subjects like `media.upload`, `recording.created`
- **Reuse:** Stream lifecycle events (`stream.started`, `stream.ended`, `peer.joined`, `peer.left`) follow the same pattern.

---

## Architecture

### Phase 1: P2P Sessions (1:1)

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser A                          Browser B                   │
│                                                                 │
│  getUserMedia()                     getUserMedia()               │
│       │                                  │                      │
│       ▼                                  ▼                      │
│  RTCPeerConnection ◄── media ──► RTCPeerConnection              │
│       │                                  │                      │
│       │         ┌──────────────┐         │                      │
│       └────────►│  Signaling   │◄────────┘                      │
│         SDP/ICE │  (SSE + POST)│  SDP/ICE                       │
│                 └──────┬───────┘                                 │
│                        │                                        │
│                 Next.js Route                                   │
│                 Handlers                                        │
│                        │                                        │
│              ┌─────────┴──────────┐                             │
│              │   Payload CMS      │                             │
│              │                    │                             │
│              │  Sessions (new)    │                             │
│              │  Accounts (existing│                             │
│              │  Media (existing)  │                             │
│              │  Recordings (exist)│                             │
│              └────────────────────┘                             │
│                                                                 │
│  STUN: stun.l.google.com:19302                                 │
│  TURN: Cloudflare TURN (free 1TB tier)                         │
└─────────────────────────────────────────────────────────────────┘
```

### Signaling: SSE + HTTP POST via Next.js Route Handlers

WebRTC requires a signaling channel to exchange SDP offers/answers and ICE candidates before a direct peer connection is established. For Phase 1, we use Next.js App Router route handlers — no additional infrastructure.

**Why SSE + POST instead of WebSockets:**
- Next.js route handlers support SSE natively (streaming `ReadableStream` responses)
- Works on Figma Cloud's Lambda-backed deployment (no persistent WebSocket support)
- Signaling is short-lived (seconds, not hours) — SSE is fine for this duration
- POST for outbound messages, SSE for inbound — simple, HTTP-native

**Endpoints:**

```
POST /api/sessions                     → Create a new session (returns sessionId)
GET  /api/sessions/[id]/signal         → SSE stream for incoming signaling messages
POST /api/sessions/[id]/signal         → Send SDP offer/answer/ICE candidate
GET  /api/sessions/[id]                → Session metadata + participant list
POST /api/sessions/[id]/join           → Join an existing session
POST /api/sessions/[id]/leave          → Leave session (triggers recording finalization)
```

**Signaling flow:**

1. Peer A creates session via `POST /api/sessions` → gets `sessionId`
2. Peer A opens SSE stream: `GET /api/sessions/{id}/signal`
3. Peer A shares session link (or Moment triggers invite)
4. Peer B joins via `POST /api/sessions/{id}/join`
5. Peer B opens SSE stream: `GET /api/sessions/{id}/signal`
6. Peer A creates `RTCPeerConnection`, generates SDP offer
7. Peer A sends offer: `POST /api/sessions/{id}/signal` → `{ type: 'offer', sdp, from, to }`
8. Server relays offer to Peer B's SSE stream
9. Peer B generates SDP answer → `POST /api/sessions/{id}/signal` → `{ type: 'answer', sdp, from, to }`
10. Server relays answer to Peer A's SSE stream
11. ICE candidates trickle via the same POST/SSE path
12. Direct P2P media connection established

**In-memory signaling state:**

Signaling messages are ephemeral — they only matter during connection setup (seconds). We use an in-memory `Map<sessionId, Set<ReadableStreamController>>` to relay messages between SSE connections. No database writes for signaling traffic.

Session *metadata* (participants, status, linked Moment) persists in a Payload collection. Signaling *messages* do not.

### NAT Traversal: STUN + Cloudflare TURN

```typescript
const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: 'turn:turn.cloudflare.com:3478',
    username: '<short-lived-credential>',
    credential: '<short-lived-credential>',
  },
]
```

**TURN credential generation** happens server-side via a new endpoint:

```
POST /api/sessions/[id]/ice-servers → Returns ICE server config with fresh TURN credentials
```

Cloudflare TURN credentials are short-lived (generated via their REST API from our backend). The endpoint requires session token auth and only returns credentials to active session participants.

**Cost:** Cloudflare offers 1TB free, then $0.05/GB. A 1-hour 720p call uses ~1.5GB if relayed via TURN (most calls won't need TURN — STUN succeeds ~85% of the time).

### New Collection: Sessions

```typescript
// src/collections/Sessions.ts
{
  slug: 'sessions',
  admin: { group: 'streaming' },
  fields: [
    { name: 'status', type: 'select',
      options: ['waiting', 'active', 'ended'],
      defaultValue: 'waiting', required: true },
    { name: 'moment', type: 'relationship', relationTo: 'moments' },
    { name: 'initiator', type: 'relationship', relationTo: 'accounts', required: true },
    { name: 'participants', type: 'array', fields: [
      { name: 'account', type: 'relationship', relationTo: 'accounts', required: true },
      { name: 'role', type: 'select', options: ['host', 'guest'], defaultValue: 'guest' },
      { name: 'joinedAt', type: 'date' },
      { name: 'leftAt', type: 'date' },
      { name: 'tracks', type: 'array', fields: [
        { name: 'kind', type: 'select', options: ['audio', 'video'], required: true },
        { name: 'sourceType', type: 'select',
          options: ['camera', 'microphone', 'screen', 'window', 'tab'], required: true },
        { name: 'label', type: 'text' },
      ]},
    ]},
    { name: 'startedAt', type: 'date' },
    { name: 'endedAt', type: 'date' },
    { name: 'recording', type: 'relationship', relationTo: 'recordings' },
    { name: 'maxParticipants', type: 'number', defaultValue: 2, min: 2, max: 10 },
  ],
}
```

### Client-Side: WebRTC Manager Hook

```typescript
// src/hooks/useWebRTCSession.ts (React hook)
function useWebRTCSession(sessionId: string) {
  // Returns:
  return {
    // Connection state
    connectionState,     // 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed'
    participants,        // Participant[]

    // Local media
    localStream,         // MediaStream
    startCamera,         // () => Promise<void>
    startMicrophone,     // () => Promise<void>
    startScreenShare,    // () => Promise<void>
    stopTrack,           // (trackId: string) => void

    // Remote media
    remoteStreams,        // Map<peerId, MediaStream>

    // Recording
    isRecording,
    startRecording,      // () => void — begins MediaRecorder on local + remote
    stopRecording,       // () => Promise<RecordingResult> — uploads chunks, finalizes

    // Session lifecycle
    join,                // () => Promise<void>
    leave,               // () => Promise<void> — triggers recording upload if active
  }
}
```

### Recording Flow (Live → Persisted)

When recording is active during a live session:

1. `MediaRecorder` captures each local track (camera, mic, screen) independently
2. Remote tracks are also captured via `MediaRecorder` on the received streams
3. All recordings track `offsetMs` relative to session `startedAt`
4. On session end or explicit stop:
   a. Each recorded blob is uploaded via existing `upload-url` → S3 → `finalize` flow
   b. `finalize-session` is called with all tracks + offsets (identical to existing recorder flow)
   c. Session document is updated with `recording` relationship
   d. Existing enrichment pipeline processes each media doc (thumbnails, waveforms, colors)

**Key insight:** The recording output is indistinguishable from an asynchronous recorder upload. The Media, Recording, and enrichment systems don't need to know the content was captured live.

---

## Phase 2: SFU for Groups (3–10 participants)

### When to Upgrade

P2P mesh works well for 2 participants. At 3+ participants, each peer must maintain N-1 connections and decode N-1 video streams. At 4 participants on a 720p call, each peer needs ~12 Mbps. Mobile users on LTE will struggle.

### SFU Options Evaluated

| Option | Pros | Cons |
|--------|------|------|
| **LiveKit (self-hosted)** | Go-based, fast. Built-in rooms, recording (Egress), AI agents framework. Apache 2.0 license. Docker/Helm deploy. | Requires separate server (not Lambda-compatible). |
| **LiveKit Cloud** | Managed LiveKit. $0.0004/min. 5K free min/mo. | Vendor dependency. |
| **Cloudflare Realtime SFU** | Anycast on 300+ PoPs. Bundled TURN. Free 1TB. | Newer product (acquired Dyte 2025). Less ecosystem. |
| **mediasoup** | Node.js/C++. Maximum control. Fine-grained media pipeline. | No built-in room management, recording, or scaling. High engineering investment. |

### Recommendation: LiveKit

LiveKit is the strongest fit for this project:

- **Built-in room management** — participants, tracks, permissions handled by the server
- **Recording via Egress** — per-track or composite recording, outputs to S3
- **Simulcast** — adaptive quality per subscriber
- **React SDK** (`@livekit/components-react`) — drop-in UI components
- **Self-hostable** — single Go binary, Docker image, or Helm chart
- **Progressive adoption** — can start with LiveKit Cloud (free tier) and self-host later

The signaling endpoints from Phase 1 would be replaced by LiveKit's signaling. The Session collection remains as the domain model, but room lifecycle delegates to LiveKit. Recording output still feeds into the existing Media/Recording pipeline.

---

## Phase 2: Signaling Upgrade Path

If SSE signaling latency becomes a bottleneck (unlikely for <10 participants, but possible on Lambda cold starts), upgrade options:

1. **Cloudflare Workers + Durable Objects** — stateful WebSocket rooms at the edge. Each DO is a room. ~$5/mo for light usage.
2. **Dedicated signaling server** — lightweight Node.js/Go process with WebSocket support. Deploy alongside LiveKit if already running a server.
3. **LiveKit's built-in signaling** — if adopting LiveKit for SFU, signaling comes free.

---

## Data Model Changes

### New Collection: Sessions

See schema above. Key relationships:

```
Session ──► Moment (optional: anchors session to an event)
Session ──► Account (initiator)
Session ──► Account[] (participants, via array)
Session ──► Recording (created on session end)
```

### Extended: Recordings

No schema changes needed. The existing `tracks` array with `{ media, sourceType, label, offsetMs, durationMs }` already handles multi-track recordings from any source. A live session produces the same structure as an async recorder upload.

### Extended: Moments

Add an optional relationship to active/recent sessions:

```typescript
{ name: 'sessions', type: 'relationship', relationTo: 'sessions', hasMany: true }
```

This links a Moment to its live sessions — past and present.

### New Log Subjects

```
session.created      — { sessionId, initiatorId, momentId? }
session.joined       — { sessionId, accountId, participantCount }
session.left         — { sessionId, accountId, reason }
session.ended        — { sessionId, duration, recordingId? }
peer.connected       — { sessionId, peerId, connectionType: 'relay' | 'host' | 'srflx' | 'prflx' }
peer.disconnected    — { sessionId, peerId, reason }
stream.track.added   — { sessionId, peerId, kind, sourceType }
stream.track.removed — { sessionId, peerId, kind, sourceType }
recording.started    — { sessionId }
recording.stopped    — { sessionId, trackCount, totalDurationMs }
```

---

## Implementation Plan

### Phase 1A: Foundation (Sessions + Signaling)

1. **Sessions collection** — schema, access control, admin UI
2. **Signaling endpoints** — SSE stream + POST relay (`/api/sessions/[id]/signal`)
3. **ICE server endpoint** — TURN credential generation via Cloudflare API
4. **`useWebRTCSession` hook** — connection lifecycle, local/remote streams
5. **Session UI** — join/create session within a Moment, video tiles, controls

### Phase 1B: Recording Integration

6. **Client-side recording** — `MediaRecorder` on local + remote tracks
7. **Upload flow** — reuse `upload-url` → S3 → `finalize` → `finalize-session`
8. **Session end handler** — auto-finalize recording, update Session doc
9. **Playback** — recorded sessions appear as Recordings, viewable in timeline

### Phase 1C: Polish

10. **Connection quality indicators** — bitrate, packet loss, connection type
11. **Reconnection** — ICE restart on transient failures
12. **Audio-only fallback** — degrade gracefully when video bandwidth is insufficient
13. **Logging** — structured events via existing log infrastructure

### Phase 2: Group Sessions

14. **LiveKit integration** — replace P2P with SFU for 3+ participants
15. **LiveKit Egress** — server-side recording replaces client-side `MediaRecorder`
16. **Simulcast** — adaptive quality per viewer
17. **Speaker detection** — active speaker highlighting
18. **Moments integration** — Memories created from session events

---

## Security Considerations

- **Authentication:** All signaling and session endpoints require valid `sessionToken` (existing Account auth)
- **Authorization:** Only session participants receive signaling messages. Session access mirrors Moment access control.
- **TURN credentials:** Short-lived (5-minute TTL), generated per-session, scoped to the session's TURN realm
- **Media encryption:** WebRTC mandates DTLS-SRTP for all media. Peer-to-peer streams are encrypted end-to-end by default.
- **Recording consent:** Session UI must indicate when recording is active. All participants see the recording indicator.
- **Signaling message validation:** SDP and ICE candidates are validated for structure before relay (prevent injection of malicious SDP)

---

## Cost Estimate (Phase 1)

| Component | Cost |
|-----------|------|
| Signaling (Next.js route handlers) | $0 (included in Figma Cloud) |
| STUN (Google public) | $0 |
| TURN (Cloudflare, free 1TB) | $0 for ~650 hours of relayed 720p calls |
| Media storage (S3 via Figma Cloud) | Existing — included in platform |
| Enrichment (Lambda jobs) | Existing — included in platform |
| **Total Phase 1** | **$0/month** (within free tiers) |

---

## Open Questions

1. **Signaling latency on Lambda cold starts** — SSE connection setup may add 500ms–2s on a cold Lambda. Is this acceptable for session establishment? (Mitigated: cold starts only affect the first request, and signaling is HTTP-based so subsequent messages use warm instances.)

2. **In-memory signaling on Lambda** — The in-memory `Map` for SSE relay works on a single instance but not across Lambda invocations. For Phase 1 (1:1 sessions), this is likely fine since both peers connect to the same warm instance. At scale, consider Redis pub/sub or Cloudflare Durable Objects.

3. **Recording quality** — Client-side `MediaRecorder` captures the decoded stream, which may be lower quality than the original (compressed → decoded → re-compressed). For production quality, server-side recording via SFU tapping (Phase 2) is preferred.

4. **Moment lifecycle** — Should creating a session auto-transition a Moment from `staged` to `active`? Should ending a session transition it to `completed`?

5. **Maximum session duration** — Lambda functions have execution time limits. Long SSE connections may get terminated. Need to implement reconnection logic with session state recovery.

---

## References

- [WebRTC API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/)
- [LiveKit Documentation](https://docs.livekit.io/)
- [MediaRecorder API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- Existing codebase: `src/endpoints/recorder/`, `src/hooks/usePresence.ts`, `src/collections/Recordings.ts`
