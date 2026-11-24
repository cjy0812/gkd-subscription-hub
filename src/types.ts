export type ProjectProvider = 'github' | 'gitlab' | 'gitea'

export interface HistoryArchiveObject {
  text(): Promise<string>
}
export interface HistoryArchiveBinding {
  get(key: string): Promise<HistoryArchiveObject | null>
  put(
    key: string,
    value: string,
    options: {
      httpMetadata: { contentType: string }
      customMetadata: Record<string, string>
    },
  ): Promise<unknown>
}
export interface Env {
  HISTORY_ARCHIVE?: HistoryArchiveBinding
  STATE: KVNamespace
  ASSETS: Fetcher
  ADMIN_PASSWORD: string
  GITHUB_TOKEN?: string
  NOTIFY_TOKEN?: string
  SUBSCRIPTION_DOMAIN: string
}
export interface DistFile {
  path: string
  sha: string
  size: number
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
export interface Prediction {
  intervalHours: number | null
  predictedAt: string | null
  nextCheckAt: string
  successfulRuns: number
}
export interface Project {
  id: number
  provider?: ProjectProvider
  providerId?: string
  instanceUrl?: string
  repositoryPath?: string
  owner: string
  repo: string
  branch: string
  commitSha?: string
  subscriptionVersion?: number | null
  group?: string
  repoUrl: string
  distFiles: DistFile[]
  distHash: string
  workflows: WorkflowInfo[]
  registeredAt: string
  lastCheckedAt: string | null
  lastDistHash: string | null
  lastDistChangedAt: string | null
  lastRuns: WorkflowRun[]
  prediction: Prediction
  lastError: string | null
}
