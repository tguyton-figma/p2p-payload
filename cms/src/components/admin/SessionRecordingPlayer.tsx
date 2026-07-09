'use client'

import React from 'react'
import { useFormFields } from '@payloadcms/ui'
import { toast } from 'sonner'
import './styles/hero.scss'

/**
 * SessionRecordingPlayer
 *
 * Inline video preview + "copy production link" button for the SessionRecordings
 * edit view. The `video` field is a relationship to a Media doc, so the form only
 * holds the media id — we fetch the doc from the admin API to resolve its file
 * URL, then render a player and expose the full production URL for sharing.
 *
 * The production origin is fixed (single prod environment). We prefer the media
 * doc's own `url` (Payload serves it as `/api/media/file/<filename>`, which 302s
 * to S3) prefixed with that origin, matching links like:
 *   https://p2p-payload.figma.site/api/media/file/session-….webm
 */
const PROD_BASE = (
  process.env.NEXT_PUBLIC_SERVER_URL || 'https://p2p-payload.figma.site'
).replace(/\/$/, '')

type MediaDoc = {
  url?: string | null
  filename?: string | null
  mimeType?: string | null
  thumbnailURL?: string | null
}

/** Turn a media doc into an absolute production URL for its file. */
function toProductionUrl(media: MediaDoc): string | null {
  if (media.url && media.url.startsWith('http')) return media.url
  if (media.url && media.url.startsWith('/')) return `${PROD_BASE}${media.url}`
  if (media.filename) return `${PROD_BASE}/api/media/file/${media.filename}`
  return null
}

export const SessionRecordingPlayer: React.FC = () => {
  // Relationship value is the media id (non-polymorphic → plain id).
  const videoId = useFormFields(([fields]) => {
    const v = fields.video?.value
    return v == null ? null : String(v)
  })

  const [media, setMedia] = React.useState<MediaDoc | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!videoId) {
      setMedia(null)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/media/${videoId}?depth=0`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((doc: MediaDoc | null) => {
        if (!cancelled) setMedia(doc)
      })
      .catch(() => {
        if (!cancelled) setMedia(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [videoId])

  if (!videoId) return null

  const fileUrl = media ? toProductionUrl(media) : null
  const poster =
    media?.thumbnailURL && media.thumbnailURL.startsWith('/')
      ? `${PROD_BASE}${media.thumbnailURL}`
      : media?.thumbnailURL ?? undefined

  const handleCopy = async () => {
    if (!fileUrl) return
    try {
      await navigator.clipboard.writeText(fileUrl)
      setCopied(true)
      toast.success('Video link copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy link')
    }
  }

  return (
    <div className="recording-player">
      <div className="hero-card">
        <div className="hero-card__media">
          {fileUrl ? (
            <video
              src={fileUrl}
              poster={poster}
              controls
              preload="metadata"
              style={{ maxHeight: 480, width: '100%', background: 'oklch(0.06 0 0)' }}
            />
          ) : (
            <div className="recording-player__placeholder">
              {loading ? 'Loading recording…' : 'Recording file is not available yet.'}
            </div>
          )}
        </div>
      </div>

      {fileUrl && (
        <div className="recording-player__link">
          <input
            className="recording-player__url"
            type="text"
            value={fileUrl}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Production video URL"
          />
          <button
            type="button"
            className="recording-player__copy"
            onClick={handleCopy}
            aria-label="Copy link to clipboard"
          >
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
        </div>
      )}
    </div>
  )
}
