export async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')
  if (token) headers.set('authorization', `Bearer ${token}`)

  const response = await fetch(path, { ...init, headers })
  const payload = await response.json().catch(() => ({})) as { error?: string } & T

  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`)
  }

  return payload
}
