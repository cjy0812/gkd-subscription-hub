import type { Project, WorkflowInfo, WorkflowRun } from './types'

const RUN_EVENT_LABELS: Record<string, string> = {
  push: '代码推送', pull_request: '拉取请求', pull_request_target: '拉取请求', schedule: '定时任务', workflow_dispatch: '手动触发', release: '版本发布', repository_dispatch: '仓库事件', workflow_call: '工作流调用', web: '网页触发', api: 'API 触发', trigger: '触发器',
}

export function runEventLabel(event: string): string {
  return RUN_EVENT_LABELS[event] || event || '未知'
}

export interface MonitoringRun extends WorkflowRun {
  key: string
  projectId: number
  owner: string
  repo: string
}
export interface MonitoringWorkflow {
  key: string
  workflowId: number
  name: string
  path: string
  relevant: boolean
  runs: MonitoringRun[]
}
export interface MonitoringProject {
  id: Project['id']
  owner: Project['owner']
  repo: Project['repo']
  lastError: Project['lastError']
  workflows: MonitoringWorkflow[]
}
export interface MonitoringOverview {
  monitoredProjects: number
  runCount: number
  nonSuccessfulCount: number
  inProgressCount: number
  recentRuns: MonitoringRun[]
  projectWorkflows: MonitoringProject[]
  projectErrors: Array<Pick<Project, 'id' | 'owner' | 'repo' | 'lastError'>>
}
type MonitoringProjectInput = Pick<
  Project,
  'id' | 'owner' | 'repo' | 'lastError' | 'lastRuns' | 'workflows'
>

function groupWorkflows(project: MonitoringProjectInput): MonitoringWorkflow[] {
  const workflowMetadata = new Map<number, WorkflowInfo>(
    project.workflows.map((item) => [item.id, item]),
  )
  const runGroups = new Map<string, MonitoringRun[]>()
  const groupIds = new Map<string, number>()
  for (const run of project.lastRuns) {
    const metadata = workflowMetadata.get(run.workflowId)
    const groupKey = metadata ? `id:${run.workflowId}` : `name:${run.workflowName || 'CI Workflow'}`
    const value: MonitoringRun = {
      ...run,
      key: `${project.id}:${run.html_url}`,
      projectId: project.id,
      owner: project.owner,
      repo: project.repo,
    }
    const group = runGroups.get(groupKey) || []
    group.push(value)
    runGroups.set(groupKey, group)
    if (!groupIds.has(groupKey)) groupIds.set(groupKey, run.workflowId)
  }
  for (const metadata of workflowMetadata.values()) {
    const groupKey = `id:${metadata.id}`
    if (!runGroups.has(groupKey)) runGroups.set(groupKey, [])
    groupIds.set(groupKey, metadata.id)
  }
  return [...runGroups.entries()]
    .map(([groupKey, groupRuns]) => {
      const workflowId = groupIds.get(groupKey) || 0
      const metadata = workflowMetadata.get(workflowId)
      const runs = groupRuns.sort(
        (a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0),
      )
      return {
        key: `${project.id}:${groupKey}`,
        workflowId,
        name: metadata?.name || runs[0]?.workflowName || 'CI Workflow',
        path: metadata?.path || '工作流文件路径未记录（非 GitHub Workflow）',
        relevant: metadata?.relevant ?? true,
        runs,
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name))
}

export function buildMonitoringOverview(
  projects: readonly MonitoringProjectInput[],
  limit = 30,
): MonitoringOverview {
  const projectWorkflows = projects
    .map((project) => ({
      id: project.id,
      owner: project.owner,
      repo: project.repo,
      lastError: project.lastError,
      workflows: groupWorkflows(project),
    }))
    .filter((project) => project.workflows.length > 0 || Boolean(project.lastError))
  const allRuns = projectWorkflows.flatMap((project) =>
    project.workflows.flatMap((workflow) => workflow.runs),
  )
  allRuns.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))
  return {
    monitoredProjects: projects.filter((project) => project.lastRuns.length > 0).length,
    runCount: allRuns.length,
    nonSuccessfulCount: allRuns.filter(
      (run) => run.status === 'completed' && run.conclusion !== 'success',
    ).length,
    inProgressCount: allRuns.filter((run) => run.status !== 'completed').length,
    recentRuns: allRuns.slice(0, Math.max(0, limit)),
    projectWorkflows,
    projectErrors: projects.filter((project) => Boolean(project.lastError)),
  }
}
