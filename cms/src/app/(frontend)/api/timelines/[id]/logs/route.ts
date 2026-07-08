import { getPayload } from 'payload'
import config from '@payload-config'
import { headers as getHeaders } from 'next/headers.js'
import type { Where } from 'payload'
import type { Log } from '@/payload-types'

interface LogEntry {
  subject: string
  data?: unknown
  sessionId?: string
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })
  const requestHeaders = await getHeaders()
  const { user } = await payload.auth({ headers: requestHeaders })

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const since = url.searchParams.get('since')
  const subject = url.searchParams.get('subject')

  const where: Where = {
    and: [{ timelineId: { equals: id } }],
  }

  if (since) {
    ;(where.and as Where[]).push({
      createdAt: { greater_than: since },
    })
  }

  if (subject) {
    // Support wildcard prefix matching: "timeline.*" → starts_with "timeline."
    if (subject.endsWith('.*')) {
      const prefix = subject.slice(0, -1)
      ;(where.and as Where[]).push({
        subject: { contains: prefix },
      })
    } else {
      ;(where.and as Where[]).push({
        subject: { equals: subject },
      })
    }
  }

  const logs = await payload.find({
    collection: 'logs',
    where,
    sort: 'createdAt',
    limit: 100,
    overrideAccess: true,
  })

  return Response.json({ logs: logs.docs })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })
  const requestHeaders = await getHeaders()
  const { user } = await payload.auth({ headers: requestHeaders })

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { entries, sessionId } = body as {
    entries: LogEntry[]
    sessionId: string
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    return Response.json({ error: 'entries must be a non-empty array' }, { status: 400 })
  }

  const created = await Promise.all(
    entries.map((entry) =>
      payload.create({
        collection: 'logs',
        data: {
          subject: entry.subject,
          data: (entry.data ?? null) as Log['data'],
          source: 'client',
          userId: user.id,
          timelineId: id,
          sessionId: entry.sessionId ?? sessionId,
        },
      }),
    ),
  )

  return Response.json({ ok: true, count: created.length })
}
