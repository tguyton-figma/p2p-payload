# 03 — Multiplayer UI

> **Reconciled with DECISIONS.md (2026-07-12) — Q9:** default is **B: anyone can activate any
> item on anyone's menu** (full co-op). The tiered/owner-only/suggestion model described later in
> this doc is demoted to **C: a rare, exceptional escape hatch — ideally never used.** Emergent/
> awkward states (e.g. someone triggers a destructive action on you) are solved with **creative,
> playful mechanics** (two-hand confirm, instant multiplayer undo, reversible-by-default, visible
> attribution) — NOT permission gates. Reach for a gate only if no fun mechanic can make the state
> acceptable. See spawned Q9a (destructive-action mechanic) + Q9b (multiplayer undo/attribution).

## The Principle

If it's visible, it's shared. If it's interactive, anyone can interact with it.

This is the most radical departure from conventional application design. In every existing tool — Figma included — UI elements like menus, dialogs, and tool palettes are private to the participant who opened them. We reject that. When you open a menu, everyone in the session sees it, and anyone can interact with it.

## Why This Matters

This creates a fundamentally different social dynamic:
- **Collaboration becomes physical** — helping someone isn't "tell me what to click," it's reaching over and clicking it
- **Teaching is embodied** — a mentor can literally guide a learner's hand through a workflow
- **Decision-making is visible** — when someone is choosing an option, everyone sees the deliberation
- **Serendipity happens** — someone notices a menu open and offers a suggestion by hovering over an option

This is also why performance matters so much. Every UI element is now a multiplayer surface, which means every UI interaction generates presence data that must propagate in real time.

## What "Multiplayer UI" Means Technically

### Shared State, Not Shared Components

We do NOT render the same React component on every client with synchronized props. Instead:

1. The participant who opens a UI surface broadcasts its **specification** (what items, what position) as presence data
2. Every client independently renders the UI from that specification
3. Interaction with the UI (hover, select) broadcasts back as presence data
4. The originator processes selections; other participants observe

This keeps rendering local and fast while sharing state over the network.

### UI Surfaces as Canvas Nodes

Every multiplayer UI surface is conceptually a **canvas node** — it has a position, a size, and an owner. It renders in the cursor layer (above React Flow) but participates in the same spatial model.

```typescript
interface SharedUISurface {
  id: string                       // unique surface ID
  owner: string                    // participant who opened it
  type: 'radial-menu' | 'context-panel' | 'reaction-picker'
  anchorType: 'cursor' | 'fixed'  // moves with cursor or stays put
  position: { x: number; y: number }
  spec: UISpec                     // type-specific content definition
  state: UIState                   // current interaction state
}
```

### Interaction Model

Any participant can interact with any shared UI surface:

1. **Hover**: participant's cursor enters a UI surface's hit area → broadcast hover presence
2. **Highlight**: the surface shows who is hovering where (each participant's highlight is colored to match their cursor)
3. **Select**: participant clicks/confirms on a surface item → broadcast as L2 event
4. **Response**: the surface owner (or the system) processes the selection

Multiple participants can hover different items simultaneously. Selection follows a simple rule: **first click wins** — if two participants click the same item at the same time, the first received selection is processed.

## The Radial Menu as First Multiplayer UI

The cursor's radial menu (see [02-cursor-system.md](02-cursor-system.md)) is the first and primary multiplayer UI surface.

### When TJ Opens a Menu

**TJ's client**:
1. TJ presses `/` → gesture transitions to `present`
2. Menu spec generated: `{ items: ['share-screen', 'add-camera', 'react', 'settings'] }`
3. Broadcast presence: `{ t: 'm', open: true, items: [...] }`
4. Render radial menu anchored to cursor position

**Alex's client** (remote):
1. Receives TJ's presence with menu state
2. Renders TJ's radial menu at TJ's cursor position (using TJ's presence coordinates)
3. Menu is interactive — Alex's cursor can hover over items
4. Alex hovers over "add-camera" → Alex's hover state broadcasts as presence
5. TJ sees Alex's cursor highlighting "add-camera" on TJ's menu

**Alex Selects an Item**:
1. Alex clicks "share-screen" on TJ's menu
2. Selection broadcast as L2 event: `{ type: 'ui:select', actor: 'alex', payload: { surface: 'tj-menu', item: 'share-screen' } }`
3. System processes: Alex starts screen sharing (the action happens for Alex, since it was Alex who selected it)
4. TJ's menu remains open — TJ can still make their own selection

### Permission Model

Not every menu item can be activated by someone else. The system needs a permission layer:

| Item Type | Anyone Can Select? | Example |
|-----------|-------------------|---------|
| **Self-action** | Only the menu owner | "Leave session", "Toggle my camera" |
| **Shared action** | Anyone | "Add Figma embed", "Start recording" |
| **Suggestion** | Anyone, but owner confirms | "Share your screen?" (appears as a request) |

Items that only the owner can activate still show hover highlights from other participants (so the owner sees "Alex is looking at 'Leave session'" as social context), but clicks from non-owners are either ignored or converted to suggestions.

## Data Flow

### Presence Layer (L1 — Ephemeral)

UI surface state rides on the existing cursor presence channel:

```typescript
// Menu open — broadcast by owner
{ t: 'm', open: true, items: ['share-screen', 'add-camera', 'react'] }

// Menu hover — broadcast by any participant hovering
{ t: 'mh', surface: 'tj-menu', item: 'share-screen' }

// Menu close — broadcast by owner
{ t: 'm', open: false }
```

### Event Layer (L2 — Persisted)

Selections and meaningful interactions are L2 events:

```typescript
{
  type: 'ui:menu:open',
  actor: 'tj',
  position: { x: 400, y: 300 },
  payload: { items: ['share-screen', 'add-camera', 'react'] }
}

{
  type: 'ui:menu:select',
  actor: 'alex',
  position: { x: 420, y: 310 },
  payload: { surface: 'tj-menu', item: 'share-screen', owner: 'tj' }
}
```

## Extending Beyond Menus

The multiplayer UI pattern extends to any interactive surface:

### Reaction Picker
A participant opens a reaction picker → everyone sees it → anyone picks a reaction → the reaction animates at that position on the canvas for everyone.

### Property Inspector
A participant selects a canvas node → a property panel appears anchored to the node → anyone can adjust properties (size, position, settings) → changes apply immediately and broadcast as events.

### Tool Palette
A participant switches tools → their cursor gesture changes → if they open a sub-tool menu, it's shared → another participant could select a different tool variant for them.

## Performance Constraints

### Why This is Hard

Every multiplayer UI surface adds:
- Presence data: surface spec + hover state × N participants
- Rendering: N remote cursors potentially interacting with N surfaces
- Hit testing: every cursor position must be tested against every open surface

### Why This is Tractable

- **Surfaces are sparse**: at any given moment, maybe 1-3 menus are open across the whole session
- **Hover is cheap**: it's just a position-in-rectangle test, same as cursor proximity checks
- **State is small**: a radial menu spec is ~100 bytes, hover state is ~20 bytes
- **Presence is already flowing**: we're already broadcasting cursor position 20x/sec; adding a menu flag and hover target adds ~10 bytes per message

### Budget

- Max concurrent open UI surfaces: design for **5** (more than enough for any real session)
- Additional presence data per surface: ~30 bytes/message × 20Hz = **600 bytes/sec per participant**
- Additional rendering: one DOM element per surface with CSS-driven hover highlights

## Open Questions

1. **Conflict resolution**: What happens when two participants select different items on the same menu simultaneously? First-write-wins? Or should selections queue?

2. **Surface lifetime**: When the owner moves their cursor away, does the menu follow? Stay in place? Close after a timeout?

3. **Nested menus**: If a menu item opens a sub-menu, is the sub-menu also multiplayer? (Yes, by principle — but this adds complexity.)

4. **Undo semantics**: If Alex selects an action on TJ's menu, who can undo it? Alex (the actor) or TJ (the owner)?

5. **Visual differentiation**: How do we visually communicate "this menu belongs to TJ but you can interact with it"? Color coding? Owner's cursor/hand style on the menu border?
