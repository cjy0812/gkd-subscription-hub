import { Hono } from 'hono'
import { auth } from '../middleware/auth'
import { predict, refresh, runs } from '../services/actions'
import { listProjectVersions, recordSubscriptionVersion } from '../services/version-history'
import { listBranches, parseRepo, scan } from '../services/scanner'
import { all, get, remove, save } from '../storage/projects'
import type { Env } from '../types'
import { getProviderAdapter } from '../services/providers'
import { bad, json } from '../utils/http'
import explorer from './explorer'

const app = new Hono<{ Bindings: Env }>()
app.use('/api/*', auth)
app.get('/api/config', async (c) => {
  const hostname = new URL(c.req.url).hostname
  const subscriptionDomain = hostname.endsWith('.workers.dev')
    ? hostname
    : c.env.SUBSCRIPTION_DOMAIN
  return json({ ok: true, subscriptionDomain })
})
app.get('/api/projects', async (c) => json({ ok: true, projects: await all(c.env) }))
app.get('/api/repositories/branches', async (c) => {
  const url = c.req.query('url')
  if (!url) return bad('缺少仓库 URL')
  try {
    const repository = parseRepo(url)
    return json({ ok: true, ...(await listBranches(c.env, repository)) })
  } catch (error) {
    return bad(error instanceof Error ? error.message : '读取分支失败', 422)
  }
})

app.post('/api/projects', async (c) => {
  try {
    const body = await c.req.json<{ url?: string; branch?: string; group?: string }>()
    if (!body.url) return bad('缺少仓库 URL')
    const repository = parseRepo(body.url)
    const project = await scan(c.env, repository, body.branch)
    project.group = body.group?.trim().slice(0, 40) || '默认分组'
    const existing = await get(c.env, project.id)
    if (existing) {
      const provider = existing.provider || 'github'
      return bad(`ID ${project.id} 已被 ${provider}:${existing.owner}/${existing.repo} 占用`, 409)
    }
    project.lastRuns = await runs(c.env, project)
    project.lastCheckedAt = new Date().toISOString()
    project.lastDistHash = project.distHash
    project.lastDistChangedAt = project.lastCheckedAt
    project.prediction = predict(project.lastRuns)
    await recordSubscriptionVersion(c.env, project)
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
app.get('/api/projects/:id/runs/:runId/jobs', async (c) => {
  const id = Number(c.req.param('id'))
  const runId = Number(c.req.param('runId'))
  const project = await get(c.env, id)
  if (!project || !Number.isSafeInteger(runId) || runId <= 0)
    return bad('项目或运行记录不存在', 404)
  if (!project.lastRuns.some((run) => run.runId === runId))
    return bad('运行记录不在当前公开快照中', 404)
  try {
    return json({
      ok: true,
      jobs: await getProviderAdapter(project.provider).listRunJobs(c.env, project, runId),
    })
  } catch (error) {
    return bad(error instanceof Error ? error.message : '读取 Job 失败', 502)
  }
})
app.get('/api/projects/:id/runs/:runId/jobs/:jobId/logs', async (c) => {
  const id = Number(c.req.param('id'))
  const runId = Number(c.req.param('runId'))
  const jobId = Number(c.req.param('jobId'))
  const stepParam = c.req.query('step')
  const stepNumber = stepParam == null ? undefined : Number(stepParam)
  const project = await get(c.env, id)
  if (
    !project ||
    !Number.isSafeInteger(runId) ||
    runId <= 0 ||
    !project.lastRuns.some((run) => run.runId === runId) ||
    !Number.isSafeInteger(jobId) ||
    jobId <= 0 ||
    (stepNumber != null && (!Number.isSafeInteger(stepNumber) || stepNumber < 0))
  )
    return bad('项目、Job 或 Step 参数无效', 400)
  try {
    const adapter = getProviderAdapter(project.provider)
    const jobs = await adapter.listRunJobs(c.env, project, runId)
    if (!jobs.some((job) => job.id === jobId)) return bad('Job 不属于指定的 Run', 404)
    const log = await adapter.getJobLog(c.env, project, jobId, stepNumber)
    return new Response(JSON.stringify({ ok: true, log }), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  } catch (error) {
    return bad(error instanceof Error ? error.message : '读取日志失败', 502)
  }
})
app.get('/api/projects/:id/versions', async (c) => {
  const id = Number(c.req.param('id'))
  const project = await get(c.env, id)
  if (!project) return bad('项目不存在', 404)
  return json({ ok: true, versions: await listProjectVersions(c.env, id, project) })
})
app.delete('/api/projects/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!(await get(c.env, id))) return bad('项目不存在', 404)
  await remove(c.env, id)
  return json({ ok: true, deleted: id })
})
app.route('/api/explorer', explorer)
app.notFound((_c) => bad('Not found', 404))
export default app
