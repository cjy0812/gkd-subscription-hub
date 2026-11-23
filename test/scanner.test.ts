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
      if (url.endsWith('/branches?per_page=100')) {
        return new Response(JSON.stringify([{ name: 'zeta' }, { name: 'main' }, { name: 'alpha' }]))
      }
      return new Response(JSON.stringify({ default_branch: 'main' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await listBranches({} as Env, 'owner', 'repo')
    expect(result).toEqual({
      defaultBranch: 'main',
      branches: ['main', 'alpha', 'zeta'],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
