import type { Metadata } from 'next'
import { getPayload } from 'payload'
import config from '@payload-config'
import { headers as getHeaders } from 'next/headers.js'
import { notFound } from 'next/navigation'
import type { Media } from '@/payload-types'

interface MediaPageProps {
  params: Promise<{ slug: string }>
}

function getBaseUrl(requestHeaders: Headers): string {
  const serverUrl =
    process.env.NEXT_PUBLIC_SERVER_URL || process.env.PAYLOAD_PUBLIC_SERVER_URL
  if (serverUrl) return serverUrl
  const proto = requestHeaders.get('x-forwarded-proto') || 'https'
  const host = requestHeaders.get('host') || 'localhost:3000'
  return `${proto}://${host}`
}

function absoluteUrl(path: string | null | undefined, baseUrl: string): string | undefined {
  if (!path) return undefined
  if (path.startsWith('http')) return path
  return `${baseUrl}${path}`
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `PT${h}H${m}M${s}S`
  if (m > 0) return `PT${m}M${s}S`
  return `PT${s}S`
}

async function fetchMedia(slug: string) {
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })
  const result = await payload.find({
    collection: 'media',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
  })
  return result.docs[0] as Media | undefined
}

export default async function MediaPage({ params }: MediaPageProps) {
  const { slug } = await params
  const doc = await fetchMedia(slug)
  if (!doc) notFound()

  const requestHeaders = await getHeaders()
  const baseUrl = getBaseUrl(requestHeaders)
  const fileUrl = absoluteUrl(doc.url, baseUrl)
  const thumbUrl = absoluteUrl(doc.thumbnailURL, baseUrl)
  const mime = doc.mimeType ?? ''
  const title = doc.filename || doc.alt || 'Media'

  const pageUrl = `${baseUrl}/media/${slug}`
  const oembedUrl = `${baseUrl}/api/oembed?url=${encodeURIComponent(pageUrl)}&format=json`
  const docAny = doc as unknown as Record<string, unknown>
  const duration = docAny.durationSeconds as number | undefined

  let jsonLd: Record<string, unknown> | undefined
  if (mime.startsWith('video/')) {
    jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: title,
      description: doc.alt || '',
      thumbnailUrl: thumbUrl,
      uploadDate: doc.createdAt,
      ...(duration ? { duration: formatDuration(duration) } : {}),
      ...(fileUrl ? { contentUrl: fileUrl } : {}),
      embedUrl: `${baseUrl}/embed/${slug}`,
    }
  } else if (mime.startsWith('audio/')) {
    jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'AudioObject',
      name: title,
      description: doc.alt || '',
      uploadDate: doc.createdAt,
      ...(duration ? { duration: formatDuration(duration) } : {}),
      ...(fileUrl ? { contentUrl: fileUrl } : {}),
      embedUrl: `${baseUrl}/embed/${slug}`,
    }
  } else if (mime.startsWith('image/')) {
    jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'ImageObject',
      name: title,
      description: doc.alt || '',
      uploadDate: doc.createdAt,
      ...(fileUrl ? { contentUrl: fileUrl } : {}),
    }
  }

  return (
    <>
      <link
        rel="alternate"
        type="application/json+oembed"
        href={oembedUrl}
        title={`${title} oEmbed`}
      />
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>{title}</h1>
        {mime.startsWith('video/') && fileUrl && (
          <video
            controls
            playsInline
            poster={thumbUrl}
            style={{ width: '100%', maxHeight: '70vh', background: '#000' }}
          >
            <source src={fileUrl} type={mime} />
          </video>
        )}
        {mime.startsWith('audio/') && fileUrl && (
          <audio controls style={{ width: '100%' }}>
            <source src={fileUrl} type={mime} />
          </audio>
        )}
        {mime.startsWith('image/') && fileUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fileUrl}
            alt={doc.alt}
            style={{ width: '100%', maxHeight: '80vh', objectFit: 'contain' }}
          />
        )}
        {doc.alt && <p style={{ marginTop: '0.5rem', color: '#666' }}>{doc.alt}</p>}
      </div>
    </>
  )
}

export async function generateMetadata({ params }: MediaPageProps): Promise<Metadata> {
  const { slug } = await params
  const doc = await fetchMedia(slug)
  if (!doc) return { title: 'Not Found' }

  const requestHeaders = await getHeaders()
  const baseUrl = getBaseUrl(requestHeaders)
  const mime = doc.mimeType ?? ''
  const title = doc.filename || doc.alt || 'Media'
  const description = doc.alt || ''
  const pageUrl = `${baseUrl}/media/${slug}`
  const fileUrl = absoluteUrl(doc.url, baseUrl)
  const thumbUrl = absoluteUrl(doc.thumbnailURL, baseUrl)
  const metaDoc = doc as unknown as Record<string, unknown>
  const w = metaDoc.mediaWidth as number | undefined
  const h = metaDoc.mediaHeight as number | undefined
  const imgW = doc.width ?? w
  const imgH = doc.height ?? h
  const duration = metaDoc.durationSeconds as number | undefined

  const ogImages: NonNullable<Metadata['openGraph']>['images'] = []
  if (mime.startsWith('video/') && thumbUrl) {
    ogImages.push({ url: thumbUrl, width: 640, height: 360 })
  } else if (mime.startsWith('image/') && fileUrl) {
    ogImages.push({
      url: fileUrl,
      ...(imgW ? { width: imgW } : {}),
      ...(imgH ? { height: imgH } : {}),
    })
  }

  const ogVideos: { url: string; type?: string; width?: number; height?: number }[] = []
  if (mime.startsWith('video/') && fileUrl) {
    ogVideos.push({
      url: fileUrl,
      type: mime,
      ...(w ? { width: w } : {}),
      ...(h ? { height: h } : {}),
    })
  }

  const twitterImages = ogImages.length > 0
    ? ogImages.map((img) => {
        if (typeof img === 'string') return img
        if (img instanceof URL) return img.toString()
        return img.url instanceof URL ? img.url.toString() : img.url
      })
    : undefined

  // Build raw meta tags for OG type and video-specific tags that Next.js
  // Metadata API doesn't expose directly (og:type beyond 'website'/'article',
  // twitter:player, video:duration).
  const other: Record<string, string> = {}
  if (mime.startsWith('video/')) {
    other['og:type'] = 'video.other'
    if (duration) other['video:duration'] = String(duration)
  } else if (mime.startsWith('audio/')) {
    other['og:type'] = 'music.song'
    if (duration) other['video:duration'] = String(duration)
  }

  // Twitter player card fields — emitted as raw meta since Next.js Metadata
  // twitter.players can be fragile across versions.
  if (!mime.startsWith('image/')) {
    other['twitter:card'] = 'player'
    other['twitter:player'] = `${baseUrl}/embed/${slug}`
    other['twitter:player:width'] = String(w ?? 1280)
    other['twitter:player:height'] = String(h ?? 720)
  }

  return {
    title,
    description,
    alternates: { canonical: pageUrl },
    openGraph: {
      siteName: 'P2P Payload',
      title,
      description,
      url: pageUrl,
      images: ogImages,
      videos: ogVideos.length > 0 ? ogVideos : undefined,
    },
    twitter: {
      card: mime.startsWith('image/') ? 'summary_large_image' : ('player' as 'summary_large_image'),
      title,
      description,
      images: twitterImages,
    },
    other,
  }
}
