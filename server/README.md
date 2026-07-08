# p2p-payload server

Deno/Hono realtime media server for WebRTC signaling, SSE streams, and long-lived connections. Deployed to Railway.

## Development

```bash
deno task dev
```

## Why this exists

Figma Cloud runs on AWS Lambda, which can't maintain persistent connections. This server handles the realtime layer: WebRTC STUN/TURN credential generation, signaling relay via SSE, and session coordination.

The CMS at `../cms/` remains the source of truth for data — this server calls into the CMS API or shares the database for session/signal state.
