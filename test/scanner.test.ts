import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractId, listBranches, parseRepo } from '../src/services/scanner'
import type { Env } from '../src/types'

describe('scanner helpers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses repository URL', () =>
    expect(parseRepo('https://github.com/Lin-arm/GKD_subscription')).toEqual({
      owner: 'Lin-arm',
      repo: 'GKD_subscription',
    }))
  it('rejects invalid URL', () => expect(() => parseRepo('https://example.com/a/b')).toThrow())
  it('extracts subscription ID', () =>
    expect(extractId('defineGkdSubscription({id:667})')).toBe(667))
  it('rejects missing ID', () => expect(() => extractId('export default {}')).toThrow())

  it('lists branches with the default branch first', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/branches?per_page=100&page=1')) {
        return new Response(JSON.stringify([{ name: 'zeta' }, { name: 'main' }, { name: 'alpha' }]))
      }
      return new Response(JSON.stringify({ default_branch: 'main' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await listBranches({} as Env, 'owner', 'repo')
    expect(result).toEqual({
      defaultBranch: 'main',
      branches: ['main', 'alpha', 'zeta'],
      truncated: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('loads additional branch pages when the first page is full', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ name: `branch-${index}` }))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('page=1')) return new Response(JSON.stringify(firstPage))
      if (url.endsWith('page=2')) return new Response(JSON.stringify([{ name: 'release' }]))
      return new Response(JSON.stringify({ default_branch: 'main' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await listBranches({} as Env, 'owner', 'repo')
    expect(result.branches).toHaveLength(102)
    expect(result.branches[0]).toBe('main')
    expect(result.branches).toContain('release')
    expect(result.truncated).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
