import type { Env, ProjectProvider } from '../types'

export type HistoryArchiveStatus = 'git-only' | 'r2-archived' | 'r2-failed' | 'unavailable'

export interface VersionSnapshot {
  id: number
  version: number
  provider: ProjectProvider
  repoUrl: string
  commitSha: string
  createdAt: string
  objectKey: string
  archiveStatus: HistoryArchiveStatus
  contentSha256?: string
  archiveError?: string
}

function key(id: number) {
  return `history:${id}:versions`
}

export async function listVersionSnapshots(env: Env, id: number): Promise<VersionSnapshot[]> {
  const value = await env.STATE.get<VersionSnapshot[]>(key(id), 'json')
  return Array.isArray(value) ? value : []
}

export async function getVersionSnapshot(
  env: Env,
  id: number,
  version: number,
): Promise<VersionSnapshot | null> {
  return (await listVersionSnapshots(env, id)).find((item) => item.version === version) || null
}

export async function saveVersionSnapshot(env: Env, snapshot: VersionSnapshot): Promise<void> {
  const items = await listVersionSnapshots(env, snapshot.id)
  const index = items.findIndex((item) => item.version === snapshot.version)
  if (index >= 0) items[index] = snapshot
  else items.push(snapshot)
  items.sort((a, b) => a.version - b.version)
  await env.STATE.put(key(snapshot.id), JSON.stringify(items))
}
