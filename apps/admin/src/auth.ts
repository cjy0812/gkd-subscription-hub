const STORAGE_KEY = 'gkdtoken'
let memoryToken = ''

export function getAdminToken(): string {
  try {
    memoryToken = sessionStorage.getItem(STORAGE_KEY) || ''
  } catch {
    // Fall back to this tab's memory when browser storage is blocked.
  }
  return memoryToken
}

export function setAdminToken(token: string): void {
  memoryToken = token
  try {
    sessionStorage.setItem(STORAGE_KEY, token)
  } catch {
    // The token remains available for this tab until it is closed or reloaded.
  }
}

export function clearAdminToken(): void {
  memoryToken = ''
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Clearing the in-memory fallback is sufficient when storage is blocked.
  }
}
