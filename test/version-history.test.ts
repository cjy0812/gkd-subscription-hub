import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readBoundedSnapshotResponse,
  recordSubscriptionVersion,
  readVersionContent,
} from '../src/services/version-history'
import { getVersionSnapshot, type VersionSnapshot } from '../src/storage/versions'
import type { Env, Project } from '../src/types'

type Row = Record<string, unknown>

function makeDatabase(limit = 512 * 1024 * 1024) {
  const versions = new Map<string, Row>()
  const objects = new Map<string, Row>()
  const usage = new Map<string, { r2_reads: number; r2_writes: number }>()
  const key = (id: number, repo: string, version: number) => `${id}:${repo}:${version}`
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const execute = async (): Promise<Row | null> => {
            if (sql.includes('INSERT INTO subscription_versions')) {
              const [id, repo, version, snapshot, status, createdAt] = values as [
                number,
                string,
                number,
                string,
                string,
                string,
              ]
              const k = key(id, repo, version)
              if (!versions.has(k)) {
                versions.set(k, {
                  snapshot_json: snapshot,
                  status,
                  content_sha256: null,
                  object_key: null,
                  compressed_size: null,
                  archive_error: null,
                  created_at: createdAt,
                })
              }
              return null
            }
            if (sql.includes('SELECT snapshot_json') && sql.includes('subscription_versions')) {
              const [id, repo, version] = values as [number, string, number]
              return versions.get(key(id, repo, version)) || null
            }
            if (sql.includes('INSERT INTO archive_objects')) {
              const [hash, objectKey, originalSize, compressedSize, status, createdAt] = values as [
                string,
                string,
                number,
                number,
                string,
                string,
              ]
              if (!objects.has(hash)) {
                const used = [...objects.values()].reduce(
                  (sum, item) => sum + Number(item.compressed_size),
                  0,
                )
                if (used + compressedSize > limit) throw new Error('R2_ARCHIVE_QUOTA_EXCEEDED')
                objects.set(hash, {
                  content_sha256: hash,
                  object_key: objectKey,
                  original_size: originalSize,
                  compressed_size: compressedSize,
                  status,
                  created_at: createdAt,
                })
              }
              return null
            }
            if (sql.includes('SELECT content_sha256') && sql.includes('archive_objects')) {
              return objects.get(String(values[0])) || null
            }
            if (sql.includes('UPDATE archive_objects')) {
              const row = objects.get(String(values[0]))
              if (row) row.status = 'ready'
              return null
            }
            if (sql.includes("UPDATE subscription_versions SET status = 'ready'")) {
              const [hash, objectKey, originalSize, compressedSize, id, repo, version] = values as [
                string,
                string,
                number,
                number,
                number,
                string,
                number,
              ]
              const row = versions.get(key(id, repo, version))
              if (row && row.status !== 'ready')
                Object.assign(row, {
                  status: 'ready',
                  content_sha256: hash,
                  object_key: objectKey,
                  original_size: originalSize,
                  compressed_size: compressedSize,
                  archive_error: null,
                })
              return null
            }
            if (sql.includes("UPDATE subscription_versions SET status = 'unavailable'")) {
              const [error, id, repo, version] = values as [string, number, string, number]
              const row = versions.get(key(id, repo, version))
              if (row && row.status !== 'ready')
                Object.assign(row, { status: 'unavailable', archive_error: error })
              return null
            }
            if (sql.includes('INSERT INTO archive_daily_usage')) {
              const isRead = sql.includes('r2_reads = r2_reads + 1')
              const day = '2026-11-25'
              const row = usage.get(day) || { r2_reads: 0, r2_writes: 0 }
              const field = isRead ? 'r2_reads' : 'r2_writes'
              const max = isRead ? 50000 : 500
              if (row[field] >= max) return null
              row[field] += 1
              usage.set(day, row)
              return { [field]: row[field] }
            }
            return null
          }
          return {
            run: async () => {
              await execute()
              return { success: true, meta: {} }
            },
            first: async <T>() => (await execute()) as T | null,
            all: async <T>() => {
              if (sql.includes('FROM subscription_versions')) {
                const [id, repo] = values as [number, string]
                const rows = [...versions.entries()]
                  .filter(([k]) => k.startsWith(`${id}:${repo}:`))
                  .map(([, row]) => row) as T[]
                return { results: rows, success: true, meta: {} }
              }
              return { results: [] as T[], success: true, meta: {} }
            },
          }
        },
      }
    },
  }
  return { db: db as unknown as D1Database, versions, objects, usage }
}

function makeState() {
  return {
    get: async () => null,
    list: async () => ({ keys: [], list_complete: true, cursor: undefined }),
  } as unknown as KVNamespace
}

function makeProject(version = 643, repo = 'repo'): Project {
  return {
    id: 233,
    provider: 'github',
    owner: 'owner',
    repo,
    branch: 'main',
    commitSha: `commit-${version}`,
    subscriptionVersion: version,
    repoUrl: `https://github.com/owner/${repo}`,
    distFiles: [
      {
        path: 'gkd.json5',
        sha: `blob-${version}`,
        size: new TextEncoder().encode('{id:233,version:643}').byteLength,
      },
    ],
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

function makeBucket() {
  const stored = new Map<string, { bytes: Uint8Array; customMetadata?: Record<string, string> }>()
  let puts = 0
  return {
    stored,
    get puts() {
      return puts
    },
    bucket: {
      head: async (key: string) => {
        const item = stored.get(key)
        return item ? {
          size: item.bytes.byteLength,
          customMetadata: item.customMetadata,
        } : null
      },
      put: async (
        key: string,
        value: ArrayBuffer | ArrayBufferView | string | ReadableStream,
        options?: { customMetadata?: Record<string, string> },
      ) => {
        const bytes = new Uint8Array(await new Response(value as BodyInit).arrayBuffer())
        stored.set(key, { bytes, customMetadata: options?.customMetadata })
        puts += 1
        return null
      },
      get: async (key: string) => {
        const item = stored.get(key)
        return item ? {
          size: item.bytes.byteLength,
          customMetadata: item.customMetadata,
          body: new Response(item.bytes).body,
        } : null
      },
    } as unknown as R2Bucket,
  }
}

function makeEnv(limit?: number) {
  const database = makeDatabase(limit)
  const bucket = makeBucket()
  const env = {
    STATE: makeState(),
    VERSIONS: database.db,
    ARCHIVE: bucket.bucket,
  } as Env
  return { env, database, bucket }
}

describe('Cloudflare R2 subscription version archive', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('archives compressed content, restores the exact bytes, and deduplicates identical versions', async () => {
    const { env, bucket, database } = makeEnv()
    const source = '{id:233,version:643}'
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(source)])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes)),
    )

    const firstProject = makeProject()
    firstProject.distFiles[0].size = bytes.byteLength
    const first = await recordSubscriptionVersion(env, firstProject)
    expect(first?.archiveStatus).toBe('r2')
    expect(first?.contentSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(bucket.puts).toBe(1)
    expect(await readVersionContent(env, first as VersionSnapshot)).toEqual(bytes)

    const secondProject = makeProject(644)
    secondProject.distFiles[0] = {
      path: 'gkd.json5',
      sha: 'different-blob',
      size: bytes.byteLength,
    }
    const second = await recordSubscriptionVersion(env, secondProject)
    expect(second?.archiveStatus).toBe('r2')
    expect(second?.objectKey).toBe(first?.objectKey)
    expect(bucket.puts).toBe(1)
    expect(database.objects.size).toBe(1)
  })

  it('rejects new objects when the configured compressed-storage budget is exhausted', async () => {
    const { env, bucket } = makeEnv(0)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{id:233,version:643}')))
    const record = await recordSubscriptionVersion(env, makeProject())
    expect(record?.archiveStatus).toBe('unavailable')
    expect(record?.archiveError).toContain('容量')
    expect(bucket.puts).toBe(0)
  })

  it('does not mix historical records between repositories reusing a subscription ID', async () => {
    const { env } = makeEnv()
    const source = new Uint8Array(new TextEncoder().encode('{id:233,version:643}'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(source)))
    await recordSubscriptionVersion(env, makeProject())
    expect(await getVersionSnapshot(env, 233, 643, makeProject(643, 'different-repo'))).toBeNull()
  })

  it('cancels a source stream when its byte limit is exceeded', async () => {
    const cancel = vi.fn()
    let index = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode(index++ === 0 ? '123456' : '789'))
      },
      cancel,
    })
    await expect(readBoundedSnapshotResponse(new Response(stream), 8)).rejects.toThrow('超过 20 MB')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects an archived object whose compressed payload has been altered', async () => {
    const { env, bucket } = makeEnv()
    const bytes = new TextEncoder().encode('{id:233,version:643}')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)))
    const record = await recordSubscriptionVersion(env, makeProject())
    expect(record?.archiveStatus).toBe('r2')
    const objectKey = record?.objectKey as string
    const item = bucket.stored.get(objectKey)
    if (!item) throw new Error('Expected an R2 object')
    item.bytes[0] ^= 0xff
    await expect(readVersionContent(env, record as VersionSnapshot)).rejects.toThrow()
  })
})
