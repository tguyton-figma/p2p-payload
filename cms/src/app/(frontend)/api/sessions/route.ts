import { getPayload } from 'payload'
import config from '@payload-config'

/**
 * POST /api/sessions — create a new session (the call anchor).
 * Returns { id }. Peers then exchange signaling via
 * /api/sessions/[id]/signals (append-only messages).
 */
export async function POST() {
  const payload = await getPayload({ config: await config })

  const session = await payload.create({
    collection: 'sessions',
    data: { status: 'waiting' },
  })

  return Response.json({ id: session.id })
}
