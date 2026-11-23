import { describe, expect, it } from 'vitest'
import { buildMonitoringOverview, type MonitoringProject } from './monitoring'

function project(
  id: number,
  lastRuns: MonitoringProject['lastRuns'] = [],
  lastError: string | null = null,
): MonitoringProject {
  return {
    id,
    owner: 'owner',
    repo: `repo-${id}`,
    lastError,
    lastRuns,
  }
}

function run(workflowId: number, updatedAt: string, status: string, conclusion: string | null) {
  return {
    workflowId,
    workflowName: `Workflow ${workflowId}`,
    event: 'push',
    status,
    conclusion,
    created_at: updatedAt,
    updated_at: updatedAt,
    html_url: `https://github.com/owner/repo/actions/runs/${workflowId}`,
    head_sha: `sha-${workflowId}`,
  }
}

describe('buildMonitoringOverview', () => {
  it('aggregates runs across projects and counts non-success and unfinished runs', () => {
    const projects = [
      project(
        1,
        [
          run(1, '2026-01-01T00:00:00Z', 'completed', 'success'),
          run(2, '2026-01-02T00:00:00Z', 'completed', 'failure'),
        ],
        'Index refresh failed',
      ),
      project(2, [
        run(3, '2026-01-03T00:00:00Z', 'in_progress', null),
        run(4, '2026-01-04T00:00:00Z', 'completed', 'cancelled'),
      ]),
      project(3),
    ]

    const result = buildMonitoringOverview(projects)

    expect(result.monitoredProjects).toBe(2)
    expect(result.runCount).toBe(4)
    expect(result.nonSuccessfulCount).toBe(2)
    expect(result.inProgressCount).toBe(1)
    expect(result.projectErrors.map((item) => item.id)).toEqual([1])
    expect(result.recentRuns.map((item) => item.workflowId)).toEqual([4, 3, 2, 1])
    expect(result.recentRuns[0]).toMatchObject({ projectId: 2, owner: 'owner', repo: 'repo-2' })
  })

  it('limits the recent run list and handles empty projects', () => {
    const projects = [
      project(1, [
        run(1, '2026-01-01T00:00:00Z', 'completed', 'success'),
        run(2, '2026-01-02T00:00:00Z', 'completed', 'success'),
      ]),
    ]

    expect(buildMonitoringOverview(projects, 1).recentRuns).toHaveLength(1)
    expect(buildMonitoringOverview([], 0)).toMatchObject({
      monitoredProjects: 0,
      runCount: 0,
      nonSuccessfulCount: 0,
      inProgressCount: 0,
      recentRuns: [],
      projectErrors: [],
    })
  })
})
