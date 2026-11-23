import { clearAdminToken, getAdminToken } from './auth'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (typeof init.body === 'string' && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  if (token) headers.set('authorization', `Bearer ${token}`)

  const apiPath = path.startsWith('/api/') ? `/admin${path}` : path
  const response = await fetch(apiPath, { ...init, headers })
  const contentType = response.headers.get('content-type') || ''
  const payload: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '')

  if (!response.ok) {
    if (response.status === 401 && getAdminToken() === token) {
      clearAdminToken()
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('gkd:auth-expired'))
    }
    const errorMessage =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : typeof payload === 'string' && payload.trim()
          ? payload
          : `HTTP ${response.status}`
    throw new ApiError(errorMessage, response.status)
  }
  return payload as T
}
