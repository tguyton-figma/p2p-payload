import { getPayload } from 'payload'
import config from '@payload-config'
import { headers as getHeaders } from 'next/headers.js'
import { notFound } from 'next/navigation'
import type { Media } from '@/payload-types'

interface EmbedPageProps {
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

export default async function EmbedPage({ params }: EmbedPageProps) {
  const { slug } = await params
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })

  const result = await payload.find({
    collection: 'media',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
  })

  const doc = result.docs[0] as Media | undefined
  if (!doc) notFound()

  const requestHeaders = await getHeaders()
  const baseUrl = getBaseUrl(requestHeaders)
  const fileUrl = absoluteUrl(doc.url, baseUrl)
  const thumbUrl = absoluteUrl(doc.thumbnailURL, baseUrl)
  const mime = doc.mimeType ?? ''

  const fullStyle: React.CSSProperties = {
    width: '100%',
    height: '100vh',
    objectFit: 'contain',
  }

  return (
    <>
      {mime.startsWith('video/') && fileUrl && (
        <video
          controls
          playsInline
          poster={thumbUrl}
          style={fullStyle}
        >
          <source src={fileUrl} type={mime} />
        </video>
      )}
      {mime.startsWith('audio/') && fileUrl && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            padding: '2rem',
          }}
        >
          <audio controls style={{ width: '100%', maxWidth: 600 }}>
            <source src={fileUrl} type={mime} />
          </audio>
        </div>
      )}
      {mime.startsWith('image/') && fileUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileUrl} alt={doc.alt} style={fullStyle} />
      )}
    </>
  )
}
