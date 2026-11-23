import type { DistFile, Env, Project, WorkflowInfo } from '../types'
import { decode, gh } from './github'
import { getProviderAdapter, parseRepositoryUrl, type RepositoryLocator } from './providers'

export function parseRepo(input: string): RepositoryLocator {
  return parseRepositoryUrl(input)
}

export async function listBranches(env: Env, locator: RepositoryLocator) {
  const adapter = getProviderAdapter(locator.provider)
  return adapter.listBranches(env, locator)
}

export function extractId(source: string) {
  const match = source.match(/defineGkdSubscription\s*\(\s*\{[\s\S]*?\bid\s*:\s*(\d+)/)
  const id = Number(match?.[1])
  if (!Number.isSafeInteger(id) || id < 1) throw Error('无法提取有效订阅 ID')
  return id
}

export async function digest(files: DistFile[]) {
  const source = files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => file.path + '\0' + file.sha + '\0' + file.size)
    .join('\n')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function githubWorkflows(
  env: Env,
  locator: RepositoryLocator,
  commitSha: string,
): Promise<WorkflowInfo[]> {
  const base = `/repos/${encodeURIComponent(locator.namespace)}/${encodeURIComponent(locator.repo)}`
  const response = await gh<{
    workflows: Array<{ id: number; name: string; path: string; state: string }>
  }>(env, `${base}/actions/workflows?per_page=100`)
  return Promise.all(
    response.workflows
      .filter((workflow) => workflow.state === 'active')
      .slice(0, 8)
      .map(async (workflow) => {
        let yaml = ''
        try {
          const filePath = workflow.path.split('/').map(encodeURIComponent).join('/')
          const file = await gh<{ content: string; encoding: string }>(
            env,
            `${base}/contents/${filePath}?ref=${commitSha}`,
          )
          yaml = decode(file)
        } catch {
          // A workflow file may have been removed between the workflow list and commit lookup.
        }
        const cron = [
          ...yaml.matchAll(/^\s*-\s*cron:\s*['"]?([^'"\s]+(?:\s+[^'"\s]+){4})['"]?\s*$/gm),
        ].map((match) => match[1])
        return {
          id: workflow.id,
          name: workflow.name,
          path: workflow.path,
          cron,
          relevant: /dist|subscription|release|publish|deploy|build/i.test(
            workflow.name + ' ' + workflow.path + ' ' + yaml,
          ),
        }
      }),
  )
}

export async function scan(
  env: Env,
  locator: RepositoryLocator,
  branch?: string,
): Promise<Project> {
  const adapter = getProviderAdapter(locator.provider)
  const metadata = await adapter.getRepository(env, locator)
  if (metadata.isPrivate || metadata.archived) throw Error('仅支持未归档公开仓库')
  if (!metadata.defaultBranch) throw Error('仓库没有可用的默认分支')

  const ref = branch || metadata.defaultBranch
  const commitSha = await adapter.getCommit(env, locator, ref)
  const subscriptionSource = await adapter.readFile(env, locator, 'src/subscription.ts', commitSha)
  const id = extractId(subscriptionSource)
  const distFiles = await adapter.listDistFiles(env, locator, commitSha)
  if (!distFiles.length) throw Error('dist/ 不存在或为空')

  const workflows =
    locator.provider === 'github' ? await githubWorkflows(env, locator, commitSha) : []
  const timestamp = new Date().toISOString()
  return {
    id,
    provider: locator.provider,
    providerId: metadata.id,
    instanceUrl: `https://${locator.host}`,
    repositoryPath: metadata.fullName,
    owner: metadata.owner,
    repo: metadata.repo,
    branch: ref,
    commitSha,
    repoUrl: metadata.htmlUrl,
    distFiles,
    distHash: await digest(distFiles),
    workflows,
    registeredAt: timestamp,
    lastCheckedAt: null,
    lastDistHash: null,
    lastDistChangedAt: null,
    lastRuns: [],
    prediction: {
      intervalHours: null,
      predictedAt: null,
      nextCheckAt: timestamp,
      successfulRuns: 0,
    },
    lastError: null,
  }
}
