import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readSubscriptionVersionAtRef,
  recordSubscriptionVersion,
  readVersionContent,
} from '../src/services/version-history'
import { listVersionSnapshots, saveVersionSnapshot, type VersionSnapshot } from '../src/storage/versions'
import { readBoundedSnapshotResponse } from '../src/services/version-history'
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
      put: async (key: string, value: string) => {
        data.set(key, value)
      },
      delete: async (key: string) => {
        data.delete(key)
      },
      list: async (options: { prefix?: string; limit?: number }) => ({
        keys: [...data.keys()]
          .filter((key) => key.startsWith(options.prefix || ''))
          .sort()
          .slice(0, options.limit || 1000)
          .map((name) => ({ name, expiration: null, metadata: null })),
        list_complete: true,
        cursor: undefined,
        cacheStatus: null,
      }),
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
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: btoa(source),
            encoding: 'base64',
          }),
        ),
    )
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

  it('rejects historical reads when a checksum is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const legacySnapshot = {
      id: 233,
      version: 642,
      provider: 'github' as const,
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      repoUrl: 'https://github.com/owner/repo',
      commitSha: 'commit-642',
      fileSha: 'blob-642',
      fileSize: 10,
      createdAt: '2026-01-01T00:00:00Z',
      archiveStatus: 'git-only' as const,
    }
    await expect(readVersionContent({ STATE: {} } as Env, legacySnapshot)).rejects.toThrow(
      '缺少有效的 SHA-256',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels historical response streams when the server-side byte limit is exceeded', async () => {
    const cancel = vi.fn()
    const encoder = new TextEncoder()
    let index = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode(index++ === 0 ? '123456' : '789'))
      },
      cancel,
    })
    await expect(readBoundedSnapshotResponse(new Response(stream), 8)).rejects.toThrow(
      '超过 20 MB',
    )
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('stores versions under independent keys so concurrent releases cannot overwrite each other', async () => {
    const state = makeState()
    const env = { STATE: state.namespace } as Env
    const makeSnapshot = (version: number): VersionSnapshot => ({
      id: 233,
      version,
      provider: 'github',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      repoUrl: 'https://github.com/owner/repo',
      commitSha: 'commit-' + version,
      fileSha: 'blob-' + version,
      fileSize: 10,
      createdAt: new Date(version).toISOString(),
      archiveStatus: 'git-only',
      contentSha256: 'a'.repeat(64),
    })
    await Promise.all([
      saveVersionSnapshot(env, makeSnapshot(643)),
      saveVersionSnapshot(env, makeSnapshot(644)),
    ])
    expect(await listVersionSnapshots(env, 233)).toMatchObject([
      { version: 643, commitSha: 'commit-643' },
      { version: 644, commitSha: 'commit-644' },
    ])
  })

  it('records an immutable Git-only snapshot', async () => {
    const state = makeState()
    const env = { STATE: state.namespace } as Env
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{id:233,version:643}')),
    )
    const record = await recordSubscriptionVersion(env, makeProject())
    expect(record).toMatchObject({
      id: 233,
      version: 643,
      commitSha: 'commit-643',
      archiveStatus: 'git-only',
    })
    expect(await listVersionSnapshots(env, 233)).toHaveLength(1)
    if (!record) throw new Error('Expected a recorded Git history snapshot')
    expect(await readVersionContent(env, record)).toBe('{id:233,version:643}')
  })
})
