import { describe, expect, it } from 'vitest'
import {
  candidateFromSearchItem,
  countRules,
  hasMalformedSubscriptionBlob,
  parseSearchCandidates,
  parseSubscription,
  requireArrayField,
} from '../src/services/explorer'

describe('Explorer data guards', () => {
  it('accepts valid repository search results and rejects malformed items', () => {
    expect(
      candidateFromSearchItem({ id: 12, full_name: 'owner/repo' }, 'repositories'),
    ).toMatchObject({
      id: 12,
      full_name: 'owner/repo',
    })
    expect(
      candidateFromSearchItem({ repository: { id: 13, full_name: 'owner/code-repo' } }, 'code'),
    ).toMatchObject({ id: 13, full_name: 'owner/code-repo' })
    expect(
      candidateFromSearchItem({ id: '12', full_name: 'owner/repo' }, 'repositories'),
    ).toBeNull()
    expect(candidateFromSearchItem({ repository: null }, 'code')).toBeNull()
    expect(
      candidateFromSearchItem(
        { id: 14, full_name: 'owner/repo', default_branch: 42 },
        'repositories',
      ),
    ).toBeNull()
    expect(
      candidateFromSearchItem(
        { id: 15, full_name: 'owner/repo', parent: 'invalid' },
        'repositories',
      ),
    ).toBeNull()
  })

  it('counts nested GKD matches without trusting the input shape', () => {
    expect(
      countRules([
        { matches: [{ key: 1 }, { key: 2 }] },
        { matches: { key: 3 }, children: [{ matches: [{ key: 4 }] }] },
        null,
        'invalid',
      ]),
    ).toBe(4)
    expect(countRules(null)).toBe(0)
  })

  it('parses a valid JSON5 subscription and preserves custom fields', () => {
    const result = parseSubscription(
      `{
        id: 233,
        name: 'Example',
        version: '1.2.3',
        categories: ['tools'],
        apps: [{ id: 'com.example.app', matches: [{ key: 1 }] }],
        customFlag: true,
      }`,
      'dist/gkd.json5',
      'abc123',
      128,
    )

    expect(result).toMatchObject({
      id: 233,
      name: 'Example',
      version: '1.2.3',
      artifactPath: 'dist/gkd.json5',
      artifactSha: 'abc123',
      artifactSize: 128,
      categoriesCount: 1,
      appsCount: 1,
      ruleCount: 1,
      customFields: { customFlag: true },
    })
  })

  it('rejects malformed or incomplete subscription data', () => {
    expect(parseSubscription('{ invalid', 'dist/gkd.json5', 'abc', 10)).toBeNull()
    expect(
      parseSubscription(
        `{ id: 233, name: 'Missing apps', version: '1.0' }`,
        'dist/gkd.json5',
        'abc',
        10,
      ),
    ).toBeNull()
  })
})

describe('malformed upstream entries', () => {
  it('marks malformed search results as incomplete while retaining valid candidates', () => {
    const result = parseSearchCandidates(
      [
        { id: 1, full_name: 'owner/valid' },
        { id: 2, full_name: 'owner/invalid', default_branch: 42 },
      ],
      'repositories',
    )
    expect(result.items).toHaveLength(1)
    expect(result.incomplete).toBe(true)
  })

  it('detects malformed subscription-looking Git Tree blobs', () => {
    expect(
      hasMalformedSubscriptionBlob([
        { type: 'blob', path: 'dist/gkd.json5', sha: 'abc', size: 10 },
      ]),
    ).toBe(false)
    expect(hasMalformedSubscriptionBlob([{ type: 'blob', path: 'dist/gkd.json5', size: 10 }])).toBe(
      true,
    )
    expect(hasMalformedSubscriptionBlob([{ type: 'tree', path: 'dist/folder' }])).toBe(false)
  })
})

describe('strict external array fields', () => {
  it('accepts arrays and rejects missing or malformed array fields', () => {
    expect(requireArrayField({ tree: [] }, 'tree', 'Git Tree')).toEqual([])
    expect(() => requireArrayField({}, 'tree', 'Git Tree')).toThrow(/tree.*数组/)
    expect(() => requireArrayField({ tree: {} }, 'tree', 'Git Tree')).toThrow(/tree.*数组/)
    expect(() => requireArrayField(null, 'items', 'GitHub Search')).toThrow(/items.*数组/)
  })
})
