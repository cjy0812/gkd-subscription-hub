import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchProjectFile, getProviderAdapter, parseRepositoryUrl } from '../src/services/providers'
import type { Env } from '../src/types'

describe('repository provider adapters', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses supported public repository URLs', () => {
    expect(parseRepositoryUrl('https://github.com/owner/repo').provider).toBe('github')
    expect(parseRepositoryUrl('https://gitlab.com/group/subgroup/project').fullPath).toBe(
      'group/subgroup/project',
    )
    expect(parseRepositoryUrl('https://gitea.com/owner/repo').provider).toBe('gitea')
  })

  it('rejects GitLab project sub-pages and unsupported hosts', () => {
    expect(() => parseRepositoryUrl('https://gitlab.com/group/project/-/tree/main')).toThrow()
    expect(() => parseRepositoryUrl('https://gitlab.example.com/group/project')).toThrow()
  })

  it('uses GitLab keyset pagination for branches', async () => {
    const nextUrl =
      'https://gitlab.com/api/v4/projects/group%2Fsubgroup%2Fproject/repository/branches?pagination=keyset&page_token=next'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('page_token=next')) {
        return new Response(JSON.stringify([{ name: 'develop' }]))
      }
      if (url.includes('/repository/branches?')) {
        return new Response(JSON.stringify([{ name: 'release' }]), {
          headers: { link: `<${nextUrl}>; rel="next"` },
        })
      }
      return new Response(
        JSON.stringify({
          id: 123,
          path_with_namespace: 'group/subgroup/project',
          web_url: 'https://gitlab.com/group/subgroup/project',
          default_branch: 'main',
          visibility: 'public',
          archived: false,
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const locator = parseRepositoryUrl('https://gitlab.com/group/subgroup/project')
    const result = await getProviderAdapter('gitlab').listBranches({} as Env, locator)
    expect(result).toEqual({
      defaultBranch: 'main',
      branches: ['main', 'develop', 'release'],
      truncated: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reads GitLab dist file sizes from blob metadata', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/repository/tree?')) {
        return new Response(
          JSON.stringify([
            { id: 'blob-a', path: 'dist/gkd.json5', type: 'blob' },
            { id: 'tree-a', path: 'dist/nested', type: 'tree' },
          ]),
        )
      }
      if (url.endsWith('/repository/blobs/blob-a')) {
        return new Response(JSON.stringify({ size: 1234 }))
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const locator = parseRepositoryUrl('https://gitlab.com/group/subgroup/project')
    const result = await getProviderAdapter('gitlab').listDistFiles(
      {} as Env,
      locator,
      'commit-sha',
    )
    expect(result).toEqual([{ path: 'gkd.json5', sha: 'blob-a', size: 1234 }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses the GitLab immutable blob endpoint for subscription delivery', () => {
    const url = getProviderAdapter('gitlab').rawFileUrl(
      {
        provider: 'gitlab',
        providerId: '123',
        owner: 'group/subgroup',
        repo: 'project',
        branch: 'main',
      },
      { path: 'gkd.json5', sha: 'blob-sha', size: 10 },
    )
    expect(url).toBe('https://gitlab.com/api/v4/projects/123/repository/blobs/blob-sha/raw')
  })

  it('lists Gitea branches and builds a commit-pinned media URL', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/branches?limit=50&page=1')) {
        return new Response(JSON.stringify([{ name: 'develop' }]))
      }
      return new Response(
        JSON.stringify({
          id: 42,
          full_name: 'owner/repo',
          html_url: 'https://gitea.com/owner/repo',
          default_branch: 'main',
          private: false,
          archived: false,
          fork: false,
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const locator = parseRepositoryUrl('https://gitea.com/owner/repo')
    const result = await getProviderAdapter('gitea').listBranches({} as Env, locator)
    expect(result.branches).toEqual(['main', 'develop'])
    const url = getProviderAdapter('gitea').rawFileUrl(
      {
        provider: 'gitea',
        owner: 'owner',
        repo: 'repo',
        branch: 'main',
        commitSha: 'commit-sha',
      },
      { path: 'nested/gkd.json5', sha: 'blob-sha', size: 10 },
    )
    expect(url).toBe(
      'https://gitea.com/api/v1/repos/owner/repo/media/commit-sha/dist/nested/gkd.json5',
    )
  })

  it('lists GitHub run jobs and downloads step logs through the official API', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/actions/runs/99/jobs'))
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 7,
                name: 'Build',
                status: 'completed',
                conclusion: 'success',
                steps: [
                  { number: 1, name: 'Checkout', status: 'completed', conclusion: 'success' },
                ],
              },
            ],
          }),
        )
      return new Response('step log')
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = getProviderAdapter('github')
    const project = { owner: 'owner', repo: 'repo', branch: 'main' }
    const jobs = await adapter.listRunJobs({} as Env, project, 99)
    expect(jobs[0]).toMatchObject({
      id: 7,
      name: 'Build',
      steps: [{ number: 1, name: 'Checkout' }],
    })
    await expect(adapter.getJobLog({} as Env, project, 7, 1)).resolves.toBe('step log')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/actions/jobs/7/steps/1/logs')
  })

  it('falls back to complete GitHub job logs when step logs are unavailable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/steps/1/logs')) return new Response(null, { status: 404 })
      return new Response('full job log')
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = getProviderAdapter('github')
    const log = await adapter.getJobLog(
      {} as Env,
      { owner: 'owner', repo: 'repo', branch: 'main' },
      7,
      1,
    )
    expect(log).toContain('暂未提供该 Step 的独立日志')
    expect(log).toContain('full job log')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/actions/jobs/7/logs')
  })

  it('loads GitLab pipeline jobs and job traces', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/pipelines/88/jobs')) {
        return new Response(JSON.stringify([{ id: 9, name: 'test', status: 'success' }]))
      }
      return new Response('gitlab trace')
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = getProviderAdapter('gitlab')
    const project = {
      provider: 'gitlab' as const,
      providerId: '123',
      owner: 'group',
      repo: 'repo',
      branch: 'main',
    }
    const jobs = await adapter.listRunJobs({} as Env, project, 88)
    expect(jobs[0]).toMatchObject({
      id: 9,
      name: 'test',
      steps: [{ number: 0, name: 'Job 日志' }],
    })
    await expect(adapter.getJobLog({} as Env, project, 9)).resolves.toBe('gitlab trace')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/jobs/9/trace')
  })

  it('loads Gitea workflow jobs and job logs', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/actions/runs/77/jobs')) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 12,
                name: 'Build',
                status: 'success',
                steps: [{ number: 1, name: 'Checkout', status: 'success' }],
              },
            ],
          }),
        )
      }
      return new Response('gitea log')
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = getProviderAdapter('gitea')
    const project = { owner: 'owner', repo: 'repo', branch: 'main' }
    const jobs = await adapter.listRunJobs({} as Env, project, 77)
    expect(jobs[0]).toMatchObject({
      id: 12,
      name: 'Build',
      steps: [{ number: 1, name: 'Checkout' }],
    })
    await expect(adapter.getJobLog({} as Env, project, 12)).resolves.toBe('gitea log')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/actions/jobs/12/logs')
  })

  it('paginates GitHub workflow jobs beyond the first 100', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('page=1')) return new Response(JSON.stringify({ jobs: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Job ${i + 1}`, status: 'completed', conclusion: 'success' })) }))
      return new Response(JSON.stringify({ jobs: [{ id: 101, name: 'Job 101', status: 'completed', conclusion: 'success' }] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const jobs = await getProviderAdapter('github').listRunJobs({} as Env, { owner: 'owner', repo: 'repo', branch: 'main' }, 99)
    expect(jobs).toHaveLength(101)
    expect(jobs.at(-1)?.id).toBe(101)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('paginates GitLab pipeline jobs using the next link', async () => {
    const nextUrl = 'https://gitlab.com/api/v4/projects/123/pipelines/88/jobs?pagination=keyset&page_token=next'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('page_token=next')) return new Response(JSON.stringify([{ id: 101, name: 'next', status: 'success' }]))
      return new Response(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `job-${i + 1}`, status: 'success' }))), { headers: { link: `<${nextUrl}>; rel="next"` } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const jobs = await getProviderAdapter('gitlab').listRunJobs({} as Env, { provider: 'gitlab', providerId: '123', owner: 'group', repo: 'repo', branch: 'main' }, 88)
    expect(jobs).toHaveLength(101)
    expect(jobs.at(-1)?.id).toBe(101)
  })

  it('paginates Gitea workflow jobs beyond the first page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('page=1')) return new Response(JSON.stringify({ jobs: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `Job ${i + 1}`, status: 'success' })) }))
      return new Response(JSON.stringify({ jobs: [{ id: 51, name: 'Job 51', status: 'success' }] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const jobs = await getProviderAdapter('gitea').listRunJobs({} as Env, { owner: 'owner', repo: 'repo', branch: 'main' }, 77)
    expect(jobs).toHaveLength(51)
    expect(jobs.at(-1)?.id).toBe(51)
  })

  it('rejects workflow logs above the bounded response size', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))),
    )
    const adapter = getProviderAdapter('github')
    await expect(
      adapter.getJobLog({} as Env, { owner: 'owner', repo: 'repo', branch: 'main' }, 7),
    ).rejects.toThrow('超过 2 MB 上限')
  })

  it('forwards HEAD and ETag to the provider raw endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 304 }))
    vi.stubGlobal('fetch', fetchMock)
    const project = {
      provider: 'github' as const,
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      commitSha: 'commit-sha',
    }
    const response = await fetchProjectFile(
      {} as Env,
      project,
      { path: 'gkd.json5', sha: 'blob-sha', size: 10 },
      { method: 'HEAD', ifNoneMatch: '"etag-value"' },
    )
    expect(response.status).toBe(304)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/owner/repo/commit-sha/dist/gkd.json5',
      expect.objectContaining({
        method: 'HEAD',
        headers: { 'if-none-match': '"etag-value"' },
      }),
    )
  })
})
