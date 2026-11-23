import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractId, listBranches, parseRepo, scan } from '../src/services/scanner'
import type { Env } from '../src/types'

const github = {
  provider: 'github',
  host: 'github.com',
  namespace: 'owner',
  repo: 'repo',
  fullPath: 'owner/repo',
} as const

describe('scanner helpers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses GitHub repository URLs', () => {
    expect(parseRepo('https://github.com/Lin-arm/GKD_subscription')).toEqual({
      provider: 'github',
      host: 'github.com',
      namespace: 'Lin-arm',
      repo: 'GKD_subscription',
      fullPath: 'Lin-arm/GKD_subscription',
    })
  })

  it('parses nested GitLab namespaces', () => {
    expect(parseRepo('https://gitlab.com/group/subgroup/project.git')).toEqual({
      provider: 'gitlab',
      host: 'gitlab.com',
      namespace: 'group/subgroup',
      repo: 'project',
      fullPath: 'group/subgroup/project',
    })
  })

  it('parses Gitea repository URLs', () => {
    expect(parseRepo('https://gitea.com/owner/repo')).toEqual({
      provider: 'gitea',
      host: 'gitea.com',
      namespace: 'owner',
      repo: 'repo',
      fullPath: 'owner/repo',
    })
  })

  it('rejects unknown hosts, HTTP URLs and extra GitHub path segments', () => {
    expect(() => parseRepo('https://example.com/a/b')).toThrow()
    expect(() => parseRepo('http://github.com/a/b')).toThrow()
    expect(() => parseRepo('https://github.com/a/b/tree/main')).toThrow()
  })

  it('extracts subscription ID', () =>
    expect(extractId('defineGkdSubscription({id:667})')).toBe(667))
  it('rejects missing ID', () => expect(() => extractId('export default {}')).toThrow())

  it('lists GitHub branches with the default branch first', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/branches?per_page=100&page=1')) {
        return new Response(JSON.stringify([{ name: 'zeta' }, { name: 'main' }, { name: 'alpha' }]))
      }
      return new Response(
        JSON.stringify({ default_branch: 'main', private: false, archived: false }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await listBranches({} as Env, github)
    expect(result).toEqual({
      defaultBranch: 'main',
      branches: ['main', 'alpha', 'zeta'],
      truncated: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('loads additional GitHub branch pages when the first page is full', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ name: `branch-${index}` }))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('page=1')) return new Response(JSON.stringify(firstPage))
      if (url.endsWith('page=2')) {
        return new Response(JSON.stringify([{ name: 'release' }]))
      }
      return new Response(
        JSON.stringify({ default_branch: 'main', private: false, archived: false }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await listBranches({} as Env, github)
    expect(result.branches).toHaveLength(102)
    expect(result.branches[0]).toBe('main')
    expect(result.branches).toContain('release')
    expect(result.truncated).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('scans a GitLab project through the provider adapter', async () => {
    const source = 'defineGkdSubscription({id:667})'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/repository/branches/main')) {
        return new Response(JSON.stringify({ commit: { id: 'commit-sha' } }))
      }
      if (url.includes('/repository/files/src%2Fsubscription.ts')) {
        return new Response(JSON.stringify({ content: btoa(source), encoding: 'base64' }))
      }
      if (url.includes('/repository/tree?')) {
        return new Response(
          JSON.stringify([{ id: 'blob-sha', path: 'dist/gkd.json5', type: 'blob', size: 100 }]),
        )
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
    const project = await scan({} as Env, parseRepo('https://gitlab.com/group/subgroup/project'))
    expect(project.provider).toBe('gitlab')
    expect(project.providerId).toBe('123')
    expect(project.owner).toBe('group/subgroup')
    expect(project.repo).toBe('project')
    expect(project.id).toBe(667)
    expect(project.commitSha).toBe('commit-sha')
    expect(project.distFiles).toEqual([{ path: 'gkd.json5', sha: 'blob-sha', size: 100 }])
    expect(project.workflows).toEqual([])
  })

  it('scans a Gitea project through the provider adapter', async () => {
    const source = 'defineGkdSubscription({id:668})'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/branches/main')) {
        return new Response(JSON.stringify({ commit: { id: 'gitea-commit' } }))
      }
      if (url.includes('/contents/src/subscription.ts')) {
        return new Response(JSON.stringify({ content: btoa(source), encoding: 'base64' }))
      }
      if (url.includes('/git/trees/gitea-commit')) {
        return new Response(
          JSON.stringify({
            tree: [{ type: 'blob', path: 'dist/gkd.json5', sha: 'gitea-blob', size: 80 }],
            truncated: false,
          }),
        )
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
    const project = await scan({} as Env, parseRepo('https://gitea.com/owner/repo'))
    expect(project.provider).toBe('gitea')
    expect(project.providerId).toBe('42')
    expect(project.id).toBe(668)
    expect(project.commitSha).toBe('gitea-commit')
    expect(project.distFiles).toEqual([{ path: 'gkd.json5', sha: 'gitea-blob', size: 80 }])
    expect(project.workflows).toEqual([])
  })

})
