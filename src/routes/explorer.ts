import { Hono } from 'hono'
import { explorerCatalog, explorerQuota, explorerStatus, startExplorer, stepExplorer } from '../services/explorer'
import type { Env } from '../types'
import { json } from '../utils/http'

const app = new Hono<{ Bindings: Env }>()
app.get('/catalog', async (c) => json({ ok: true, entries: await explorerCatalog(c.env) }))
app.get('/status', async (c) => json({ ok: true, status: await explorerStatus(c.env) }))
app.get('/quota', async (c) => json({ ok: true, quota: await explorerQuota(c.env) }))
app.post('/discover', async (c) => json({ ok: true, status: await startExplorer(c.env) }))
app.post('/discover/step', async (c) => json({ ok: true, status: await stepExplorer(c.env) }))
export default app
