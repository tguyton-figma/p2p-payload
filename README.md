# p2p-payload

A creative media platform with live, low-latency audio/video sessions between participants — with
seamless recording and persistence into a timeline, moments, and memories system.

## Structure

Single application: a Payload CMS + Next.js app in [`cms/`](./cms), deployed to
[Figma Cloud](https://p2p-payload.figma.site). The realtime audio/video layer is provided by
**LiveKit** (a managed/self-hostable SFU), so there is no separate signaling server to run — see
the architecture note below.

## Development

```bash
cd cms && pnpm install && pnpm dev
```

- Admin panel: http://localhost:3000/admin
- Production: https://p2p-payload.figma.site
- Deploy: `npx @payloadcms/figma@latest deploy` (run `pnpm generate:types` first for schema changes)

## Architecture

Realtime A/V runs on **LiveKit (SFU)**: each client publishes its stream once and subscribes to the
others, so sessions scale to many-to-many (1–10 participants) without the fan-out limit of a P2P
mesh. The CMS mints short-lived LiveKit access tokens (authenticated via the existing Account
session token); LiveKit owns signaling, forwarding, and reconnection. Recordings are captured
client-side and flow into the existing `upload-url` → `finalize` → `finalize-session` media pipeline.

- **Decision & rationale:** [ADR-0001 — Use LiveKit (SFU) for realtime audio/video](./cms/docs/adr/0001-livekit-sfu-for-realtime-av.md)
- **Background:** [RFC-001](./cms/docs/rfc-001-webrtc-p2p-streaming.md) (superseded in part by ADR-0001)

> A previous iteration explored a hand-rolled P2P mesh with a standalone Deno/Hono signaling server
> (`server/`). That was retired in favor of LiveKit — the mesh caps at ~5 participants for topology
> reasons, and LiveKit reaches the many-to-many goal with far less code to own. See ADR-0001.

## Resources

- [Payload CMS Docs](https://payloadcms.com/docs)
- [LiveKit Docs](https://docs.livekit.io)
- [LiveKit Pricing](https://livekit.com/pricing)
- [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
