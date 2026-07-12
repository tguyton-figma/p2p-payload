# 02 — Cursor System

> **Reconciled with DECISIONS.md (2026-07-12):** The hand cursor is the **always-present anchor**
> of a **single identity** that projects into many forms (feed, avatar, staging silhouette) —
> identity is bound to the Payload **`Accounts`** collection (Q13). Rendering is **sprite-atlas
> only, no Rive/new platform** (Q11 leanness). Foundational expressions (high-five, wave, pings)
> are typed **core** events; the long tail lives in the open **`ext.*`** tier (Q19). Menu
> activation is **anyone-can-activate (Q9 = B)**; see spec 03.

## The Vision

The cursor is not a pointer — it's a hand. Your hand in this space. It shows gesture, rotation, and intent. It carries your tools. It's how you communicate, interact, and express. Other participants see your hand moving in real time, and their hands are visible to you. When two hands get close, things happen.

## Rendering Approach

### Recommendation: Sprite Atlas Everywhere (Zero New Dependencies)

We deliberately avoid pulling a new animation platform (Rive, Lottie, etc.) into the stack. Keeping dependencies lean is a first-order goal, and a pre-rendered sprite atlas gives us everything we need using only image assets served from Payload CMS and rendering primitives we already have.

**Both local and remote cursors** use the same technique:
- Pre-render the hand from a 3D model (Blender) across all gesture × rotation combinations
- Pack every frame into a single texture atlas (PNG/WebP), stored in Payload CMS Media
- ~6-8 gestures × 16-24 rotation angles = 96-192 frames in one image, loaded once per session
- Display the right frame by offsetting into the atlas — either a DOM element with `background-position`, or a quad in a canvas/WebGL layer
- Gesture and rotation arrive as presence data (local from input, remote from broadcast) and map to an atlas frame via a lookup table

This is exactly how RTS games (Starcraft, Age of Empires, Warcraft) handled cursors and units: pre-rendered sprites, frame-perfect state changes, effectively free at runtime. It scales to 50+ cursors trivially.

**Handling the "discrete frames" concern**:
The one thing sprites lose versus a live vector/3D renderer is continuous interpolation — rotation snaps between the pre-rendered angles rather than sweeping smoothly. We close that gap in code, with no new dependency:
- **Position**: spring/lerp interpolation between received positions gives smooth 60fps motion from 20Hz network updates (this is needed regardless of rendering technique).
- **Rotation**: 24 angles = 15° steps, which reads as smooth at cursor scale; if we want smoother, we render more angles (cheap — just more frames in the atlas) or apply a small CSS `rotate()` on top of the nearest sprite frame to bridge the gap.
- **Gesture transitions**: pre-render a few in-between frames for the common transitions (point→grab), or accept a crisp snap — RTS cursors snapped and felt responsive, not janky.

### If We Ever Need More: WebGL Overlay Layer

If we later add physics-driven visual effects (particles, glow, impact ripples), we'd introduce a Three.js / WebGL overlay canvas with `pointer-events: none` layered over React Flow. At that point, cursor rendering could move into this layer using instanced meshes or sprite geometry — reusing the *same atlas* we already built, just sampled by a shader instead of the DOM. Three.js would be the one heavier dependency we take on, and only when effects justify it. This is an upgrade path, not a starting requirement.

## Rendering Integration with React Flow

The cursor layer sits above React Flow in the DOM:

```
<div class="session-container" style="cursor: none">
  <ReactFlow>                          <!-- existing canvas -->
    <MediaNode />
    <FigmaEmbedNode />
  </ReactFlow>
  <div class="cursor-layer">           <!-- new overlay, pointer-events: none -->
    <LocalCursor />                    <!-- sprite element, follows mouse -->
    {remoteCursors.map(c =>
      <RemoteCursor key={c.id} />      <!-- sprite element, interpolated position -->
    )}
  </div>
</div>
```

The cursor layer is a sibling of React Flow, absolutely positioned to fill the same viewport. `pointer-events: none` ensures clicks pass through to React Flow nodes. The native cursor is hidden via `cursor: none` on the container.

## Gesture States

The hand cursor has a finite set of gesture states, each representing a mode or action:

| Gesture | When | Visual |
|---------|------|--------|
| `point` | Default idle state | Index finger extended, relaxed hand |
| `open` | Hovering over interactive element | Open palm, fingers spread |
| `grab` | Dragging a tile or object | Closed fist, gripping |
| `pinch` | Precision interaction (resize, rotate) | Thumb and index pinching |
| `present` | Menu is open (cursor-as-UI mode) | Hand rotated, palm up, menu on wrist |
| `react` | Triggered interaction (high-five, wave) | Context-dependent animation |
| `idle` | No mouse movement for N seconds | Subtle breathing animation |

Gesture transitions are driven by user input and canvas context:
- Mouse enters an interactive node → `point` → `open`
- Mouse down on a draggable node → `open` → `grab`
- Mouse up after drag → `grab` → `point`
- Press `/` or right-click → `point` → `present` (menu opens)
- Two cursors cross proximity threshold → both → `react`

## Cursor-as-UI: The Radial Menu

When a participant activates the menu (press `/`, right-click, or designated gesture), the hand transitions to the `present` gesture — palm rotated upward — and a **radial menu** fans out from the wrist area.

### Menu Properties
- **Anchored to cursor**: the menu moves with the hand
- **Radial layout**: items arranged in a circle/arc around the wrist
- **Directional selection**: move toward an item to highlight it, release/click to select
- **Multiplayer visible**: the menu and its state are broadcast as presence data
- **Multiplayer interactive**: any participant can hover over and select items on anyone's menu (see [03-multiplayer-ui.md](03-multiplayer-ui.md))

### Menu State in Presence Data

When a menu is open, the presence message includes:
```typescript
{ t: 'm'; open: true; items: ['share-screen', 'add-camera', 'react', 'settings'] }
```

Remote clients render the radial menu at the cursor's position using the same item list. Hover state on menu items is itself a presence broadcast, so everyone sees which item is being considered.

## Cursor Interactions

### Proximity Triggers

When two cursors come within a configurable distance threshold:

1. **Detection**: distance check runs every frame in `requestAnimationFrame` — O(N²) for N cursors, trivial for <50 participants
2. **Visual signal**: both cursors show a subtle "awareness" effect (glow, tilt toward each other)
3. **Interaction trigger**: if both participants perform a gesture (e.g., both wiggle, or both open palm), trigger a shared animation
4. **Broadcast**: the interaction is an L2 session event, not just presence — it's meaningful and replayable

### Interaction Types (Initial Set)

| Trigger | Both Gestures | Animation |
|---------|--------------|-----------|
| Proximity + wiggle | Any | High-five between both hands |
| Proximity + open palm | Both open | Fist bump |
| Point at another cursor | Point + any | "Look here" ping |

### Interaction as Event

```typescript
{
  type: 'cursor:interact',
  actor: 'tj',
  payload: {
    partner: 'alex',
    interaction: 'high-five',
    position: { x: 400, y: 300 },
    partnerPosition: { x: 420, y: 310 }
  }
}
```

## Network Protocol

### Presence (Layer 1 — Lossy Data Channel)

**Topic**: `presence`
**Frequency**: Local cursor broadcasts at 20Hz (50ms intervals), throttled from 60fps input
**Interpolation**: Remote clients interpolate between received positions using spring physics to achieve smooth 60fps rendering from 20Hz input

**Message shape** (compact, ~40 bytes):
```typescript
{
  t: 'c',                    // type: cursor
  x: number,                 // canvas X (float32)
  y: number,                 // canvas Y (float32)
  g: number,                 // gesture enum (uint8)
  r: number,                 // rotation angle (float32, radians)
  m: 0 | 1,                  // menu open (bit flag)
  h: string | null            // hover target node ID
}
```

### Encoding

For maximum efficiency, encode as a binary `ArrayBuffer` rather than JSON:
- 1 byte: message type
- 4 bytes: x (float32)
- 4 bytes: y (float32)
- 1 byte: gesture
- 4 bytes: rotation (float32)
- 1 byte: flags (menu open, dragging, etc.)
- Total: ~15 bytes per update

At 20Hz × 20 participants = 400 messages/sec × 15 bytes = **6 KB/sec** — well within data channel capacity.

## Asset Pipeline

### Sprite Atlas

1. **Design**: Model the hand in Blender with gesture poses
2. **Render**: Capture from 16-24 rotation angles per gesture
3. **Pack**: Combine all frames into a single texture atlas (PNG or WebP)
4. **Upload**: Store in Payload CMS Media collection with metadata (gesture names, angle count, frame dimensions)
5. **Serve**: CDN-cached, content-hash URL, loaded once per session
6. **Map**: Client-side lookup table maps `(gesture, rotation)` → sprite atlas coordinates

### Local Cursor Smoothing (No Separate Asset)

The local cursor uses the **same atlas** as remote cursors — there is no second asset format to build or maintain. The difference is purely in how state is sourced and smoothed:
- Gesture/rotation come from local input (mouse, keyboard, canvas context) with zero network latency
- Rotation between pre-rendered angles is bridged with a small CSS `rotate()` on the nearest frame
- Gesture changes can use a short CSS cross-fade between the two atlas frames for a soft transition
- All of this is a handful of lines of code against assets we already have — no runtime library

## Open Questions

1. **Hand style customization**: Should participants be able to choose their hand style/skin? This multiplies the asset requirements but adds personalization.

2. **Accessibility**: How do we handle participants who need a traditional cursor? Offer a "flat mode" toggle that renders a 2D cursor with the same state information?

3. **Mobile/touch**: How does the hand cursor translate to touch input? The cursor position would follow the touch point, but gestures would need different triggers (long press = grab, double tap = menu).

4. **Z-ordering**: When cursors overlap, which hand renders on top? Follow React Flow's z-index model, or always render the local cursor on top?

5. **Atlas dimensions**: How many gestures and rotation angles do we actually need? More angles = smoother rotation but larger atlas. Start with 8 gestures × 16 angles and tune from real use?

6. **Recorder view rendering**: The recorder view (see [08-recording-muxing.md](08-recording-muxing.md)) has no local cursor and renders all cursors from broadcast presence. The sprite approach handles this cleanly — every cursor, including what would be the "local" one, is just a sprite driven by presence data. Confirm the local/remote code paths converge here.
