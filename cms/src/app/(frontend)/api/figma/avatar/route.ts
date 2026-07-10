import { getPayload } from 'payload'
import config from '@payload-config'

/**
 * GET /api/figma/avatar?figmaId=<id>
 *
 * Streams a participant's Figma profile image (stored on their Account as
 * `avatarUrl` from /v1/me) back **same-origin**. Used as the camera-off tile
 * placeholder — live in the canvas, and drawn into the recording (where serving
 * from our own origin keeps the capture canvas untainted).
 *
 * We only ever proxy avatar URLs already stored on an Account (never a
 * caller-supplied URL), so there's no open-proxy/SSRF surface. Profile images
 * are already shown to everyone in a session, so this is intentionally readable
 * without auth to keep guests' view consistent.
 */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const figmaId = searchParams.get('figmaId')
  if (!figmaId) return new Response('figmaId required', { status: 400 })

  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({
    collection: 'accounts',
    where: { figmaId: { equals: figmaId } },
    limit: 1,
    overrideAccess: true,
    depth: 0,
  })
  const avatarUrl = (docs[0] as { avatarUrl?: string | null } | undefined)?.avatarUrl
  if (!avatarUrl) return new Response('not found', { status: 404 })

  try {
    const res = await fetch(avatarUrl)
    if (!res.ok) return new Response('avatar fetch failed', { status: 502 })
    const buf = await res.arrayBuffer()
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'image/png',
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (err) {
    payload.logger.error({ err }, 'figma avatar error')
    return new Response('avatar error', { status: 500 })
  }
}
