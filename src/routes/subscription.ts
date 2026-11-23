import { Hono } from 'hono'
import { get } from '../storage/projects'
import type { Env, Project } from '../types'
import { renderMarkdown } from '../utils/markdown'
import { bad, documentPage, escapeHtml, mime, wantsHtml } from '../utils/http'

const app = new Hono<{ Bindings: Env }>()

function directory(p: Project) {
  const prefix = `/${p.id}/`
  const rows = p.distFiles
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => {
      const h = f.path.split('/').map(encodeURIComponent).join('/')
      return `<li><a href="${prefix}${h}">${escapeHtml(f.path)}</a> <small>${f.size.toLocaleString()} bytes</small></li>`
    })
    .join('')
  return documentPage(
    `GKD ${p.id}`,
    `<h1>GKD 订阅 · ID ${p.id}</h1><p>${escapeHtml(p.owner)}/${escapeHtml(p.repo)} · dist/</p><ul>${rows}</ul><p>${p.distFiles.length} 个文件</p>`,
  )
}

app.all('*', async (c) => {
  const req = c.req.raw
  if (req.method !== 'GET' && req.method !== 'HEAD') return bad('Method not allowed', 405)
  const url = new URL(req.url)
  const match = url.pathname.match(/^\/(\d+)(?:\/(.*))?$/)
  if (!match) return bad('Not found', 404)
  const id = match[1]
  const p = await get(c.env, Number(id))
  if (!p) return bad('Subscription not registered', 404)
  let path: string
  try {
    path = decodeURIComponent(match[2] || '')
  } catch {
    return bad('Bad path', 400)
  }
  if (!path)
    return new Response(directory(p), {
      headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' },
    })
  if (
    path.split('/').some((x) => !x || x === '.' || x === '..' || x.startsWith('.')) ||
    path.includes('\\') ||
    !/^[A-Za-z0-9_@.+/-]+$/.test(path)
  )
    return bad('Not found', 404)
  if (!p.distFiles.some((f) => f.path === path)) return bad('File not found', 404)
  const immutableRef = p.commitSha || encodeURIComponent(p.branch)
  const upstream =
      'https://raw.githubusercontent.com/' +
      p.owner +
      '/' +
      p.repo +
      '/' +
      immutableRef +
      '/dist/' +
      path.split('/').map(encodeURIComponent).join('/'),
    r = await fetch(upstream, {
      method: req.method,
      headers: req.headers.get('if-none-match')
        ? { 'if-none-match': req.headers.get('if-none-match')! }
        : {},
      cf: { cacheEverything: true, cacheTtl: 60 },
    })
  if (!r.ok) return new Response(r.body, { status: r.status, headers: r.headers })
  if (
    wantsHtml(req) &&
    (path.toLowerCase().endsWith('.md') || path.toLowerCase().endsWith('.json5'))
  ) {
    const text = await r.text(),
      body = path.toLowerCase().endsWith('.md')
        ? renderMarkdown(text)
        : '<h1>' +
          escapeHtml(path) +
          '</h1><p><a href="?raw=1">原始文件</a></p><pre><code>' +
          escapeHtml(text) +
          '</code></pre>',
      out = new Response(documentPage(path, body), {
        headers: {
          'content-type': 'text/html;charset=utf-8',
          'cache-control': 'public,max-age=60',
          vary: 'Accept, Sec-Fetch-Mode, Sec-Fetch-Dest',
          'x-content-type-options': 'nosniff',
        },
      })
    return req.method === 'HEAD'
      ? new Response(null, { status: out.status, headers: out.headers })
      : out
  }
  const h = new Headers(r.headers)
  h.set('content-type', mime(path))
  h.set('access-control-allow-origin', '*')
  h.set('cache-control', 'public,max-age=60,s-maxage=60')
  h.set('vary', 'Accept, Sec-Fetch-Mode, Sec-Fetch-Dest')
  h.set('x-gkd-subscription-id', id)
  h.set('x-gkd-repository', p.owner + '/' + p.repo)
  h.set('x-content-type-options', 'nosniff')
  return new Response(r.body, { status: r.status, headers: h })
})
export default app
