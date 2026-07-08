# ADR-0001: Use LiveKit (SFU) for realtime audio/video

- **Status:** Accepted
- **Date:** 2026-07-08
- **Supersedes:** RFC-001 in part — the P2P mesh topology, the SSE/DB-poll signaling layer, and the standalone Deno/Hono signaling server.

## Context

The product needs **many concurrent sessions of 1–10 participants each**, with Zoom/Teams-style
many-to-many audio/video.

The existing implementation is a hand-rolled **full-mesh** P2P system: signaling runs through
Payload collections (`Signals`, `Participants`) that clients poll (1s for signals, 3s for the
roster), because Figma Cloud runs on Lambda and Lambda can't hold a persistent connection. A
Deno/Hono server (`server/`, deployed to Railway) was scaffolded to move that signaling onto an
always-on process.

The key realization that reframed the whole effort: **the ~5-peer cap is a topology problem, not
a signaling-speed problem.** In a mesh, every peer opens a connection to every other peer and
uploads its camera N−1 times — bandwidth and CPU blow up around 4–5 participants no matter how
fast signaling is. Making signaling real-time (SSE or WebSockets on the Deno server) makes small
calls snappier but does **not** lift the cap.

Many-to-many at the scale we want requires an **SFU** (Selective Forwarding Unit): each client
uploads its stream once to a media server, which forwards it to everyone else. Building and
operating an SFU ourselves (mediasoup, Pion) is a large, ongoing engineering commitment.
**LiveKit** is an open-source SFU plus client SDKs that provides signaling, media forwarding,
simulcast, reconnection, active-speaker detection, and server-side recording (Egress) out of the
box. Its auth model — the backend mints short-lived JWTs — maps cleanly onto our existing Account
`sessionToken` auth.

## Decision

Adopt **LiveKit** as the media plane for realtime A/V.

- **Media / signaling / SFU:** LiveKit. Start on LiveKit Cloud's free "Build" tier for
  development and feasibility; graduate to **self-hosted LiveKit on Railway** (or a paid tier) for
  production scale and server-side recording. The client code and SDK are identical across all
  three — no rewrite to graduate.
- **Token minting:** a Payload/Next route in `cms/` (`POST /api/livekit/token`) authenticates the
  caller via the existing Account `sessionToken`, then signs a LiveKit JWT scoped to a room,
  identity, and permissions. The LiveKit API secret never reaches the browser. This is a plain
  request/response with no persistent connection, so it runs fine on Lambda/Figma Cloud.
- **Frontend:** replace the hand-rolled mesh in `app/(frontend)/session/page.tsx` with
  `@livekit/components-react` (`<LiveKitRoom>` + video tiles).
- **Recording:** client-side `MediaRecorder` feeding the existing
  `upload-url` → `finalize` → `finalize-session` pipeline (RFC-001 Phase 1B). This needs no LiveKit
  Egress and stays within the free tier. Server-side Egress-to-S3 is deferred until we self-host or
  move to a paid tier.
- **Deno/Hono `server/` project:** **retired and removed.** Its sole purpose was holding the
  persistent signaling connection Lambda couldn't — a job LiveKit now owns. If we later want
  realtime features outside LiveKit's scope (chat, live cursors, presence), we can reintroduce a
  small service or use LiveKit's data channels.

## Consequences

**Positive**
- Many-to-many 1–10 works out of the box; the mesh cap is gone.
- Large net deletion of code we would otherwise own and debug: signaling relay, glare handling,
  ICE trickling, poll loops.
- Back to a **single deployable app** (`cms/`) for the MVP — no Railway service to operate.
- Clear, rewrite-free scale path: free cloud → self-host/paid.

**Trade-offs**
- A dependency on LiveKit (mitigated: open source and self-hostable — no vendor lock-in on the
  media plane).
- We don't build or learn WebRTC's signaling internals by hand. Acceptable: the goal is shipping a
  working system, not mastering the primitives.
- Free-tier limits (5,000 connection-minutes, 50 GB downstream, 100 concurrent connections) are
  ample for development and demos but **not** sustained production; recording-to-cloud is not on
  the free tier — hence client-side recording for now.

**Superseded — to be removed/replaced in the implementation slice** (not in this doc-only change)
- `Signals` and `Participants` collections (hand-rolled signaling state).
- `/api/sessions/[id]/signals` and `/api/sessions/[id]/participants` routes.
- The mesh client in `app/(frontend)/session/page.tsx`.
- `Sessions` is **retained** as the domain anchor: it maps to a LiveKit room and links
  Moment ↔ Account(s) ↔ Recording.

## Alternatives considered

| Option | Outcome |
|---|---|
| Hand-rolled SSE+POST signaling on Deno, keep mesh | Snappier small calls, but still capped ~5. Doesn't meet the many-to-many goal. **Rejected.** |
| Hand-rolled SSE signaling now + build our own SFU (mediasoup) later | Maximum control, but high build/operate cost. Not lean for an MVP. **Rejected.** |
| **LiveKit (SFU)** | Meets the goal with minimal code; self-hostable escape hatch. **Chosen.** |

## References

- [RFC-001: WebRTC P2P Realtime Audio/Video Streaming](../rfc-001-webrtc-p2p-streaming.md) — superseded in part
- [LiveKit pricing](https://livekit.com/pricing)
- [LiveKit documentation](https://docs.livekit.io)
