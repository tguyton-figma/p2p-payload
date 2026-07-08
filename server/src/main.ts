import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

const app = new Hono()

app.use('*', logger())
app.use('*', cors())

app.get('/health', (c) => c.json({ status: 'ok' }))

const port = parseInt(Deno.env.get('PORT') ?? '8787')
console.log(`Server listening on port ${port}`)
Deno.serve({ port }, app.fetch)
