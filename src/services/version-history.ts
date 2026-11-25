import type { Env, Project } from '../types'
import {
  getVersionSnapshot,
  listVersionSnapshots,
  markArchiveObjectReady,
  markVersionReady,
  markVersionUnavailable,
  consumeArchiveReadBudget,
  consumeArchiveWriteBudget,
  reserveArchiveObject,
  saveVersionSnapshot,
  type VersionSnapshot,
} from '../storage/versions'
import { parseJson5 } from './json5'
import { fetchProjectFile, readRepositoryFileAtRef } from './providers'

const MAX_HISTORY_SNAPSHOT_BYTES = 20 * 1024 * 1024
const MAX_COMPRESSED_SNAPSHOT_BYTES = 21 * 1024 * 1024

export class HistorySnapshotTooLargeError extends Error {
  constructor(readonly byteLength: number) {
    super(`历史订阅文件超过 20 MB 安全读取上限（约 ${(byteLength / 1024 / 1024).toFixed(1)} MB）`)
    this.name = 'HistorySnapshotTooLargeError'
  }
}

function sha256(value: Uint8Array): Promise<string> {
  return crypto.subtle
    .digest('SHA-256', value.slice().buffer as ArrayBuffer)
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
      /* Preserve the size rejection. */
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
      if (totalBytes > maxBytes) throw new HistorySnapshotTooLargeError(totalBytes)
      chunks.push(result.value)
    }
  } catch (error) {
    try {
      await reader.cancel(error)
    } catch {
      /* Stream already failed or canceled. */
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

async function gitBlobSha(bytes: Uint8Array, expectedSha: string): Promise<string> {
  const algorithm = expectedSha.length === 64 ? 'SHA-256' : 'SHA-1'
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(expectedSha)) {
    throw new Error('历史 Git Blob SHA 格式无效')
  }
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`)
  const payload = new Uint8Array(header.byteLength + bytes.byteLength)
  payload.set(header)
  payload.set(bytes, header.byteLength)
  const digest = await crypto.subtle.digest(algorithm, payload.buffer as ArrayBuffer)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function readSourceSnapshot(env: Env, snapshot: VersionSnapshot): Promise<Uint8Array> {
  if (!Number.isSafeInteger(snapshot.fileSize) || snapshot.fileSize < 0)
    throw new Error('历史订阅文件大小元数据无效')
  if (snapshot.fileSize > MAX_HISTORY_SNAPSHOT_BYTES)
    throw new HistorySnapshotTooLargeError(snapshot.fileSize)
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
    { path: snapshot.filePath || 'gkd.json5', sha: snapshot.fileSha, size: snapshot.fileSize },
  )
  if (!response.ok) throw Error(`读取历史订阅文件失败：HTTP ${response.status}`)
  const bytes = await readBoundedSnapshotResponse(response)
  if (bytes.byteLength !== snapshot.fileSize)
    throw new Error('历史订阅文件大小与固定版本元数据不一致')
  const actualBlobSha = await gitBlobSha(bytes, snapshot.fileSha)
  if (actualBlobSha.toLowerCase() !== snapshot.fileSha.toLowerCase()) {
    throw new Error('历史订阅文件 Git Blob SHA 与固定 Commit 元数据不一致')
  }
  return bytes
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice().buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice().buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  return readBoundedSnapshotResponse(new Response(stream))
}

async function archiveSnapshot(
  env: Env,
  snapshot: VersionSnapshot,
  bytes: Uint8Array,
): Promise<VersionSnapshot> {
  const hash = await sha256(bytes)
  const compressed = await gzip(bytes)
  const key = `objects/${hash.slice(0, 2)}/${hash}.json5.gz`
  const reserved = await reserveArchiveObject(env, {
    contentSha256: hash,
    objectKey: key,
    originalSize: bytes.byteLength,
    compressedSize: compressed.byteLength,
    status: 'pending',
  })
  if (reserved.status !== 'ready') {
    // A deterministic content-addressed key makes retrying the same immutable bytes idempotent.
    await consumeArchiveWriteBudget(env)
    await env.ARCHIVE.put(reserved.objectKey, compressed, {
      httpMetadata: { contentType: 'application/gzip' },
      customMetadata: { sha256: hash, originalSize: String(bytes.byteLength) },
    })
    await markArchiveObjectReady(env, hash)
  }
  await markVersionReady(
    env,
    snapshot,
    hash,
    reserved.objectKey,
    reserved.compressedSize,
    bytes.byteLength,
  )
  return {
    ...snapshot,
    archiveStatus: 'r2',
    contentSha256: hash,
    objectKey: reserved.objectKey,
    compressedSize: reserved.compressedSize,
    archiveError: undefined,
  }
}

export async function archiveHistoricalSnapshot(
  env: Env,
  legacySnapshot: VersionSnapshot,
): Promise<VersionSnapshot> {
  const expectedLegacyHash = legacySnapshot.contentSha256
  let snapshot: VersionSnapshot
  try {
    snapshot = await saveVersionSnapshot(env, legacySnapshot)
  } catch (error) {
    const message = error instanceof Error ? error.message : '历史版本索引保存失败'
    return { ...legacySnapshot, archiveStatus: 'unavailable', archiveError: message }
  }
  if (snapshot.archiveStatus === 'r2' && snapshot.objectKey) return snapshot
  try {
    const bytes = await readSourceSnapshot(env, snapshot)
    if (expectedLegacyHash && (await sha256(bytes)) !== expectedLegacyHash) {
      throw new Error('历史源文件 SHA-256 与已登记内容不一致')
    }
    return await archiveSnapshot(env, snapshot, bytes)
  } catch (error) {
    const message = error instanceof Error ? error.message : '历史订阅归档失败'
    await markVersionUnavailable(env, snapshot, message)
    return { ...snapshot, archiveStatus: 'unavailable', archiveError: message }
  }
}

export async function recordSubscriptionVersion(
  env: Env,
  project: Project,
): Promise<VersionSnapshot | null> {
  const version = project.subscriptionVersion
  if (!version || !project.commitSha) return null
  const existing = await getVersionSnapshot(env, project.id, version, project)
  if (existing?.archiveStatus === 'r2' && existing.contentSha256 && existing.objectKey)
    return existing
  if (existing) return archiveHistoricalSnapshot(env, existing)

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
    filePath: file.path,
    fileSize: file.size,
    createdAt: new Date().toISOString(),
    archiveStatus: 'pending',
  }
  const winner = await saveVersionSnapshot(env, snapshot)
  if (winner.archiveStatus === 'r2' && winner.objectKey) return winner
  try {
    const bytes = await readSourceSnapshot(env, winner)
    return await archiveSnapshot(env, winner, bytes)
  } catch (error) {
    const message = error instanceof Error ? error.message : '历史订阅归档失败'
    await markVersionUnavailable(env, winner, message)
    return { ...winner, archiveStatus: 'unavailable', archiveError: message }
  }
}

export async function readVersionContent(env: Env, snapshot: VersionSnapshot): Promise<Uint8Array> {
  if (snapshot.archiveStatus !== 'r2' || !snapshot.contentSha256 || !snapshot.objectKey) {
    throw new Error(snapshot.archiveError || '历史版本尚未完成 R2 归档')
  }
  await consumeArchiveReadBudget(env)
  const object = await env.ARCHIVE.get(snapshot.objectKey)
  if (!object) throw new Error('R2 历史归档对象不存在')
  if (object.size > MAX_COMPRESSED_SNAPSHOT_BYTES) throw new Error('R2 压缩对象超过安全读取上限')
  if (snapshot.compressedSize !== undefined && object.size !== snapshot.compressedSize) {
    throw new Error('R2 压缩对象大小与 D1 元数据不一致')
  }
  if (
    object.customMetadata?.sha256 !== snapshot.contentSha256 ||
    object.customMetadata?.originalSize !== String(snapshot.fileSize)
  ) {
    throw new Error('R2 对象元数据校验失败')
  }
  const compressed = await readBoundedSnapshotResponse(
    new Response(object.body),
    MAX_COMPRESSED_SNAPSHOT_BYTES,
  )
  const bytes = await gunzip(compressed)
  if (bytes.byteLength !== snapshot.fileSize || (await sha256(bytes)) !== snapshot.contentSha256) {
    throw new Error('R2 历史归档完整性校验失败')
  }
  return bytes
}

export async function listProjectVersions(env: Env, id: number, project: Project) {
  return listVersionSnapshots(env, id, project)
}
