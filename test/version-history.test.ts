import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSubscriptionVersionAtRef, recordSubscriptionVersion, readVersionContent } from '../src/services/version-history'
import { listVersionSnapshots } from '../src/storage/versions'
import type { Env, Project } from '../src/types'

function makeState() {
  const data = new Map<string, string>()
  return {
    data,
    namespace: {
      get: async (key: string, type?: string) => {
        const value = data.get(key)
        if (value === undefined) return null
        return type === 'json' ? JSON.parse(value) : value
      },
      put: async (key: string, value: string) => { data.set(key, value) },
      delete: async (key: string) => { data.delete(key) },
    } as unknown as KVNamespace,
  }
}

function makeProject(): Project {
  return {
    id: 233,
    provider: 'github',
    owner: 'owner',
    repo: 'repo',
    branch: 'main',
    commitSha: 'commit-643',
    subscriptionVersion: 643,
    repoUrl: 'https://github.com/owner/repo',
    distFiles: [{ path: 'gkd.json5', sha: 'blob-sha', size: 100 }],
    distHash: 'hash',
    workflows: [],
    registeredAt: '2026-01-01T00:00:00Z',
    lastCheckedAt: null,
    lastDistHash: null,
    lastDistChangedAt: null,
    lastRuns: [],
    prediction: { intervalHours: null, predictedAt: null, nextCheckAt: '', successfulRuns: 0 },
    lastError: null,
  }
}

describe('subscription version history', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the version from the GKD version metadata file', async () => {
    const source = '{id:233,version:643}'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      content: btoa(source),
      encoding: 'base64',
    })))
    vi.stubGlobal('fetch', fetchMock)
    const version = await readSubscriptionVersionAtRef(
      { STATE: {} } as Env,
      'https://github.com/owner/repo',
      'commit-643',
      233,
    )
    expect(version).toBe(643)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('records an immutable Git snapshot when R2 is not configured', async () => {
    const state = makeState()
    const env = { STATE: state.namespace } as Env
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{id:233,version:643}')))
    const record = await recordSubscriptionVersion(env, makeProject())
    expect(record).toMatchObject({
      id: 233,
      version: 643,
      commitSha: 'commit-643',
      archiveStatus: 'git-only',
    })
    expect((await listVersionSnapshots(env, 233))).toHaveLength(1)
    expect(await readVersionContent(env, record!)).toBe('{id:233,version:643}')
  })

  it('stores and verifies the R2 copy when an archive binding is configured', async () => {
    const state = makeState()
    let stored = ''
    const bucket = {
      put: vi.fn(async (_key: string, value: string) => { stored = value }),
      get: vi.fn(async () => stored ? { text: async () => stored } : null),
    }
    const env = { STATE: state.namespace, HISTORY_ARCHIVE: bucket } as unknown as Env
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{id:233,version:643}')))
    const record = await recordSubscriptionVersion(env, makeProject())
    expect(record?.archiveStatus).toBe('r2-archived')
    expect(bucket.put).toHaveBeenCalledOnce()
    expect(await readVersionContent(env, record!)).toBe('{id:233,version:643}')
    expect(bucket.get).toHaveBeenCalledWith('subscriptions/233/v643/gkd.json5')
  })
})
