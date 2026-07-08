# p2p-payload

Realtime audio/video streaming platform powered by Payload CMS on Figma Cloud, with LiveKit for the
live media layer.

A creative media platform featuring live, low-latency sessions between participants with seamless
recording and persistence into a timeline, moments, and memories system.

## Quick Start

```bash
pnpm install
pnpm dev
```

Admin panel: http://localhost:3000/admin

Prod: https://p2p-payload.figma.site

## Development

- **Live environment:** production only (no staging/dev)
- **Deployment:** `npx @payloadcms/figma@latest deploy`
- **Type safety:** Always run `pnpm generate:types` before deploying schema changes
- **Testing:** Push to prod and iterate via the browser preview

## Architecture

- **Realtime A/V:** LiveKit (SFU) — many-to-many 1–10 participants. The CMS mints short-lived
  LiveKit access tokens; LiveKit owns signaling, forwarding, and reconnection.
- **Recording:** client-side capture into the existing `upload-url` → `finalize` →
  `finalize-session` media pipeline.
- See [ADR-0001](./docs/adr/0001-livekit-sfu-for-realtime-av.md) for the decision and rationale, and
  [RFC-001](./docs/rfc-001-webrtc-p2p-streaming.md) for background (superseded in part).

## Collections

- **Users:** Figma OAuth auth, RBAC
- **Accounts:** OAuth identity (created by callback)
- **Media:** Video/audio with enrichment pipeline (thumbnails, waveforms, colors)
- **Recordings:** Multi-track sessions with sync offsets
- **Timelines:** Versioned drafts with scenes
- **Moments:** Events/exhibits with OKLCH paint system
- **Memories:** Activity log/chat tied to moments
- **Logs:** Append-only structured events
- **Sessions:** Domain anchor for a live A/V session — maps to a LiveKit room, links Moment ↔ Account(s) ↔ Recording

## Resources

- [Payload Docs](https://payloadcms.com/docs)
- [Payload Figma Cloud](https://payloadcms.com/docs/getting-started/what-is-payload)
- [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
