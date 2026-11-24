import type { Env, Project } from '../types'
import {
  getVersionSnapshot,
  listVersionSnapshots,
  saveVersionSnapshot,
  type VersionSnapshot,
} from '../storage/versions'
import { parseJson5 } from './json5'
import { fetchProjectFile, readRepositoryFileAtRef } from './providers'

const MAX_HISTORY_SNAPSHOT_BYTES = 50 * 1024 * 1024

export class HistorySnapshotTooLargeError extends Error {
  constructor(readonly byteLength: number) {
    super(
      '历史订阅文件超过 50 MB 安全读取上限（约 ' +
        (byteLength / 1024 / 1024).toFixed(1) +
        ' MB）',
    )
    this.name = 'HistorySnapshotTooLargeError'
  }
}

function sha256(value: Uint8Array): Promise<string> {
  return crypto.subtle
    .digest('SHA-256', value.buffer as ArrayBuffer)
    .then((digest) =>
      [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    )
}

export async function readBoundedSnapshotResponse(
  response: Response,
  maxBytes = MAX_HISTORY_SNAPSHOT_BYTES,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > maxBytes) {
    try {
      await response.body?.cancel()
    } catch {
      // A failed cancellation must not bypass the declared-size rejection.
    }
    throw new HistorySnapshotTooLargeError(declaredLength)
  }

  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      totalBytes += result.value.byteLength
      if (totalBytes > maxBytes) {
        throw new HistorySnapshotTooLargeError(totalBytes)
      }
      chunks.push(result.value)
    }
  } catch (error) {
    try {
      await reader.cancel(error)
    } catch {
      // The stream may already have failed or canceled itself.
    }
    throw error
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function readSubscriptionVersionAtRef(
  env: Env,
  repoUrl: string,
  ref: string,
  expectedId: number,
): Promise<number | null> {
  try {
    const source = await readRepositoryFileAtRef(env, repoUrl, 'dist/gkd.version.json5', ref)
    const value = parseJson5(source)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    const id = Number(record.id)
    const version = Number(record.version)
    if (id !== expectedId || !Number.isSafeInteger(version) || version < 1) return null
    return version
  } catch {
    return null
  }
}

async function readGitSnapshot(env: Env, snapshot: VersionSnapshot): Promise<Uint8Array> {
  if (!Number.isSafeInteger(snapshot.fileSize) || snapshot.fileSize < 0) {
    throw new Error('历史订阅文件大小元数据无效')
  }
  if (snapshot.fileSize > MAX_HISTORY_SNAPSHOT_BYTES) {
    throw new HistorySnapshotTooLargeError(snapshot.fileSize)
  }

  const response = await fetchProjectFile(
    env,
    {
      provider: snapshot.provider,
      providerId: snapshot.providerId,
      owner: snapshot.owner,
      repo: snapshot.repo,
      branch: snapshot.branch,
      commitSha: snapshot.commitSha,
    },
    { path: 'gkd.json5', sha: snapshot.fileSha, size: snapshot.fileSize },
  )
  if (!response.ok) throw Error(`读取历史订阅文件失败：HTTP ${response.status}`)
  return readBoundedSnapshotResponse(response)
}

export async function recordSubscriptionVersion(
  env: Env,
  project: Project,
): Promise<VersionSnapshot | null> {
  const version = project.subscriptionVersion
  if (!version || !project.commitSha) return null
  const existing = await getVersionSnapshot(env, project.id, version)
  if (existing) {
    if (existing.archiveStatus === 'git-only' && existing.contentSha256) return existing
    try {
      const bytes = await readGitSnapshot(env, existing)
      const recovered: VersionSnapshot = {
        ...existing,
        archiveStatus: 'git-only',
        contentSha256: await sha256(bytes),
        archiveError: undefined,
      }
      await saveVersionSnapshot(env, recovered)
      return recovered
    } catch (error) {
      const unavailable: VersionSnapshot = {
        ...existing,
        archiveStatus: 'unavailable',
        contentSha256: undefined,
        archiveError: error instanceof Error ? error.message : '读取历史订阅文件失败',
      }
      await saveVersionSnapshot(env, unavailable)
      return unavailable
    }
  }

  const file = project.distFiles.find((item) => item.path.toLowerCase() === 'gkd.json5')
  if (!file) return null

  const snapshot: VersionSnapshot = {
    id: project.id,
    version,
    provider: project.provider || 'github',
    providerId: project.providerId,
    owner: project.owner,
    repo: project.repo,
    branch: project.branch,
    repoUrl: project.repoUrl,
    commitSha: project.commitSha,
    fileSha: file.sha,
    fileSize: file.size,
    createdAt: new Date().toISOString(),
    archiveStatus: 'git-only',
  }

  try {
    const bytes = await readGitSnapshot(env, snapshot)
    snapshot.contentSha256 = await sha256(bytes)
  } catch (error) {
    snapshot.archiveStatus = 'unavailable'
    snapshot.archiveError = error instanceof Error ? error.message : '读取历史订阅文件失败'
  }
  await saveVersionSnapshot(env, snapshot)
  return snapshot
}

export async function readVersionContent(env: Env, snapshot: VersionSnapshot): Promise<string> {
  if (snapshot.archiveStatus !== 'git-only' || !snapshot.contentSha256) {
    throw Error('历史快照缺少有效的 SHA-256 校验值，拒绝返回未校验内容')
  }
  const bytes = await readGitSnapshot(env, snapshot)
  if ((await sha256(bytes)) !== snapshot.contentSha256) {
    throw Error('Git 历史快照校验失败')
  }
  return new TextDecoder().decode(bytes)
}

export async function listProjectVersions(env: Env, id: number) {
  return listVersionSnapshots(env, id)
}
