import type { Env } from '../types'
import { parseJson5 } from './json5'

const PREFIX = 'explorer:'
const SEARCH_QUERIES = [
  { kind: 'repositories', query: 'topic:gkd-subscription is:public fork:true' },
  { kind: 'repositories', query: 'topic:gkd-rules is:public fork:true' },
  { kind: 'repositories', query: 'topic:gkd is:public fork:true' },
  { kind: 'repositories', query: 'gkd-subscription in:name is:public fork:true' },
  { kind: 'code', query: 'defineGkdSubscription in:file is:public' },
  { kind: 'code', query: 'defineGkdSubscription in:file is:public is:fork' },
] as const
const PAGE_SIZE = 100
const VERIFY_PER_STEP = 4
const MAX_ARTIFACTS_PER_REPO = 2
const MAX_ARTIFACT_SIZE = 256_000

type JsonRecord = Record<string, unknown>
type Candidate = JsonRecord & {
  id: number
  full_name: string
  default_branch?: string
  private?: boolean
  visibility?: string
  fork?: boolean
  parent?: { full_name?: string } | null
  __source?: string
  __sources?: string[]
}
type GitHubTreeBlob = { type: 'blob'; path: string; sha: string; size: number }

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function requireArrayField(value: unknown, field: string, context: string): unknown[] {
  if (!isRecord(value) || !Array.isArray(value[field])) {
    throw new Error(`${context} 响应格式无效：字段 ${field} 必须是数组`)
  }
  return value[field]
}

function isCandidate(value: unknown): value is Candidate {
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    !Number.isSafeInteger(value.id) ||
    value.id <= 0 ||
    typeof value.full_name !== 'string' ||
    !value.full_name.trim()
  ) {
    return false
  }
  if (value.default_branch !== undefined && typeof value.default_branch !== 'string') return false
  if (value.private !== undefined && typeof value.private !== 'boolean') return false
  if (value.visibility !== undefined && typeof value.visibility !== 'string') return false
  if (value.fork !== undefined && typeof value.fork !== 'boolean') return false
  if (value.__source !== undefined && typeof value.__source !== 'string') return false
  if (value.parent !== undefined && value.parent !== null) {
    if (!isRecord(value.parent)) return false
    if (value.parent.full_name !== undefined && typeof value.parent.full_name !== 'string') {
      return false
    }
  }
  return true
}

export function candidateFromSearchItem(
  item: unknown,
  kind: (typeof SEARCH_QUERIES)[number]['kind'],
): Candidate | null {
  if (!isRecord(item)) return null
  const candidate = kind === 'code' ? item.repository : item
  return isCandidate(candidate) ? candidate : null
}

export function parseSearchCandidates(
  rawItems: unknown[],
  kind: (typeof SEARCH_QUERIES)[number]['kind'],
): { items: Candidate[]; incomplete: boolean } {
  const parsed = rawItems.map((item) => candidateFromSearchItem(item, kind))
  return {
    items: parsed.filter((item): item is Candidate => item !== null),
    incomplete: parsed.some((item) => item === null),
  }
}

export function hasMalformedSubscriptionBlob(tree: unknown[]): boolean {
  return tree.some(
    (item) =>
      isRecord(item) &&
      item.type === 'blob' &&
      typeof item.path === 'string' &&
      /^dist\/.*\.json5?$/i.test(item.path) &&
      !isTreeBlob(item),
  )
}

function isTreeBlob(value: unknown): value is GitHubTreeBlob {
  return (
    isRecord(value) &&
    value.type === 'blob' &&
    typeof value.path === 'string' &&
    typeof value.sha === 'string' &&
    typeof value.size === 'number'
  )
}
type Subscription = {
  id: number
  name: string
  version: string
  author?: string
  updateUrl?: string
  checkUpdateUrl?: string
  artifactPath: string
  artifactSha: string
  artifactSize: number
  categoriesCount: number
  appsCount: number
  globalGroupsCount: number
  ruleCount: number
  customFields: Record<string, unknown>
}
type Entry = {
  repository: Record<string, unknown>
  fork: boolean
  parent: string | null
  subscriptions: Subscription[]
  discoveredBy: string[]
  verifiedAt: string
}
type CandidateBatch = { key: string; count: number }
type Job = {
  status: 'idle' | 'searching' | 'verifying' | 'complete' | 'paused' | 'error'
  phase: 'collecting' | 'verifying' | 'complete'
  runId: string
  queryIndex: number
  page: number
  candidateBatches: CandidateBatch[]
  candidateCount: number
  candidateIndex: number
  sourceById: Record<string, string[]>
  entries: Entry[]
  verifiedCount: number
  matchedCount: number
  seen: number[]
  startedAt: string | null
  updatedAt: string
  error: string | null
  incomplete: boolean
  scannedPages: number
}
const now = () => new Date().toISOString()
const key = (name: string) => PREFIX + name

async function read<T>(env: Env, name: string, fallback: T): Promise<T> {
  return (await env.STATE.get<T>(key(name), 'json')) ?? fallback
}
async function write(env: Env, name: string, value: unknown) {
  await env.STATE.put(key(name), JSON.stringify(value))
}
function emptyJob(): Job {
  return {
    status: 'idle',
    phase: 'collecting',
    runId: crypto.randomUUID(),
    queryIndex: 0,
    page: 1,
    candidateBatches: [],
    candidateCount: 0,
    candidateIndex: 0,
    sourceById: {},
    entries: [],
    verifiedCount: 0,
    matchedCount: 0,
    seen: [],
    startedAt: null,
    updatedAt: now(),
    error: null,
    incomplete: false,
    scannedPages: 0,
  }
}

async function loadJob(env: Env): Promise<Job> {
  const stored = await env.STATE.get<Partial<Job>>(key('job'), 'json')
  if (!stored) return emptyJob()
  if (!stored.phase || !stored.runId || !Array.isArray(stored.candidateBatches)) {
    const legacy = emptyJob()
    legacy.status = stored.status === 'complete' ? 'complete' : 'paused'
    legacy.phase = stored.status === 'complete' ? 'complete' : 'collecting'
    legacy.startedAt = stored.startedAt ?? null
    legacy.updatedAt = stored.updatedAt ?? now()
    legacy.error =
      stored.status === 'complete'
        ? null
        : '扫描任务结构已升级。请重新开始扫描；上次已发布目录不会被覆盖。'
    return legacy
  }
  return { ...emptyJob(), ...stored } as Job
}

async function writeCandidateBatch(
  env: Env,
  runId: string,
  index: number,
  candidates: Candidate[],
) {
  const batchKey = `${PREFIX}queue:${runId}:${index}`
  await env.STATE.put(batchKey, JSON.stringify(candidates), { expirationTtl: 7 * 24 * 60 * 60 })
  return batchKey
}

async function readCandidateAt(env: Env, job: Job, index: number, cache: Map<string, Candidate[]>) {
  let offset = 0
  for (const batch of job.candidateBatches) {
    if (index < offset + batch.count) {
      let candidates = cache.get(batch.key)
      if (!candidates) {
        const stored = await env.STATE.get<Candidate[]>(batch.key, 'json')
        if (!stored) throw new Error('候选队列数据已过期，请重新开始扫描；已发布目录保持不变。')
        candidates = stored
        cache.set(batch.key, candidates)
      }
      const candidate = candidates[index - offset]
      if (!candidate) throw new Error('候选队列数据不完整，请重新开始扫描；已发布目录保持不变。')
      return candidate
    }
    offset += batch.count
  }
  throw new Error('候选队列索引超出范围，请重新开始扫描；已发布目录保持不变。')
}
export async function explorerStatus(env: Env) {
  const job = await loadJob(env)
  return {
    status: job.status,
    phase: job.phase,
    queryIndex: job.queryIndex,
    page: job.page,
    candidateCount: job.candidateCount,
    candidateIndex: job.candidateIndex,
    verifiedCount: job.verifiedCount || job.candidateIndex,
    matchedCount: job.matchedCount || job.entries.length,
    seenCount: job.candidateCount,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    error: job.error,
    incomplete: job.incomplete,
    scannedPages: job.scannedPages,
  }
}
function repositoryData(repository: Candidate) {
  const allowed = [
    'id',
    'node_id',
    'name',
    'full_name',
    'html_url',
    'description',
    'homepage',
    'owner',
    'topics',
    'license',
    'language',
    'default_branch',
    'created_at',
    'updated_at',
    'pushed_at',
    'size',
    'stargazers_count',
    'watchers_count',
    'forks_count',
    'open_issues_count',
    'archived',
    'disabled',
    'fork',
    'parent',
    'custom_properties',
    'visibility',
    'allow_forking',
    'has_issues',
    'has_projects',
    'has_wiki',
    'has_pages',
    'has_discussions',
    'has_downloads',
    'is_template',
    'web_commit_signoff_required',
    'subscribers_count',
    'network_count',
  ]
  const data = Object.fromEntries(
    allowed
      .filter((field) => repository[field] !== undefined)
      .map((field) => [field, repository[field]]),
  )
  if (isRecord(data.parent)) {
    data.parent = typeof data.parent.full_name === 'string' ? data.parent.full_name : null
  }
  return data
}
export function countRules(value: unknown): number {
  let count = 0
  const visit = (node: unknown, depth: number) => {
    if (depth > 30) return
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1)
      return
    }
    if (!isRecord(node)) return
    if (Array.isArray(node.matches)) {
      count += node.matches.length
    } else if (node.matches !== undefined && node.matches !== null) {
      count++
    }
    for (const [field, child] of Object.entries(node)) {
      if (field !== 'matches') visit(child, depth + 1)
    }
  }
  visit(value, 0)
  return count
}
export function parseSubscription(
  source: string,
  path: string,
  sha: string,
  size: number,
): Subscription | null {
  try {
    const data: unknown = parseJson5(source)
    if (!isRecord(data)) return null
    const id = Number(data.id)
    const name = typeof data.name === 'string' ? data.name.trim() : ''
    const version =
      typeof data.version === 'string' || typeof data.version === 'number'
        ? String(data.version)
        : ''
    const apps = Array.isArray(data.apps) ? data.apps : []
    const globalGroups = Array.isArray(data.globalGroups) ? data.globalGroups : []
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !name ||
      !version ||
      (!apps.length && !globalGroups.length)
    ) {
      return null
    }
    const standardFields = new Set([
      'id',
      'name',
      'version',
      'author',
      'updateUrl',
      'checkUpdateUrl',
      'categories',
      'apps',
      'globalGroups',
    ])
    const customFields = Object.fromEntries(
      Object.entries(data).filter(([field]) => !standardFields.has(field)),
    )
    return {
      id,
      name,
      version,
      ...(typeof data.author === 'string' ? { author: data.author } : {}),
      ...(typeof data.updateUrl === 'string' ? { updateUrl: data.updateUrl } : {}),
      ...(typeof data.checkUpdateUrl === 'string' ? { checkUpdateUrl: data.checkUpdateUrl } : {}),
      artifactPath: path,
      artifactSha: sha,
      artifactSize: size,
      categoriesCount: Array.isArray(data.categories) ? data.categories.length : 0,
      appsCount: apps.length,
      globalGroupsCount: globalGroups.length,
      ruleCount: countRules([...apps, ...globalGroups]),
      customFields,
    }
  } catch {
    return null
  }
}
async function github(env: Env, path: string): Promise<unknown> {
  const response = await fetch('https://api.github.com' + path, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'gkd-rules-explorer',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + env.GITHUB_TOKEN } : {}),
    },
  })
  if (response.status === 403 || response.status === 429) {
    const reset = response.headers.get('x-ratelimit-reset')
    const remaining = response.headers.get('x-ratelimit-remaining')
    throw new Error(
      'GitHub API 限流' +
        (remaining ? '，剩余请求数：' + remaining : '') +
        (reset ? '，预计重置：' + new Date(Number(reset) * 1000).toISOString() : ''),
    )
  }
  if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`)
  return response.json() as Promise<unknown>
}
async function verify(
  env: Env,
  candidate: Candidate,
  sources: string[],
  cached?: Entry,
): Promise<Entry | null> {
  const repository = candidate.full_name
  const branch = candidate.default_branch
  if (!branch || candidate.visibility === 'private' || candidate.private === true) return null

  const commitData = await github(env, `/repos/${repository}/commits/${encodeURIComponent(branch)}`)
  if (
    !isRecord(commitData) ||
    typeof commitData.sha !== 'string' ||
    !isRecord(commitData.commit) ||
    !isRecord(commitData.commit.tree) ||
    typeof commitData.commit.tree.sha !== 'string'
  ) {
    throw new Error(`GitHub Commit 响应格式无效：${repository}`)
  }
  const commitSha = commitData.sha
  const treeSha = commitData.commit.tree.sha
  if (cached && cached.repository.commitSha === commitSha) {
    return {
      ...cached,
      repository: { ...cached.repository, ...repositoryData(candidate), commitSha },
      discoveredBy: [...new Set([...cached.discoveredBy, ...sources])],
      verifiedAt: now(),
    }
  }

  let full = candidate
  if (candidate.fork && !candidate.parent && !cached?.parent) {
    try {
      const repositoryData = await github(env, `/repos/${candidate.full_name}`)
      if (isCandidate(repositoryData)) full = repositoryData
    } catch {
      // Keep the fork; parent metadata is optional when GitHub cannot return it.
    }
  }
  const treeData = await github(env, `/repos/${repository}/git/trees/${treeSha}?recursive=1`)
  if (!isRecord(treeData)) throw new Error(`Git Tree 响应格式无效：${repository}`)
  if (treeData.truncated === true) throw new Error(`Git Tree 被截断：${repository}`)
  const rawTree = requireArrayField(treeData, 'tree', 'Git Tree')
  if (hasMalformedSubscriptionBlob(rawTree)) {
    throw new Error(`Git Tree 订阅文件条目格式无效：${repository}`)
  }
  const files = rawTree
    .filter(isTreeBlob)
    .filter((file) => /^dist\/.*\.json5?$/i.test(file.path) && file.size <= MAX_ARTIFACT_SIZE)
    .sort((a, b) => {
      const rank = (path: string) =>
        /(^|\/)gkd\.json5?$/i.test(path) ? 0 : /gkd.*\.json5?$/i.test(path) ? 1 : 2
      return rank(a.path) - rank(b.path)
    })
    .slice(0, MAX_ARTIFACTS_PER_REPO)

  const subscriptions: Subscription[] = []
  for (const file of files) {
    const rawUrl =
      'https://raw.githubusercontent.com/' +
      repository +
      '/' +
      commitSha +
      '/' +
      file.path.split('/').map(encodeURIComponent).join('/')
    const raw = await fetch(rawUrl)
    if (!raw.ok) continue
    const body = await raw.text()
    if (body.length > MAX_ARTIFACT_SIZE) continue
    const subscription = parseSubscription(body, file.path, file.sha, file.size)
    if (subscription) subscriptions.push(subscription)
  }
  if (!subscriptions.length) return null

  return {
    repository: { ...repositoryData(full), commitSha },
    fork: candidate.fork === true,
    parent: full.parent?.full_name || null,
    subscriptions,
    discoveredBy: sources,
    verifiedAt: now(),
  }
}
export async function startExplorer(env: Env) {
  const existing = await loadJob(env)
  if (existing.status === 'searching' || existing.status === 'verifying') {
    return explorerStatus(env)
  }
  const job = emptyJob()
  job.status = 'searching'
  job.startedAt = now()
  await write(env, 'job', job)
  return explorerStatus(env)
}

function compactCandidate(candidate: Candidate): Candidate {
  return {
    ...repositoryData(candidate),
    parent: candidate.parent ?? null,
  } as Candidate
}

export async function stepExplorer(env: Env) {
  const job = await loadJob(env)
  if (job.error?.startsWith('扫描任务结构已升级')) return explorerStatus(env)
  if (job.status === 'paused' || job.status === 'error') {
    job.status = job.phase === 'verifying' ? 'verifying' : 'searching'
    job.error = null
  }
  if (job.status !== 'searching' && job.status !== 'verifying') {
    return explorerStatus(env)
  }

  try {
    if (job.phase === 'collecting') {
      if (job.queryIndex >= SEARCH_QUERIES.length) {
        job.phase = 'verifying'
        job.status = 'verifying'
        job.updatedAt = now()
        await write(env, 'job', job)
        return explorerStatus(env)
      }

      const search = SEARCH_QUERIES[job.queryIndex]
      const endpoint = search.kind === 'code' ? 'code' : 'repositories'
      const data = await github(
        env,
        `/search/${endpoint}?q=${encodeURIComponent(search.query)}&per_page=${PAGE_SIZE}&page=${job.page}`,
      )
      if (!isRecord(data)) throw new Error('GitHub Search 响应格式无效')
      const rawItems = requireArrayField(data, 'items', 'GitHub Search')
      const parsed = parseSearchCandidates(rawItems, search.kind)
      const items = parsed.items
      const totalCount = Number(data.total_count || 0)

      job.incomplete ||= parsed.incomplete
      job.incomplete ||= data.incomplete_results === true
      job.incomplete ||= totalCount > 1000
      job.scannedPages++

      const known = new Set(job.seen)
      const fresh: Candidate[] = []
      for (const repository of items) {
        const id = Number(repository.id)
        const idKey = String(id)
        const sources = job.sourceById[idKey] || []
        if (known.has(id)) {
          if (!sources.includes(search.query)) {
            job.sourceById[idKey] = [...sources, search.query]
          }
          continue
        }
        known.add(id)
        job.seen.push(id)
        job.sourceById[idKey] = [search.query]
        fresh.push(compactCandidate(repository))
      }

      if (fresh.length) {
        const batchKey = await writeCandidateBatch(
          env,
          job.runId,
          job.candidateBatches.length,
          fresh,
        )
        job.candidateBatches.push({ key: batchKey, count: fresh.length })
        job.candidateCount += fresh.length
      }

      if (items.length < PAGE_SIZE || job.page >= 10) {
        job.queryIndex++
        job.page = 1
      } else {
        job.page++
      }

      if (job.queryIndex >= SEARCH_QUERIES.length) {
        job.phase = 'verifying'
        job.status = 'verifying'
      } else {
        job.status = 'searching'
      }
      job.updatedAt = now()
      await write(env, 'job', job)
      return explorerStatus(env)
    }

    const cachedEntries = await read<Entry[]>(env, 'catalog', [])
    const cacheById = new Map<number, Entry>(
      cachedEntries.flatMap((entry) => {
        const id = entry.repository.id
        return typeof id === 'number' && Number.isSafeInteger(id) ? [[id, entry] as const] : []
      }),
    )
    const batchCache = new Map<string, Candidate[]>()
    const end = Math.min(job.candidateIndex + VERIFY_PER_STEP, job.candidateCount)
    for (; job.candidateIndex < end; job.candidateIndex++) {
      const candidate = await readCandidateAt(env, job, job.candidateIndex, batchCache)
      try {
        const entry = await verify(
          env,
          candidate,
          job.sourceById[String(candidate.id)] || [],
          cacheById.get(Number(candidate.id)),
        )
        if (entry) job.entries.push(entry)
      } catch (error) {
        job.incomplete = true
        if (error instanceof Error && error.message.startsWith('GitHub API 限流')) {
          job.status = 'paused'
          job.error = error.message
          break
        }
      }
    }

    job.verifiedCount = job.candidateIndex
    job.matchedCount = job.entries.length
    if (job.status !== 'paused' && job.candidateIndex >= job.candidateCount) {
      job.status = 'complete'
      job.phase = 'complete'
      await write(env, 'catalog', job.entries)
      job.entries = []
      job.candidateBatches = []
      job.seen = []
      job.sourceById = {}
    } else if (job.status !== 'paused') {
      job.status = 'verifying'
    }

    job.updatedAt = now()
    await write(env, 'job', job)
    return explorerStatus(env)
  } catch (error) {
    job.status =
      error instanceof Error && error.message.startsWith('GitHub API 限流') ? 'paused' : 'error'
    job.error = error instanceof Error ? error.message : '扫描失败'
    job.updatedAt = now()
    await write(env, 'job', job)
    return explorerStatus(env)
  }
}
export async function explorerCatalog(env: Env) {
  return read<Entry[]>(env, 'catalog', [])
}

export async function explorerQuota(env: Env) {
  const response = await github(env, '/rate_limit')
  const resources = isRecord(response) && isRecord(response.resources) ? response.resources : {}
  const categories = ['core', 'search', 'code_search']
  return Object.fromEntries(
    categories.map((category) => {
      const value = isRecord(resources[category]) ? resources[category] : {}
      return [
        category,
        {
          limit: Number(value.limit || 0),
          remaining: Number(value.remaining || 0),
          used: Number(value.used || 0),
          reset: Number(value.reset || 0),
        },
      ]
    }),
  )
}
