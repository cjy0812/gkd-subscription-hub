export interface ProjectPrediction {
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
  group?: string
  commitSha?: string
  group?: string
  commitSha?: string
  repoUrl: string
  distFiles: Array<{ path: string; sha: string; size: number }>
  distHash: string
  registeredAt: string
  lastCheckedAt: string | null
  lastDistChangedAt: string | null
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
