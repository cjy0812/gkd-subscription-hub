import { describe, expect, it } from 'vitest'
import { buildProjectFileUrl } from './project-files'

describe('buildProjectFileUrl', () => {
  it('builds preview and raw links with encoded path segments', () => {
    expect(buildProjectFileUrl('gkd.example.com', 123, 'gkd.json5', 'view')).toBe(
      'https://gkd.example.com/123/gkd.json5?view=1',
    )
    expect(buildProjectFileUrl('https://gkd.example.com/', 123, 'nested/file.md', 'raw')).toBe(
      'https://gkd.example.com/123/nested/file.md?raw=1',
    )
  })

  it('normalizes case-insensitive DNS hostnames', () => {
    expect(buildProjectFileUrl('GKD.Example.COM', 123, 'gkd.json5', 'view')).toBe(
      'https://gkd.example.com/123/gkd.json5?view=1',
    )
  })

  it('rejects missing domains, invalid IDs, and unsafe paths', () => {
    expect(buildProjectFileUrl('', 123, 'gkd.json5', 'view')).toBeNull()
    expect(buildProjectFileUrl('gkd.example.com', 0, 'gkd.json5', 'view')).toBeNull()
    expect(buildProjectFileUrl('gkd.example.com', 123, '../secret', 'raw')).toBeNull()
    expect(buildProjectFileUrl('gkd.example.com', 123, '.hidden/file', 'raw')).toBeNull()
    expect(buildProjectFileUrl('gkd.example.com', 123, 'folder\\file', 'raw')).toBeNull()
    expect(buildProjectFileUrl('https://evil.example/path', 123, 'gkd.json5', 'raw')).toBeNull()
  })
})
