import { Hono } from 'hono'
import { auth } from '../middleware/auth'
import { predict, refresh, runs } from '../services/actions'
import { parseRepo, scan } from '../services/scanner'
import { all, get, remove, save } from '../storage/projects'
import type { Env } from '../types'
import { bad, json } from '../utils/http'

const app = new Hono<{ Bindings: Env }>()
app.get('/admin', (c) => c.redirect('/'))
app.use('/api/*', auth)
app.get('/api/config', async (c) =>
  json({ ok: true, subscriptionDomain: c.env.SUBSCRIPTION_DOMAIN }),
)
app.get('/api/projects', async (c) => json({ ok: true, projects: await all(c.env) }))
app.post('/api/projects', async (c) => {
  try {
    const body = await c.req.json<{ url?: string; branch?: string; group?: string }>()
    if (!body.url) return bad('缺少仓库 URL')
    const { owner, repo } = parseRepo(body.url)
    const project = await scan(c.env, owner, repo, body.branch)
    project.group = body.group?.trim().slice(0, 40) || '默认分组'
    const existing = await get(c.env, project.id)
    if (existing) return bad(`ID ${project.id} 已被 ${existing.owner}/${existing.repo} 占用`, 409)
    project.lastRuns = await runs(c.env, project)
    project.lastCheckedAt = new Date().toISOString()
    project.lastDistHash = project.distHash
    project.lastDistChangedAt = project.lastCheckedAt
    project.prediction = predict(project.lastRuns)
    await save(c.env, project)
    return json({ ok: true, project }, 201)
  } catch (error) {
    return bad(error instanceof Error ? error.message : '注册失败', 422)
  }
})
app.post('/api/projects/:id/refresh', async (c) => {
  const id = Number(c.req.param('id'))
  const project = await get(c.env, id)
  if (!project) return bad('项目不存在', 404)
  try {
    return json({ ok: true, project: await refresh(c.env, project) })
  } catch (error) {
    const message = error instanceof Error ? error.message : '刷新失败'
    await save(c.env, {
      ...project,
      lastError: message,
      prediction: {
        ...project.prediction,
        nextCheckAt: new Date(Date.now() + 1800000).toISOString(),
      },
    })
    return bad(message, 502)
  }
})
app.delete('/api/projects/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!(await get(c.env, id))) return bad('项目不存在', 404)
  await remove(c.env, id)
  return json({ ok: true, deleted: id })
})
app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith('/api/')) return bad('Not found', 404)
  return c.env.ASSETS.fetch(c.req.raw)
})
export default app
