import { save } from '../storage/projects'
import type { Env, Prediction, Project, WorkflowRun } from '../types'
import { scan } from './scanner'
import { readSubscriptionVersionAtRef, recordSubscriptionVersion } from './version-history'
import { getProviderAdapter, parseRepositoryUrl } from './providers'
export async function runs(e: Env, p: Project): Promise<WorkflowRun[]> {
  try {
    return await getProviderAdapter(p.provider).listWorkflowRuns(e, p)
  } catch {
    // CI availability must not block subscription scanning.
    return []
  }
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
  const previousVersion =
    p.subscriptionVersion ??
    (p.commitSha
      ? await readSubscriptionVersionAtRef(e, p.repoUrl, p.commitSha, p.id)
      : null)
  if (previousVersion !== null) {
    await recordSubscriptionVersion(e, { ...p, subscriptionVersion: previousVersion })
  }
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
  await recordSubscriptionVersion(e, next)
  await save(e, next)
  return next
}
