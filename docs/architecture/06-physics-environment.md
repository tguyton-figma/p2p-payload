# 06 — Physics & Environment

> **Reconciled with DECISIONS.md (2026-07-12):**
> - **Physics is EPHEMERAL while it runs, PERSISTENT on commit (Q11b).** Live simulation (momentum, in-flight motion) is presence/broadcast; only the settled result (`core.feed.moved` final position) is logged. Don't log every physics tick.
> - **Physics is config-gated per session (Q2/Q17)** — a room can turn physics on/off and pick a gravity mode; headless + data-driven, not hardcoded.
> - **Keep the event set small (Q11d).** Physics adds at most a tiny number of core verbs (e.g. a settle/collide commit); resist a proliferation of physics events. Most physics stays ephemeral.
> - **"Host-authoritative physics" below is superseded by the CQRS model (Q8)**: physics results publish as events like anything else; authority is the log, not a privileged host. Which client *runs* the sim is an implementation detail to settle later.
> - Objects have a single-identity projection model (Q13) and everything-multiplayer interaction (Q9) — collisions/tugs between participants' feeds are co-op by default.

## The Goal

The canvas should feel physical. Objects have weight, momentum, and presence. Interactions have consequence — dragging a tile feels like moving something, not just updating coordinates. The environment responds to what's happening: active areas glow, collisions ripple, idle objects settle.

## Physics Engine

### Selection: Matter.js (Prototype) → Planck.js (Production)

**Matter.js** for prototyping:
- Largest ecosystem, most examples, gentlest learning curve
- Runs headless (no renderer) — we sync physics body positions to React Flow node positions
- Good enough for 5-20 bodies (our tile count)
- ~80KB bundle

**Planck.js** for production if needed:
- Box2D-quality physics (better solver for stacking, joints, constraints)
- Smaller bundle (~40KB, no built-in renderer)
- Same conceptual model as Matter.js — migration is straightforward

**Rapier** (WASM) only if we need 100+ bodies or complex simulations — overkill for our current scope.

### Integration with React Flow

```
React Flow nodes ←→ Physics bodies (bidirectional sync)

User drags tile → update physics body position (kinematic)
Physics tick → update React Flow node position (dynamic)
```

The physics world runs headless. Each React Flow node has a corresponding physics body. Sync is bidirectional:

1. **User drags a tile**: while dragging, the physics body is set to `kinematic` (user-controlled). Its position follows the drag.
2. **User releases**: the body transitions to `dynamic` with the drag's velocity vector. The tile slides with momentum, decelerating via friction.
3. **Collision**: if a moving tile hits another, the other tile responds physically (pushed, bounced).
4. **Settle**: tiles come to rest via damping. Once velocity drops below a threshold, the body goes `static` (no CPU cost until disturbed).

### Physics Step Loop

```typescript
useEffect(() => {
  if (!physicsActive) return
  
  let raf: number
  const step = () => {
    engine.update(1000 / 60)  // fixed timestep
    for (const body of engine.bodies) {
      const node = nodeMap.get(body.id)
      if (node && !body.isKinematic) {
        updateNodePosition(node.id, body.position)
      }
    }
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}, [physicsActive])
```

Physics only runs when there are active (non-static) bodies — idle canvas = zero physics overhead.

## Physics Behaviors

### Drag Momentum
Release a tile and it slides with inertia. The velocity is derived from the last few frames of the drag gesture. Friction decelerates it. It feels like pushing something across a table.

### Collision
Tiles can't overlap. When a moving tile contacts another:
- **Elastic bounce**: both tiles respond proportional to their "mass" (size or a configured weight)
- **Visual feedback**: a subtle ripple or flash at the contact point
- **Event**: `canvas:tile:collide` event logged (L2)

### Gravity Modes
Configurable per session:
- **None**: tiles stay where placed (current behavior, default)
- **Gentle settle**: tiles slowly drift toward a center point, clustering naturally
- **Floor gravity**: tiles fall toward the bottom of the viewport, stacking
- **Orbit**: tiles orbit a central point (decorative, for idle sessions)

### Constraints and Springs
Related tiles (e.g., a participant's camera + their screen share) can be connected by invisible springs — they loosely follow each other without being rigidly grouped. Pull one away and the other gently follows.

## Environmental Effects

### Visual Atmosphere

These effects create a living, responsive environment:

**Active speaker glow**: When a participant is speaking, their tile emits a subtle, pulsing glow. Intensity correlates with volume. This is purely visual and driven by LiveKit's `isSpeaking` state (already available via hooks).

**Proximity warmth**: The area between closely positioned tiles has a warmer color temperature (subtle CSS gradient overlay). Distant areas feel cooler. This reinforces the proximity metaphor.

**Idle breathing**: Tiles that haven't been interacted with for >30 seconds have a subtle, slow scale pulse ("breathing") — the canvas feels alive even when still.

### Light (Future)

If we introduce a WebGL overlay layer (for cursor rendering or particle effects), we can add dynamic lighting:

- **Cursor light**: each cursor casts a soft light on nearby tiles, like a flashlight on a desk
- **Speaking light**: active speakers emit a brighter light, drawing attention
- **Ambient occlusion**: tiles that are close together cast subtle shadows on each other

This requires a Three.js or WebGL layer and is a Phase 5+ feature. The CSS-based effects above provide the same *feeling* of environmental responsiveness without the rendering complexity.

### Particles (Future)

Lightweight particle effects for specific interactions:
- **Join/leave**: a brief sparkle or dissolve effect at the tile's position
- **High-five**: confetti burst between two cursors
- **Recording start**: a subtle pulse radiating from the record button
- **Collision**: small debris/sparkle at impact point

Particle systems are natural in a WebGL layer but can also be approximated with CSS animations for simpler cases.

## Sound Design (Future)

Environmental audio cues that reinforce physicality:

- **Tile drop**: a soft thud when a tile settles after being dragged
- **Collision**: a gentle bump sound when tiles collide
- **Menu open/close**: a crisp mechanical sound (sci-fi bracelet activating)
- **Join**: a warm tone (someone arrived)
- **High-five**: a satisfying slap

These use the Web Audio API with pre-loaded audio buffers. Spatial positioning via PannerNode means the sounds come from where the action happened on the canvas.

Audio assets stored in Payload CMS Media collection, loaded once per session, cached aggressively.

## Multiplayer Physics

### The Consistency Challenge

Physics simulation is deterministic given identical inputs, but floating-point precision and timing differences across clients mean two browsers running the same physics won't stay in sync. For multiplayer physics, we need a single authority.

### Approach: Host-Authoritative Physics

The session host runs the physics simulation. Results are broadcast to all participants:

1. Host's client runs Matter.js/Planck.js
2. On each physics tick with position changes, host broadcasts updated positions via the existing `canvas-layout` data channel
3. Remote clients apply positions directly (no local physics simulation)
4. When a remote participant drags a tile, they broadcast drag start/end — the host's physics picks up the tile's velocity on release

**Trade-off**: the host bears the CPU cost of physics. For 5-20 tiles, this is negligible. If the host disconnects, physics pauses until a new host is designated.

### Event Logging

Physics-driven position changes that cross a threshold (tile moves more than 20 units from its last logged position) are recorded as L2 events:

```typescript
{
  type: 'canvas:tile:settle',
  actor: 'system',  // physics-driven, not user-driven
  payload: { tileId, from: { x, y }, to: { x, y }, cause: 'momentum' | 'collision' | 'gravity' }
}
```

## Implementation Phases

Physics and environmental effects are progressive enhancements. Each can be added independently:

| Phase | Feature | Complexity | Dependencies |
|-------|---------|-----------|--------------|
| 5a | Drag momentum | Low | Physics engine integration |
| 5b | Tile collision | Medium | Physics engine, visual feedback |
| 5c | Active speaker glow | Low | LiveKit `isSpeaking` hook |
| 5d | Environmental sound effects | Low | Web Audio, asset pipeline |
| 5e | Gravity modes | Medium | Physics engine, session config |
| 5f | Particle effects | Medium | WebGL overlay layer or CSS |
| 5g | Dynamic lighting | High | WebGL overlay layer (Three.js) |

## Open Questions

1. **Physics scope**: Should physics apply to ALL canvas objects (tiles, embeds, cursors) or just media tiles? Figma embeds with physics might be fun but could also be annoying.

2. **Opt-out**: Should physics be toggleable per session? Some sessions might want a calm, grid-based layout. Others want the playground feel.

3. **Performance budget**: What's the maximum acceptable CPU overhead for physics? On a low-end machine, should physics automatically degrade (lower tick rate, fewer bodies)?

4. **Deterministic replay**: If we want to replay physics accurately, we need to store physics parameters and forces as events, not just final positions. Is this worth the complexity?

5. **Multiplayer collision ethics**: If Alex drags a tile into TJ's tile and pushes it across the canvas, is that acceptable behavior? Should there be a "lock my tile" option?
