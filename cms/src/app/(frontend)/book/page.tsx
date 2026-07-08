import { getPayload } from 'payload'
import config from '@payload-config'
import { DevPanel } from './DevPanel'
import '@/components/time/time.css'
import './book.css'

/**
 * Find the index of the Moment closest to `now`.
 * Prefers active (now is between start/end), then upcoming, then most recent past.
 */
function computeInitialFocusIndex(
  moments: { start: string; end: string }[],
): number {
  if (moments.length === 0) return 0

  const now = Date.now()

  // 1. Is there an active moment (now is between start and end)?
  for (let i = 0; i < moments.length; i++) {
    const start = new Date(moments[i].start).getTime()
    const end = new Date(moments[i].end).getTime()
    if (now >= start && now <= end) return i
  }

  // 2. Find the nearest upcoming moment (start > now)
  for (let i = 0; i < moments.length; i++) {
    const start = new Date(moments[i].start).getTime()
    if (start > now) return i
  }

  // 3. All moments are in the past — return the last one (most recent)
  return moments.length - 1
}

export default async function BookPage() {
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })

  const { docs: moments } = await payload.find({
    collection: 'moments',
    sort: 'start',
    limit: 10000,
    depth: 2, // populate cover media (depth 1) and its fields
  })

  const initialFocusIndex = computeInitialFocusIndex(moments)

  return (
    <DevPanel realMoments={moments} realFocusIndex={initialFocusIndex} />
  )
}

export const metadata = {
  title: 'book.',
}
