import { getPayload } from 'payload'
import config from '@payload-config'
import { getAccountFromRequest } from '@/lib/oauth/server/account-auth'
import { isTokenExpired, refreshFigmaToken } from '@/lib/oauth/providers/figma'

/**
 * GET /api/figma/render?fileKey=..&nodeId=..&scale=2
 *
 * Renders a Figma node (or the file thumbnail) to PNG using the signed-in
 * account's Figma OAuth token, then streams the bytes back **same-origin**. The
 * session recorder draws these onto its capture canvas; serving them from our own
 * origin (rather than Figma's S3 URL) keeps the canvas untainted so
 * `captureStream()` keeps working.
 *
 * Access follows Figma's own permissions: the render only succeeds for files the
 * signed-in user (the recording host) can see. Anything else returns non-2xx and
 * the recorder falls back to a labeled placeholder.
 */

const FIGMA_API = 'https://api.figma.com/v1'

type TokenFields = {
  accessToken?: string | null
  refreshToken?: string | null
  tokenExpiresAt?: string | null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const fileKey = searchParams.get('fileKey')
  const nodeId = searchParams.get('nodeId')
  if (!fileKey) return new Response('fileKey required', { status: 400 })

  // Clamp scale to Figma's accepted range (0.01–4).
  const scale = Math.min(4, Math.max(0.01, Number(searchParams.get('scale')) || 2))

  const payload = await getPayload({ config: await config })
  const account = await getAccountFromRequest(payload, request.headers)
  if (!account) return new Response('Sign in required', { status: 401 })

  // Re-fetch with overrideAccess to read the read-protected token fields
  // (payload.auth may hand back a redacted user).
  const { docs } = await payload.find({
    collection: 'accounts',
    where: { id: { equals: account.id } },
    limit: 1,
    overrideAccess: true,
    depth: 0,
  })
  const full = docs[0] as (typeof docs)[0] & TokenFields
  if (!full?.accessToken) return new Response('No Figma token', { status: 401 })

  let accessToken = full.accessToken

  // Refresh an expired token before calling Figma.
  if (full.tokenExpiresAt && isTokenExpired(full.tokenExpiresAt) && full.refreshToken) {
    const clientId = process.env.OAUTH_CLIENT_ID
    const clientSecret = process.env.OAUTH_CLIENT_SECRET
    if (!clientId || !clientSecret) return new Response('OAuth not configured', { status: 500 })
    try {
      const refreshed = await refreshFigmaToken(
        { clientId, clientSecret, redirectUri: '' },
        full.refreshToken,
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
    } catch (err) {
      payload.logger.error({ err }, 'figma render: token refresh failed')
      return new Response('Token refresh failed', { status: 401 })
    }
  }

  try {
    // Resolve the source PNG URL from Figma: a specific node when we have one,
    // otherwise the file's thumbnail.
    let imageUrl: string | null = null
    if (nodeId) {
      const url = `${FIGMA_API}/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(
        nodeId,
      )}&format=png&scale=${scale}`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!res.ok) return new Response('render failed', { status: res.status === 403 ? 403 : 502 })
      const data = (await res.json()) as { images?: Record<string, string | null>; err?: string | null }
      if (data.err) return new Response('render error', { status: 502 })
      imageUrl = data.images?.[nodeId] ?? null
    } else {
      const res = await fetch(`${FIGMA_API}/files/${encodeURIComponent(fileKey)}?depth=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) return new Response('file fetch failed', { status: res.status === 403 ? 403 : 502 })
      const data = (await res.json()) as { thumbnailUrl?: string }
      imageUrl = data.thumbnailUrl ?? null
    }

    if (!imageUrl) return new Response('no image', { status: 404 })

    // Fetch the PNG server-side and re-serve it from our origin (taint-safe).
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) return new Response('image fetch failed', { status: 502 })
    const buf = await imgRes.arrayBuffer()
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        // Short private cache — the recorder loads it once per recording.
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (err) {
    payload.logger.error({ err }, 'figma render error')
    return new Response('render error', { status: 500 })
  }
}
