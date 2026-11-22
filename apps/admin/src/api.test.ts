import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from './api'
import { getAdminToken, setAdminToken } from './auth'

const values = new Map<string, string>()
const storage = {
  getItem: vi.fn((key: string) => values.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  removeItem: vi.fn((key: string) => values.delete(key)),
}
const dispatchEvent = vi.fn()
const fetchMock = vi.fn()

beforeEach(() => {
  values.clear()
  vi.clearAllMocks()
  vi.stubGlobal('sessionStorage', storage)
  vi.stubGlobal('window', { dispatchEvent })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('admin API client', () => {
  it('prefixes admin API paths and sends the bearer token', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(api<{ ok: boolean }>('/api/projects', 'admin-secret')).resolves.toEqual({
      ok: true,
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/admin/api/projects')
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(new Headers(request?.headers).get('authorization')).toBe('Bearer admin-secret')
  })

  it('sets JSON content type for string bodies without overriding explicit headers', async () => {
    fetchMock.mockResolvedValue(
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
    )

    await api('/api/projects', 'token', { method: 'POST', body: JSON.stringify({ url: 'repo' }) })
    const [, request] = fetchMock.mock.calls[0]
    expect(new Headers(request.headers).get('content-type')).toBe('application/json')

    fetchMock.mockClear()
    await api('/api/projects', 'token', {
      method: 'POST',
      headers: { 'content-type': 'application/custom' },
      body: JSON.stringify({ url: 'repo' }),
    })
    const [, explicitRequest] = fetchMock.mock.calls[0]
    expect(new Headers(explicitRequest.headers).get('content-type')).toBe('application/custom')
  })

  it('clears the session and emits an auth-expired event on 401', async () => {
    setAdminToken('expired-token')
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(api('/api/projects', 'expired-token')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'Unauthorized',
    })
    expect(getAdminToken()).toBe('')
    expect(dispatchEvent).toHaveBeenCalledOnce()
    expect(dispatchEvent.mock.calls[0][0]).toBeInstanceOf(Event)
  })

  it('does not clear the session for non-401 errors', async () => {
    setAdminToken('still-valid')
    fetchMock.mockResolvedValueOnce(new Response('Service unavailable', { status: 503 }))

    await expect(api('/api/projects', 'still-valid')).rejects.toBeInstanceOf(ApiError)
    expect(getAdminToken()).toBe('still-valid')
    expect(dispatchEvent).not.toHaveBeenCalled()
  })
})
