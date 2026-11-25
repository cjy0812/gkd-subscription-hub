import type {
  DistFile,
  Env,
  ProjectProvider,
  WorkflowInfo,
  WorkflowJob,
  WorkflowRun,
} from '../types'
import { decode, gh } from './github'

export interface RepositoryLocator {
  provider: ProjectProvider
  host: string
  namespace: string
  repo: string
  fullPath: string
}

export interface ProviderRepository {
  id: string
  fullName: string
  owner: string
  repo: string
  htmlUrl: string
  defaultBranch: string
  isPrivate: boolean
  archived: boolean
  fork: boolean
  parentFullName: string | null
}

export interface BranchList {
  defaultBranch: string
  branches: string[]
  truncated: boolean
}

export interface ProviderAdapter {
  kind: ProjectProvider
  parse(host: string, segments: string[]): RepositoryLocator | null
  getRepository(env: Env, locator: RepositoryLocator): Promise<ProviderRepository>
  listBranches(env: Env, locator: RepositoryLocator): Promise<BranchList>
  getCommit(env: Env, locator: RepositoryLocator, branch: string): Promise<string>
  listDistFiles(env: Env, locator: RepositoryLocator, commitSha: string): Promise<DistFile[]>
  readFile(env: Env, locator: RepositoryLocator, path: string, ref: string): Promise<string>
  listWorkflowRuns(env: Env, project: ProjectSource): Promise<WorkflowRun[]>
  listRunJobs(env: Env, project: ProjectSource, runId: number): Promise<WorkflowJob[]>
  getJobLog(env: Env, project: ProjectSource, jobId: number, stepNumber?: number): Promise<string>
  rawFileUrl(project: ProjectSource, file: DistFile): string
}

export interface ProjectSource {
  provider?: ProjectProvider
  owner: string
  repo: string
  repositoryPath?: string
  providerId?: string
  commitSha?: string
  branch: string
  workflows?: WorkflowInfo[]
}

const MAX_PAGES = 10
const PAGE_SIZE = 100

const MAX_JOB_LOG_BYTES = 2 * 1024 * 1024

async function readBoundedLog(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > MAX_JOB_LOG_BYTES) throw Error('单份日志超过 2 MB 上限，请前往托管平台查看')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_JOB_LOG_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // Preserve the size-limit error if the upstream stream cannot be canceled.
        }
        throw Error('单份日志超过 2 MB 上限，请前往托管平台查看')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function parsePath(host: string, segments: string[], provider: ProjectProvider, minimum: number) {
  if (
    host !==
    (provider === 'github' ? 'github.com' : provider === 'gitlab' ? 'gitlab.com' : 'gitea.com')
  ) {
    return null
  }
  if (
    segments.length < minimum ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return null
  }
  const lastSegment = segments[segments.length - 1]
  if (!lastSegment) return null
  const repo = lastSegment.replace(/\.git$/i, '')
  const namespace = segments.slice(0, -1).join('/')
  if (!namespace || !repo) return null
  return { provider, host, namespace, repo, fullPath: `${namespace}/${repo}` }
}

const githubAdapter: ProviderAdapter = {
  kind: 'github',
  parse: (host, segments) =>
    segments.length === 2 ? parsePath(host, segments, 'github', 2) : null,
  async getRepository(env, locator) {
    const data = await gh<{
      id: number
      full_name: string
      html_url: string
      default_branch: string
      private: boolean
      archived: boolean
      fork: boolean
      parent?: { full_name?: string } | null
    }>(env, `/repos/${encodeURIComponent(locator.namespace)}/${encodeURIComponent(locator.repo)}`)
    return {
      id: String(data.id),
      fullName: data.full_name,
      owner: locator.namespace,
      repo: locator.repo,
      htmlUrl: data.html_url,
      defaultBranch: data.default_branch,
      isPrivate: data.private,
      archived: data.archived,
      fork: data.fork,
      parentFullName: data.parent?.full_name || null,
    }
  },
  async listBranches(env, locator) {
    const base = `/repos/${encodeURIComponent(locator.namespace)}/${encodeURIComponent(locator.repo)}`
    const [metadata, firstPage] = await Promise.all([
      gh<{ default_branch: string; private?: boolean; archived?: boolean }>(env, base),
      gh<Array<{ name: string }>>(env, `${base}/branches?per_page=${PAGE_SIZE}&page=1`),
    ])
    if (metadata.private || metadata.archived) throw Error('仅支持未归档公开仓库')
    const items = [...firstPage]
    let page = 1
    let pageItems = firstPage
    while (pageItems.length === PAGE_SIZE && page < MAX_PAGES) {
      page += 1
      pageItems = await gh<Array<{ name: string }>>(
        env,
        `${base}/branches?per_page=${PAGE_SIZE}&page=${page}`,
      )
      items.push(...pageItems)
    }
    const names = [...new Set(items.map((item) => item.name))]
    return {
      defaultBranch: metadata.default_branch,
      branches: [
        metadata.default_branch,
        ...names
          .filter((name) => name !== metadata.default_branch)
          .sort((a, b) => a.localeCompare(b)),
      ],
      truncated: page === MAX_PAGES && pageItems.length === PAGE_SIZE,
    }
  },
  async getCommit(env, locator, branch) {
    const base = `/repos/${encodeURIComponent(locator.namespace)}/${encodeURIComponent(locator.repo)}`
    const refPath = branch.split('/').map(encodeURIComponent).join('/')
    const ref = await gh<{ object: { sha: string } }>(env, `${base}/git/ref/heads/${refPath}`)
    return ref.object.sha
  },
  async listDistFiles(env, locator, commitSha) {
    const base = `/repos/${encodeURIComponent(locator.namespace)}/${encodeURIComponent(locator.repo)}`
    const commit = await gh<{ tree: { sha: string } }>(env, `${base}/git/commits/${commitSha}`)
    const tree = await gh<{
      truncated: boolean
      tree: Array<{ type: string; path: string; sha: string; size?: number }>
    }>(env, `${base}/git/trees/${commit.tree.sha}?recursive=1`)
    if (tree.truncated) throw Error('GitHub Git Tree 被截断')
    return tree.tree
      .filter((item) => item.type === 'blob' && item.path.startsWith('dist/'))
      .map((item) => ({ path: item.path.slice(5), sha: item.sha, size: item.size || 0 }))
      .filter(
        (item) => item.path && !item.path.split('/').some((part) => part === '.' || part === '..'),
      )
  },
  async readFile(env, locator, path, ref) {
    const base = `/repos/${encodeURIComponent(locator.namespace)}/${encodeURIComponent(locator.repo)}`
    const filePath = path.split('/').map(encodeURIComponent).join('/')
    const file = await gh<{ content: string; encoding: string }>(
      env,
      `${base}/contents/${filePath}?ref=${encodeURIComponent(ref)}`,
    )
    return decode(file)
  },
  async listWorkflowRuns(env, project) {
    const groups = await Promise.all(
      (project.workflows || [])
        .filter((workflow) => workflow.relevant)
        .slice(0, 6)
        .map(async (workflow) => {
          try {
            const data = await gh<{
              workflow_runs: Array<{
                id: number
                event: string
                status: string
                conclusion: string | null
                created_at: string
                updated_at: string
                html_url: string
                head_sha: string
              }>
            }>(
              env,
              `/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/actions/workflows/${workflow.id}/runs?per_page=10`,
            )
            return data.workflow_runs.map((run) => ({
              runId: run.id,
              workflowId: workflow.id,
              workflowName: workflow.name,
              event: run.event,
              status: run.status,
              conclusion: run.conclusion,
              created_at: run.created_at,
              updated_at: run.updated_at,
              html_url: run.html_url,
              head_sha: run.head_sha,
            }))
          } catch {
            return []
          }
        }),
    )
    return groups
      .flat()
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 30)
  },
  async listRunJobs(env, project, runId) {
    const base = `/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/actions/runs/${runId}/jobs`
    const jobs: Array<{
      id: number
      name: string
      status: string
      conclusion: string | null
      steps?: Array<{ number: number; name: string; status: string; conclusion: string | null }>
    }> = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await gh<{ jobs: typeof jobs }>(
        env,
        `${base}?per_page=${PAGE_SIZE}&page=${page}`,
      )
      jobs.push(...data.jobs)
      if (data.jobs.length < PAGE_SIZE) break
      if (page === MAX_PAGES)
        throw Error(`GitHub Job 列表超过 ${PAGE_SIZE * MAX_PAGES} 条上限，无法确认完整性`)
    }
    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      steps: (job.steps || []).map((step) => ({
        number: step.number,
        name: step.name,
        status: step.status,
        conclusion: step.conclusion,
      })),
    }))
  },
  async getJobLog(env, project, jobId, stepNumber) {
    const suffix = stepNumber == null ? '' : `/steps/${stepNumber}`
    const path = `/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/actions/jobs/${jobId}${suffix}/logs`
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'gkd-subscription-hub',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
    }
    const response = await fetch(`https://api.github.com${path}`, { headers })
    if (response.status === 404 && stepNumber != null) {
      const jobResponse = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/actions/jobs/${jobId}/logs`,
        { headers },
      )
      if (!jobResponse.ok) throw Error(`GitHub Job 日志读取失败：HTTP ${jobResponse.status}`)
      const jobLog = await readBoundedLog(jobResponse)
      return ['GitHub 暂未提供该 Step 的独立日志，以下为完整 Job 日志。', '', jobLog].join('\n')
    }
    if (!response.ok) throw Error(`GitHub 日志读取失败：HTTP ${response.status}`)
    return readBoundedLog(response)
  },
  rawFileUrl(project, file) {
    const ref = project.commitSha || encodeURIComponent(project.branch)
    return `https://raw.githubusercontent.com/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/${ref}/dist/${file.path.split('/').map(encodeURIComponent).join('/')}`
  },
}

async function readProviderLog(url: string, provider: string): Promise<string> {
  const response = await fetch(url, { headers: { Accept: 'text/plain, */*' } })
  if (response.status === 403 || response.status === 429)
    throw Error(`${provider} 日志 API 触发限流（HTTP ${response.status}）`)
  if (!response.ok) throw Error(`${provider} 日志读取失败：HTTP ${response.status}`)
  return readBoundedLog(response)
}

async function providerJson<T>(url: string, provider: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (response.status === 403 || response.status === 429) {
    throw Error(`${provider} API 触发限流（HTTP ${response.status}），请稍后重试。`)
  }
  if (!response.ok) throw Error(`${provider} API 请求失败：HTTP ${response.status}`)
  return response.json() as Promise<T>
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let index = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const current = index++
        results[current] = await mapper(items[current])
      }
    }),
  )
  return results
}

async function gitlabPage<T>(url: string): Promise<{ data: T; next: string | null }> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (response.status === 403 || response.status === 429) {
    throw Error(`GitLab API 触发限流（HTTP ${response.status}），请稍后重试。`)
  }
  if (!response.ok) throw Error(`GitLab API 请求失败：HTTP ${response.status}`)
  const link = response.headers.get('link') || ''
  const nextLink = link.split(',').find((part) => /rel="?next"?/.test(part))
  const next = nextLink?.match(/<([^>]+)>/)?.[1] || null
  return { data: (await response.json()) as T, next }
}

const gitlabAdapter: ProviderAdapter = {
  kind: 'gitlab',
  parse: (host, segments) => parsePath(host, segments, 'gitlab', 2),
  async getRepository(_env, locator) {
    const data = await providerJson<{
      id: number
      path_with_namespace: string
      web_url: string
      default_branch: string
      visibility: string
      archived: boolean
      forked_from_project?: { path_with_namespace?: string } | null
    }>(`https://gitlab.com/api/v4/projects/${encodeURIComponent(locator.fullPath)}`, 'GitLab')
    const parts = data.path_with_namespace.split('/')
    return {
      id: String(data.id),
      fullName: data.path_with_namespace,
      owner: parts.slice(0, -1).join('/'),
      repo: parts.at(-1) || locator.repo,
      htmlUrl: data.web_url,
      defaultBranch: data.default_branch,
      isPrivate: data.visibility !== 'public',
      archived: data.archived,
      fork: Boolean(data.forked_from_project),
      parentFullName: data.forked_from_project?.path_with_namespace || null,
    }
  },
  async listBranches(_env, locator) {
    const project = encodeURIComponent(locator.fullPath)
    const [metadata, first] = await Promise.all([
      this.getRepository(_env, locator),
      gitlabPage<Array<{ name: string }>>(
        `https://gitlab.com/api/v4/projects/${project}/repository/branches?per_page=${PAGE_SIZE}&pagination=keyset`,
      ),
    ])
    const items = [...first.data]
    let next = first.next
    if (!next && first.data.length === PAGE_SIZE) {
      throw Error('GitLab 分支列表返回满页但缺少下一页链接，无法确认完整性')
    }
    let pages = 1
    while (next && pages < MAX_PAGES) {
      if (new URL(next).hostname !== 'gitlab.com') throw Error('GitLab 分页链接主机无效')
      const page = await gitlabPage<Array<{ name: string }>>(next)
      items.push(...page.data)
      next = page.next
      if (!next && page.data.length === PAGE_SIZE && pages + 1 < MAX_PAGES) {
        throw Error('GitLab 分支列表返回满页但缺少下一页链接，无法确认完整性')
      }
      pages += 1
    }
    if (metadata.isPrivate || metadata.archived) throw Error('仅支持未归档公开仓库')
    const names = [...new Set(items.map((item) => item.name))]
    return {
      defaultBranch: metadata.defaultBranch,
      branches: [
        metadata.defaultBranch,
        ...names
          .filter((name) => name !== metadata.defaultBranch)
          .sort((a, b) => a.localeCompare(b)),
      ],
      truncated: Boolean(next) || items.length >= PAGE_SIZE * MAX_PAGES,
    }
  },
  async getCommit(_env, locator, branch) {
    const project = encodeURIComponent(locator.fullPath)
    const data = await providerJson<{ commit: { id: string } }>(
      `https://gitlab.com/api/v4/projects/${project}/repository/branches/${encodeURIComponent(branch)}`,
      'GitLab',
    )
    return data.commit.id
  },
  async listDistFiles(_env, locator, commitSha) {
    const project = encodeURIComponent(locator.fullPath)
    let url = `https://gitlab.com/api/v4/projects/${project}/repository/tree?path=dist&recursive=true&pagination=keyset&per_page=${PAGE_SIZE}&order_by=id&sort=asc&ref=${encodeURIComponent(commitSha)}`
    const files: Array<{ id: string; path: string; type: string }> = []
    let pages = 0
    while (url && pages < MAX_PAGES) {
      const page = await gitlabPage<Array<{ id: string; path: string; type: string }>>(url)
      files.push(...page.data)
      url = page.next || ''
      if (!url && page.data.length === PAGE_SIZE) {
        throw Error('GitLab dist/ 返回满页但缺少下一页链接，无法确认目录完整性')
      }
      pages += 1
    }
    if (url) throw Error('GitLab dist/ 文件超过 1,000 条，暂不支持完整索引')
    const blobs = files
      .filter((item) => item.type === 'blob')
      .filter(
        (item) =>
          item.path.startsWith('dist/') &&
          item.path.slice(5) &&
          !item.path
            .slice(5)
            .split('/')
            .some((part) => part === '.' || part === '..'),
      )
    return mapWithConcurrency(blobs, 8, async (item) => {
      const blob = await providerJson<{ size: number }>(
        `https://gitlab.com/api/v4/projects/${project}/repository/blobs/${encodeURIComponent(item.id)}`,
        'GitLab',
      )
      return {
        path: item.path.slice(5),
        sha: item.id,
        size: blob.size,
      }
    })
  },
  async readFile(_env, locator, path, ref) {
    const project = encodeURIComponent(locator.fullPath)
    const filePath = encodeURIComponent(path)
    const file = await providerJson<{ content: string; encoding: string }>(
      `https://gitlab.com/api/v4/projects/${project}/repository/files/${filePath}?ref=${encodeURIComponent(ref)}`,
      'GitLab',
    )
    return decode(file)
  },
  async listWorkflowRuns(_env, project) {
    if (!project.providerId) return []
    const pipelines = await providerJson<
      Array<{
        id: number
        status: string
        source: string
        name?: string | null
        created_at: string
        updated_at: string
        web_url: string
        sha: string
      }>
    >(
      `https://gitlab.com/api/v4/projects/${encodeURIComponent(project.providerId)}/pipelines?ref=${encodeURIComponent(project.branch)}&per_page=10&order_by=id&sort=desc`,
      'GitLab',
    )
    return pipelines.map((pipeline) => {
      const conclusion =
        pipeline.status === 'success'
          ? 'success'
          : pipeline.status === 'failed'
            ? 'failure'
            : pipeline.status === 'canceled'
              ? 'cancelled'
              : pipeline.status === 'skipped'
                ? 'skipped'
                : null
      const status = conclusion
        ? 'completed'
        : [
              'created',
              'waiting_for_callback',
              'waiting_for_resource',
              'preparing',
              'pending',
              'manual',
              'scheduled',
            ].includes(pipeline.status)
          ? 'queued'
          : 'in_progress'
      return {
        runId: pipeline.id,
        workflowId: pipeline.id,
        workflowName: pipeline.name || 'GitLab CI',
        event: pipeline.source,
        status,
        conclusion,
        created_at: pipeline.created_at,
        updated_at: pipeline.updated_at || pipeline.created_at,
        html_url: pipeline.web_url,
        head_sha: pipeline.sha,
      }
    })
  },
  async listRunJobs(_env, project, runId) {
    const projectId = encodeURIComponent(
      project.providerId || project.repositoryPath || `${project.owner}/${project.repo}`,
    )
    let url: string | null =
      `https://gitlab.com/api/v4/projects/${projectId}/pipelines/${runId}/jobs?per_page=${PAGE_SIZE}`
    const jobs: Array<{ id: number; name: string; status: string }> = []
    let pages = 0
    while (url && pages < MAX_PAGES) {
      if (new URL(url).hostname !== 'gitlab.com') throw Error('GitLab 分页链接主机无效')
      const pageResult: {
        data: Array<{ id: number; name: string; status: string }>
        next: string | null
      } = await gitlabPage<Array<{ id: number; name: string; status: string }>>(url)
      jobs.push(...pageResult.data)
      url = pageResult.next
      pages += 1
      if (!url && pageResult.data.length === PAGE_SIZE && pages < MAX_PAGES)
        throw Error('GitLab Job 列表返回满页但缺少下一页链接，无法确认完整性')
    }
    if (url) throw Error(`GitLab Job 列表超过 ${PAGE_SIZE * MAX_PAGES} 条上限，无法确认完整性`)
    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: ['success', 'failed', 'canceled', 'skipped'].includes(job.status)
        ? job.status === 'success'
          ? 'success'
          : job.status
        : null,
      steps: [{ number: 0, name: 'Job 日志', status: job.status, conclusion: null }],
    }))
  },
  async getJobLog(_env, project, jobId) {
    const projectId = encodeURIComponent(
      project.providerId || project.repositoryPath || `${project.owner}/${project.repo}`,
    )
    return readProviderLog(
      `https://gitlab.com/api/v4/projects/${projectId}/jobs/${jobId}/trace`,
      'GitLab',
    )
  },
  rawFileUrl(project, file) {
    return `https://gitlab.com/api/v4/projects/${encodeURIComponent(project.providerId || project.repositoryPath || `${project.owner}/${project.repo}`)}/repository/blobs/${file.sha}/raw`
  },
}

const giteaAdapter: ProviderAdapter = {
  kind: 'gitea',
  parse: (host, segments) => (segments.length === 2 ? parsePath(host, segments, 'gitea', 2) : null),
  async getRepository(_env, locator) {
    const base = `https://gitea.com/api/v1/repos/${encodeURIComponent(locator.namespace)}/${encodeURIComponent(locator.repo)}`
    const data = await providerJson<{
      id: number
      full_name: string
      html_url: string
      default_branch: string
      private: boolean
      archived: boolean
      fork: boolean
      parent?: { full_name?: string } | null
    }>(base, 'Gitea')
    return {
      id: String(data.id),
      fullName: data.full_name,
      owner: locator.namespace,
      repo: locator.repo,
      htmlUrl: data.html_url,
      defaultBranch: data.default_branch,
      isPrivate: data.private,
      archived: data.archived,
      fork: data.fork,
      parentFullName: data.parent?.full_name || null,
    }
  },
  async listBranches(_env, locator) {
    const base = `https://gitea.com/api/v1/repos/${encodeURIComponent(locator.namespace)}/${encodeURIComponent(locator.repo)}`
    const items: Array<{ name: string }> = []
    let page = 1
    let pageItems: Array<{ name: string }> = []
    do {
      pageItems = await providerJson<Array<{ name: string }>>(
        `${base}/branches?limit=50&page=${page}`,
        'Gitea',
      )
      items.push(...pageItems)
      page += 1
    } while (pageItems.length === 50 && page <= 20)
    const metadata = await this.getRepository(_env, locator)
    if (metadata.isPrivate || metadata.archived) throw Error('仅支持未归档公开仓库')
    const names = [...new Set(items.map((item) => item.name))]
    return {
      defaultBranch: metadata.defaultBranch,
      branches: [
        metadata.defaultBranch,
        ...names
          .filter((name) => name !== metadata.defaultBranch)
          .sort((a, b) => a.localeCompare(b)),
      ],
      truncated: page > 20 && pageItems.length === 50,
    }
  },
  async getCommit(_env, locator, branch) {
    const base = `https://gitea.com/api/v1/repos/${encodeURIComponent(locator.namespace)}/${encodeURIComponent(locator.repo)}`
    const data = await providerJson<{ commit: { id: string } }>(
      `${base}/branches/${encodeURIComponent(branch)}`,
      'Gitea',
    )
    return data.commit.id
  },
  async listDistFiles(_env, locator, commitSha) {
    const base = `https://gitea.com/api/v1/repos/${encodeURIComponent(locator.namespace)}/${encodeURIComponent(locator.repo)}`
    const files: Array<{ type: string; path: string; sha: string; size?: number }> = []
    let page = 1
    let truncated = false
    do {
      const data = await providerJson<{
        tree: Array<{ type: string; path: string; sha: string; size?: number }>
        truncated: boolean
      }>(`${base}/git/trees/${commitSha}?recursive=true&per_page=100&page=${page}`, 'Gitea')
      files.push(...data.tree)
      truncated = data.truncated
      page += 1
    } while (truncated && page <= MAX_PAGES)
    if (truncated) throw Error('Gitea Git Tree 超过 1,000 条，暂不支持完整索引')
    return files
      .filter((item) => item.type === 'blob' && item.path.startsWith('dist/'))
      .map((item) => ({ path: item.path.slice(5), sha: item.sha, size: item.size || 0 }))
      .filter(
        (item) => item.path && !item.path.split('/').some((part) => part === '.' || part === '..'),
      )
  },
  async readFile(_env, locator, path, ref) {
    const base = `https://gitea.com/api/v1/repos/${encodeURIComponent(locator.namespace)}/${encodeURIComponent(locator.repo)}`
    const filePath = path.split('/').map(encodeURIComponent).join('/')
    const file = await providerJson<{ content: string; encoding: string }>(
      `${base}/contents/${filePath}?ref=${encodeURIComponent(ref)}`,
      'Gitea',
    )
    return decode(file)
  },
  async listWorkflowRuns(_env, project) {
    const data = await providerJson<{
      workflow_runs: Array<{
        id: number
        path?: string
        event: string
        status: string
        conclusion?: string | null
        created_at: string
        updated_at?: string
        completed_at?: string
        html_url: string
        head_sha: string
      }>
    }>(
      `https://gitea.com/api/v1/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/actions/runs?branch=${encodeURIComponent(project.branch)}&limit=10&page=1`,
      'Gitea',
    )
    return data.workflow_runs.map((run) => {
      const conclusion =
        run.conclusion ||
        (run.status === 'success'
          ? 'success'
          : run.status === 'failure'
            ? 'failure'
            : run.status === 'cancelled'
              ? 'cancelled'
              : run.status === 'skipped'
                ? 'skipped'
                : null)
      const status = conclusion
        ? 'completed'
        : ['queued', 'pending', 'requested'].includes(run.status)
          ? 'queued'
          : 'in_progress'
      return {
        runId: run.id,
        workflowId: run.id,
        workflowName: run.path?.split('/').at(-1) || 'Gitea Actions',
        event: run.event,
        status,
        conclusion,
        created_at: run.created_at,
        updated_at: run.updated_at || run.completed_at || run.created_at,
        html_url: run.html_url,
        head_sha: run.head_sha,
      }
    })
  },
  async listRunJobs(_env, project, runId) {
    const base = `https://gitea.com/api/v1/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/actions/runs/${runId}/jobs`
    const jobs: Array<{
      id: number
      name: string
      status: string
      conclusion?: string | null
      steps?: Array<{ number?: number; name: string; status: string; conclusion?: string | null }>
    }> = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await providerJson<{ jobs: typeof jobs }>(
        `${base}?limit=50&page=${page}`,
        'Gitea',
      )
      jobs.push(...(data.jobs || []))
      if ((data.jobs || []).length < 50) break
      if (page === MAX_PAGES)
        throw Error(`Gitea Job 列表超过 ${50 * MAX_PAGES} 条上限，无法确认完整性`)
    }
    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion || null,
      steps: (job.steps || [{ name: 'Job 日志', status: job.status }]).map((step, index) => ({
        number: step.number ?? index,
        name: step.name,
        status: step.status,
        conclusion: step.conclusion || null,
      })),
    }))
  },
  async getJobLog(_env, project, jobId) {
    const url = `https://gitea.com/api/v1/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/actions/jobs/${jobId}/logs`
    return readProviderLog(url, 'Gitea')
  },
  rawFileUrl(project, file) {
    const owner = encodeURIComponent(project.owner)
    const repo = encodeURIComponent(project.repo)
    const ref = encodeURIComponent(project.commitSha || project.branch)
    const path = ['dist', ...file.path.split('/')].map(encodeURIComponent).join('/')
    return `https://gitea.com/api/v1/repos/${owner}/${repo}/media/${ref}/${path}`
  },
}

const adapters: Record<ProjectProvider, ProviderAdapter> = {
  github: githubAdapter,
  gitlab: gitlabAdapter,
  gitea: giteaAdapter,
}

export function parseRepositoryUrl(input: string): RepositoryLocator {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw Error('仓库 URL 无效')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw Error('仅接受 HTTPS 公开仓库地址')
  }
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        const decoded = decodeURIComponent(segment)
        if (decoded.includes('/') || decoded.includes('\\')) throw Error('仓库路径段无效')
        return decoded
      } catch {
        throw Error('仓库路径编码无效')
      }
    })
  if (url.hostname === 'gitlab.com' && segments.includes('-')) {
    throw Error('请填写 GitLab 项目根地址，不要附带 /-/tree 等页面路径')
  }
  const adapter = Object.values(adapters).find((item) => item.parse(url.hostname, segments))
  const locator = adapter?.parse(url.hostname, segments)
  if (!locator) throw Error('当前仅支持 GitHub、GitLab.com 与 Gitea.com 的公开仓库 URL')
  return locator
}

export function getProviderAdapter(provider: ProjectProvider | undefined): ProviderAdapter {
  return adapters[provider || 'github']
}

export async function readRepositoryFileAtRef(
  env: Env,
  repositoryUrl: string,
  path: string,
  ref: string,
): Promise<string> {
  const locator = parseRepositoryUrl(repositoryUrl)
  return getProviderAdapter(locator.provider).readFile(env, locator, path, ref)
}

export async function fetchProjectFile(
  _env: Env,
  project: ProjectSource,
  file: DistFile,
  options: { method?: string; ifNoneMatch?: string } = {},
) {
  const provider = getProviderAdapter(project.provider)
  const url = provider.rawFileUrl(project, file)
  return fetch(url, {
    method: options.method || 'GET',
    headers: options.ifNoneMatch ? { 'if-none-match': options.ifNoneMatch } : {},
    cf: { cacheEverything: true, cacheTtl: 60 },
  })
}
