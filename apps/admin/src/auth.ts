const STORAGE_KEY = 'gkdtoken'

export function getAdminToken(): string {
  return sessionStorage.getItem(STORAGE_KEY) || ''
}

export function setAdminToken(token: string): void {
  sessionStorage.setItem(STORAGE_KEY, token)
}

export function clearAdminToken(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}
