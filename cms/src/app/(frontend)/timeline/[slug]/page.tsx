import { getPayload } from 'payload'
import config from '@payload-config'
import { headers as getHeaders } from 'next/headers.js'
import { notFound } from 'next/navigation'
import { TimelinePlayer } from './TimelinePlayer'
import './timeline.css'

interface TimelinePageProps {
  params: Promise<{ slug: string }>
}

export default async function TimelinePage({ params }: TimelinePageProps) {
  const { slug } = await params
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })
  const requestHeaders = await getHeaders()
  const { user } = await payload.auth({ headers: requestHeaders })

  const result = await payload.find({
    collection: 'timelines',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 2,
    draft: Boolean(user),
    ...(user
      ? { user, overrideAccess: false }
      : {}),
  })

  const timeline = result.docs[0]

  if (!timeline) {
    notFound()
  }

  return (
    <main>
      <TimelinePlayer timeline={timeline} />
    </main>
  )
}

export async function generateMetadata({ params }: TimelinePageProps) {
  const { slug } = await params
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })

  const result = await payload.find({
    collection: 'timelines',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
  })

  const timeline = result.docs[0]

  return {
    title: timeline?.title ?? 'Timeline',
    description: timeline?.description ?? '',
  }
}
