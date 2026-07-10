/**
 * Accounts OAuth Endpoints
 *
 * Implements the Figma OAuth flow for the recorder Make app.
 *
 * Flow:
 * 1. Make app generates a sessionId, opens /api/accounts/oauth/authorize?session_id=<id>
 * 2. User is redirected to Figma and approves
 * 3. Figma redirects to /api/accounts/oauth/callback?code=...&state=...
 * 4. Callback upserts Account, generates sessionToken, stores pendingSessionId in DB
 * 5. Make app polls /api/accounts/oauth/session?session_id=<id> until it gets the token
 * 6. App stores sessionToken in clientStorage, uses it for all uploads
 */

import type { Endpoint } from 'payload'
import { completeFigmaOAuth, getFigmaAuthorizationUrl } from '../../lib/oauth/providers/figma'
import { generateId, getBaseUrl } from '../../lib/oauth/server/utils'
import {
  accountCookie,
  clearedAccountCookie,
  getAccountFromRequest,
} from '../../lib/oauth/server/account-auth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ACCOUNTS = 'accounts' as any

// Scopes we request from Figma. current_user:read powers /v1/me (handle, email,
// profile image); file_content:read powers rendering embedded Figma nodes via
// /v1/images for session recordings. Changing this set requires existing users to
// re-consent (sign in again) before their token carries the new grants.
const FIGMA_SCOPES = ['current_user:read', 'file_content:read']

// In-memory CSRF state store (15 min TTL).
// Only lives for the authorize → Figma → callback round-trip — same Lambda instance.
const pendingStates = new Map<string, {
  // 'poll' = Make/recorder app (claims the token by polling /oauth/session).
  // 'browser' = frontend login (callback sets a cookie and redirects back).
  mode: 'poll' | 'browser'
  sessionId?: string
  redirectPath?: string
  redirectUri: string
  createdAt: number
}>()

setInterval(() => {
  const now = Date.now()
  for (const [k, v] of pendingStates) {
    if (now - v.createdAt > 15 * 60 * 1000) pendingStates.delete(k)
  }
}, 60_000)

function getConfig(redirectUri: string) {
  const clientId = process.env.OAUTH_CLIENT_ID
  const clientSecret = process.env.OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret, redirectUri }
}

/**
 * GET /api/accounts/oauth/authorize?session_id=<id>
 *
 * Generates CSRF state, stores session_id, redirects to Figma.
 */
export const accountsOAuthAuthorize: Endpoint = {
  path: '/oauth/authorize',
  method: 'get',
  handler: async (req) => {
    const url = new URL(req.url || '', 'http://localhost')
    const sessionId = url.searchParams.get('session_id')

    if (!sessionId) {
      return Response.json({ error: 'session_id is required' }, { status: 400 })
    }

    const baseUrl = getBaseUrl(req)
    const redirectUri = `${baseUrl}/api/accounts/oauth/callback`
    const config = getConfig(redirectUri)

    if (!config) {
      return Response.json(
        { error: 'OAuth not configured — OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET missing' },
        { status: 500 },
      )
    }

    const state = generateId(32)
    pendingStates.set(state, { mode: 'poll', sessionId, redirectUri, createdAt: Date.now() })

    const authUrl = getFigmaAuthorizationUrl(config, {
      scopes: FIGMA_SCOPES,
      state,
    })

    return Response.redirect(authUrl, 302)
  },
}

/**
 * GET /api/accounts/oauth/login?redirect=/session
 *
 * Browser sign-in. Unlike /authorize (poll-based for the Make app), this
 * remembers a post-login redirect path; the callback sets an httpOnly cookie and
 * sends the browser back there. Keep the whole chain on the frontend host so the
 * host-only cookie is set and read on the same origin.
 */
export const accountsOAuthLogin: Endpoint = {
  path: '/oauth/login',
  method: 'get',
  handler: async (req) => {
    const url = new URL(req.url || '', 'http://localhost')
    const requested = url.searchParams.get('redirect') || '/session'
    // Same-site relative paths only — prevents open-redirect abuse.
    const redirectPath =
      requested.startsWith('/') && !requested.startsWith('//') ? requested : '/session'

    const baseUrl = getBaseUrl(req)
    const redirectUri = `${baseUrl}/api/accounts/oauth/callback`
    const config = getConfig(redirectUri)

    if (!config) {
      return Response.json(
        { error: 'OAuth not configured — OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET missing' },
        { status: 500 },
      )
    }

    const state = generateId(32)
    pendingStates.set(state, { mode: 'browser', redirectPath, redirectUri, createdAt: Date.now() })

    const authUrl = getFigmaAuthorizationUrl(config, { scopes: FIGMA_SCOPES, state })
    return Response.redirect(authUrl, 302)
  },
}

/**
 * GET /api/accounts/oauth/callback?code=...&state=...
 *
 * Exchanges the code for tokens, upserts the Account, stores pendingSessionId
 * in the DB, then redirects to the success page.
 */
export const accountsOAuthCallback: Endpoint = {
  path: '/oauth/callback',
  method: 'get',
  handler: async (req) => {
    const url = new URL(req.url || '', 'http://localhost')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const oauthError = url.searchParams.get('error')

    if (oauthError) {
      return Response.json(
        { error: oauthError, description: url.searchParams.get('error_description') },
        { status: 400 },
      )
    }

    if (!code || !state) {
      return Response.json({ error: 'Missing code or state' }, { status: 400 })
    }

    const pending = pendingStates.get(state)
    if (!pending) {
      return Response.json({ error: 'Invalid or expired state' }, { status: 400 })
    }
    pendingStates.delete(state)

    const { sessionId, redirectUri, mode, redirectPath } = pending
    const config = getConfig(redirectUri)

    if (!config) {
      return Response.json({ error: 'OAuth not configured' }, { status: 500 })
    }

    try {
      const result = await completeFigmaOAuth(config, code, FIGMA_SCOPES)

      // Find existing account by Figma user ID
      const { docs } = await req.payload.find({
        collection: ACCOUNTS,
        where: { figmaId: { equals: result.user.id } },
        limit: 1,
        overrideAccess: true,
      })

      const sessionToken = generateId(32)
      const accountData = {
        figmaId: result.user.id,
        handle: result.user.handle,
        email: result.user.email,
        avatarUrl: result.user.img_url,
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        tokenExpiresAt: result.tokens.expiresAt.toISOString(),
        sessionToken,
        pendingSessionId: mode === 'browser' ? null : sessionId,
      }

      if (docs.length > 0) {
        await req.payload.update({
          collection: ACCOUNTS,
          id: docs[0].id,
          data: accountData,
          overrideAccess: true,
          req,
        })
      } else {
        await req.payload.create({
          collection: ACCOUNTS,
          data: accountData,
          overrideAccess: true,
          req,
        })
      }

      req.payload.logger.info(
        `Accounts OAuth: ${docs.length > 0 ? 'updated' : 'created'} account for Figma user ${result.user.handle} (${result.user.id})`,
      )

      const baseUrl = getBaseUrl(req)

      // Browser sign-in: set the session cookie and return to the app.
      if (mode === 'browser') {
        return new Response(null, {
          status: 302,
          headers: {
            Location: `${baseUrl}${redirectPath ?? '/session'}`,
            'Set-Cookie': accountCookie(sessionToken),
          },
        })
      }

      // Make/recorder app: it polls /oauth/session for the token.
      return Response.redirect(`${baseUrl}/oauth/success`, 302)
    } catch (err) {
      req.payload.logger.error({ err }, 'Accounts OAuth callback error')
      return Response.json(
        { error: 'OAuth flow failed', details: String(err) },
        { status: 500 },
      )
    }
  },
}

/**
 * GET /api/accounts/oauth/session?session_id=<id>
 *
 * Make app polls this until the OAuth flow completes.
 * Returns { ready: false } with 202 while pending.
 * Returns { ready: true, sessionToken } and clears pendingSessionId once done.
 */
export const accountsOAuthSession: Endpoint = {
  path: '/oauth/session',
  method: 'get',
  handler: async (req) => {
    const url = new URL(req.url || '', 'http://localhost')
    const sessionId = url.searchParams.get('session_id')

    if (!sessionId) {
      return Response.json({ error: 'session_id is required' }, { status: 400 })
    }

    const { docs } = await req.payload.find({
      collection: ACCOUNTS,
      where: { pendingSessionId: { equals: sessionId } },
      limit: 1,
      overrideAccess: true,
    })

    if (!docs.length) {
      return Response.json({ ready: false }, { status: 202 })
    }

    const account = docs[0]

    // Clear the pending session ID — it's been claimed
    await req.payload.update({
      collection: ACCOUNTS,
      id: account.id,
      data: { pendingSessionId: null },
      overrideAccess: true,
      req,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionToken = (account as any).sessionToken as string

    return Response.json({
      ready: true,
      sessionToken,
    })
  },
}

/**
 * GET /api/accounts/oauth/me
 *
 * Returns the signed-in account (from the `pp_account` cookie) or null.
 * Never returns the sessionToken.
 */
export const accountsOAuthMe: Endpoint = {
  path: '/oauth/me',
  method: 'get',
  handler: async (req) => {
    // The Figma OAuth app's client id doubles as the EmbedKit `client-id` for
    // canvas embeds. It's public (it already appears in the authorize URL), so
    // we hand it to the browser here instead of duplicating it into a
    // NEXT_PUBLIC_ variable.
    const figmaClientId = process.env.OAUTH_CLIENT_ID ?? null
    const account = await getAccountFromRequest(req.payload, req.headers)
    if (!account) return Response.json({ account: null, figmaClientId })
    return Response.json({
      account: {
        figmaId: account.figmaId,
        handle: account.handle ?? null,
        email: account.email ?? null,
        avatarUrl: account.avatarUrl ?? null,
      },
      figmaClientId,
    })
  },
}

/**
 * POST /api/accounts/oauth/logout — clear the browser account session cookie.
 */
export const accountsOAuthLogout: Endpoint = {
  path: '/oauth/logout',
  method: 'post',
  handler: async () => {
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearedAccountCookie() } })
  },
}

export const accountsOAuthEndpoints: Endpoint[] = [
  accountsOAuthAuthorize,
  accountsOAuthLogin,
  accountsOAuthCallback,
  accountsOAuthSession,
  accountsOAuthMe,
  accountsOAuthLogout,
]
