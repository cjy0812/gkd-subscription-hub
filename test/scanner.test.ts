import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractId, listBranches, parseRepo } from '../src/services/scanner'
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
})
