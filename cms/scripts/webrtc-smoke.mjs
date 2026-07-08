// Headless mesh smoke test for the WebRTC /session flow.
// Launches N browser contexts with fake media, has one create a room and the
// rest join, and asserts every peer sees every other peer (N-1 live remote
// tracks each). Then asserts a 6th peer is rejected by the room cap.
//
// Run: node scripts/webrtc-smoke.mjs
import { chromium } from 'playwright'

const URL = process.env.SMOKE_URL ?? 'https://p2p-payload.figma.site/session'
const N = 5
const TIMEOUT = 60_000

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})

let failed = false
const fail = (msg) => {
  console.error('❌', msg)
  failed = true
}

const newPage = async () => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  return page
}

try {
  const pages = []
  for (let i = 0; i < N; i++) pages.push(await newPage())

  // Peer 0 creates the room.
  await pages[0].goto(URL, { waitUntil: 'networkidle' })
  await pages[0].getByText('Start call').click()
  await pages[0].waitForSelector('.session__id', { timeout: TIMEOUT })
  const sid = (await pages[0].textContent('.session__id'))?.trim()
  if (!sid) throw new Error('No session ID for room creator')
  console.log(`▸ Room ${sid} created; joining ${N - 1} more peers…`)

  // Peers 1..N-1 join.
  for (let i = 1; i < N; i++) {
    await pages[i].goto(URL, { waitUntil: 'networkidle' })
    await pages[i].fill('.session__input', sid)
    await pages[i].getByText('Join', { exact: true }).click()
  }

  // Every peer must end up with N-1 remote tiles.
  await Promise.all(
    pages.map((p, i) =>
      p
        .waitForFunction(
          (expected) => document.querySelectorAll('.session__tile--remote').length === expected,
          N - 1,
          { timeout: TIMEOUT },
        )
        .catch(() => fail(`Peer ${i} did not reach ${N - 1} remote tiles`)),
    ),
  )
  if (!failed) console.log(`✅ All ${N} peers see ${N - 1} remotes each (full mesh)`)

  // Every remote tile must carry a live video track.
  for (let i = 0; i < N; i++) {
    const liveVideos = await pages[i].evaluate(() =>
      [...document.querySelectorAll('.session__tile--remote video')].filter((v) => {
        const s = v.srcObject
        return s && s.getVideoTracks().some((t) => t.readyState === 'live')
      }).length,
    )
    if (liveVideos !== N - 1) fail(`Peer ${i} has ${liveVideos} live remote videos (expected ${N - 1})`)
  }
  if (!failed) console.log('✅ Live video flowing on every mesh link')

  // A 6th peer must be rejected by the cap.
  const overflow = await newPage()
  await overflow.goto(URL, { waitUntil: 'networkidle' })
  await overflow.fill('.session__input', sid)
  await overflow.getByText('Join', { exact: true }).click()
  try {
    await overflow.waitForSelector('.session__error', { timeout: TIMEOUT })
    const msg = await overflow.textContent('.session__error')
    console.log(`✅ 6th peer rejected: "${msg?.trim()}"`)
  } catch {
    fail('6th peer was NOT rejected — cap not enforced')
  }
} catch (err) {
  fail(err.message)
} finally {
  await browser.close()
}

process.exitCode = failed ? 1 : 0
