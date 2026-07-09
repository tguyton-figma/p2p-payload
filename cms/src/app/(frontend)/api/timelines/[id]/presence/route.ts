import { getPayload } from 'payload'
import config from '@payload-config'
import { headers as getHeaders } from 'next/headers.js'

const STALE_THRESHOLD_MS = 15_000

interface ViewerRecord {
  viewerId: string
  displayName: string
  avatarUrl: string | null
  sceneIndex: number
  playheadMs: number
  lastSeen: number
}

function pruneStale(viewers: ViewerRecord[]): ViewerRecord[] {
  const cutoff = Date.now() - STALE_THRESHOLD_MS
  return viewers.filter((v) => v.lastSeen > cutoff)
}

async function getKvKey(payload: Awaited<ReturnType<typeof getPayload>>, timelineId: string) {
  const key = `presence:${timelineId}`
  const existing = await payload.find({
    collection: 'payload-kv',
    where: { key: { equals: key } },
    limit: 1,
  })
  return { key, doc: existing.docs[0] ?? null }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })

  const { doc } = await getKvKey(payload, id)
  const viewers = doc ? pruneStale(doc.data as ViewerRecord[]) : []

  return Response.json({ viewers })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })

  // Auth is optional — anonymous viewers are allowed
  const requestHeaders = await getHeaders()
  const { user } = await payload.auth({ headers: requestHeaders })

  const body = await request.json()
  const { viewerId, sceneIndex, playheadMs, displayName } = body as {
    viewerId: string
    sceneIndex: number
    playheadMs: number
    displayName?: string
  }

  if (!viewerId) {
    return Response.json({ error: 'viewerId is required' }, { status: 400 })
  }

  const record: ViewerRecord = {
    viewerId,
    displayName: user?.email ?? displayName ?? 'Anonymous',
    // Users carry `figmaImageUrl`; signed-in Accounts carry `avatarUrl`.
    avatarUrl:
      (user as { avatarUrl?: string | null; figmaImageUrl?: string | null } | null)?.avatarUrl ??
      (user as { figmaImageUrl?: string | null } | null)?.figmaImageUrl ??
      null,
    sceneIndex,
    playheadMs,
    lastSeen: Date.now(),
  }

  const { key, doc } = await getKvKey(payload, id)
  const existing = doc ? pruneStale(doc.data as ViewerRecord[]) : []

  // Upsert by viewerId (not user.id)
  const updated = existing.filter((v) => v.viewerId !== viewerId)
  updated.push(record)

  if (doc) {
    await payload.update({
      collection: 'payload-kv',
      id: doc.id,
      data: { data: updated },
    })
  } else {
    await payload.create({
      collection: 'payload-kv',
      data: { key, data: updated },
    })
  }

  return Response.json({ ok: true, viewers: updated })
}
