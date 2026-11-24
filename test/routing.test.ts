import { describe, expect, it, vi } from 'vitest'
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

  it('rewrites browser HTML navigation to JSON5 into the GKD preview SPA', async () => {
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
      new Request('https://gkd.example.com/233/dist/gkd.json5', {
        headers: {
          accept: 'text/html',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
        },
      }),
      env,
      context,
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://gkd.example.com/preview/233?file=gkd.json5')
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
