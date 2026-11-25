import type { Env, Project, ProjectProvider } from '../types'

export type HistoryArchiveStatus = 'pending' | 'r2' | 'unavailable' | 'git-only'

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
  filePath?: string
  fileSize: number
  createdAt: string
  archiveStatus: HistoryArchiveStatus
  contentSha256?: string
  objectKey?: string
  compressedSize?: number
  archiveError?: string
}

interface VersionRow {
  snapshot_json: string
  status: 'pending' | 'ready' | 'unavailable'
  content_sha256: string | null
  object_key: string | null
  compressed_size: number | null
  archive_error: string | null
}

export interface ArchiveObject {
  contentSha256: string
  objectKey: string
  originalSize: number
  compressedSize: number
  status: 'pending' | 'ready'
}

export function repositoryKey(
  source: Pick<Project, 'provider' | 'providerId' | 'repoUrl'> | VersionSnapshot,
): string {
  const provider = source.provider || 'github'
  let canonical = source.repoUrl
  try {
    const url = new URL(source.repoUrl)
    canonical = url.hostname.toLowerCase() + url.pathname.replace(/\/+$/, '')
  } catch {
    canonical = source.repoUrl.trim()
  }
  return [provider, source.providerId || '', canonical].join(':')
}

function fromRow(row: VersionRow | null): VersionSnapshot | null {
  if (!row) return null
  const snapshot = JSON.parse(row.snapshot_json) as VersionSnapshot
  return {
    ...snapshot,
    archiveStatus: row.status === 'ready' ? 'r2' : row.status,
    contentSha256: row.content_sha256 || undefined,
    objectKey: row.object_key || undefined,
    compressedSize: row.compressed_size ?? undefined,
    archiveError: row.archive_error || undefined,
  }
}

function statement(env: Env, sql: string, ...values: (string | number | null)[]) {
  return env.VERSIONS.prepare(sql).bind(...values)
}

function snapshotRank(snapshot: VersionSnapshot): number {
  return snapshot.archiveStatus === 'git-only' && !!snapshot.contentSha256 && /^[a-f0-9]{64}$/i.test(snapshot.contentSha256) ? 0 : 1
}

function preferLegacySnapshot(
  current: VersionSnapshot,
  candidate: VersionSnapshot,
): VersionSnapshot {
  const rankDifference = snapshotRank(candidate) - snapshotRank(current)
  if (rankDifference < 0) return candidate
  if (rankDifference > 0) return current
  if (candidate.createdAt !== current.createdAt) {
    return candidate.createdAt < current.createdAt ? candidate : current
  }
  return candidate.commitSha.localeCompare(current.commitSha) < 0 ? candidate : current
}

async function legacySnapshots(
  env: Env,
  id: number,
  version?: number,
): Promise<VersionSnapshot[]> {
  const result: VersionSnapshot[] = []
  const legacy = await env.STATE.get<VersionSnapshot[]>(`history:${id}:versions`, 'json')
  if (Array.isArray(legacy)) {
    result.push(...legacy.filter((item) => version === undefined || item.version === version))
  }
  const prefix = version === undefined
    ? `history:${id}:snapshot:`
    : `history:${id}:snapshot:${version}:`
  let cursor: string | undefined
  do {
    const page = await env.STATE.list({
      prefix,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    })
    const values = await Promise.all(
      page.keys.map((item) => env.STATE.get<VersionSnapshot>(item.name, 'json')),
    )
    for (const item of values) {
      if (item && (version === undefined || item.version === version)) result.push(item)
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return result
}

export async function getVersionSnapshot(
  env: Env,
  id: number,
  version: number,
  project: Project,
): Promise<VersionSnapshot | null> {
  const row = await statement(
    env,
    'SELECT snapshot_json, status, content_sha256, object_key, compressed_size, archive_error FROM subscription_versions WHERE subscription_id = ? AND repository_key = ? AND version = ?',
    id,
    repositoryKey(project),
    version,
  ).first<VersionRow>()
  if (row) return fromRow(row)

  const candidates = (await legacySnapshots(env, id, version)).filter(
    (item) => repositoryKey(item) === repositoryKey(project),
  )
  const match = candidates.reduce<VersionSnapshot | null>(
    (current, candidate) =>
      current ? preferLegacySnapshot(current, candidate) : candidate,
    null,
  )
  return match ? { ...match, archiveStatus: match.archiveStatus || 'git-only' } : null
}

export async function getVersionSnapshotById(
  env: Env,
  id: number,
  version: number,
): Promise<{ snapshot: VersionSnapshot | null; ambiguous: boolean }> {
  const rows = await statement(
    env,
    'SELECT repository_key, snapshot_json, status, content_sha256, object_key, compressed_size, archive_error FROM subscription_versions WHERE subscription_id = ? AND version = ? ORDER BY created_at DESC',
    id,
    version,
  ).all<VersionRow & { repository_key: string }>()
  const repositories = new Set((rows.results || []).map((row) => row.repository_key))
  if (repositories.size > 1) return { snapshot: null, ambiguous: true }
  if (rows.results?.length) return { snapshot: fromRow(rows.results[0]), ambiguous: false }

  const legacy = (await legacySnapshots(env, id)).filter((item) => item.version === version)
  const legacyRepositories = new Set(legacy.map((item) => repositoryKey(item)))
  if (legacyRepositories.size > 1) return { snapshot: null, ambiguous: true }
  return {
    snapshot: legacy[0]
      ? { ...legacy[0], archiveStatus: legacy[0].archiveStatus || 'git-only' }
      : null,
    ambiguous: false,
  }
}

export async function listVersionSnapshots(
  env: Env,
  id: number,
  project: Project,
): Promise<VersionSnapshot[]> {
  const rows = await statement(
    env,
    'SELECT snapshot_json, status, content_sha256, object_key, compressed_size, archive_error FROM subscription_versions WHERE subscription_id = ? AND repository_key = ? ORDER BY version ASC',
    id,
    repositoryKey(project),
  ).all<VersionRow>()
  const result = (rows.results || [])
    .map((row) => fromRow(row))
    .filter((item): item is VersionSnapshot => !!item)

  const legacyByVersion = new Map<number, VersionSnapshot>()
  for (const item of await legacySnapshots(env, id)) {
    if (repositoryKey(item) !== repositoryKey(project)) continue
    const current = legacyByVersion.get(item.version)
    legacyByVersion.set(
      item.version,
      current ? preferLegacySnapshot(current, item) : item,
    )
  }
  for (const [version, item] of legacyByVersion) {
    if (!result.some((existing) => existing.version === version)) {
      result.push({ ...item, archiveStatus: item.archiveStatus || 'git-only' })
    }
  }
  return result.sort((a, b) => a.version - b.version)
}

export async function saveVersionSnapshot(
  env: Env,
  snapshot: VersionSnapshot,
): Promise<VersionSnapshot> {
  if (!Number.isSafeInteger(snapshot.id) || snapshot.id <= 0)
    throw new Error('Invalid subscription ID')
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version <= 0)
    throw new Error('Invalid subscription version')
  if (!snapshot.commitSha || !snapshot.fileSha)
    throw new Error('Version snapshot requires immutable source SHAs')

  const key = repositoryKey(snapshot)
  const initial = {
    ...snapshot,
    archiveStatus: 'pending' as const,
    contentSha256: undefined,
    objectKey: undefined,
  }
  await statement(
    env,
    'INSERT INTO subscription_versions (subscription_id, repository_key, version, snapshot_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(subscription_id, repository_key, version) DO NOTHING',
    snapshot.id,
    key,
    snapshot.version,
    JSON.stringify(initial),
    'pending',
    snapshot.createdAt,
  ).run()

  const row = await statement(
    env,
    'SELECT snapshot_json, status, content_sha256, object_key, compressed_size, archive_error FROM subscription_versions WHERE subscription_id = ? AND repository_key = ? AND version = ?',
    snapshot.id,
    key,
    snapshot.version,
  ).first<VersionRow>()
  const winner = fromRow(row)
  if (!winner) throw new Error('Failed to persist subscription version index')
  return winner
}

export async function reserveArchiveObject(
  env: Env,
  object: ArchiveObject,
): Promise<ArchiveObject> {
  try {
    await statement(
      env,
      'INSERT INTO archive_objects (content_sha256, object_key, original_size, compressed_size, status, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(content_sha256) DO NOTHING',
      object.contentSha256,
      object.objectKey,
      object.originalSize,
      object.compressedSize,
      'pending',
      new Date().toISOString(),
    ).run()
  } catch (error) {
    if (String(error).includes('R2_ARCHIVE_QUOTA_EXCEEDED')) {
      throw new Error('R2 历史归档容量或每日写入预算已达到安全上限，已拒绝新增归档')
    }
    throw error
  }
  const row = await statement(
    env,
    'SELECT content_sha256, object_key, original_size, compressed_size, status FROM archive_objects WHERE content_sha256 = ?',
    object.contentSha256,
  ).first<{
    content_sha256: string
    object_key: string
    original_size: number
    compressed_size: number
    status: 'pending' | 'ready'
  }>()
  if (!row) throw new Error('Failed to reserve R2 archive capacity')
  if (
    row.original_size !== object.originalSize ||
    row.compressed_size !== object.compressedSize ||
    row.object_key !== object.objectKey
  )
    throw new Error('R2 内容寻址对象元数据冲突')
  return {
    contentSha256: row.content_sha256,
    objectKey: row.object_key,
    originalSize: row.original_size,
    compressedSize: row.compressed_size,
    status: row.status,
  }
}

export async function markArchiveObjectReady(env: Env, hash: string) {
  await statement(
    env,
    "UPDATE archive_objects SET status = 'ready' WHERE content_sha256 = ?",
    hash,
  ).run()
}

export async function markVersionReady(
  env: Env,
  snapshot: VersionSnapshot,
  contentSha256: string,
  objectKey: string,
  compressedSize: number,
  originalSize: number,
) {
  await statement(
    env,
    "UPDATE subscription_versions SET status = 'ready', content_sha256 = ?, object_key = ?, original_size = ?, compressed_size = ?, archive_error = NULL WHERE subscription_id = ? AND repository_key = ? AND version = ? AND status != 'ready'",
    contentSha256,
    objectKey,
    originalSize,
    compressedSize,
    snapshot.id,
    repositoryKey(snapshot),
    snapshot.version,
  ).run()
}

export async function markVersionUnavailable(env: Env, snapshot: VersionSnapshot, error: string) {
  await statement(
    env,
    "UPDATE subscription_versions SET status = 'unavailable', archive_error = ? WHERE subscription_id = ? AND repository_key = ? AND version = ? AND status != 'ready'",
    error.slice(0, 500),
    snapshot.id,
    repositoryKey(snapshot),
    snapshot.version,
  ).run()
}

export async function getArchiveObject(env: Env, hash: string): Promise<ArchiveObject | null> {
  const row = await statement(
    env,
    'SELECT content_sha256, object_key, original_size, compressed_size, status FROM archive_objects WHERE content_sha256 = ?',
    hash,
  ).first<{
    content_sha256: string
    object_key: string
    original_size: number
    compressed_size: number
    status: 'pending' | 'ready'
  }>()
  return row
    ? {
        contentSha256: row.content_sha256,
        objectKey: row.object_key,
        originalSize: row.original_size,
        compressedSize: row.compressed_size,
        status: row.status,
      }
    : null
}

export async function consumeArchiveReadBudget(env: Env): Promise<void> {
  const row = await statement(
    env,
    "INSERT INTO archive_daily_usage (day, r2_reads, r2_writes) VALUES (date('now'), 1, 0) ON CONFLICT(day) DO UPDATE SET r2_reads = r2_reads + 1 WHERE r2_reads < 20000 RETURNING r2_reads",
  ).first<{ r2_reads: number }>()
  if (!row) throw new Error('R2 每日读取预算已达到安全上限，请稍后重试')
}

export async function consumeArchiveWriteBudget(env: Env): Promise<void> {
  const row = await statement(
    env,
    "INSERT INTO archive_daily_usage (day, r2_reads, r2_writes) VALUES (date('now'), 0, 1) ON CONFLICT(day) DO UPDATE SET r2_writes = r2_writes + 1 WHERE r2_writes < 200 RETURNING r2_writes",
  ).first<{ r2_writes: number }>()
  if (!row) throw new Error('R2 每日写入预算已达到安全上限，已拒绝新增归档')
}
