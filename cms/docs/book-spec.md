# book.

## Vision & Positioning

**One-liner**: book is how field teams navigate spacetime together.

**Target user**: Figma employees in customer-facing roles (Sales, Solutions, Onboarding, Customer Success) who need to coordinate time across people and timezones with minimal friction.

**Problem**: Calendar tools are dense, conflict-prone, and timezone-hostile. They present raw datetime data that requires constant mental translation. Overlapping events are treated as normal. Coordination requires manual effort. The result is entropy — double-bookings, timezone mistakes, scattered context, and meetings with no memory.

**Position**: book replaces the calendar paradigm with spacetime. Time flows linearly and cannot overlap. Every moment is a rich, living artifact — not a dumb time block. The system resolves conflicts through presence, not user labor. Information about each moment accumulates automatically and persists as a narrative record.

### Principles

- **Focus is sacred** — one moment at a time, one place at a time
- **Time flows linearly** — no overlaps, no parallel timelines
- **You can't be in two places at once** — presence resolves conflicts
- **Moments matter** — every event is a rich, individuated artifact
- **Great things are made together** — multiplayer coordination is native
- **Hypermedia is the engine of application state** — semantic, progressive, link-driven
- **Dark skies, quiet cities, art** — aesthetic constraint: calm, data-dense, beautiful

---

## Core Concepts

### Space

The viewport. Renders the focused moment's data. Updates dynamically as focus moves along Time. Space is where users read, interact with, and manipulate moment data.

### Time

A linear, single-row array of moments. The navigation spine. Users move focus forward/backward through Time; the focused moment drives Space. Time enforces the no-overlap constraint: every point in a user's time belongs to at most one moment.

### Moment

The atomic unit. A discrete, data-rich calendar event with:

- **Identity**: Title, cover media (image/gif/video), visual identity
- **Temporal**: Start, end, duration — non-overlapping within any user's Time
- **Access**: Public, Internal, Private/invite-only
- **Participants**: People involved + their presence state
- **Links/Resources**: First-class hyperlinks to external resources (Zoom, docs, etc.)
- **Status**: Inline select, configurable per team needs
- **Memories**: Append-only event stream recording the moment's full lifecycle — creation, edits, messages, link clicks, joins/leaves, transcripts, artifacts. The conversational/narrative thread.
- **Relations**: Moments can relate to other moments (recurring cadences, follow-ups, series)

### Presence

A user's declared relationship to a moment in time. Not just "attending/not attending" but temporally granular: "joining first half," "arriving 10 min late," "leaving early for Moment B." Visible to all participants. The mechanism by which overlaps are resolved without changing the moment's root time.

Data shape: `{ joinTime, leaveTime, note }`

### Memories

The moment's living record. An append-only stream of typed events:

- **System events**: created, edited, status changed, participant added/removed
- **User messages**: threaded conversation within the moment
- **Activity signals**: link clicks, joins, leaves, screen shares started
- **Artifacts**: transcripts, recordings, notes saved post-hoc

---

## User Model

**Identity**: Figma SSO via existing Accounts collection. Each user has a Figma identity (handle, email, avatar) provisioned through the OAuth flow.

**Roles**: All users are peers in book — no admin/editor/viewer hierarchy within the product. CMS-level admin access (for managing collections, debugging) uses the existing Users RBAC.

### Jobs to Be Done

- See my upcoming moments with zero timezone math
- Create a moment and invite people with conflict-free guarantee
- Understand what's happening in a moment before, during, and after it occurs
- Coordinate recurring touchpoints without static scheduling
- Catch up on moments I missed via their memory stream

---

## Feature Set & Scope

### v1 — Must Have

- **Moment CRUD** — create, view, edit, delete moments with all core fields
- **Time navigation** — linear traversal, focus/tab between moments, focused moment drives Space
- **Conflict prevention** — system enforces no-overlap; surfaces conflicts at creation time
- **Presence** — declare and view temporal presence per moment (rich object: join time, leave time, note)
- **Memories** — auto-generated event stream per moment (system events + user messages)
- **Cover media** — image/gif/video per moment, stored via existing Media collection
- **Semantic time display** — natural rhythms (dawn/morning/afternoon/evening), sun/moon phase indicators, collapsed non-working hours
- **Cross-timezone coordination** — global semantic time, timezone slider for multi-timezone awareness
- **Links/resources** — first-class hyperlinks attached to moments
- **Participant management** — invite, accept, decline with presence granularity
- **Clipboard export** — CMD+C copies focused moment as markdown to clipboard. Focus determines content. Zero-overhead context sharing.

### v1 — Nice to Have

- Moment relations (series, follow-ups, parent-child)
- Rich memory types (transcripts, artifact attachments)

### Future (Pinned)

- Recurring moment cadences with system-driven coordination
- Custom status workflows (Linear-style per-team configuration)

### Out of Scope / Non-Goals

- **Notifications** — book is a quiet system. No push, no email, no alerts.
- **Calendar import** (Google Calendar, Outlook)
- Multiple view modes / layout options — system handles this
- Traditional calendar grid views (day/week/month grids)
- Resource booking (rooms, equipment)
- Gantt charts, project management, task tracking
- Public/external-facing features — internal tool only

---

## Information Architecture

### Navigation

Time is the primary nav. A single horizontal row of moments. User tabs/arrows to move focus. The focused moment populates Space.

### Space Layout

System-determined. Renders the focused moment's data — cover media, title, temporal info, participants + presence, links, status, and the memory stream. No user-configurable layouts.

### Time Display

Natural rhythms replace raw hours.

- **Phases**: Resting/Away → Dawn → Morning → Afternoon → Evening
- **Visual encoding**: Sun/moon phase icons for local time
- **Timezone handling**: Global semantic time as primary; a slider reveals equivalent local times across all participant timezones
- **Working hours**: Non-working hours collapse by default, expanding active blocks to fill the viewport
- **Date/time augmentation**: Traditional datetime is accessible but secondary — a supporting detail, not the organizing principle

---

## Data Model

book gets its own section in the CMS. New collections (replacing `Events`):

### Moments (collection)

The core entity.

- `title` (text, required)
- `cover` (relationship → Media) — image/gif/video used as visual identity
- `start` (date, required) — moment start time (UTC)
- `end` (date, required) — moment end time (UTC)
- `duration` (number, virtual) — derived from start/end
- `access` (select: public, internal, private)
- `status` (select: inline, options TBD per team needs)
- `links` (array of {label, url}) — first-class hyperlinks
- `participants` (array of {account → Accounts, presence: {joinTime, leaveTime, note}}) — who's involved + their temporal presence declarations
- `relatedMoments` (relationship → Moments, hasMany) — for recurring cadences, series, follow-ups
- `createdBy` (relationship → Accounts)

### Memories (collection)

Append-only event stream per moment.

- `moment` (relationship → Moments, required, indexed)
- `type` (select: system, message, activity, artifact)
- `content` (richText or JSON) — the event payload
- `author` (relationship → Accounts) — who/what generated this memory
- `metadata` (JSON) — flexible payload for typed events

### Existing Collections

- **Accounts** — reused as-is for identity
- **Media** — reused as-is for storage
- **Users** — reused as-is for CMS admin RBAC

### Removed

- **Events** — replaced by Moments

### Unchanged / Unrelated

- Timelines, Recordings, Logs

---

## API Schema & Access Patterns (Verified)

Smoke tested via Payload Local API (`npx tsx`) against the Figma Cloud DB Adapter. All operations confirmed working.

### REST Endpoints

- `GET /api/moments` — list/query moments
- `POST /api/moments` — create a moment
- `GET /api/moments/:id` — read a single moment
- `PATCH /api/moments/:id` — update a moment
- `DELETE /api/moments/:id` — delete a moment
- `GET /api/memories` — list/query memories
- `POST /api/memories` — create a memory
- `GET /api/memories/:id` — read a single memory
- `DELETE /api/memories/:id` — delete a memory (admin only)

All endpoints require authentication (Figma SSO JWT or User API key). Unauthenticated requests return `403`.

### Access Control

**Moments**:

| Operation | Access |
|-----------|--------|
| read | Admin/editor: all. Others: public + internal moments only (query constraint). Unauthenticated: denied. |
| create | Any authenticated user |
| update | Any authenticated user |
| delete | Admin or editor only |

**Memories** (append-only):

| Operation | Access |
|-----------|--------|
| read | Any authenticated user |
| create | Any authenticated user |
| update | **Blocked** — no updates allowed (append-only) |
| delete | Admin only |

### Moments Field Schema

```
title          text, required
cover          relationship → media
start          date (dayAndTime picker), required, UTC
end            date (dayAndTime picker), required, UTC
               validated: end must be after start
duration       number, virtual (computed: minutes between start/end)
access         select [public, internal, private], default: internal
status         select [staged, confirmed, active, completed, cancelled], default: staged
links[]        array of:
  label        text, required
  url          text, required
participants[] array of:
  account      relationship → accounts, required
  joinTime     date (dayAndTime picker)
  leaveTime    date (dayAndTime picker)
  note         text
relatedMoments relationship → moments, hasMany
createdBy      relationship → accounts, readOnly
createdAt      date, auto (timestamps)
updatedAt      date, auto (timestamps)
```

### Memories Field Schema

```
moment         relationship → moments, required, indexed
type           select [system, message, activity, artifact], required
content        richText
author         relationship → accounts
metadata       json
createdAt      date, auto (timestamps)
updatedAt      date, auto (timestamps)
```

### Admin Panel

Both collections appear under the **book** group in the Payload admin sidebar at `https://p2p-payload.figma.site/admin`. Authentication via Figma SSO.

### Local API Testing

For scripted testing without HTTP auth, use the Payload Local API:

```bash
npx tsx src/scripts/your-script.ts
```

Import pattern:

```typescript
import { getPayload } from 'payload'
import config from '@payload-config'
const payload = await getPayload({ config })
```

Local API uses `overrideAccess: true` by default — operations bypass access control. Pass `overrideAccess: false` + `user` to test access patterns.

---

## Key Interactions

### Creating a Moment

User creates → picks title, time range, participants, access level, cover media. System checks all participants' Time for overlaps. If conflict detected, surfaces it immediately with resolution options (adjust time, resolve via presence). Once staged, participants accept.

### Navigating Time

User's Time is a linear strip. Tab/arrow keys move focus. Focused moment populates Space. Time collapses non-working hours. Natural rhythm labels (dawn, morning…) orient the user. Scrolling Time moves through days.

### Resolving Conflicts

At moment creation or when a new invite arrives, system detects overlap. User resolves via presence declaration: "full attendance," "partial (first/second half)," "declining." Resolution is visible to all participants as presence state on the moment.

### Memory Accumulation

Every action on a moment (creation, edit, status change, message, link click, join/leave) appends to its Memories stream automatically. Users can also post messages directly into the stream. The stream is the moment's permanent narrative record.

### Clipboard Export

CMD+C copies the currently focused moment's data as a markdown blob to clipboard. No modal, no button — focus determines what gets copied. Target hardware: Mac/iPhone/iPad.

---

## Design Constraints & Decisions

### Technical

- Payload CMS on Figma Cloud (AWS Lambda) — existing infra
- Figma SSO via Accounts collection — existing identity
- Figma DB Adapter — Figma Cloud handles storage/persistence
- No self-managed database — persistence is fully delegated to Figma Cloud infrastructure

### Client Platform

The client application is built in **Figma Make**, not as a custom Next.js frontend or Payload admin view. Payload / Figma Cloud is the backend only (API, collections, persistence).

- **Preferred**: Figma Make Local (alpha) — design/develop the client interface directly against local project code. Tighter DX loop, code-level control.
- **Fallback**: Figma Make Cloud — build the client app in Make's cloud environment, communicating with the Payload backend via API.

Make Local is frontier tech — validate the DX before committing.

### Frontend Philosophy

- Semantic, classless HTML — no Tailwind, no class soup
- CSS variables/tokens, relative/fractional units, min/max/breakpoint-driven responsiveness
- `data-` attributes for state-driven styling where needed
- Progressive enhancement, accessible, standards-first
- State managed via event sourcing / state machine patterns — optimistic, conflict-free
- Hyperlinks as first-class connective tissue (HATEOAS-informed)

### Aesthetic

- Dark theme, FUI-inspired (Evangelion reference palette)
- Data-dense but uncluttered — calm, focused, art-forward
- Every moment is a visual artifact (cover media as identity)
- Natural/organic time representation over clinical datetime displays
