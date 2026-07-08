import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import type { Media } from '@/payload-types'

function getBaseUrl(request: NextRequest): string {
  const serverUrl =
    process.env.NEXT_PUBLIC_SERVER_URL || process.env.PAYLOAD_PUBLIC_SERVER_URL
  if (serverUrl) return serverUrl
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('host') || 'localhost:3000'
  return `${proto}://${host}`
}

function absoluteUrl(path: string | null | undefined, baseUrl: string): string | undefined {
  if (!path) return undefined
  if (path.startsWith('http')) return path
  return `${baseUrl}${path}`
}

function extractSlug(url: string): string | null {
  try {
    const parsed = new URL(url)
    const match = parsed.pathname.match(/^\/media\/([^/]+)$/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const url = searchParams.get('url')
  const format = searchParams.get('format')

  if (format && format !== 'json') {
    return NextResponse.json({ error: 'Only JSON format is supported' }, { status: 501 })
  }

  if (!url) {
    return NextResponse.json({ error: 'Missing required "url" parameter' }, { status: 400 })
  }

  const slug = extractSlug(url)
  if (!slug) {
    return NextResponse.json({ error: 'URL does not match a media resource' }, { status: 404 })
  }

  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })
  const result = await payload.find({
    collection: 'media',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
  })

  const doc = result.docs[0] as Media | undefined
  if (!doc) {
    return NextResponse.json({ error: 'Media not found' }, { status: 404 })
  }

  const baseUrl = getBaseUrl(request)
  const mime = doc.mimeType ?? ''
  const title = doc.filename || doc.alt || 'Media'
  const fileUrl = absoluteUrl(doc.url, baseUrl)
  const thumbUrl = absoluteUrl(doc.thumbnailURL, baseUrl)
  const metaDoc = doc as unknown as Record<string, unknown>
  const w = metaDoc.mediaWidth as number | undefined
  const h = metaDoc.mediaHeight as number | undefined
  const imgW = doc.width ?? w
  const imgH = doc.height ?? h

  if (mime.startsWith('image/')) {
    return NextResponse.json({
      version: '1.0',
      type: 'photo',
      provider_name: 'P2P Payload',
      provider_url: baseUrl,
      title,
      url: fileUrl,
      width: imgW ?? 1280,
      height: imgH ?? 720,
      ...(fileUrl ? { thumbnail_url: fileUrl } : {}),
      ...(imgW ? { thumbnail_width: imgW } : {}),
      ...(imgH ? { thumbnail_height: imgH } : {}),
    })
  }

  const embedUrl = `${baseUrl}/embed/${slug}`
  const width = w ?? 1280
  const height = h ?? 720

  const response: Record<string, unknown> = {
    version: '1.0',
    type: mime.startsWith('video/') ? 'video' : 'rich',
    provider_name: 'P2P Payload',
    provider_url: baseUrl,
    title,
    width,
    height,
    html: `<iframe src="${embedUrl}" width="${width}" height="${height}" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`,
  }

  if (thumbUrl) {
    response.thumbnail_url = thumbUrl
    response.thumbnail_width = 640
    response.thumbnail_height = 360
  } else if (mime.startsWith('image/') && fileUrl) {
    response.thumbnail_url = fileUrl
    if (imgW) response.thumbnail_width = imgW
    if (imgH) response.thumbnail_height = imgH
  }

  return NextResponse.json(response)
}
