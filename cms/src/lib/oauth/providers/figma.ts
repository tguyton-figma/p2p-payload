/**
 * Figma OAuth Provider
 *
 * Implements OAuth 2.0 Authorization Code flow for Figma.
 * @see https://www.figma.com/developers/api#oauth2
 */

export interface FigmaOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export interface FigmaTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number // seconds
  token_type: 'Bearer'
}

export interface FigmaUserResponse {
  id: string
  email: string
  handle: string
  img_url: string
}

export interface FigmaOAuthResult {
  tokens: {
    accessToken: string
    refreshToken: string
    expiresAt: Date
    tokenType: string
  }
  user: FigmaUserResponse
  scopes: string[]
}

const FIGMA_AUTH_URL = 'https://www.figma.com/oauth'
const FIGMA_API_URL = 'https://api.figma.com/v1'

/**
 * Generate the Figma authorization URL to redirect the user to.
 */
export function getFigmaAuthorizationUrl(
  config: FigmaOAuthConfig,
  options: { scopes: string[]; state: string },
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: options.scopes.join(','), // Figma uses comma-separated scopes
    state: options.state,
    response_type: 'code',
  })
  return `${FIGMA_AUTH_URL}?${params.toString()}`
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeFigmaCode(
  config: FigmaOAuthConfig,
  code: string,
): Promise<FigmaTokenResponse> {
  const response = await fetch(`${FIGMA_API_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
      grant_type: 'authorization_code',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Figma token exchange failed: ${response.status} ${error}`)
  }

  return response.json()
}

/**
 * Refresh an expired access token.
 */
export async function refreshFigmaToken(
  config: FigmaOAuthConfig,
  refreshToken: string,
): Promise<FigmaTokenResponse> {
  const response = await fetch(`${FIGMA_API_URL}/oauth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Figma token refresh failed: ${response.status} ${error}`)
  }

  return response.json()
}

/**
 * Fetch the authenticated user's Figma profile.
 */
export async function getFigmaUser(accessToken: string): Promise<FigmaUserResponse> {
  const response = await fetch(`${FIGMA_API_URL}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Figma user fetch failed: ${response.status} ${error}`)
  }

  return response.json()
}

/**
 * Complete the OAuth flow: exchange code → fetch user → return structured result.
 */
export async function completeFigmaOAuth(
  config: FigmaOAuthConfig,
  code: string,
  requestedScopes: string[],
): Promise<FigmaOAuthResult> {
  const tokenResponse = await exchangeFigmaCode(config, code)
  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000)
  const user = await getFigmaUser(tokenResponse.access_token)

  return {
    tokens: {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt,
      tokenType: tokenResponse.token_type,
    },
    user,
    scopes: requestedScopes,
  }
}

/**
 * Check if a token is expired (with 5-minute buffer).
 */
export function isTokenExpired(expiresAt: Date | string): boolean {
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt
  return Date.now() > expiry.getTime() - 5 * 60 * 1000
}
