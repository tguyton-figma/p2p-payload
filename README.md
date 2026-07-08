# p2p-payload

A creative media platform with live, low-latency P2P audio/video sessions between participants — with seamless recording and persistence into a timeline, moments, and memories system.

## Projects

| Directory | Stack | Deployment | Purpose |
|-----------|-------|------------|---------|
| [`cms/`](./cms) | Payload CMS, Next.js, Node.js | [Figma Cloud](https://p2p-payload.figma.site) | Content management, media pipeline, auth, admin UI |
| [`server/`](./server) | Hono, Deno | Railway | Realtime signaling, SSE streams, WebRTC coordination |

### Why two projects?

Figma Cloud runs on AWS Lambda — great for the CMS, but Lambda can't maintain long-lived connections (WebSocket, SSE, STUN/TURN). The `server/` project handles the realtime layer that Lambda can't, deployed to Railway where persistent connections are supported.

## Development

### CMS

```bash
cd cms && pnpm install && pnpm dev
```

- Admin panel: http://localhost:3000/admin
- Production: https://p2p-payload.figma.site
- Deploy: `npx @payloadcms/figma@latest deploy`

### Server

```bash
cd server && deno task dev
```

- Health check: http://localhost:8787/health

## Architecture

- **Phase 1 (MVP):** P2P WebRTC mesh for 1:1 sessions via SSE signaling
- **Phase 2 (Groups):** LiveKit SFU for 3–10 participant sessions
- See [RFC-001](./cms/docs/rfc-001-webrtc-p2p-streaming.md) for the full streaming architecture

## Resources

- [Payload CMS Docs](https://payloadcms.com/docs)
- [Hono Docs](https://hono.dev)
- [Deno Runtime](https://deno.land)
- [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [Railway Deployment](https://docs.railway.com)
