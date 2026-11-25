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

  it('serves the GKD preview SPA for its deep link', async () => {
    const env = environment()
    const response = await worker.fetch(
      new Request('https://gkd.example.com/preview/233?file=gkd.json5'),
      env,
      context,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('/')
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce()
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
      new Request('https://gkd.example.com/233/dist/gkd.json5?raw=1', {
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
      new Request('https://gkd.example.com/233/dist/%E8%A7%84%E5%88%99%E8%AF%B4%E6%98%8E.json5', {
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

  it('keeps the preview deep-link routed to Static Assets', async () => {
    const env = environment()
    const response = await worker.fetch(
      new Request('https://gkd.example.com/preview/233?file=gkd.json5'),
      env,
      context,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('/')
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce()
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
})
