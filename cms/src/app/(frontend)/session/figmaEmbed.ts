// Detect a pasted Figma URL and unfurl it into an EmbedKit 2.0 embed URL.
//
// EmbedKit 2.0 embeds a Figma file/prototype/board/slides by pointing an iframe
// at embed.figma.com with the original path preserved and a couple of extra query
// params:
//   - embed-host   (required) an identifier for the embedding app
//   - client-id    (optional) the OAuth app client id; needed to control
//                   prototypes via the Embed API and to view private files.
// See https://developers.figma.com/docs/embeds/embed-kit-2.0/

// The embed-host is an arbitrary identifier for our app; Figma uses it for
// attribution. Defaults to our production host.
const DEFAULT_EMBED_HOST = 'p2p-payload.figma.site'

// First path segment for the Figma surfaces EmbedKit can render.
const FIGMA_KINDS = new Set(['file', 'design', 'proto', 'board', 'slides', 'deck'])

export interface FigmaEmbed {
  /** Fully-formed embed.figma.com URL for the iframe src. */
  url: string
  /** Human-friendly title derived from the URL (best effort). */
  name: string
  /** File key from the URL path — used to render a still via the REST API. */
  fileKey: string
  /** Node id in REST API form (`1:2`), from the `node-id` param, if present. */
  nodeId: string | null
}

export interface FigmaEmbedOptions {
  /**
   * OAuth app client id — enables the Embed API (interactive prototype control)
   * and private-file viewing. Sourced from the server (our OAUTH_CLIENT_ID), so
   * it's passed in at call time rather than read from the environment here.
   */
  clientId?: string | null
  /** Override the embed-host identifier. */
  embedHost?: string
}

/** Prettify a URL path segment (e.g. "My-Design-File" -> "My Design File"). */
function prettify(segment: string | undefined): string {
  if (!segment) return 'Figma file'
  try {
    const decoded = decodeURIComponent(segment)
    const spaced = decoded.replace(/[-_]+/g, ' ').trim()
    return spaced || 'Figma file'
  } catch {
    return 'Figma file'
  }
}

/**
 * Parse an arbitrary string; return an EmbedKit embed spec if it's a Figma URL
 * we can embed, otherwise null. Accepts figma.com, www.figma.com, and already-
 * transformed embed.figma.com URLs (and figma.com/community/file/... links).
 */
export function parseFigmaUrl(raw: string, opts: FigmaEmbedOptions = {}): FigmaEmbed | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null

  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return null
  }

  const host = u.hostname.toLowerCase()
  const isFigmaHost =
    host === 'figma.com' || host === 'www.figma.com' || host === 'embed.figma.com'
  if (!isFigmaHost) return null

  const segments = u.pathname.split('/').filter(Boolean)
  // Community links look like /community/file/<id>/<name>; the embeddable kind
  // and name sit one level deeper.
  const communityOffset = segments[0] === 'community' ? 1 : 0
  const kind = segments[communityOffset]
  if (!kind || !FIGMA_KINDS.has(kind)) return null

  // Path is /<kind>/<key>/<name?>; key follows the kind, name follows the key.
  const fileKey = segments[communityOffset + 1]
  const name = prettify(segments[communityOffset + 2])

  // node-id arrives URL-encoded as `1-2`; the REST API wants `1:2`.
  const rawNodeId = u.searchParams.get('node-id')
  const nodeId = rawNodeId ? rawNodeId.replace(/-/g, ':') : null

  // Build the embed URL: same path + query on embed.figma.com, plus embed params.
  const embed = new URL(u.toString())
  embed.protocol = 'https:'
  embed.hostname = 'embed.figma.com'
  embed.searchParams.set('embed-host', opts.embedHost || DEFAULT_EMBED_HOST)
  if (opts.clientId) embed.searchParams.set('client-id', opts.clientId)

  return { url: embed.toString(), name, fileKey, nodeId }
}

/** Whether a string looks like an embeddable Figma URL. */
export function isFigmaUrl(raw: string): boolean {
  return parseFigmaUrl(raw) !== null
}
