import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAdminToken, getAdminToken, setAdminToken } from './auth'

const values = new Map<string, string>()

beforeEach(() => {
  values.clear()
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearAdminToken()
})

describe('admin session storage', () => {
  it('stores, reads, and clears the session token', () => {
    setAdminToken('valid-token')
    expect(getAdminToken()).toBe('valid-token')
    clearAdminToken()
    expect(getAdminToken()).toBe('')
  })

  it('falls back to tab-local memory when session storage is blocked', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(() => {
        throw new DOMException('Blocked', 'SecurityError')
      }),
      setItem: vi.fn(() => {
        throw new DOMException('Blocked', 'SecurityError')
      }),
      removeItem: vi.fn(() => {
        throw new DOMException('Blocked', 'SecurityError')
      }),
    })

    setAdminToken('memory-token')
    expect(getAdminToken()).toBe('memory-token')
    clearAdminToken()
    expect(getAdminToken()).toBe('')
  })
})
