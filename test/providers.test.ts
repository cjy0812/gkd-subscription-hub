import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchProjectFile,
  getProviderAdapter,
  parseRepositoryUrl,
} from '../src/services/providers'
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
      if (url.includes('/repository/branches?')) {
        return new Response(JSON.stringify([{ name: 'release' }]), {
          headers: { link: `<${nextUrl}>; rel="next"` },
        })
      }
      if (url.includes('page_token=next')) {
        return new Response(JSON.stringify([{ name: 'develop' }]))
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
    expect(url).toBe(
      'https://gitlab.com/api/v4/projects/123/repository/blobs/blob-sha/raw',
    )
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
