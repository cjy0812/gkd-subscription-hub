export interface Env {
  STATE: KVNamespace
  ASSETS: Fetcher
  ADMIN_PASSWORD: string
  GITHUB_TOKEN?: string
  ADMIN_HOST: string
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
  owner: string
  repo: string
  branch: string
  commitSha?: string
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
