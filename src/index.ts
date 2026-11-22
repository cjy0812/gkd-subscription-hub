import admin from './routes/admin'
import subscription from './routes/subscription'
import { refresh } from './services/actions'
import { get, ids, save } from './storage/projects'
import type { Env, Project } from './types'
import { bad, json } from './utils/http'

const LEGACY_SUBSCRIPTION_URL = 'https://raw.githubusercontent.com/cjy0812/Ling033_GKD_Rules/main/dist/gkd.json5'

function equalSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

async function notify(req: Request, env: Env, ctx: ExecutionContext) {
  if (!env.NOTIFY_TOKEN) return bad('Webhook is not configured', 503)
  const auth = req.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ') || !equalSecret(auth.slice(7), env.NOTIFY_TOKEN))
    return bad('Unauthorized', 401)
  if (req.method !== 'POST') return bad('Method not allowed', 405)
  let body: { provider?: string; repository?: string }
  try {
    body = await req.json()
  } catch {
    return bad('Invalid JSON', 400)
  }
  if (body.provider !== 'github' || typeof body.repository !== 'string')
    return bad('Expected provider=github and repository=owner/repo', 400)
  const match = body.repository.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (!match) return bad('Invalid repository', 400)
  const projects: Project[] = (await Promise.all((await ids(env)).map((id) => get(env, id)))).filter(
    (p): p is Project => !!p,
  )
  const project = projects.find(
    (p) => p.owner.toLowerCase() === match[1].toLowerCase() && p.repo.toLowerCase() === match[2].toLowerCase(),
  )
  if (!project) return bad('Repository is not registered', 404)
  const cooldownKey = 'notify:cooldown:' + project.id
  if (await env.STATE.get(cooldownKey)) return json({ ok: true, accepted: false, reason: 'cooldown' })
  await env.STATE.put(cooldownKey, new Date().toISOString(), { expirationTtl: 60 })
  ctx.waitUntil(
    refresh(env, project).catch(async (error) => {
      await save(env, {
        ...project,
        lastError: error instanceof Error ? error.message : 'Webhook refresh failed',
        prediction: { ...project.prediction, nextCheckAt: new Date(Date.now() + 1800000).toISOString() },
      })
    }),
  )
  return json({ ok: true, accepted: true, projectId: project.id }, 202)
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url)
    const path = url.pathname

    if (path === '/') return Response.redirect(new URL('/admin/', url), 302)
    if (path === '/hooks/notify') return notify(req, env, ctx)

    if (path === '/gkd.json5') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return bad('Method not allowed', 405)
      const upstream = await fetch(LEGACY_SUBSCRIPTION_URL, { method: req.method })
      const headers = new Headers(upstream.headers)
      headers.set('cache-control', 'public, max-age=60, s-maxage=60')
      headers.set('access-control-allow-origin', '*')
      headers.set('x-content-type-options', 'nosniff')
      return new Response(upstream.body, { status: upstream.status, headers })
    }

    if (path === '/admin') return Response.redirect(new URL('/admin/', url), 301)
    if (path.startsWith('/admin/')) {
      if (path.startsWith('/admin/api/')) {
        const rewritten = new URL(req.url)
        rewritten.pathname = path.slice('/admin'.length)
        return admin.fetch(new Request(rewritten, req), env)
      }
      const assetUrl = new URL(req.url)
      assetUrl.pathname = path === '/admin/' ? '/' : path.slice('/admin'.length)
      return env.ASSETS.fetch(new Request(assetUrl, req))
    }

    if (/^\/\d+(?:\/|$)/.test(path)) return subscription.fetch(req, env)
    return bad('Not found', 404)
  },
  async scheduled(_c: ScheduledController, e: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const now = Date.now()
        for (const id of await ids(e)) {
          const p = await get(e, id)
          if (!p || Date.parse(p.prediction?.nextCheckAt || '') > now) continue
          try {
            await refresh(e, p)
          } catch (x) {
            await save(e, {
              ...p,
              lastError: x instanceof Error ? x.message : 'Refresh failed',
              prediction: { ...p.prediction, nextCheckAt: new Date(now + 1800000).toISOString() },
            })
          }
        }
      })(),
    )
  },
}
