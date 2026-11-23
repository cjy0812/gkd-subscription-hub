import type { Project, WorkflowRun } from './types'

export interface MonitoringRun extends WorkflowRun {
  key: string
  projectId: number
  owner: string
  repo: string
}

export interface MonitoringProject {
  id: Project['id']
  owner: Project['owner']
  repo: Project['repo']
  lastError: Project['lastError']
  lastRuns: Project['lastRuns']
}

export interface MonitoringOverview {
  monitoredProjects: number
  runCount: number
  nonSuccessfulCount: number
  inProgressCount: number
  recentRuns: MonitoringRun[]
  projectErrors: MonitoringProject[]
}

export function buildMonitoringOverview(
  projects: readonly MonitoringProject[],
  limit = 30,
): MonitoringOverview {
  const allRuns = projects.flatMap((project) =>
    project.lastRuns.map((run) => ({
      ...run,
      key: `${project.id}:${run.workflowId}:${run.head_sha}:${run.updated_at}`,
      projectId: project.id,
      owner: project.owner,
      repo: project.repo,
    })),
  )
  allRuns.sort(
    (left, right) => (Date.parse(right.updated_at) || 0) - (Date.parse(left.updated_at) || 0),
  )

  return {
    monitoredProjects: projects.filter((project) => project.lastRuns.length > 0).length,
    runCount: allRuns.length,
    nonSuccessfulCount: allRuns.filter(
      (run) => run.status === 'completed' && run.conclusion !== 'success',
    ).length,
    inProgressCount: allRuns.filter((run) => run.status !== 'completed').length,
    recentRuns: allRuns.slice(0, Math.max(0, limit)),
    projectErrors: projects.filter((project) => Boolean(project.lastError)),
  }
}
