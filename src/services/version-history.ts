import type { Env, Project } from '../types'
import {
  getVersionSnapshot,
  listVersionSnapshots,
  saveVersionSnapshot,
  type VersionSnapshot,
} from '../storage/versions'
import { parseJson5 } from './json5'
import { fetchProjectFile, readRepositoryFileAtRef } from './providers'

function sha256(value: string): Promise<string> {
  return crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(value))
    .then((digest) =>
      [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    )
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

async function readGitSnapshot(env: Env, snapshot: VersionSnapshot): Promise<string> {
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
  return response.text()
}

export async function recordSubscriptionVersion(
  env: Env,
  project: Project,
): Promise<VersionSnapshot | null> {
  const version = project.subscriptionVersion
  if (!version || !project.commitSha) return null
  const existing = await getVersionSnapshot(env, project.id, version)
  if (existing) return existing
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
    objectKey: `subscriptions/${project.id}/v${version}/gkd.json5`,
    archiveStatus: 'git-only',
  }

  try {
    const content = await readGitSnapshot(env, snapshot)
    snapshot.contentSha256 = await sha256(content)
  } catch (error) {
    snapshot.archiveStatus = 'unavailable'
    snapshot.archiveError = error instanceof Error ? error.message : '读取历史订阅文件失败'
  }
  await saveVersionSnapshot(env, snapshot)
  return snapshot
}

export async function readVersionContent(env: Env, snapshot: VersionSnapshot): Promise<string> {
  const content = await readGitSnapshot(env, snapshot)
  if (snapshot.contentSha256 && (await sha256(content)) !== snapshot.contentSha256) {
    throw Error('Git 历史快照校验失败')
  }
  return content
}

export async function listProjectVersions(env: Env, id: number) {
  return listVersionSnapshots(env, id)
}
