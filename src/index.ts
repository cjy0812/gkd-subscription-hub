import admin from './routes/admin'
import subscription from './routes/subscription'
import { refresh } from './services/actions'
import { get, ids, save } from './storage/projects'
import type { Env } from './types'
export default {
  async fetch(req: Request, env: Env) {
    return new URL(req.url).pathname.startsWith('/s/')
      ? subscription.fetch(req, env)
      : admin.fetch(req, env)
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
