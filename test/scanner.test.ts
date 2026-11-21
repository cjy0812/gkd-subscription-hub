import { describe, expect, it } from 'vitest'
import { extractId, parseRepo } from '../src/services/scanner'

describe('scanner helpers', () => {
  it('parses repository URL', () =>
    expect(parseRepo('https://github.com/Lin-arm/GKD_subscription')).toEqual({
      owner: 'Lin-arm',
      repo: 'GKD_subscription',
    }))
  it('rejects invalid URL', () => expect(() => parseRepo('https://example.com/a/b')).toThrow())
  it('extracts subscription ID', () =>
    expect(extractId('defineGkdSubscription({id:667})')).toBe(667))
  it('rejects missing ID', () => expect(() => extractId('export default {}')).toThrow())
})
