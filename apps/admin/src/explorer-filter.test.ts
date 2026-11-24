import { describe, expect, it } from 'vitest'
import {
  collectExplorerAuthors,
  collectExplorerTopics,
  collectSubscriptionIdConflicts,
  filterExplorerEntries,
  type ExplorerFilters,
} from './explorer-filter'
import type { ExplorerEntry } from './types'

const entry = (
  fullName: string,
  options: {
    fork?: boolean
    archived?: boolean
    stars?: number
    forks?: number
    pushedAt?: string
    topics?: string[]
    author?: string
    ruleCount?: number
    id?: number
    customFields?: Record<string, unknown>
  } = {},
): ExplorerEntry => ({
  repository: {
    id: fullName.length,
    full_name: fullName,
    description: `${fullName} description`,
    html_url: `https://github.com/${fullName}`,
    default_branch: 'main',
    stargazers_count: options.stars ?? 0,
    forks_count: options.forks ?? 0,
    pushed_at: options.pushedAt ?? '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    language: 'TypeScript',
    homepage: null,
    created_at: '2025-01-01T00:00:00Z',
    size: 100,
    open_issues_count: 0,
    topics: options.topics,
    archived: options.archived,
  },
  fork: options.fork ?? false,
  parent: null,
  subscriptions: [
    {
      id: options.id ?? 100,
      name: 'Demo subscription',
      version: '1.0.0',
      author: options.author,
      artifactPath: 'dist/gkd.json5',
      artifactSha: 'abc',
      artifactSize: 10,
      categoriesCount: 1,
      appsCount: 2,
      globalGroupsCount: 0,
      ruleCount: options.ruleCount ?? 0,
      customFields: options.customFields ?? {},
    },
  ],
  discoveredBy: ['repository-search'],
  verifiedAt: '2026-01-01T00:00:00Z',
})

const defaults: ExplorerFilters = {
  query: '',
  exactSubscriptionId: '',
  fork: 'all',
  archived: 'all',
  author: '',
  topic: '',
  sortBy: 'pushed',
}

describe('Explorer filters', () => {
  const entries = [
    entry('zeta/project', {
      stars: 10,
      forks: 2,
      pushedAt: '2026-01-03T00:00:00Z',
      topics: ['gkd', 'android'],
      author: 'Alice',
      ruleCount: 30,
      customFields: { channel: 'stable' },
    }),
    entry('alpha/project', {
      fork: true,
      stars: 50,
      forks: 8,
      pushedAt: '2026-01-02T00:00:00Z',
      topics: ['gkd'],
      author: 'Bob',
      ruleCount: 10,
    }),
    entry('beta/project', {
      archived: true,
      stars: 20,
      forks: 4,
      pushedAt: '2026-01-01T00:00:00Z',
      topics: ['android'],
      author: 'Alice',
      ruleCount: 100,
    }),
  ]

  it('collects unique, sorted authors and topics', () => {
    expect(collectExplorerAuthors(entries)).toEqual(['Alice', 'Bob'])
    expect(collectExplorerTopics(entries)).toEqual(['android', 'gkd'])
  })

  it('searches repository and subscription metadata, including custom fields', () => {
    expect(
      filterExplorerEntries(entries, { ...defaults, query: 'stable' }).map(
        (x) => x.repository.full_name,
      ),
    ).toEqual(['zeta/project'])
    expect(
      filterExplorerEntries(entries, { ...defaults, query: 'alpha' }).map(
        (x) => x.repository.full_name,
      ),
    ).toEqual(['alpha/project'])
  })

  it('combines fork, archived, author, and topic filters', () => {
    const result = filterExplorerEntries(entries, {
      ...defaults,
      fork: 'no',
      archived: 'no',
      author: 'Alice',
      topic: 'gkd',
    })
    expect(result.map((x) => x.repository.full_name)).toEqual(['zeta/project'])
  })

  it('sorts numeric fields descending and names ascending', () => {
    expect(
      filterExplorerEntries(entries, { ...defaults, sortBy: 'stars' }).map(
        (x) => x.repository.full_name,
      ),
    ).toEqual(['alpha/project', 'beta/project', 'zeta/project'])
    expect(
      filterExplorerEntries(entries, { ...defaults, sortBy: 'rules' }).map(
        (x) => x.repository.full_name,
      ),
    ).toEqual(['beta/project', 'zeta/project', 'alpha/project'])
    expect(
      filterExplorerEntries(entries, { ...defaults, sortBy: 'name' }).map(
        (x) => x.repository.full_name,
      ),
    ).toEqual(['alpha/project', 'beta/project', 'zeta/project'])
  })

  it('sorts by most recently pushed with updatedAt fallback', () => {
    const withMissingPush = entry('omega/project', { pushedAt: '' })
    withMissingPush.repository.updated_at = '2026-01-04T00:00:00Z'
    expect(
      filterExplorerEntries([...entries, withMissingPush], defaults).map(
        (x) => x.repository.full_name,
      ),
    ).toEqual(['omega/project', 'zeta/project', 'alpha/project', 'beta/project'])
  })

  it('matches subscription IDs exactly instead of fuzzy substring search', () => {
    const idEntries = [
      entry('owner/233', { id: 233 }),
      entry('owner/1233', { id: 1233 }),
      entry('owner/2233', { id: 2233 }),
    ]
    expect(
      filterExplorerEntries(idEntries, { ...defaults, exactSubscriptionId: '233' }).map(
        (item) => item.repository.full_name,
      ),
    ).toEqual(['owner/233'])
    expect(
      filterExplorerEntries(idEntries, { ...defaults, exactSubscriptionId: '23' }),
    ).toHaveLength(0)
  })

  it('reports duplicate subscription IDs across distinct repositories', () => {
    const conflicts = collectSubscriptionIdConflicts([
      entry('owner/first', { id: 233 }),
      entry('owner/second', { id: 233 }),
      entry('owner/other', { id: 1233 }),
      entry('owner/first', { id: 233 }),
    ])
    expect(conflicts).toEqual([{ id: 233, repositories: ['owner/first', 'owner/second'] }])
  })
})
