import type { Env } from '../types'
import { parseJson5 } from './json5'

const PREFIX = 'explorer:'
const SEARCH_QUERIES = [{ kind: 'repositories', query: 'topic:gkd-subscription' }, { kind: 'repositories', query: 'topic:gkd' }, { kind: 'code', query: 'defineGkdSubscription in:file' }]
const PAGE_SIZE = 100
const VERIFY_PER_STEP = 4

type Candidate = Record<string, any> & { id: number; full_name: string }
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
type Job = {
  status: 'idle' | 'searching' | 'verifying' | 'complete' | 'paused' | 'error'
  queryIndex: number
  page: number
  candidates: Candidate[]
  candidateIndex: number
  entries: Entry[]
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
export async function explorerStatus(env: Env) {
  return read<Job>(env, 'job', {
    status: 'idle', queryIndex: 0, page: 1, candidates: [], candidateIndex: 0,
    entries: [], seen: [], startedAt: null, updatedAt: now(), error: null,
    incomplete: false, scannedPages: 0,
  })
}
function repositoryData(r: Candidate) {
  const allowed = [
    'id','node_id','name','full_name','html_url','description','homepage','owner',
    'topics','license','language','default_branch','created_at','updated_at','pushed_at',
    'size','stargazers_count','watchers_count','forks_count','open_issues_count',
    'archived','disabled','fork','parent','custom_properties','visibility','allow_forking','has_issues','has_projects','has_wiki','has_pages','has_discussions','has_downloads','is_template','web_commit_signoff_required','subscribers_count','network_count',
  ]
  const data = Object.fromEntries(allowed.filter(k => r[k] !== undefined).map(k => [k, r[k]]))\n  if (data.parent && typeof data.parent === 'object') data.parent = (data.parent as any).full_name || null\n  return data
}
function countRules(value: any): number {
  let count = 0
  const visit = (node: any, depth: number) => {
    if (depth > 30 || !node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const child of node) visit(child, depth + 1); return }
    if (typeof node.matches === 'string' || typeof node.matches === 'object') count++
    for (const [k, v] of Object.entries(node)) if (k !== 'matches') visit(v, depth + 1)
  }
  visit(value, 0)
  return count
}
function parseSubscription(text: string, path: string, sha: string, size: number): Subscription | null {
  try {
    const data = parseJson5(text) as any
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const id = Number(data.id)
    const name = typeof data.name === 'string' ? data.name.trim() : ''
    const version = typeof data.version === 'string' || typeof data.version === 'number' ? String(data.version) : ''
    const apps = Array.isArray(data.apps) ? data.apps : []
    const groups = Array.isArray(data.globalGroups) ? data.globalGroups : []
    if (!Number.isSafeInteger(id) || id <= 0 || !name || !version || (!apps.length && !groups.length)) return null
    const standard = new Set(['id','name','version','author','updateUrl','checkUpdateUrl','categories','apps','globalGroups'])
    const customFields = Object.fromEntries(Object.entries(data).filter(([k]) => !standard.has(k)))
    return {
      id, name, version,
      ...(typeof data.author === 'string' ? { author: data.author } : {}),
      ...(typeof data.updateUrl === 'string' ? { updateUrl: data.updateUrl } : {}),
      ...(typeof data.checkUpdateUrl === 'string' ? { checkUpdateUrl: data.checkUpdateUrl } : {}),
      artifactPath: path, artifactSha: sha, artifactSize: size,
      categoriesCount: Array.isArray(data.categories) ? data.categories.length : 0,
      appsCount: apps.length, globalGroupsCount: groups.length,
      ruleCount: countRules([...apps, ...groups]), customFields,
    }
  } catch { return null }
}
async function github<T>(env: Env, path: string): Promise<T> {
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
    throw new Error('GitHub API 限流' + (reset ? '，预计重置：' + new Date(Number(reset) * 1000).toISOString() : ''))
  }
  if (!response.ok) throw new Error('GitHub API HTTP ' + response.status)
  return response.json() as Promise<T>
}
async function verify(env: Env, candidate: Candidate, sources: string[]): Promise<Entry | null> {
  let full = candidate
  if (candidate.fork && !candidate.parent) {
    try { full = await github<any>(env, `/repos/${candidate.full_name}`) } catch { /* parent remains unknown */ }
  }
  const repo = candidate.full_name
  const branch = candidate.default_branch
  if (!branch || candidate.visibility === 'private') return null
  const commit = await github<any>(env, `/repos/${repo}/commits/${encodeURIComponent(branch)}`)
  const sha = commit.sha
  const treeSha = commit.commit?.tree?.sha
  if (!treeSha) throw new Error('无法读取 Git Tree SHA：' + repo)
  const tree = await github<any>(env, `/repos/${repo}/git/trees/${treeSha}?recursive=1`)
  if (tree.truncated) throw new Error('Git Tree 被截断：' + repo)
  const files = (tree.tree || []).filter((f: any) =>
    f.type === 'blob' && /^dist\/.*\.json5?$/i.test(f.path) && f.size <= 256_000
  ).sort((a: any, b: any) => {
    const rank = (p: string) => /(^|\/)gkd\.json5?$/i.test(p) ? 0 : /gkd.*\.json5?$/i.test(p) ? 1 : 2
    return rank(a.path) - rank(b.path)
  }).slice(0, 2)
  const subscriptions: Subscription[] = []
  for (const file of files) {
    const raw = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${file.path.split('/').map(encodeURIComponent).join('/')}`)
    if (!raw.ok) continue
    const body = await raw.text()
    const parsed = parseSubscription(body, file.path, file.sha, file.size)
    if (parsed) subscriptions.push(parsed)
  }
  if (!subscriptions.length) return null
  return {
    repository: { ...repositoryData(full), commitSha: sha },
    fork: candidate.fork === true,
    parent: full.parent?.full_name || null,
    subscriptions,
    discoveredBy: sources,
    verifiedAt: now(),
  }
}
export async function startExplorer(env: Env) {
  const existing = await explorerStatus(env)
  if (['searching','verifying'].includes(existing.status)) return existing
  const job: Job = {
    status: 'searching', queryIndex: 0, page: 1, candidates: [], candidateIndex: 0,
    entries: [], seen: [], startedAt: now(), updatedAt: now(), error: null,
    incomplete: false, scannedPages: 0,
  }
  await write(env, 'job', job)
  return job
}
export async function stepExplorer(env: Env) {
  const job = await explorerStatus(env)
  if (job.status === 'paused' || job.status === 'error') { job.status = 'searching'; job.error = null }
  if (!['searching','verifying'].includes(job.status)) return job
  try {
    if (job.candidateIndex >= job.candidates.length && job.queryIndex < SEARCH_QUERIES.length) {
      const search = SEARCH_QUERIES[job.queryIndex]
      const endpoint = search.kind === 'code' ? 'code' : 'repositories'
      const data = await github<any>(env, `/search/${endpoint}?q=${encodeURIComponent(search.query)}&per_page=${PAGE_SIZE}&page=${job.page}`)
      const items: Candidate[] = (data.items || []).map((item: any) => search.kind === 'code' ? item.repository : item).filter((item: any) => item?.id && item?.full_name)
      job.incomplete ||= data.incomplete_results === true || (search.kind === 'code' && Number(data.total_count || 0) > items.length) || (search.kind === 'repositories' && job.page >= 10 && Number(data.total_count || 0) > 1000)
      job.scannedPages++
      const known = new Set(job.seen)
      const fresh = items.filter(r => !known.has(Number(r.id)))
      for (const r of fresh) {
        r.__source = search.query
        job.seen.push(Number(r.id))
      }
      job.candidates = fresh
      job.candidateIndex = 0
      if (items.length < PAGE_SIZE || job.page >= (search.kind === 'code' ? 1 : 10)) {
        job.queryIndex++
        job.page = 1
      } else job.page++
      job.status = 'verifying'
    }
    const end = Math.min(job.candidateIndex + VERIFY_PER_STEP, job.candidates.length)
    for (; job.candidateIndex < end; job.candidateIndex++) {
      const candidate = job.candidates[job.candidateIndex]
      try {
        const entry = await verify(env, candidate, [candidate.__source])
        if (entry) job.entries.push(entry)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('GitHub API 限流')) {
          job.status = 'paused'; job.error = error.message; break
        }
      }
    }
    if (job.status !== 'paused' && job.queryIndex >= SEARCH_QUERIES.length && job.candidateIndex >= job.candidates.length) {
      job.status = 'complete'
      await write(env, 'catalog', job.entries)
    } else if (job.status !== 'paused') job.status = job.candidateIndex < job.candidates.length ? 'verifying' : 'searching'
    job.updatedAt = now()
    await write(env, 'job', job)
    return job
  } catch (error) {
    job.status = 'error'
    job.error = error instanceof Error ? error.message : '扫描失败'
    job.updatedAt = now()
    await write(env, 'job', job)
    return job
  }
}
export async function explorerCatalog(env: Env) {
  return read<Entry[]>(env, 'catalog', [])
}
