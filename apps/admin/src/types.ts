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
  owner: string
  repo: string
  branch: string
  group?: string
  commitSha?: string
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
