// Probe: fire many candidate signals concurrently and assert none are lost.
// The append-only signals model should persist every insert (unlike the old
// shared-document PATCH approach, which clobbered concurrent writes).
const BASE = process.env.SMOKE_URL ?? 'https://p2p-payload.figma.site'
const N = 12

const { id } = await fetch(`${BASE}/api/sessions`, { method: 'POST' }).then((r) => r.json())
console.log('session', id)

const post = (kind, data) =>
  fetch(`${BASE}/api/sessions/${id}/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'caller', kind, data }),
  })

// One offer + N candidates, all fired concurrently.
await Promise.all([
  post('offer', { type: 'offer', sdp: 'OFFER_SDP' }),
  ...Array.from({ length: N }, (_, i) => post('candidate', { candidate: `c${i}` })),
])

const { signals } = await fetch(`${BASE}/api/sessions/${id}/signals`).then((r) => r.json())
const offers = signals.filter((s) => s.kind === 'offer').length
const candidates = signals.filter((s) => s.kind === 'candidate').length
console.log(`offer rows: ${offers} (expected 1)`)
console.log(`candidate rows: ${candidates} (expected ${N})`)
console.log(offers === 1 && candidates === N ? '✅ no signals lost' : '❌ signals lost')
