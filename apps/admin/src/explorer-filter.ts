import type { ExplorerEntry } from './types'

export type ExplorerSortBy = 'pushed' | 'stars' | 'forks' | 'rules' | 'name'
export type ExplorerBooleanFilter = 'all' | 'yes' | 'no'

export interface ExplorerFilters {
  query: string
  fork: ExplorerBooleanFilter
  archived: ExplorerBooleanFilter
  author: string
  topic: string
  sortBy: ExplorerSortBy
}

export function collectExplorerAuthors(entries: readonly ExplorerEntry[]): string[] {
  return [
    ...new Set(
      entries.flatMap((entry) =>
        entry.subscriptions
          .map((subscription) => subscription.author)
          .filter((author): author is string => typeof author === 'string' && author.length > 0),
      ),
    ),
  ].sort()
}

export function collectExplorerTopics(entries: readonly ExplorerEntry[]): string[] {
  return [...new Set(entries.flatMap((entry) => entry.repository.topics ?? []))].sort()
}

function matchesBooleanFilter(filter: ExplorerBooleanFilter, value: boolean): boolean {
  return filter === 'all' || (filter === 'yes') === value
}

function getSortValue(entry: ExplorerEntry, sortBy: ExplorerSortBy): number | string {
  const repository = entry.repository
  switch (sortBy) {
    case 'stars':
      return repository.stargazers_count || 0
    case 'forks':
      return repository.forks_count || 0
    case 'rules':
      return entry.subscriptions.reduce((total, subscription) => total + subscription.ruleCount, 0)
    case 'name':
      return (repository.full_name || '').toLowerCase()
    case 'pushed':
      return Date.parse(repository.pushed_at || repository.updated_at || '') || 0
  }
}

export function filterExplorerEntries(
  entries: readonly ExplorerEntry[],
  filters: ExplorerFilters,
): ExplorerEntry[] {
  const query = filters.query.trim().toLowerCase()
  const filtered = entries.filter((entry) => {
    const repository = entry.repository
    const searchableText = [
      repository.full_name,
      repository.description,
      repository.owner?.login,
      ...(repository.topics ?? []),
      ...entry.subscriptions.flatMap((subscription) => [
        subscription.name,
        subscription.author,
        String(subscription.id),
        subscription.version,
        JSON.stringify(subscription.customFields),
      ]),
    ]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' ')
      .toLowerCase()

    return (
      (!query || searchableText.includes(query)) &&
      matchesBooleanFilter(filters.fork, entry.fork) &&
      matchesBooleanFilter(filters.archived, Boolean(repository.archived)) &&
      (!filters.author ||
        entry.subscriptions.some((subscription) => subscription.author === filters.author)) &&
      (!filters.topic || (repository.topics ?? []).includes(filters.topic))
    )
  })

  return filtered.sort((left, right) => {
    const leftValue = getSortValue(left, filters.sortBy)
    const rightValue = getSortValue(right, filters.sortBy)
    return typeof leftValue === 'string' && typeof rightValue === 'string'
      ? leftValue.localeCompare(rightValue)
      : Number(rightValue) - Number(leftValue)
  })
}
