import { getPayload } from 'payload'
import config from '@payload-config'
import { getFigmaUser, isTokenExpired, refreshFigmaToken } from '@/lib/oauth/providers/figma'

/**
 * GET /api/figma/avatar?figmaId=<id>
 *
 * Streams a participant's Figma profile image (stored on their Account as
 * `avatarUrl` from /v1/me) back **same-origin** — used as the camera-off
 * placeholder live in the canvas and drawn taint-safe into recordings.
 *
 * Figma avatar URLs are signed and expire, so if the stored URL fails we
 * refresh `img_url` from /v1/me using the account's token (refreshing that too
 * if needed), persist it, and retry. Normal loads hit only the fast stored-URL
 * path and are browser-cached.
 *
 * Only ever proxies avatar URLs already tied to an Account (never a
 * caller-supplied URL), so there's no open-proxy/SSRF surface. Profile images
 * are already shown to everyone in a session, so this is readable without auth.
 */

type AccountTokens = {
  id: string
  avatarUrl?: string | null
  accessToken?: string | null
  refreshToken?: string | null
  tokenExpiresAt?: string | null
}

const CACHE_HEADER = 'public, max-age=3600'

async function streamImage(url: string): Promise<Response | null> {
  const res = await fetch(url).catch(() => null)
  if (!res || !res.ok) return null
  const buf = await res.arrayBuffer()
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') || 'image/png',
      'Cache-Control': CACHE_HEADER,
    },
  })
}

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
  const account = docs[0] as AccountTokens | undefined
  if (!account) return new Response('not found', { status: 404 })

  // Fast path: the stored (possibly cached) avatar URL.
  if (account.avatarUrl) {
    const ok = await streamImage(account.avatarUrl)
    if (ok) return ok
  }

  // Slow path: the stored URL is missing/expired — re-fetch img_url from Figma
  // with the account's token and self-heal the stored value.
  try {
    let accessToken = account.accessToken
    if (!accessToken) return new Response('no avatar', { status: 404 })

    if (account.tokenExpiresAt && isTokenExpired(account.tokenExpiresAt) && account.refreshToken) {
      const clientId = process.env.OAUTH_CLIENT_ID
      const clientSecret = process.env.OAUTH_CLIENT_SECRET
      if (clientId && clientSecret) {
        const refreshed = await refreshFigmaToken(
          { clientId, clientSecret, redirectUri: '' },
          account.refreshToken,
        )
        accessToken = refreshed.access_token
        await payload.update({
          collection: 'accounts',
          id: account.id,
          data: {
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token,
            tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
          },
          overrideAccess: true,
        })
      }
    }

    const user = await getFigmaUser(accessToken)
    if (!user.img_url) return new Response('no avatar', { status: 404 })
    if (user.img_url !== account.avatarUrl) {
      await payload.update({
        collection: 'accounts',
        id: account.id,
        data: { avatarUrl: user.img_url },
        overrideAccess: true,
      })
    }
    const ok = await streamImage(user.img_url)
    return ok ?? new Response('avatar fetch failed', { status: 502 })
  } catch (err) {
    payload.logger.error({ err }, 'figma avatar refresh error')
    return new Response('avatar error', { status: 502 })
  }
}
