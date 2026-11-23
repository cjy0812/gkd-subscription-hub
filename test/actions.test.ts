import { afterEach, describe, expect, it, vi } from 'vitest'
import { runs } from '../src/services/actions'
import type { Project } from '../src/types'

function project(provider: 'gitlab' | 'gitea'): Project {
  return {
    id: 667,
    provider,
    providerId: '123',
    owner: provider === 'gitlab' ? 'group/subgroup' : 'owner',
    repo: 'project',
    branch: 'main',
    repoUrl:
      provider === 'gitlab'
        ? 'https://gitlab.com/group/subgroup/project'
        : 'https://gitea.com/owner/project',
    distFiles: [],
    distHash: '',
    workflows: [],
    registeredAt: '2026-11-23T00:00:00.000Z',
    lastCheckedAt: null,
    lastDistHash: null,
    lastDistChangedAt: null,
    lastRuns: [],
    prediction: {
      intervalHours: null,
      predictedAt: null,
      nextCheckAt: '2026-11-23T00:00:00.000Z',
      successfulRuns: 0,
    },
    lastError: null,
  }
}

describe('provider CI monitoring', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('maps GitLab pipelines into the shared workflow run model', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify([
          {
            id: 901,
            status: 'success',
            source: 'push',
            name: 'Build and test',
            created_at: '2026-11-22T10:00:00.000Z',
            updated_at: '2026-11-22T10:03:00.000Z',
            web_url: 'https://gitlab.com/group/project/-/pipelines/901',
            sha: 'abc123',
          },
          {
            id: 902,
            status: 'running',
            source: 'schedule',
            created_at: '2026-11-22T11:00:00.000Z',
            updated_at: '2026-11-22T11:01:00.000Z',
            web_url: 'https://gitlab.com/group/project/-/pipelines/902',
            sha: 'def456',
          },
        ]),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await runs({} as never, project('gitlab'))
    expect(result).toEqual([
      {
        workflowId: 901,
        workflowName: 'Build and test',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        created_at: '2026-11-22T10:00:00.000Z',
        updated_at: '2026-11-22T10:03:00.000Z',
        html_url: 'https://gitlab.com/group/project/-/pipelines/901',
        head_sha: 'abc123',
      },
      {
        workflowId: 902,
        workflowName: 'GitLab CI',
        event: 'schedule',
        status: 'in_progress',
        conclusion: null,
        created_at: '2026-11-22T11:00:00.000Z',
        updated_at: '2026-11-22T11:01:00.000Z',
        html_url: 'https://gitlab.com/group/project/-/pipelines/902',
        head_sha: 'def456',
      },
      {
        workflowId: 903,
        workflowName: 'GitLab CI',
        event: 'web',
        status: 'queued',
        conclusion: null,
        created_at: '2026-11-22T12:00:00.000Z',
        updated_at: '2026-11-22T12:01:00.000Z',
        html_url: 'https://gitlab.com/group/project/-/pipelines/903',
        head_sha: 'ghi789',
      },
    ])
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/projects/123/pipelines?ref=main')
  })

  it('maps Gitea Actions workflow runs into the shared workflow run model', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
          workflow_runs: [
            {
              id: 701,
              path: '.gitea/workflows/build.yml',
              event: 'push',
              status: 'success',
              conclusion: 'success',
              created_at: '2026-11-22T12:00:00.000Z',
              updated_at: '2026-11-22T12:02:00.000Z',
              html_url: 'https://gitea.com/owner/project/actions/runs/701',
              head_sha: 'ghi789',
            },
          ],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await runs({} as never, project('gitea'))
    expect(result).toEqual([
      {
        workflowId: 701,
        workflowName: 'build.yml',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        created_at: '2026-11-22T12:00:00.000Z',
        updated_at: '2026-11-22T12:02:00.000Z',
        html_url: 'https://gitea.com/owner/project/actions/runs/701',
        head_sha: 'ghi789',
      },
    ])
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/repos/owner/project/actions/runs')
  })

  it('does not fail refresh when a provider hides its public CI runs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Forbidden', { status: 403 })),
    )
    await expect(runs({} as never, project('gitea'))).resolves.toEqual([])
  })
})
