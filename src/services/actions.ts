import { save } from '../storage/projects'
import type { Env, Prediction, Project, WorkflowRun } from '../types'
import { gh } from './github'
import { scan } from './scanner'
import { parseRepositoryUrl } from './providers'
type GitLabPipeline = {
  id: number
  status: string
  source: string
  name?: string | null
  created_at: string
  updated_at: string
  web_url: string
  sha: string
}

type GiteaActionRun = {
  id: number
  path?: string
  event: string
  status: string
  conclusion?: string | null
  created_at: string
  updated_at?: string
  completed_at?: string
  html_url: string
  head_sha: string
}

async function gitlabRuns(p: Project): Promise<WorkflowRun[]> {
  if (!p.providerId) return []
  try {
    const url = `https://gitlab.com/api/v4/projects/${encodeURIComponent(p.providerId)}/pipelines?ref=${encodeURIComponent(p.branch)}&per_page=10&order_by=id&sort=desc`
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) return []
    const pipelines = (await response.json()) as GitLabPipeline[]
    return pipelines.map((pipeline) => {
      const conclusion =
        pipeline.status === 'success'
          ? 'success'
          : pipeline.status === 'failed'
            ? 'failure'
            : pipeline.status === 'canceled'
              ? 'cancelled'
              : pipeline.status === 'skipped'
                ? 'skipped'
                : null
      const status = conclusion
        ? 'completed'
        : ['created', 'waiting_for_resource', 'preparing', 'pending', 'manual', 'scheduled'].includes(
              pipeline.status,
            )
          ? 'queued'
          : 'in_progress'
      return {
        workflowId: pipeline.id,
        workflowName: pipeline.name || 'GitLab CI',
        event: pipeline.source,
        status,
        conclusion,
        created_at: pipeline.created_at,
        updated_at: pipeline.updated_at || pipeline.created_at,
        html_url: pipeline.web_url,
        head_sha: pipeline.sha,
      }
    })
  } catch {
    return []
  }
}

async function giteaRuns(p: Project): Promise<WorkflowRun[]> {
  try {
    const owner = encodeURIComponent(p.owner)
    const repo = encodeURIComponent(p.repo)
    const url = `https://gitea.com/api/v1/repos/${owner}/${repo}/actions/runs?branch=${encodeURIComponent(p.branch)}&limit=10&page=1`
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) return []
    const data = (await response.json()) as { workflow_runs: GiteaActionRun[] }
    return data.workflow_runs.map((run) => {
      const conclusion =
        run.conclusion ||
        (run.status === 'success'
          ? 'success'
          : run.status === 'failure'
            ? 'failure'
            : run.status === 'cancelled'
              ? 'cancelled'
              : run.status === 'skipped'
                ? 'skipped'
                : null)
      const status = conclusion
        ? 'completed'
        : ['queued', 'pending', 'requested'].includes(run.status)
          ? 'queued'
          : 'in_progress'
      const workflowName = run.path?.split('/').at(-1) || 'Gitea Actions'
      return {
        workflowId: run.id,
        workflowName,
        event: run.event,
        status,
        conclusion,
        created_at: run.created_at,
        updated_at: run.updated_at || run.completed_at || run.created_at,
        html_url: run.html_url,
        head_sha: run.head_sha,
      }
    })
  } catch {
    return []
  }
}

type GitHubWorkflowRun = {
  event: string
  status: string
  conclusion: string | null
  created_at: string
  updated_at: string
  html_url: string
  head_sha: string
}

export async function runs(e: Env, p: Project): Promise<WorkflowRun[]> {
  if (p.provider === 'gitlab') return gitlabRuns(p)
  if (p.provider === 'gitea') return giteaRuns(p)
  const groups = await Promise.all(
    p.workflows
      .filter((w) => w.relevant)
      .slice(0, 6)
      .map(async (w) => {
        try {
          const d = await gh<{ workflow_runs: GitHubWorkflowRun[] }>(
            e,
            `/repos/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}/actions/workflows/${w.id}/runs?per_page=10`,
          )
          return d.workflow_runs.map((r) => ({
            workflowId: w.id,
            workflowName: w.name,
            event: r.event,
            status: r.status,
            conclusion: r.conclusion,
            created_at: r.created_at,
            updated_at: r.updated_at,
            html_url: r.html_url,
            head_sha: r.head_sha,
          }))
        } catch {
          return []
        }
      }),
  )
  return groups
    .flat()
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, 30)
}
function median(a: number[]) {
  if (!a.length) return null
  a.sort((x, y) => x - y)
  return a[Math.floor(a.length / 2)]
}
export function predict(rs: WorkflowRun[], now = Date.now()): Prediction {
  const t = rs
      .filter((r) => r.status === 'completed' && r.conclusion === 'success')
      .map((r) => Date.parse(r.updated_at))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
      .slice(-6),
    g: number[] = []
  for (let i = 1; i < t.length; i++) {
    const h = (t[i] - t[i - 1]) / 36e5
    if (h >= 0.5 && h <= 336) g.push(h)
  }
  const h = median(g),
    pred = t.length >= 3 && h !== null ? t[t.length - 1] + h * 36e5 : null,
    next = pred === null ? now + 216e5 : Math.min(now + 216e5, Math.max(now + 9e5, pred - 9e5))
  return {
    intervalHours: h === null ? null : Math.round(h * 100) / 100,
    predictedAt: pred === null ? null : new Date(pred).toISOString(),
    nextCheckAt: new Date(next).toISOString(),
    successfulRuns: t.length,
  }
}
export async function refresh(e: Env, p: Project) {
  const fresh = await scan(e, parseRepositoryUrl(p.repoUrl), p.branch)
  const lastRuns = await runs(e, fresh)
  const now = Date.now()
  const next = {
    ...fresh,
    group: p.group || '默认分组',
    registeredAt: p.registeredAt,
    lastDistHash: fresh.distHash,
    lastDistChangedAt:
      fresh.distHash !== p.lastDistHash ? new Date(now).toISOString() : p.lastDistChangedAt,
    lastRuns,
    lastCheckedAt: new Date(now).toISOString(),
    prediction: predict(lastRuns, now),
    lastError: null,
  }
  await save(e, next)
  return next
}
