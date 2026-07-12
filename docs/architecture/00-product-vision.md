# 00 — Product Vision

## What We're Building

A real-time multiplayer canvas where video, audio, and interaction feel like being in the same room — closer to a game world than a video call. Participants join a shared spatial canvas where their presence is physical: they have hands (not arrows), they hear each other based on proximity (not uniform volume), and every interaction ripples through the shared space.

## The Experience We Want

Imagine joining a session. Your cursor is a hand — your hand in this space. You see other participants' hands moving around the canvas alongside their video feeds. As you move closer to someone, their voice gets louder and their feed sharpens. You press `/` and your hand rotates, revealing a radial menu on your wrist — everyone sees it, and someone nearby reaches over to make a selection on your menu for you. You drag a feed across the canvas and it has weight — it slides with momentum, bumps into other feeds, settles with a satisfying physics. Two hands get close and they high-five. The whole space feels alive.

## Design Language

### Inspired By

- **Figma** — multiplayer cursors, real-time presence, collaborative canvas
- **FigJam** — cursor interactions (high-fives), playful expressiveness
- **RTS games** (Starcraft, Age of Empires) — cursor as identity, context-sensitive states, instant feedback
- **Sci-fi interfaces** — wrist-mounted holographic menus, gestural interaction
- **Proximity chat games** (Among Us, VRChat, Gather) — spatial audio, distance-driven experience

### Not Inspired By

- Traditional video conferencing (grid layouts, uniform audio, passive viewing)
- Desktop metaphors (windows, toolbars, dropdown menus)
- Flat 2D cursor conventions

## Core Tenets

### 1. The Cursor IS the Interface
No toolbars. No sidebars. No floating panels disconnected from the action. Every tool, every menu, every piece of UI emanates from and returns to the cursor. The hand is your identity, your tool, and your communication channel.

### 2. Everything is Multiplayer
If it's visible, it's shared. If it's interactive, anyone can interact with it. A menu I open is a surface everyone can see and touch. This isn't "multiplayer with private UI" — it's "multiplayer all the way down." This creates emergent social behaviors that feel like play, not work.

### 3. Proximity is Meaning
Distance on the canvas isn't just layout — it's semantics. Close things are loud, clear, and interactive. Far things are quiet, blurred, and ambient. This makes spatial arrangement a form of communication: moving closer to someone is an action with meaning, not just repositioning.

### 4. Physics Make It Real
Weight, momentum, collision, and gravity give the canvas a tangible quality. Interactions have consequence — dragging something feels like moving something, not just updating coordinates. This grounds the experience in physical intuition even though the space is digital.

### 5. Every Moment is Capturable
The session isn't ephemeral — it's a timeline. Every meaningful event is recorded, enabling replay, review, and reflection. Not surveillance — archaeology. "What happened in that session?" should have an answer.

## What Success Looks Like

- A new participant joins and immediately understands the space through physical intuition
- Interactions between participants happen spontaneously through proximity and gesture
- The experience feels closer to a game than a productivity tool
- Sessions can be replayed as a coherent timeline of events
- Performance never breaks the illusion — 60fps, low latency, responsive at all times
