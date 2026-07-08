# p2p-payload

WebRTC P2P realtime audio/video streaming system powered by Payload CMS on Figma Cloud.

A creative media platform featuring live, low-latency P2P sessions between participants with seamless recording and persistence into a timeline, moments, and memories system.

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

- **Phase 1 (MVP):** P2P WebRTC mesh for 1:1 sessions via SSE signaling
- **Phase 2 (Groups):** LiveKit SFU for 3–10 participant sessions
- See [RFC-001](./docs/rfc-001-webrtc-p2p-streaming.md) for the full streaming architecture

## Collections

- **Users:** Figma OAuth auth, RBAC
- **Accounts:** OAuth identity (created by callback)
- **Media:** Video/audio with enrichment pipeline (thumbnails, waveforms, colors)
- **Recordings:** Multi-track sessions with sync offsets
- **Timelines:** Versioned drafts with scenes
- **Moments:** Events/exhibits with OKLCH paint system
- **Memories:** Activity log/chat tied to moments
- **Logs:** Append-only structured events
- **Sessions:** Active/ended P2P/SFU streaming sessions (Phase 1)

## Resources

- [Payload Docs](https://payloadcms.com/docs)
- [Payload Figma Cloud](https://payloadcms.com/docs/getting-started/what-is-payload)
- [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
