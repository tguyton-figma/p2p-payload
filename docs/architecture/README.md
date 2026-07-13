# Architecture Specs

Living specifications for the next generation of the p2p-payload canvas experience.

## Design Principles

1. **Cursor is the interface** — all tools, menus, and signals expressed through the cursor
2. **Everything is multiplayer** — any UI a participant opens is visible and interactive for all
3. **Proximity drives experience** — distance on canvas determines audio, visual, and interaction behavior
4. **Ephemeral by default, persisted by intent** — separate hot real-time data from cold stored data
5. **Event-sourced truth** — every meaningful state change captured as an immutable event for replay
6. **Lean on what we have** — LiveKit for real-time, React Flow for canvas, Payload CMS for persistence; resist adding new platforms/dependencies
7. **The recorder is the app** — server-side recording renders our own canvas, so every feature is captured for free (and must render from shared state alone)

## Documents

| # | Spec | Status | Summary |
|---|------|--------|---------|
| 00 | [Product Vision](00-product-vision.md) | Draft | What we're building, why, and the design language |
| 01 | [Data Architecture](01-data-architecture.md) | Draft | Layered stack: ephemeral → events → assets |
| 02 | [Cursor System](02-cursor-system.md) | Draft | 3D hand cursors, gestures, cursor-as-UI |
| 03 | [Multiplayer UI](03-multiplayer-ui.md) | Draft | Shared interactive UI surfaces across participants |
| 04 | [Event Architecture](04-event-sourcing.md) | Reconciled | CQRS + event sourcing, two planes, tiered vocabulary, replay |
| 05 | [Spatial Proximity](05-spatial-proximity.md) | Draft | Distance-based audio, visual, and interaction zones |
| 06 | [Physics & Environment](06-physics-environment.md) | Draft | Motion, gravity, light, impact, environmental richness |
| 07 | [Implementation Phases](07-implementation-phases.md) | Draft | Sequenced build plan with dependencies |
| 08 | [Recording & Muxing](08-recording-muxing.md) | Draft | Server-side composite egress, progressive/durable capture, enrichment, 4K |
| 09 | [Recording Perspectives](09-recording-perspectives.md) | Draft | Multi-POV capture — any participant records their perspective; `renderAs()` primitive; spectating |
| 10 | [World & Identity](10-world-and-identity.md) | Draft | Ephemeral sessions, config + semantic handles, portals/sub-sessions, Accounts-bound identity, arrival |
| — | [Technical Report](TECHNICAL-REPORT.md) | Synthesis | Unified implementation blueprint across all specs; current→target mapping; 21 gaps worked through (§12) |
| — | [Production Plan](PRODUCTION-PLAN.md) | **Active** | Sequenced build order (resolves Q10); 11 milestones from cursor presence through environmental polish |

## Decision Log

**[DECISIONS.md](DECISIONS.md) is the authoritative source of truth.** It records every settled architecture decision (Q1–Q20, Round 3 implementation synthesis, and spawned sub-decisions) with rationale. When a spec and DECISIONS.md disagree, DECISIONS.md wins — the specs are being reconciled to it over time.

**[TECHNICAL-REPORT.md](TECHNICAL-REPORT.md)** synthesizes all specs into one implementation blueprint and carries the full rationale for the Round 3 gap resolutions inline.

## Current Stack

- **Real-time**: LiveKit (SFU, data channels, WebRTC tracks)
- **Canvas**: React Flow / xyflow (DOM-based node graph)
- **Backend/CMS**: Payload CMS (collections, media, API routes)
- **Framework**: Next.js 15 (app router)
- **Recording**: Client-side Canvas 2D + MediaRecorder
- **Deployment**: Figma Cloud
