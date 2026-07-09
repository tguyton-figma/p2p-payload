/**
 * Account auth helpers for the browser (frontend) session.
 *
 * The browser signs in with Figma and receives an httpOnly `pp_account` cookie
 * holding the Account's sessionToken. The Accounts collection registers a custom
 * Payload auth strategy that reads this cookie, so `payload.auth({ headers })`
 * returns the Account as the authenticated user. `getAccountFromRequest` prefers
 * that path and falls back to reading the cookie directly — so callers work even
 * if strategy ordering ever changes.
 */

import type { Payload } from 'payload'
import type { Account } from '@/payload-types'
import { parseCookies } from 'payload/shared'

export const PP_ACCOUNT_COOKIE = 'pp_account'

// 30 days. How long a browser stays signed in without re-auth.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30

/**
 * Resolve the signed-in Account from a request's headers, or null.
 * `overrideAccess` is required on the fallback find because the `sessionToken`
 * field is read-protected.
 */
export async function getAccountFromRequest(
  payload: Payload,
  headers: Headers,
): Promise<Account | null> {
  const { user } = await payload.auth({ headers })
  if (user && (user as { collection?: string }).collection === 'accounts') {
    return user as unknown as Account
  }

  const token = parseCookies(headers).get(PP_ACCOUNT_COOKIE)
  if (!token) return null

  const { docs } = await payload.find({
    collection: 'accounts',
    where: { sessionToken: { equals: token } },
    limit: 1,
    overrideAccess: true,
    depth: 0,
  })
  return docs[0] ?? null
}

/** Set-Cookie value that establishes a browser account session. */
export function accountCookie(token: string): string {
  return `${PP_ACCOUNT_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`
}

/** Set-Cookie value that clears the browser account session. */
export function clearedAccountCookie(): string {
  return `${PP_ACCOUNT_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}
