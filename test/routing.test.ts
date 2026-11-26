import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import type { Env } from '../src/types'

function environment(overrides: Partial<Env> = {}) {
  return {
    STATE: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    } as unknown as KVNamespace,
    ASSETS: {
      fetch: vi.fn(async (request: Request) => new Response(new URL(request.url).pathname)),
    } as unknown as Fetcher,
    ADMIN_PASSWORD: 'test-password',
    SUBSCRIPTION_DOMAIN: 'gkd.example.com',
    ...overrides,
  } as Env
}

const context = { waitUntil: vi.fn() } as unknown as ExecutionContext

describe('top-level routing', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('serves the public portal at the root without redirecting to Admin', async () => {
    const env = environment()
    const response = await worker.fetch(new Request('https://gkd.example.com/'), env, context)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('/')
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce()
  })

  it('exposes public subscription data without requiring Admin auth', async () => {
    const response = await worker.fetch(
      new Request('https://gkd.example.com/api/public/subscriptions'),
      environment(),
      context,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, subscriptions: [] })
  })

  it('returns the exact indexed subscription filename for public copy links', async () => {
    const project = {
      id: 233,
      provider: 'github',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      repoUrl: 'https://github.com/owner/repo',
      distFiles: [{ path: 'GKD.JSON5', sha: 'blob-sha', size: 42 }],
    }
    const env = environment({
      STATE: {
        get: vi.fn(async (key: string) => {
          if (key === 'projects:index') return [233]
          if (key === 'project:233') return project
          return null
        }),
      } as unknown as KVNamespace,
    })
    const response = await worker.fetch(
      new Request('https://gkd.example.com/api/public/subscriptions'),
      env,
      context,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      subscriptions: [
        {
          id: 233,
          hasSubscription: true,
          subscriptionPath: 'GKD.JSON5',
        },
      ],
    })
  })

  it('returns an empty run list for older project snapshots without lastRuns', async () => {
    const project = {
      id: 233,
      provider: 'github',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      repoUrl: 'https://github.com/owner/repo',
      registeredAt: '2026-01-01T00:00:00.000Z',
      fileCount: 1,
      distFiles: [{ path: 'gkd.json5', sha: 'blob-sha', size: 42 }],
    }
    const env = environment({
      STATE: {
        get: vi.fn(async (key: string) => {
          if (key === 'projects:index') return [233]
          if (key === 'project:233') return project
          return null
        }),
      } as unknown as KVNamespace,
    })
    const response = await worker.fetch(
      new Request('https://gkd.example.com/api/public/subscriptions'),
      env,
      context,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      subscriptions: [{ id: 233, lastRuns: [] }],
    })
  })

  it('keeps ordinary JSON files raw until the generic reader is available', async () => {
    const project = {
      id: 233,
      provider: 'github',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      commitSha: 'commit-sha',
      distFiles: [{ path: 'config.json', sha: 'blob-sha', size: 13 }],
    }
    const env = environment({
      STATE: {
        get: vi.fn(async (key: string) => (key === 'project:233' ? project : null)),
      } as unknown as KVNamespace,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"enabled":true}')),
    )
    const response = await worker.fetch(
      new Request('https://gkd.example.com/233/config.json', {
        headers: { accept: 'text/html' },
      }),
      env,
      context,
    )
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.text()).toBe('{"enabled":true}')
  })

  it('serves the admin SPA from the assets root', async () => {
    const env = environment()
    const response = await worker.fetch(new Request('https://gkd.example.com/admin/'), env, context)
    expect(await response.text()).toBe('/')
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce()
  })

  it('rewrites admin API paths to the internal API router', async () => {
    const response = await worker.fetch(
      new Request('https://gkd.example.com/admin/api/projects'),
      environment(),
      context,
    )
    expect(response.status).toBe(401)
  })

  it('serves the preview SPA at the canonical JSON5 URL without redirecting', async () => {
    const project = {
      id: 233,
      distFiles: [{ path: 'gkd.json5', sha: 'blob-sha', size: 42 }],
    }
    const env = environment({
      STATE: {
        get: vi.fn(async (key: string) => (key === 'project:233' ? project : null)),
      } as unknown as KVNamespace,
    })
    const response = await worker.fetch(
      new Request('https://gkd.example.com/233/gkd.json5', {
        headers: {
          accept: 'text/html',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
        },
      }),
      env,
      context,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('vary')).toContain('Accept')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toBeNull()
    expect(await response.text()).toBe('/')
  })

  it('serves raw JSON5 when the browser explicitly requests raw=1', async () => {
    const project = {
      id: 233,
      provider: 'github',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      commitSha: 'commit-sha',
      distFiles: [{ path: 'gkd.json5', sha: 'blob-sha', size: 42 }],
    }
    const env = environment({
      STATE: {
        get: vi.fn(async (key: string) => (key === 'project:233' ? project : null)),
      } as unknown as KVNamespace,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{id:233,version:1}')),
    )
    const response = await worker.fetch(
      new Request('https://gkd.example.com/233/gkd.json5?raw=1', {
        headers: {
          accept: 'text/html',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
        },
      }),
      env,
      context,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json5')
    expect(await response.text()).toBe('{id:233,version:1}')
  })

  it('accepts Unicode JSON5 filenames in indexed dist paths', async () => {
    const project = {
      id: 233,
      distFiles: [{ path: '规则说明.json5', sha: 'blob-sha', size: 42 }],
    }
    const env = environment({
      STATE: {
        get: vi.fn(async (key: string) => (key === 'project:233' ? project : null)),
      } as unknown as KVNamespace,
    })
    const response = await worker.fetch(
      new Request('https://gkd.example.com/233/%E8%A7%84%E5%88%99%E8%AF%B4%E6%98%8E.json5', {
        headers: {
          accept: 'text/html',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
        },
      }),
      env,
      context,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(await response.text()).toBe('/')
  })

  it('serves canonical non-HTML JSON5 requests as the original file bytes', async () => {
    const project = {
      id: 233,
      provider: 'github',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      commitSha: 'commit-sha',
      distFiles: [{ path: 'gkd.json5', sha: 'blob-sha', size: 42 }],
    }
    const env = environment({
      STATE: {
        get: vi.fn(async (key: string) => (key === 'project:233' ? project : null)),
      } as unknown as KVNamespace,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{id:233,version:1}')),
    )
    const response = await worker.fetch(
      new Request('https://gkd.example.com/233/gkd.json5', {
        headers: { accept: 'application/json5, */*' },
      }),
      env,
      context,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json5')
    expect(await response.text()).toBe('{id:233,version:1}')
  })

  it('loads public workflow jobs and verifies Job ownership before reading logs', async () => {
    const project = {
      id: 233,
      provider: 'github',
      owner: 'owner',
      repo: 'repo',
      repoUrl: 'https://github.com/owner/repo',
      branch: 'main',
      lastRuns: [{ runId: 123 }],
      distFiles: [{ path: 'gkd.json5', sha: 'blob-sha', size: 42 }],
    }
    const env = environment({
      STATE: {
        get: vi.fn(async (key: string) => {
          if (key === 'projects:index') return [233]
          if (key === 'project:233') return project
          return null
        }),
      } as unknown as KVNamespace,
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/owner/repo') {
        return new Response(
          JSON.stringify({
            id: 1,
            full_name: 'owner/repo',
            html_url: 'https://github.com/owner/repo',
            default_branch: 'main',
            private: false,
            archived: false,
            fork: false,
          }),
        )
      }
      if (url.includes('/actions/runs/123/jobs')) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 7,
                name: 'Build',
                status: 'completed',
                conclusion: 'success',
                steps: [{ number: 1, name: 'Build', status: 'completed', conclusion: 'success' }],
              },
            ],
          }),
        )
      }
      return new Response('step log')
    })
    vi.stubGlobal('fetch', fetchMock)
    const jobsResponse = await worker.fetch(
      new Request('https://gkd.example.com/api/public/subscriptions/233/runs/123/jobs'),
      env,
      context,
    )
    expect(jobsResponse.status).toBe(200)
    expect(await jobsResponse.json()).toMatchObject({
      jobs: [{ id: 7, steps: [{ number: 1, name: 'Build' }] }],
    })

    const logResponse = await worker.fetch(
      new Request(
        'https://gkd.example.com/api/public/subscriptions/233/runs/123/jobs/7/logs?step=1',
      ),
      env,
      context,
    )
    expect(logResponse.status).toBe(200)
    expect(await logResponse.json()).toMatchObject({ log: 'step log' })
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('/actions/jobs/7/steps/1/logs')

    const missingJobResponse = await worker.fetch(
      new Request('https://gkd.example.com/api/public/subscriptions/233/runs/123/jobs/999/logs'),
      env,
      context,
    )
    expect(missingJobResponse.status).toBe(404)
  })

  it('rejects public workflow log access after a repository becomes private', async () => {
    const project = {
      id: 233,
      provider: 'github',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      repoUrl: 'https://github.com/owner/repo',
      lastRuns: [{ runId: 123 }],
      distFiles: [{ path: 'gkd.json5', sha: 'blob-sha', size: 42 }],
    }
    const env = environment({
      STATE: {
        get: vi.fn(async (key: string) =>
          key === 'project:233' ? project : key === 'projects:index' ? [233] : null,
        ),
      } as unknown as KVNamespace,
    })
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 1,
            full_name: 'owner/repo',
            html_url: 'https://github.com/owner/repo',
            default_branch: 'main',
            private: true,
            archived: false,
            fork: false,
          }),
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const response = await worker.fetch(
      new Request('https://gkd.example.com/api/public/subscriptions/233/runs/123/jobs'),
      env,
      context,
    )
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: '仓库已不再是未归档公开仓库',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns 404 for the removed legacy preview route', async () => {
    const response = await worker.fetch(
      new Request('https://gkd.example.com/preview/233?file=gkd.json5'),
      environment(),
      context,
    )
    expect(response.status).toBe(404)
  })

  it('rejects legacy dist-prefixed file URLs', async () => {
    const project = {
      id: 233,
      distFiles: [{ path: 'gkd.json5', sha: 'blob-sha', size: 42 }],
    }
    const env = environment({
      STATE: {
        get: vi.fn(async (key: string) => (key === 'project:233' ? project : null)),
      } as unknown as KVNamespace,
    })
    const response = await worker.fetch(
      new Request('https://gkd.example.com/233/dist/gkd.json5'),
      env,
      context,
    )
    expect(response.status).toBe(404)
  })

  it('returns 404 for unknown paths', async () => {
    const response = await worker.fetch(
      new Request('https://gkd.example.com/unknown'),
      environment(),
      context,
    )
    expect(response.status).toBe(404)
  })

  it('requires the notify secret to be configured', async () => {
    const response = await worker.fetch(
      new Request('https://gkd.example.com/hooks/notify', { method: 'POST' }),
      environment(),
      context,
    )
    expect(response.status).toBe(503)
  })

  it('routes numeric project paths to subscription lookup', async () => {
    const response = await worker.fetch(
      new Request('https://gkd.example.com/233/gkd.json5'),
      environment(),
      context,
    )
    expect(response.status).toBe(404)
  })

  it('serves archived history with Cache API and forwards the Worker execution context', async () => {
    const source = new TextEncoder().encode('{id:233,version:16}')
    const compressedStream = new Blob([source]).stream().pipeThrough(new CompressionStream('gzip'))
    const compressed = new Uint8Array(await new Response(compressedStream).arrayBuffer())
    const digest = await crypto.subtle.digest('SHA-256', source)
    const contentSha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    const snapshot = {
      id: 233,
      version: 16,
      provider: 'github',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      repoUrl: 'https://github.com/owner/repo',
      commitSha: 'commit-sha',
      fileSha: 'blob-sha',
      filePath: 'gkd.json5',
      fileSize: source.byteLength,
      createdAt: '2026-11-25T00:00:00.000Z',
      archiveStatus: 'pending',
    }
    const row = {
      snapshot_json: JSON.stringify(snapshot),
      status: 'ready',
      content_sha256: contentSha256,
      object_key: `objects/${contentSha256.slice(0, 2)}/${contentSha256}.json5.gz`,
      compressed_size: compressed.byteLength,
      archive_error: null,
    }
    const database = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => {
            if (sql.includes('subscription_versions')) return row
            if (sql.includes('archive_daily_usage')) return { r2_reads: 1 }
            return null
          }),
          run: vi.fn(async () => ({ success: true })),
        })),
      })),
    }
    const project = {
      id: 233,
      provider: 'github',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      repoUrl: 'https://github.com/owner/repo',
      distFiles: [{ path: 'gkd.json5', sha: 'blob-sha', size: source.byteLength }],
    }
    const env = environment({
      STATE: {
        get: vi.fn(async (key: string) => (key === 'project:233' ? project : null)),
      } as unknown as KVNamespace,
      VERSIONS: database as unknown as D1Database,
      ARCHIVE: {
        get: vi.fn(async () => ({
          size: compressed.byteLength,
          customMetadata: { sha256: contentSha256, originalSize: String(source.byteLength) },
          body: new Response(compressed).body,
        })),
      } as unknown as R2Bucket,
    })
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    }
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) })
    vi.mocked(context.waitUntil).mockClear()

    const response = await worker.fetch(
      new Request('https://gkd.example.com/233/v16/gkd.json5?raw=1', {
        headers: { accept: 'application/json5' },
      }),
      env,
      context,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json5')
    expect(response.headers.get('x-gkd-subscription-version')).toBe('16')
    expect(await response.text()).toBe(new TextDecoder().decode(source))
    expect(cache.put).toHaveBeenCalledOnce()
    expect(context.waitUntil).toHaveBeenCalled()
  })

  it('returns browser-friendly HTML 404 while keeping raw subscription errors structured', async () => {
    const project = {
      id: 233,
      provider: 'github',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      repoUrl: 'https://github.com/owner/repo',
      distFiles: [{ path: 'gkd.json5', sha: 'blob-sha', size: 42 }],
    }
    const env = environment({
      STATE: {
        get: vi.fn(async (key: string) => (key === 'project:233' ? project : null)),
      } as unknown as KVNamespace,
    })
    const browserResponse = await worker.fetch(
      new Request('https://gkd.example.com/233/missing.json5', {
        headers: {
          accept: 'text/html',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
        },
      }),
      env,
      context,
    )
    expect(browserResponse.status).toBe(404)
    expect(browserResponse.headers.get('content-type')).toContain('text/html')
    expect(await browserResponse.text()).toContain('订阅文件不存在')

    const rawResponse = await worker.fetch(
      new Request('https://gkd.example.com/233/missing.json5?raw=1', {
        headers: { accept: 'application/json5' },
      }),
      env,
      context,
    )
    expect(rawResponse.status).toBe(404)
    expect(rawResponse.headers.get('content-type')).toContain('application/json')
    expect(await rawResponse.json()).toMatchObject({
      ok: false,
      error: '订阅文件不存在',
    })
  })
})
