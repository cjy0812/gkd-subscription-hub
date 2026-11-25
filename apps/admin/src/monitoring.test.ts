import { describe, expect, it } from 'vitest'
import { buildMonitoringOverview } from './monitoring'
import type { Project } from './types'

function project(
  id: number,
  workflows: Project['workflows'],
  lastRuns: Project['lastRuns'] = [],
  lastError: string | null = null,
): Project {
  return {
    id,
    owner: 'owner',
    repo: `repo-${id}`,
    branch: 'main',
    repoUrl: 'https://github.com/owner/repo',
    distFiles: [],
    distHash: '',
    workflows,
    registeredAt: '2026-01-01T00:00:00Z',
    lastCheckedAt: null,
    lastDistHash: null,
    lastDistChangedAt: null,
    lastRuns,
    prediction: { intervalHours: null, predictedAt: null, nextCheckAt: '', successfulRuns: 0 },
    lastError,
  }
}
function run(
  workflowId: number,
  updatedAt: string,
  status: string,
  conclusion: string | null,
  runId = workflowId,
) {
  return {
    workflowId,
    workflowName: `Workflow ${workflowId}`,
    event: 'push',
    status,
    conclusion,
    created_at: updatedAt,
    updated_at: updatedAt,
    html_url: `https://github.com/owner/repo/actions/runs/${runId}`,
    head_sha: `sha-${workflowId}`,
  }
}

describe('buildMonitoringOverview', () => {
  it('groups runs by project and workflow YAML file while retaining aggregate counts', () => {
    const result = buildMonitoringOverview([
      project(
        1,
        [
          { id: 1, name: 'Build', path: '.github/workflows/build.yml', cron: [], relevant: true },
          {
            id: 2,
            name: 'Release',
            path: '.github/workflows/release.yml',
            cron: [],
            relevant: true,
          },
        ],
        [
          run(1, '2026-01-01T00:00:00Z', 'completed', 'success'),
          run(2, '2026-01-02T00:00:00Z', 'completed', 'failure'),
        ],
        'Index refresh failed',
      ),
      project(2, [], [run(3, '2026-01-03T00:00:00Z', 'in_progress', null)]),
    ])
    expect(result.monitoredProjects).toBe(2)
    expect(result.runCount).toBe(3)
    expect(result.nonSuccessfulCount).toBe(1)
    expect(result.inProgressCount).toBe(1)
    expect(result.projectWorkflows[0].workflows.map((workflow) => workflow.path)).toEqual([
      '.github/workflows/build.yml',
      '.github/workflows/release.yml',
    ])
    expect(result.projectWorkflows[1].workflows[0]).toMatchObject({
      name: 'Workflow 3',
      path: '工作流文件路径未记录（非 GitHub Workflow）',
    })
    expect(result.projectErrors.map((item) => item.id)).toEqual([1])
  })

  it('sorts monitoring records by trigger time, not the later update time', () => {
    const result = buildMonitoringOverview([project(1, [], [
      run(1, '2026-01-02T00:00:00Z', 'completed', 'success', 1, '2026-01-05T00:00:00Z'),
      run(2, '2026-01-01T00:00:00Z', 'completed', 'success', 2, '2026-01-06T00:00:00Z'),
    ])])
    expect(result.recentRuns.map((item) => item.workflowId)).toEqual([1, 2])
  })

  it('applies a limit to recent runs and handles empty projects', () => {
    const overview = buildMonitoringOverview(
      [
        project(
          1,
          [],
          [
            run(1, '2026-01-01T00:00:00Z', 'completed', 'success', 1),
            run(1, '2026-01-02T00:00:00Z', 'completed', 'success', 2),
          ],
        ),
      ],
      1,
    )
    expect(overview.recentRuns).toHaveLength(1)
    expect(buildMonitoringOverview([])).toMatchObject({
      monitoredProjects: 0,
      runCount: 0,
      nonSuccessfulCount: 0,
      inProgressCount: 0,
      recentRuns: [],
      projectWorkflows: [],
      projectErrors: [],
    })
  })
})
