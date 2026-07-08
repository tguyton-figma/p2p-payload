import { getPayload } from 'payload'
import config from '@payload-config'

const MAX_PARTICIPANTS = 5
const STALE_MS = 15_000

async function activePeers(
  payload: Awaited<ReturnType<typeof getPayload>>,
  sessionId: string,
  now: number,
) {
  const { docs } = await payload.find({
    collection: 'participants',
    where: {
      and: [{ session: { equals: sessionId } }, { lastSeen: { greater_than: now - STALE_MS } }],
    },
    limit: 50,
    depth: 0,
  })
  return docs
}

/**
 * GET /api/sessions/[id]/participants — active peer IDs in the room.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const payload = await getPayload({ config: await config })
  const now = Date.now()
  const peers = (await activePeers(payload, id, now)).map((d) => d.peerId)
  return Response.json({ peers })
}

/**
 * POST /api/sessions/[id]/participants — register or heartbeat a peer.
 * Body: { peerId }. Bumps lastSeen on the peer's own row (creating it on first
 * call). Enforces the room cap: a NEW peer is rejected with 409 when the room is
 * already full; an existing peer's heartbeat is always accepted.
 * Returns { peers } — the active roster including self.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { peerId } = (await request.json()) as { peerId: string }
  if (!peerId) return Response.json({ error: 'peerId is required' }, { status: 400 })

  const payload = await getPayload({ config: await config })
  const now = Date.now()

  const existing = await payload.find({
    collection: 'participants',
    where: { and: [{ session: { equals: id } }, { peerId: { equals: peerId } }] },
    limit: 1,
    depth: 0,
  })

  if (existing.docs.length) {
    await payload.update({
      collection: 'participants',
      id: existing.docs[0].id,
      data: { lastSeen: now },
    })
  } else {
    const active = await activePeers(payload, id, now)
    if (active.length >= MAX_PARTICIPANTS) {
      return Response.json(
        { error: `Session is full (max ${MAX_PARTICIPANTS}).`, full: true },
        { status: 409 },
      )
    }
    await payload.create({
      collection: 'participants',
      data: { session: id, peerId, lastSeen: now },
    })
  }

  const peers = (await activePeers(payload, id, now)).map((d) => d.peerId)
  return Response.json({ peers })
}

/**
 * DELETE /api/sessions/[id]/participants?peerId=<peerId> — leave the room.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const peerId = new URL(request.url).searchParams.get('peerId')
  if (!peerId) return Response.json({ error: 'peerId is required' }, { status: 400 })

  const payload = await getPayload({ config: await config })
  await payload.delete({
    collection: 'participants',
    where: { and: [{ session: { equals: id } }, { peerId: { equals: peerId } }] },
  })
  return Response.json({ ok: true })
}
