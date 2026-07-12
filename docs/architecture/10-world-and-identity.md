# 10 — World & Identity

> New in the Round-2 reconciliation (2026-07-12). Home for the "world/people" layer decided in
> Q12, Q13, Q16, Q17, Q18 (and the deferred Q14 lifecycle, Q15 staging). Authoritative decisions
> in `DECISIONS.md`.

## Design Philosophy

Actions are the atomic unit; rich multiplayer experiences **emerge** from composing actions and **enriching individual moments** with smart, coherent state transformation. We design the *moments* — arrival, staging, joining, leaving — not just the function. Reject the "flatten to utility" pattern of current tools.

## Identity (Q13)

- **Single unified identity**, bound to the Payload **`Accounts`** collection — the canonical identity store across the whole app.
- **Many projections of one entity**: the **hand cursor is the always-present anchor**; a **media feed** attaches when publishing; an **avatar** shows when camera-off; a **staging silhouette** represents the pre-join state. All share the identity's color/name so a person reads as one being across states.
- **Extend `Accounts`** for rich identity config: preferences, uploaded assets (custom hand skins, avatars), universal app config, capabilities.
- **User "memory"** — a per-user projection over their own event history (spec 04 log): a durable, personal sense of what they've done/experienced (personalization, continuity).
- **Guests** (`anon-*`) are ephemeral/limited; full identity requires an Account.
- Open: identity schema details, color assignment (system vs chosen, distinct-per-session), memory model (Q13a–d).

## Sessions (Q12, Q17)

### Ephemeral (Q12)
A session is an **ephemeral call** — it exists only while occupied; empty → gone. No persistent rooms. **History/revisiting is served by recordings** (the event log + captured video), not by durable places. Staging and portals operate between *live* sessions, so they don't need persistence.

### Config-driven (Q17, Q2)
Sessions are configurable "rooms." Config must scale coherently — keep axes clean, not tangled. Distinct axes:
- **Access — anonymous**: allow unauthenticated/anonymous users? (today's open/closed toggle)
- **Access — audience**: any authenticated user vs only within your **tenant/organization**
- **Discoverability**: private-link / unlisted / public-in-directory (access control and discoverability are *separate* axes)
- Plus behavior config from other decisions: camera/focus mode (Q2), proximity params (spec 05), who/what recording is allowed (Q3), cursor/expression/physics toggles.

### Semantic addressing (Q17) — "the app talks to you"
- Every session has a **hidden backend UUID** (system builds with it; never user-facing).
- Auto-generate a **semantic handle** (human alias) used to join.
- **URL routes use the handle as slug**; a share link is a route whose slug is the handle.
- **Rename anytime**: UUID is stable, handles are aliases → support **aliasing + redirects** (old handle → current). Keeps the semantic system ergonomic across many live/stitched sessions.
- Open: handle-generation algorithm + collision/safety (Q17b), alias/redirect storage (Q17c), tenant/org model (Q17d), directory UX (Q17e).

## Arrival & Departure (Q16)

First-class, configurable, **recordable events** — not mere animation:
- `core.participant.arrived` / `core.participant.departed` carry an **entrance/exit style** (data-driven choreography: knock / footsteps / flourish / greeting — options defined later).
- Configurable per session; part of history/replay + recordings.
- Doubles as the **portal traversal transition** (below).

## Topology: Portals & Sub-sessions (Q18)

Edge-based off-screen stitching was **dropped** (too complex). Replaced with **portals**:
- A **portal is a canvas node** (like media/embed nodes) carrying a target session ref (UUID/handle). Multiplayer-visible (everything-multiplayer, Q9).
- Moving your cursor into / activating a portal triggers a **room handoff** — leave the current LiveKit room, join the linked one — reusing the arrival/departure choreography (Q16) as the transition.
- **Sessions interlink as a graph** via portal links (not spatial adjacency).
- **Sub-sessions / breakouts** spawn *within* a session and surface as a portal — conceptually like breakout rooms, portal-navigated. Sessions-within-sessions = a hierarchy.
- Lean: a participant is in **exactly one session at a time**.
- Open: portal data model (Q18a), hierarchy/nesting + sub-session lifecycle (Q18b), traversal mechanics / pre-connect + publish handoff (Q18c), who-can-spawn + permissions (Q18d).

## Deferred (need more design)

- **Q14 — Participant lifecycle states**: candidate Discovering → Staging → (Arriving) → Present → (Observing) → (Leaving) → Departed. Open whether Arriving/Leaving are states vs choreography, and whether Observing is a mode of Present.
- **Q15 — Staging as canvas presence**: confirmed *wanted* (embodied pre-join presence, not an invisible count). Candidate: outward = silhouettes/vignettes in a threshold zone; inward = privacy-gated peek (metadata always, live preview only if config/consent allows). Design TBD.
