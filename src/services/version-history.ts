import type { Env, Project, ProjectProvider } from '../types'
import { getVersionSnapshot, listVersionSnapshots, saveVersionSnapshot, type VersionSnapshot } from '../storage/versions'
import { parseJson5 } from './json5'
import { readRepositoryFileAtRef } from './providers'

function sha256(value: string): Promise<string> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  )
}

export async function readSubscriptionVersionAtRef(
  env: Env,
  repoUrl: string,
  provider: ProjectProvider | undefined,
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
  return readRepositoryFileAtRef(
    env,
    snapshot.repoUrl,
    `dist/gkd.json5`,
    snapshot.commitSha,
  )
}

export async function recordSubscriptionVersion(env: Env, project: Project): Promise<VersionSnapshot | null> {
  const version = project.subscriptionVersion
  if (!version || !project.commitSha) return null
  const existing = await getVersionSnapshot(env, project.id, version)
  if (existing) return existing

  const objectKey = `subscriptions/${project.id}/v${version}/gkd.json5`
  const snapshot: VersionSnapshot = {
    id: project.id,
    version,
    provider: project.provider || 'github',
    repoUrl: project.repoUrl,
    commitSha: project.commitSha,
    createdAt: new Date().toISOString(),
    objectKey,
    archiveStatus: 'unavailable',
  }

  let content: string
  try {
    content = await readGitSnapshot(env, snapshot)
  } catch (error) {
    snapshot.archiveError = error instanceof Error ? error.message : '读取历史订阅文件失败'
    await saveVersionSnapshot(env, snapshot)
    return snapshot
  }
  snapshot.contentSha256 = await sha256(content)

  if (!env.HISTORY_ARCHIVE) {
    snapshot.archiveStatus = 'git-only'
  } else {
    try {
      await env.HISTORY_ARCHIVE.put(objectKey, content, {
        httpMetadata: { contentType: 'application/json5; charset=utf-8' },
        customMetadata: {
          sha256: snapshot.contentSha256,
          subscriptionId: String(snapshot.id),
          version: String(snapshot.version),
          commitSha: snapshot.commitSha,
        },
      })
      snapshot.archiveStatus = 'r2-archived'
    } catch (error) {
      snapshot.archiveStatus = 'r2-failed'
      snapshot.archiveError = error instanceof Error ? error.message : 'R2 归档失败'
    }
  }

  await saveVersionSnapshot(env, snapshot)
  return snapshot
}

export async function archiveVersionSnapshot(
  env: Env,
  id: number,
  version: number,
): Promise<VersionSnapshot | null> {
  const snapshot = await getVersionSnapshot(env, id, version)
  if (!snapshot) return null
  if (!env.HISTORY_ARCHIVE) throw Error('R2 尚未启用：请先在 Cloudflare 创建存储桶并配置 HISTORY_ARCHIVE 绑定')
  const content = await readGitSnapshot(env, snapshot)
  const digest = await sha256(content)
  await env.HISTORY_ARCHIVE.put(snapshot.objectKey, content, {
    httpMetadata: { contentType: 'application/json5; charset=utf-8' },
    customMetadata: {
      sha256: digest,
      subscriptionId: String(snapshot.id),
      version: String(snapshot.version),
      commitSha: snapshot.commitSha,
    },
  })
  const updated: VersionSnapshot = {
    ...snapshot,
    contentSha256: digest,
    archiveStatus: 'r2-archived',
    archiveError: undefined,
  }
  await saveVersionSnapshot(env, updated)
  return updated
}

export async function readVersionContent(env: Env, snapshot: VersionSnapshot): Promise<string> {
  if (env.HISTORY_ARCHIVE && snapshot.archiveStatus === 'r2-archived') {
    try {
      const object = await env.HISTORY_ARCHIVE.get(snapshot.objectKey)
      if (object) {
        const content = await object.text()
        const digest = await sha256(content)
        if (snapshot.contentSha256 && digest === snapshot.contentSha256) return content
      }
    } catch {
      // Fall back to the immutable Git commit if R2 cannot be read or verified.
    }
  }
  return readGitSnapshot(env, snapshot)
}

export async function listProjectVersions(env: Env, id: number) {
  return listVersionSnapshots(env, id)
}
