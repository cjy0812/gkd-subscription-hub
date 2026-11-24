import type { Env, ProjectProvider } from '../types'

export type HistoryArchiveStatus = 'git-only' | 'unavailable'

export interface VersionSnapshot {
  id: number
  version: number
  provider: ProjectProvider
  providerId?: string
  owner: string
  repo: string
  branch: string
  repoUrl: string
  commitSha: string
  fileSha: string
  fileSize: number
  createdAt: string
  archiveStatus: HistoryArchiveStatus
  contentSha256?: string
  archiveError?: string
}

function legacyKey(id: number) {
  return `history:${id}:versions`
}

function snapshotPrefix(id: number) {
  return `history:${id}:snapshot:`
}

function snapshotKey(snapshot: VersionSnapshot) {
  return (
    snapshotPrefix(snapshot.id) +
    `${snapshot.version}:${snapshot.archiveStatus}:${snapshot.commitSha}`
  )
}

function normalizeSnapshot(snapshot: VersionSnapshot): VersionSnapshot {
  if (
    snapshot.archiveStatus !== 'git-only' ||
    !snapshot.contentSha256 ||
    !/^[a-f0-9]{64}$/i.test(snapshot.contentSha256)
  ) {
    return {
      ...snapshot,
      archiveStatus: 'unavailable',
      contentSha256: undefined,
      archiveError: snapshot.archiveError || '历史快照缺少有效的 SHA-256 校验值',
    }
  }
  return snapshot
}

function snapshotRank(snapshot: VersionSnapshot): number {
  return snapshot.archiveStatus === 'git-only' && snapshot.contentSha256 ? 0 : 1
}

function preferSnapshot(current: VersionSnapshot, candidate: VersionSnapshot): VersionSnapshot {
  const rankDifference = snapshotRank(candidate) - snapshotRank(current)
  if (rankDifference < 0) return candidate
  if (rankDifference > 0) return current
  if (candidate.createdAt !== current.createdAt) {
    return candidate.createdAt < current.createdAt ? candidate : current
  }
  return candidate.commitSha.localeCompare(current.commitSha) < 0 ? candidate : current
}

async function readIndexedSnapshots(env: Env, id: number): Promise<VersionSnapshot[]> {
  const result: VersionSnapshot[] = []
  let cursor: string | undefined

  do {
    const page = await env.STATE.list({
      prefix: snapshotPrefix(id),
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    })
    const snapshots = await Promise.all(
      page.keys.map((entry) => env.STATE.get<VersionSnapshot>(entry.name, 'json')),
    )
    for (const snapshot of snapshots) {
      if (snapshot) result.push(normalizeSnapshot(snapshot))
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)

  return result
}

export async function listVersionSnapshots(env: Env, id: number): Promise<VersionSnapshot[]> {
  // Read the legacy array while older deployments' history records are migrated lazily.
  const legacy = await env.STATE.get<VersionSnapshot[]>(legacyKey(id), 'json')
  const indexed = await readIndexedSnapshots(env, id)
  const candidates = [
    ...(Array.isArray(legacy) ? legacy.map(normalizeSnapshot) : []),
    ...indexed,
  ]
  const byVersion = new Map<number, VersionSnapshot>()

  for (const snapshot of candidates) {
    const current = byVersion.get(snapshot.version)
    byVersion.set(
      snapshot.version,
      current ? preferSnapshot(current, snapshot) : snapshot,
    )
  }

  return [...byVersion.values()].sort((a, b) => a.version - b.version)
}

export async function getVersionSnapshot(
  env: Env,
  id: number,
  version: number,
): Promise<VersionSnapshot | null> {
  return (await listVersionSnapshots(env, id)).find((item) => item.version === version) || null
}

export async function saveVersionSnapshot(env: Env, snapshot: VersionSnapshot): Promise<void> {
  if (!Number.isSafeInteger(snapshot.id) || snapshot.id <= 0) {
    throw new Error('Invalid subscription ID for version snapshot')
  }
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version <= 0) {
    throw new Error('Invalid subscription version snapshot')
  }
  if (!snapshot.commitSha || !snapshot.fileSha) {
    throw new Error('Version snapshot requires immutable Git commit and blob SHAs')
  }
  if (
    snapshot.archiveStatus === 'git-only' &&
    (!snapshot.contentSha256 || !/^[a-f0-9]{64}$/i.test(snapshot.contentSha256))
  ) {
    throw new Error('Git-only version snapshot requires a valid SHA-256 checksum')
  }

  // Each immutable snapshot has its own KV key. Concurrent releases no longer
  // perform a read-modify-write of one shared per-project array.
  await env.STATE.put(snapshotKey(snapshot), JSON.stringify(snapshot))
}
