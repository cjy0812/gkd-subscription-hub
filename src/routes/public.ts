import { Hono } from 'hono'
import { explorerCatalog } from '../services/explorer'
import { all } from '../storage/projects'
import type { Env } from '../types'
import { json } from '../utils/http'

const app = new Hono<{ Bindings: Env }>()

// Public DTOs intentionally omit internal hashes, errors, credentials, quota and mutation controls.
app.get('/subscriptions', async (c) => {
  const projects = await all(c.env)
  const subscriptions = projects.map((project) => ({
    id: project.id, provider: project.provider || 'github', owner: project.owner, repo: project.repo,
    branch: project.branch, group: project.group || '默认分组', repoUrl: project.repoUrl,
    registeredAt: project.registeredAt, lastCheckedAt: project.lastCheckedAt,
    fileCount: project.distFiles.length,
    hasSubscription: project.distFiles.some((file) => file.path.toLowerCase() === 'gkd.json5'),
  }))
  return json({ ok: true, subscriptions })
})

app.get('/explorer', async (c) => {
  const entries = await explorerCatalog(c.env)
  const publicEntries = entries.map((entry) => ({
    repository: {
      id: entry.repository.id,
      full_name: entry.repository.full_name,
      description: entry.repository.description,
      html_url: entry.repository.html_url,
      default_branch: entry.repository.default_branch,
      topics: entry.repository.topics,
      stargazers_count: entry.repository.stargazers_count,
      forks_count: entry.repository.forks_count,
      pushed_at: entry.repository.pushed_at,
      updated_at: entry.repository.updated_at,
      language: entry.repository.language,
      license: entry.repository.license,
      homepage: entry.repository.homepage,
      created_at: entry.repository.created_at,
    },
    fork: entry.fork, parent: entry.parent,
    subscriptions: entry.subscriptions.map((subscription) => ({
      id: subscription.id, name: subscription.name, version: subscription.version,
      author: subscription.author, updateUrl: subscription.updateUrl, checkUpdateUrl: subscription.checkUpdateUrl,
      artifactPath: subscription.artifactPath, artifactSize: subscription.artifactSize,
      categoriesCount: subscription.categoriesCount, appsCount: subscription.appsCount,
      globalGroupsCount: subscription.globalGroupsCount, ruleCount: subscription.ruleCount,
      customFields: subscription.customFields,
    })),
    discoveredBy: entry.discoveredBy, verifiedAt: entry.verifiedAt,
  }))
  return json({ ok: true, entries: publicEntries })
})

app.notFound(() => json({ ok: false, error: 'Not found' }, 404))
export default app
