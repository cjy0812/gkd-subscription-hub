export async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')
  if (token) headers.set('authorization', `Bearer ${token}`)

  const apiPath = path.startsWith('/api/') ? `/admin${path}` : path
  const response = await fetch(apiPath, { ...init, headers })
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T

  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`)
  }

  return payload
}
