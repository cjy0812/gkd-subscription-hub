import { Hono } from 'hono'
import { explorerCatalog } from '../services/explorer'
import { all, get } from '../storage/projects'
import { getProviderAdapter, parseRepositoryUrl } from '../services/providers'
import type { Env, WorkflowJob } from '../types'
import { json } from '../utils/http'

const app = new Hono<{ Bindings: Env }>()

const JOB_CACHE_TTL_MS = 15_000
const JOB_CACHE_MAX_ENTRIES = 500
const jobCache = new Map<string, { expiresAt: number; jobs: WorkflowJob[] }>()
const LOG_WINDOW_MS = 60_000
const LOG_MAX_REQUESTS_PER_WINDOW = 20
const logRequestWindows = new Map<string, { startedAt: number; count: number }>()

async function getPublicRunProject(env: Env, id: number, runId: number) {
  const project = await get(env, id)
  if (!project?.lastRuns?.some((run) => run.runId === runId)) return null
  if (!project.repoUrl) throw Error('缺少仓库地址，无法确认当前公开状态')
  const locator = parseRepositoryUrl(project.repoUrl)
  const metadata = await getProviderAdapter(project.provider).getRepository(env, locator)
  if (metadata.isPrivate || metadata.archived) throw Error('仓库已不再是未归档公开仓库')
  return project
}

async function getCachedPublicJobs(env: Env, project: NonNullable<Awaited<ReturnType<typeof getPublicRunProject>>>, runId: number) {
  const key = `${project.provider || 'github'}:${project.owner}/${project.repo}:${runId}`
  const cached = jobCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.jobs
  if (cached) jobCache.delete(key)
  const jobs = await getProviderAdapter(project.provider).listRunJobs(env, project, runId)
  if (jobCache.size >= JOB_CACHE_MAX_ENTRIES) {
    const oldest = jobCache.keys().next().value
    if (oldest) jobCache.delete(oldest)
  }
  jobCache.set(key, { jobs, expiresAt: Date.now() + JOB_CACHE_TTL_MS })
  return jobs
}

function allowPublicLogRequest(ip: string) {
  const now = Date.now()
  if (!logRequestWindows.has(ip) && logRequestWindows.size >= 2_000) {
    const oldest = logRequestWindows.keys().next().value
    if (oldest) logRequestWindows.delete(oldest)
  }
  const current = logRequestWindows.get(ip)
  if (!current || now - current.startedAt >= LOG_WINDOW_MS) {
    logRequestWindows.set(ip, { startedAt: now, count: 1 })
    return true
  }
  if (current.count >= LOG_MAX_REQUESTS_PER_WINDOW) return false
  current.count += 1
  return true
}

// Public DTOs intentionally omit internal hashes, errors, credentials, quota and mutation controls.
app.get('/subscriptions', async (c) => {
  const projects = await all(c.env)
  const subscriptions = projects.map((project) => ({
    id: project.id,
    provider: project.provider || 'github',
    owner: project.owner,
    repo: project.repo,
    branch: project.branch,
    group: project.group || '默认分组',
    repoUrl: project.repoUrl,
    registeredAt: project.registeredAt,
    lastCheckedAt: project.lastCheckedAt,
    fileCount: project.distFiles.length,
    subscriptionPath:
      project.distFiles.find((file) => file.path.toLowerCase() === 'gkd.json5')?.path || null,
    hasSubscription: project.distFiles.some((file) => file.path.toLowerCase() === 'gkd.json5'),
    lastRuns: (project.lastRuns || []).slice(0, 5).map((run) => ({
      runId: run.runId,
      workflowName: run.workflowName,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion,
      created_at: run.created_at,
      html_url: run.html_url,
    })),
  }))
  return json({ ok: true, subscriptions })
})

app.get('/subscriptions/:id/runs/:runId/jobs', async (c) => {
  const id = Number(c.req.param('id'))
  const runId = Number(c.req.param('runId'))
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(runId) || runId <= 0)
    return json({ ok: false, error: '项目或运行记录不存在' }, 404)
  try {
    const project = await getPublicRunProject(c.env, id, runId)
    if (!project) return json({ ok: false, error: '运行记录不在当前公开快照中' }, 404)
    return json({ ok: true, jobs: await getCachedPublicJobs(c.env, project, runId) })
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : '读取 Job 失败' }, 502)
  }
})
app.get('/subscriptions/:id/runs/:runId/jobs/:jobId/logs', async (c) => {
  const id = Number(c.req.param('id'))
  const runId = Number(c.req.param('runId'))
  const jobId = Number(c.req.param('jobId'))
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !Number.isSafeInteger(runId) ||
    runId <= 0 ||
    !Number.isSafeInteger(jobId) ||
    jobId <= 0
  )
    return json({ ok: false, error: '项目或 Job 参数无效' }, 400)
  const stepParam = c.req.query('step')
  const stepNumber = stepParam == null ? undefined : Number(stepParam)
  if (stepNumber != null && (!Number.isSafeInteger(stepNumber) || stepNumber < 0))
    return json({ ok: false, error: 'Step 参数无效' }, 400)
  const ip = c.req.header('cf-connecting-ip') || 'unknown'
  if (!allowPublicLogRequest(ip))
    return json({ ok: false, error: '日志请求过于频繁，请稍后重试' }, 429)
  try {
    const project = await getPublicRunProject(c.env, id, runId)
    if (!project) return json({ ok: false, error: '运行记录不存在' }, 404)
    const jobs = await getCachedPublicJobs(c.env, project, runId)
    if (!jobs.some((job) => job.id === jobId))
      return json({ ok: false, error: 'Job 不属于指定的 Run' }, 404)
    const log = await getProviderAdapter(project.provider).getJobLog(c.env, project, jobId, stepNumber)
    return json({ ok: true, log })
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : '读取日志失败' }, 502)
  }
})
app.get('/explorer', async (c) => {
  const entries = await explorerCatalog(c.env)
  const publicEntries = entries.map((entry) => ({
    repository: {
      id: entry.repository.id,
      full_name: entry.repository.full_name,
      description: entry.repository.description,
      html_url: entry.repository.html_url,
      default_branch: entry.repository.default_branch,
      topics: entry.repository.topics,
      stargazers_count: entry.repository.stargazers_count,
      forks_count: entry.repository.forks_count,
      pushed_at: entry.repository.pushed_at,
      updated_at: entry.repository.updated_at,
      language: entry.repository.language,
      license: entry.repository.license,
      homepage: entry.repository.homepage,
      created_at: entry.repository.created_at,
    },
    fork: entry.fork,
    parent: entry.parent || null,
    subscriptions: entry.subscriptions.map((subscription) => ({
      id: subscription.id,
      name: subscription.name,
      version: subscription.version,
      author: subscription.author,
      updateUrl: subscription.updateUrl,
      checkUpdateUrl: subscription.checkUpdateUrl,
      artifactPath: subscription.artifactPath,
      artifactSize: subscription.artifactSize,
      categoriesCount: subscription.categoriesCount,
      appsCount: subscription.appsCount,
      globalGroupsCount: subscription.globalGroupsCount,
      ruleCount: subscription.ruleCount,
    })),
    discoveredBy: entry.discoveredBy,
    verifiedAt: entry.verifiedAt,
  }))
  return json({ ok: true, entries: publicEntries })
})

app.notFound(() => json({ ok: false, error: 'Not found' }, 404))
export default app
