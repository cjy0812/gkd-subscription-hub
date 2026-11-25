import type {
  RawApp,
  RawAppGroup,
  RawAppRule,
  RawCategory,
  RawGlobalGroup,
  RawGlobalRule,
  RawSubscription,
} from '@gkd-kit/api'

export type PreviewScope = 'app' | 'global'
export type PreviewRule = RawAppRule | RawGlobalRule | string
export type PreviewGroup = RawAppGroup | RawGlobalGroup

export interface SubscriptionStats {
  apps: number
  appGroups: number
  appRules: number
  globalGroups: number
  globalRules: number
  categories: number
}

export interface SubscriptionMeta {
  id: number
  name: string
  version: number
  author?: string
  updateUrl?: string
  supportUri?: string
  checkUpdateUrl?: string
}

export interface PageResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  pageCount: number
}

export interface AppPreviewSummary {
  index: number
  id: string
  name: string
  groupCount: number
  ruleCount: number
}

export interface GroupPreviewSummary {
  index: number
  key: number
  name: string
  desc?: string
  enabled: boolean | null
  ruleCount: number
  attributes: Array<{ key: string; value: string }>
}

export interface RulePreviewSummary {
  index: number
  key?: number
  name: string
  action?: string
  matches: string
  anyMatches: string
  preview: string
}

export interface CategoryPreviewSummary {
  key: number
  name: string
  enable: boolean | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isRawSubscription(value: unknown): value is RawSubscription {
  if (!isRecord(value)) return false
  const isAppRule = (rule: unknown) => typeof rule === 'string' || isRecord(rule)
  const isAppRules = (rules: unknown) =>
    typeof rules === 'string' || isRecord(rules) || (Array.isArray(rules) && rules.every(isAppRule))
  const appsValid =
    value.apps === undefined ||
    (Array.isArray(value.apps) &&
      value.apps.every(
        (app) =>
          isRecord(app) &&
          typeof app.id === 'string' &&
          Array.isArray(app.groups) &&
          app.groups.every(
            (group) =>
              isRecord(group) &&
              typeof group.key === 'number' &&
              typeof group.name === 'string' &&
              isAppRules(group.rules),
          ),
      ))
  const groupsValid =
    value.globalGroups === undefined ||
    (Array.isArray(value.globalGroups) &&
      value.globalGroups.every(
        (group) =>
          isRecord(group) &&
          typeof group.key === 'number' &&
          typeof group.name === 'string' &&
          Array.isArray(group.rules) &&
          group.rules.every(isRecord),
      ))
  const categoriesValid =
    value.categories === undefined ||
    (Array.isArray(value.categories) &&
      value.categories.every(
        (category) =>
          isRecord(category) &&
          typeof category.key === 'number' &&
          typeof category.name === 'string',
      ))
  return (
    typeof value.id === 'number' &&
    Number.isSafeInteger(value.id) &&
    typeof value.version === 'number' &&
    Number.isSafeInteger(value.version) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    appsValid &&
    groupsValid &&
    categoriesValid
  )
}

export function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function getRules(group: PreviewGroup): PreviewRule[] {
  return toArray(group.rules as PreviewRule | PreviewRule[])
}

function getRuleCount(groups: readonly PreviewGroup[]): number {
  return groups.reduce((total, group) => total + getRules(group).length, 0)
}

export function summarizeSubscription(subscription: RawSubscription): {
  meta: SubscriptionMeta
  stats: SubscriptionStats
} {
  const apps = subscription.apps || []
  const globalGroups = (subscription.globalGroups || []) as PreviewGroup[]
  const appGroups = apps.reduce((total, app) => total + app.groups.length, 0)
  const appRules = apps.reduce(
    (total, app) => total + getRuleCount(app.groups as PreviewGroup[]),
    0,
  )
  return {
    meta: {
      id: subscription.id,
      name: subscription.name,
      version: subscription.version,
      author: subscription.author,
      updateUrl: subscription.updateUrl,
      supportUri: subscription.supportUri,
      checkUpdateUrl: subscription.checkUpdateUrl,
    },
    stats: {
      apps: apps.length,
      appGroups,
      appRules,
      globalGroups: globalGroups.length,
      globalRules: getRuleCount(globalGroups),
      categories: subscription.categories?.length || 0,
    },
  }
}

function paginate<T>(items: T[], page: number, pageSize: number): PageResult<T> {
  const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize) || 50))
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize))
  const safePage = Math.max(1, Math.min(pageCount, Math.floor(page) || 1))
  const start = (safePage - 1) * safePageSize
  return {
    items: items.slice(start, start + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    total: items.length,
    pageCount,
  }
}

function includesQuery(values: unknown[], query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return true
  return values.some((value) =>
    String(value ?? '')
      .toLocaleLowerCase()
      .includes(normalized),
  )
}

export function getAppsPage(
  subscription: RawSubscription,
  page: number,
  pageSize: number,
  query = '',
): PageResult<AppPreviewSummary> {
  const matchingApps = (subscription.apps || [])
    .map((app: RawApp, index) => ({ app, index }))
    .filter(({ app }) => includesQuery([app.id, app.name || app.id], query))
  const result = paginate(matchingApps, page, pageSize)
  return {
    ...result,
    items: result.items.map(({ app, index }) => ({
      index,
      id: app.id,
      name: app.name || app.id,
      groupCount: app.groups.length,
      ruleCount: getRuleCount(app.groups as PreviewGroup[]),
    })),
  }
}

function getScopeGroups(
  subscription: RawSubscription,
  scope: PreviewScope,
  appIndex?: number,
): PreviewGroup[] {
  if (scope === 'global') return (subscription.globalGroups || []) as PreviewGroup[]
  const app = subscription.apps?.[appIndex ?? -1]
  if (!app) throw new Error('应用不存在或已更改')
  return app.groups as PreviewGroup[]
}

function stringifyPreview(value: unknown, maxLength = 180): string {
  if (typeof value === 'string')
    return value.length > maxLength ? value.slice(0, maxLength) + '…' : value
  if (value == null) return ''
  let result: string
  try {
    result = JSON.stringify(value)
  } catch {
    result = String(value)
  }
  return result.length > maxLength ? result.slice(0, maxLength) + '…' : result
}

const APP_GROUP_ATTRIBUTES = [
  'activityIds',
  'excludeActivityIds',
  'versionNames',
  'excludeVersionNames',
  'versionCodes',
  'excludeVersionCodes',
  'versionCode',
  'versionName',
  'ignoreGlobalGroupMatch',
]
const COMMON_GROUP_ATTRIBUTES = [
  'fastQuery',
  'matchRoot',
  'matchDelay',
  'matchTime',
  'actionCd',
  'actionDelay',
  'actionMaximum',
  'resetMatch',
  'actionCdKey',
  'actionMaximumKey',
  'order',
  'forcedTime',
  'priorityTime',
  'priorityActionMaximum',
  'snapshotUrls',
  'excludeSnapshotUrls',
  'exampleUrls',
  'scopeKeys',
]

function summarizeGroup(
  group: PreviewGroup,
  index: number,
  scope: PreviewScope,
): GroupPreviewSummary {
  const attributes: Array<{ key: string; value: string }> = []
  const keys =
    scope === 'app'
      ? [...COMMON_GROUP_ATTRIBUTES, ...APP_GROUP_ATTRIBUTES]
      : [
          ...COMMON_GROUP_ATTRIBUTES,
          'matchAnyApp',
          'matchLauncher',
          'matchSystemApp',
          'disableIfAppGroupMatch',
          'apps',
        ]
  for (const key of keys) {
    const value = (group as unknown as Record<string, unknown>)[key]
    if (value == null) continue
    const displayValue =
      key === 'apps' && Array.isArray(value)
        ? value
            .map((app) => {
              if (!isRecord(app)) return stringifyPreview(app, 60)
              return String(app.id || '未知应用') + (app.enable === false ? '（禁用）' : '（启用）')
            })
            .join('、')
        : stringifyPreview(value, 240)
    attributes.push({ key, value: displayValue })
  }
  return {
    index,
    key: group.key,
    name: group.name,
    desc: group.desc,
    enabled: group.enable ?? null,
    ruleCount: getRules(group).length,
    attributes,
  }
}

export function getGroupsPage(
  subscription: RawSubscription,
  scope: PreviewScope,
  appIndex: number | undefined,
  page: number,
  pageSize: number,
  query = '',
): PageResult<GroupPreviewSummary> {
  const matchingGroups = getScopeGroups(subscription, scope, appIndex)
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => includesQuery([group.key, group.name, group.desc], query))
  const result = paginate(matchingGroups, page, pageSize)
  return {
    ...result,
    items: result.items.map(({ group, index }) => summarizeGroup(group, index, scope)),
  }
}

function normalizeRule(rule: PreviewRule): RawAppRule | RawGlobalRule | { matches: string } {
  return typeof rule === 'string' ? { matches: rule } : rule
}

function getFullRuleMatches(value: unknown): string {
  return toArray(value as string | string[] | undefined)
    .map(String)
    .join('\n')
}

function getRuleMatches(value: unknown, maxLength = 2000): string {
  const text = getFullRuleMatches(value)
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text
}

function summarizeRule(rule: PreviewRule, index: number): RulePreviewSummary {
  const normalized = normalizeRule(rule) as unknown as Record<string, unknown>
  const name =
    typeof normalized.name === 'string' && normalized.name.trim()
      ? normalized.name
      : '规则 ' + (index + 1)
  const matches = getRuleMatches(normalized.matches)
  const anyMatches = getRuleMatches(normalized.anyMatches)
  const key = typeof normalized.key === 'number' ? normalized.key : undefined
  return {
    index,
    key,
    name,
    action: typeof normalized.action === 'string' ? normalized.action : undefined,
    matches,
    anyMatches,
    preview: matches || anyMatches || stringifyPreview(normalized, 180),
  }
}

export function getRulesPage(
  subscription: RawSubscription,
  scope: PreviewScope,
  appIndex: number | undefined,
  groupIndex: number,
  page: number,
  pageSize: number,
  query = '',
): PageResult<RulePreviewSummary> {
  const group = getScopeGroups(subscription, scope, appIndex)[groupIndex]
  if (!group) throw new Error('规则组不存在或已更改')
  const matchingRules = getRules(group)
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => {
      const normalized = normalizeRule(rule) as unknown as Record<string, unknown>
      return includesQuery(
        [
          normalized.key,
          normalized.name,
          normalized.action,
          getFullRuleMatches(normalized.matches),
          getFullRuleMatches(normalized.anyMatches),
        ],
        query,
      )
    })
  const result = paginate(matchingRules, page, pageSize)
  return {
    ...result,
    items: result.items.map(({ rule, index }) => summarizeRule(rule, index)),
  }
}

export function getRuleDetail(
  subscription: RawSubscription,
  scope: PreviewScope,
  appIndex: number | undefined,
  groupIndex: number,
  ruleIndex: number,
): RawAppRule | RawGlobalRule | { matches: string } {
  const group = getScopeGroups(subscription, scope, appIndex)[groupIndex]
  const rule = group ? getRules(group)[ruleIndex] : undefined
  if (rule == null) throw new Error('规则不存在或已更改')
  return normalizeRule(rule)
}

export function getCategoriesPage(
  subscription: RawSubscription,
  page: number,
  pageSize: number,
  query = '',
): PageResult<CategoryPreviewSummary> {
  const categories = (subscription.categories || [])
    .map((category: RawCategory) => ({
      key: category.key,
      name: category.name,
      enable: category.enable ?? null,
    }))
    .filter((category) => includesQuery([category.key, category.name, category.enable], query))
  return paginate(categories, page, pageSize)
}
