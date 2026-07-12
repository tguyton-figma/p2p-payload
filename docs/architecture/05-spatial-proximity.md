# 05 — Spatial Proximity

## The Concept

Distance on the canvas is not just layout — it's a dimension of the experience. Close things are loud, clear, vivid, and interactive. Far things are quiet, blurred, ambient, and observational. Moving closer to someone is a meaningful action, like walking across a room.

> **Reconciled with DECISIONS.md (2026-07-12):**
> - **Listener anchor = the participant's identity position** (the hand-cursor anchor / their feed), and under **`renderAs(X)` / spectating / follow (Q2, spec 09)** the listener follows X. So "whose ears" is the perspective primitive — the recorder view and a live spectator compute the same mix for X. (Resolves open question 1 below.)
> - **Proximity config is part of SESSION CONFIG (Q17a)**, not just "room metadata" — per-session defaults with per-participant overrides, consistent with the headless/config-driven model (Q2).
> - **Recordings DO capture proximity effects** — the recorder renders our own canvas app server-side (spec 08), so CSS proximity visuals + the spatial mix appear in the recording exactly as rendered for the recorded perspective. (Resolves open question 2 below; the old Canvas-2D limitation is gone with the client recorder.)
> - `.media-node` here is the **feed projection** of an identity (Q13); the same distance math also drives cursor-to-cursor awareness (spec 02).

## Spatial Audio

### Architecture

Replace the current `<RoomAudioRenderer />` (which plays all remote audio at uniform volume) with a custom `SpatialAudioController` that routes each participant's microphone track through the Web Audio API's `PannerNode`.

```
MediaStreamAudioSourceNode → PannerNode → AudioContext.destination
         (per track)          (per track)      (shared)
```

### Coordinate Mapping

Map the 2D canvas to 3D audio space:
- Canvas X → PannerNode `positionX`
- Canvas Y → PannerNode `positionZ`
- PannerNode `positionY` fixed at `0`

The listener position is the local participant's tile position. Remote participant positions are computed as offsets: `(remote.x - local.x, 0, remote.y - local.y)`.

### Distance Model

```typescript
const pannerConfig = {
  panningModel: 'HRTF',           // binaural processing for headphone users
  distanceModel: 'exponential',    // natural-sounding decay
  refDistance: 100,                 // full volume within 100 canvas units
  maxDistance: 500,                 // silent beyond 500 canvas units
  rolloffFactor: 2,                // decay rate
  coneInnerAngle: 360,             // omnidirectional
  coneOuterAngle: 360,
  coneOuterGain: 1,
}
```

These values are starting points — they should be tunable per session (stored as session config, broadcast via room metadata).

### Smooth Updates

```typescript
panner.positionX.setTargetAtTime(relativeX, audioCtx.currentTime, 0.02)
panner.positionZ.setTargetAtTime(relativeY, audioCtx.currentTime, 0.02)
```

The 20ms time constant prevents audio pops during movement. Updates fire on every position change (drag events, peer position broadcasts) — the PannerNode handles per-sample interpolation internally, so we don't need a `requestAnimationFrame` loop.

### Chrome Quirk

Chrome requires a muted `<audio>` element playing the MediaStream for WebRTC audio to route through Web Audio nodes. The LiveKit spatial audio demo documents this pattern. Each `SpatialTrackRenderer` creates a hidden `<audio>` element, sets it to muted, and attaches the stream. The actual audio output comes from the Web Audio graph.

### Integration Point

The `SpatialAudioController` consumes:
- **Audio tracks**: `useTracks([{ source: Track.Source.Microphone }])` from LiveKit
- **Positions**: `positionsRef` from SessionCanvas (already maintained)
- **Local position**: the local participant's tile position in React Flow

This requires zero new infrastructure. We already have all the data.

### Bandwidth Optimization

For sessions with many participants, unsubscribe from audio tracks beyond `maxDistance`:

```typescript
if (distance > maxDistance) {
  track.setSubscribed(false)  // stop receiving audio data
} else if (distance < maxDistance * 0.8) {
  track.setSubscribed(true)   // hysteresis to prevent flapping
}
```

This saves CPU (no decoding) and bandwidth (no packets) for distant participants.

## Visual Proximity Effects

### CSS-Driven Approach

Apply CSS custom properties to `.media-node` wrappers, driven by distance calculations:

```css
.media-node {
  filter: blur(var(--prox-blur, 0px)) saturate(var(--prox-sat, 1));
  opacity: var(--prox-opacity, 1);
  transform: scale(var(--prox-scale, 1));
  transition: filter 0.5s ease, opacity 0.5s ease, transform 0.3s ease;
  will-change: filter, opacity, transform;
}
```

### Proximity Zones

| Zone | Distance Range | Audio | Visual |
|------|---------------|-------|--------|
| **Intimate** | 0 – 80 units | Full volume | Full clarity, subtle warm glow |
| **Near** | 80 – 200 units | Full volume, slight pan | Full clarity, no effects |
| **Mid** | 200 – 350 units | Attenuating | Blur 2-4px, opacity 0.8, scale 0.95 |
| **Far** | 350 – 500 units | Barely audible | Blur 6-10px, opacity 0.5, desaturated |
| **Beyond** | > 500 units | Silent | Blur 12px+, opacity 0.25, greyscale |

### Distance Calculation

```typescript
function useProximityEffects(localNodeId: string, nodesRef: MutableRefObject<Node[]>) {
  useEffect(() => {
    const localPos = positionsRef.current[localNodeId]
    if (!localPos) return

    for (const node of nodesRef.current) {
      if (node.id === localNodeId) continue
      const remotePos = node.position
      const dist = Math.hypot(remotePos.x - localPos.x, remotePos.y - localPos.y)

      const el = document.querySelector(`[data-id="${node.id}"]`) as HTMLElement
      if (!el) continue

      const t = Math.min(1, Math.max(0, (dist - REF_DIST) / (MAX_DIST - REF_DIST)))
      el.style.setProperty('--prox-blur', `${t * 12}px`)
      el.style.setProperty('--prox-opacity', `${1 - t * 0.75}`)
      el.style.setProperty('--prox-sat', `${1 - t * 0.6}`)
      el.style.setProperty('--prox-scale', `${1 - t * 0.15}`)
    }
  }, [positions])  // re-run on any position change
}
```

### Performance

- **N participants**: O(N) distance calculations from local participant (not O(N²) — we only care about distance from *us*)
- **CSS transitions**: GPU-composited, no JS animation loop needed
- **Blur cost**: keep under 12px to avoid expensive blur kernels
- **`will-change`**: hints browser to promote elements to GPU layers

## Proximity-Driven Interactions

Beyond audio and visual, proximity enables behavioral changes:

### Cursor Awareness
When two cursors are within a threshold distance, both show a subtle "awareness" indicator — the hands orient slightly toward each other, or a gentle glow appears between them. This is presence-layer data, computed locally from cursor positions.

### Interaction Zones
Some canvas interactions only work at close range:
- **High-five**: both cursors within 50 units
- **Menu interaction**: cursor within 100 units of another participant's open menu
- **Feed interaction**: cursor within the bounds of a media tile (already handled by React Flow hit testing)

### Ambient Sound
Future: add environmental audio that responds to canvas density. Areas with many participants have a subtle ambient hum (like a busy room). Empty areas are silent. This would use a `GainNode` driven by a density calculation over tile positions.

## Configuration

Proximity parameters should be tunable per session and stored in room metadata:

```typescript
interface ProximityConfig {
  audioRefDistance: number      // default: 100
  audioMaxDistance: number      // default: 500
  audioRolloff: number          // default: 2
  visualRefDistance: number     // default: 80 (can differ from audio)
  visualMaxDistance: number     // default: 500
  interactionDistance: number   // default: 50
}
```

Host can adjust these via session settings. Changes broadcast via room metadata update → all clients reconfigure in real time.

## What We Already Have

| Need | Existing Asset |
|------|---------------|
| Audio tracks per participant | `useTracks()` with `Track.Source.Microphone` |
| Tile positions | `positionsRef` in SessionCanvas |
| Position sync | Data channel `canvas-layout` topic |
| Room configuration | Room metadata (already used for open/closed, recording) |
| Per-track volume control | `RemoteAudioTrack.setVolume()` in LiveKit |
| Selective subscription | `track.setSubscribed(boolean)` in LiveKit |

## Open Questions

1. **Listener position** → RESOLVED: the anchor is the participant's identity position, following `renderAs(X)`/focus (see banner). Sub-question remaining: is that identity position the *feed* location or the *hand-cursor* location when the two diverge? (Lean: identity/feed for stability; revisit.)

2. **Visual effects on recording** → RESOLVED: yes — the server-side recorder renders our app, so effects are captured (see banner).

3. **New participant positioning**: When someone joins, where do they appear? If they spawn far from everyone, they start in silence. Should new participants auto-place near the cluster, or at a fixed "lobby" position?

4. **Canvas zoom interaction**: React Flow supports zoom (currently disabled). If we enable zoom, how does distance interact with zoom level? Physical pixel distance? Or canvas-unit distance regardless of zoom?

5. **Mono vs stereo source**: LiveKit microphone tracks are mono. PannerNode with HRTF produces convincing spatialization from mono sources, but it won't sound as rich as stereo. Is that acceptable?
