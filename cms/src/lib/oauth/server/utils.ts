/**
 * OAuth Server Utilities
 *
 * URL resolution reads the `host` header dynamically so the redirect URI
 * is always correct whether the request comes through the public URL or
 * directly via the Lambda function URL.
 */

import crypto from 'crypto'

interface RequestLike {
  headers: { get(name: string): string | null }
}

/**
 * Resolve the base URL from the incoming request's host header.
 * Falls back to PAYLOAD_PUBLIC_SERVER_URL, then localhost in dev.
 */
export function getBaseUrl(request?: RequestLike): string {
  if (request) {
    const host = request.headers.get('host')
    if (host) {
      const protocol = host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https'
      return `${protocol}://${host}`
    }
  }

  if (process.env.PAYLOAD_PUBLIC_SERVER_URL) {
    return process.env.PAYLOAD_PUBLIC_SERVER_URL
  }

  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:3000'
  }

  throw new Error('getBaseUrl: cannot determine base URL — no host header and no PAYLOAD_PUBLIC_SERVER_URL')
}

/**
 * Generate a cryptographically secure random hex string.
 */
export function generateId(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('hex')
}
