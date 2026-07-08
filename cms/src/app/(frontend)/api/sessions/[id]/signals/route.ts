import { getPayload } from 'payload'
import config from '@payload-config'
import type { Signal } from '@/payload-types'

/**
 * GET /api/sessions/[id]/signals?to=<peerId> — signaling messages addressed to
 * a given peer. Peers poll this and dedupe by document id. Ordered oldest-first
 * so an offer/answer is processed before the candidates that follow it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const to = new URL(request.url).searchParams.get('to')
  if (!to) return Response.json({ error: 'to is required' }, { status: 400 })

  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({
    collection: 'signals',
    where: { and: [{ session: { equals: id } }, { to: { equals: to } }] },
    sort: 'createdAt',
    limit: 1000,
    depth: 0,
  })

  const signals = docs.map((d) => ({ id: d.id, from: d.from, kind: d.kind, data: d.data }))
  return Response.json({ signals })
}

/**
 * POST /api/sessions/[id]/signals — append one signaling message.
 * Body: { from, to (peer IDs), kind: 'offer'|'answer'|'candidate', data }.
 * Append-only inserts never race, so no signal is ever lost.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const payload = await getPayload({ config: await config })

  const { from, to, kind, data } = (await request.json()) as {
    from: Signal['from']
    to: Signal['to']
    kind: Signal['kind']
    data: Signal['data']
  }

  if (!from || !to || !kind) {
    return Response.json({ error: 'from, to and kind are required' }, { status: 400 })
  }

  const signal = await payload.create({
    collection: 'signals',
    data: { session: id, from, to, kind, data },
  })

  return Response.json({ id: signal.id })
}
