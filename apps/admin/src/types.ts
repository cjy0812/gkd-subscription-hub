export interface ProjectPrediction {
  intervalHours: number | null
  predictedAt: string | null
  nextCheckAt: string
  successfulRuns: number
}

export interface WorkflowInfo {
  id: number
  name: string
  path: string
  cron: string[]
  relevant: boolean
}

export interface WorkflowRun {
  workflowId: number
  workflowName: string
  event: string
  status: string
  conclusion: string | null
  created_at: string
  updated_at: string
  html_url: string
  head_sha: string
}

export interface DistFile {
  path: string
  sha: string
  size: number
}

export interface Project {
  id: number
  provider?: 'github' | 'gitlab' | 'gitea'
  providerId?: string
  instanceUrl?: string
  repositoryPath?: string
  owner: string
  repo: string
  branch: string
  group?: string
  commitSha?: string
  subscriptionVersion?: number | null
  repoUrl: string
  distFiles: DistFile[]
  distHash: string
  workflows: WorkflowInfo[]
  registeredAt: string
  lastCheckedAt: string | null
  lastDistHash: string | null
  lastDistChangedAt: string | null
  lastRuns: WorkflowRun[]
  prediction: ProjectPrediction
  lastError: string | null
}

export interface ProjectsResponse {
  ok: boolean
  projects: Project[]
}

export interface ProjectResponse {
  ok: boolean
  project: Project
}

export interface ExplorerSubscription {
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

export interface ExplorerRepository {
  id: number
  full_name: string
  description: string | null
  owner?: { login?: string }
  topics?: string[]
  archived?: boolean
  html_url: string
  default_branch: string
  stargazers_count: number
  forks_count: number
  pushed_at: string | null
  updated_at: string
  language: string | null
  license?: { spdx_id: string | null } | null
  homepage: string | null
  created_at: string
  size: number
  open_issues_count: number
  custom_properties?: Record<string, unknown>
}

export interface ExplorerEntry {
  repository: ExplorerRepository
  fork: boolean
  parent: string | null
  subscriptions: ExplorerSubscription[]
  discoveredBy: string[]
  verifiedAt: string
}

export interface ExplorerJobStatus {
  phase: 'collecting' | 'verifying' | 'complete'
  status: 'idle' | 'searching' | 'verifying' | 'complete' | 'paused' | 'error'
  queryIndex: number
  page: number
  candidateCount: number
  candidateIndex: number
  verifiedCount: number
  matchedCount: number
  seenCount: number
  error: string | null
  incomplete: boolean
  scannedPages: number
  startedAt: string | null
  updatedAt: string
}

export interface ExplorerQuotaResource {
  limit: number
  remaining: number
  used: number
  reset: number
}

export interface ExplorerQuota {
  core: ExplorerQuotaResource
  search: ExplorerQuotaResource
  code_search: ExplorerQuotaResource
}

export interface ExplorerCatalogResponse {
  ok: boolean
  entries: ExplorerEntry[]
}

export interface ExplorerStatusResponse {
  ok: boolean
  status: ExplorerJobStatus
}

export interface ExplorerQuotaResponse {
  ok: boolean
  quota: ExplorerQuota
}
