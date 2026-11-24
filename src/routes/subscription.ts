import { Hono } from 'hono'
import { fetchProjectFile } from '../services/providers'
import { get } from '../storage/projects'
import type { Env, Project } from '../types'
import { renderJson5Preview } from '../utils/json5-preview'
import { renderMarkdown } from '../utils/markdown'
import { bad, documentPage, escapeHtml, htmlPreviewSecurityHeaders, mime, wantsHtml } from '../utils/http'

const app = new Hono<{ Bindings: Env }>()

function directory(project: Project) {
  const prefix = `/${project.id}/dist/`
  const rows = project.distFiles
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => {
      const path = file.path.split('/').map(encodeURIComponent).join('/')
      const type = mime(file.path).split(';', 1)[0]
      return `<tr><td><a href="${prefix}${path}">${escapeHtml(file.path)}</a></td><td>${escapeHtml(type)}</td><td>${file.size.toLocaleString()} bytes</td></tr>`
    })
    .join('')
  const body =
    `<h1>GKD 订阅 · ID ${project.id}</h1>` +
    `<p><a href="${escapeHtml(project.repoUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(project.owner)}/${escapeHtml(project.repo)}</a> · dist/</p>` +
    `<p>${project.distFiles.length} 个文件</p>` +
    '<div class="directory-table"><table><thead><tr><th>文件</th><th>类型</th><th>大小</th></tr></thead>' +
    `<tbody>${rows}</tbody></table></div>`
  return documentPage(`GKD ${project.id} · dist`, body)
}

app.all('*', async (c) => {
  const req = c.req.raw
  if (req.method !== 'GET' && req.method !== 'HEAD') return bad('Method not allowed', 405)
  const url = new URL(req.url)
  const match = url.pathname.match(/^\/(\d+)(?:\/(.*))?$/)
  if (!match) return bad('Not found', 404)
  const id = match[1]
  const project = await get(c.env, Number(id))
  if (!project) return bad('Subscription not registered', 404)

  let path: string
  try {
    path = decodeURIComponent(match[2] || '')
  } catch {
    return bad('Bad path', 400)
  }
  if (!path || path === 'dist' || path === 'dist/') {
    const out = new Response(directory(project), {
      headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store', ...htmlPreviewSecurityHeaders },
    })
    return req.method === 'HEAD' ? new Response(null, { status: out.status, headers: out.headers }) : out
  }
  if (path.startsWith('dist/')) path = path.slice(5)
  if (!path) return bad('Not found', 404)
  if (path.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.')) ||
      path.includes('\\') || !/^[A-Za-z0-9_@.+/-]+$/.test(path)) return bad('Not found', 404)

  const file = project.distFiles.find((item) => item.path === path)
  if (!file) return bad('File not found', 404)
  const response = await fetchProjectFile(c.env, project, file, {
    method: req.method,
    ifNoneMatch: req.headers.get('if-none-match') || undefined,
  })
  if (!response.ok) return new Response(response.body, { status: response.status, headers: response.headers })

  if (wantsHtml(req) && (path.toLowerCase().endsWith('.md') || path.toLowerCase().endsWith('.json5'))) {
    const text = await response.text()
    const body = path.toLowerCase().endsWith('.md')
      ? renderMarkdown(text)
      : renderJson5Preview(text, path, url.searchParams.get('preview') === 'full')
    const out = new Response(documentPage(path, body, '?raw=1'), {
      headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'public,max-age=60',
        vary: 'Accept, Sec-Fetch-Mode, Sec-Fetch-Dest', ...htmlPreviewSecurityHeaders },
    })
    return req.method === 'HEAD' ? new Response(null, { status: out.status, headers: out.headers }) : out
  }

  const headers = new Headers(response.headers)
  headers.set('content-type', mime(path))
  headers.set('access-control-allow-origin', '*')
  headers.set('cache-control', 'public,max-age=60,s-maxage=60')
  headers.set('vary', 'Accept, Sec-Fetch-Mode, Sec-Fetch-Dest')
  headers.set('x-gkd-subscription-id', id)
  headers.set('x-gkd-repository', project.owner + '/' + project.repo)
  headers.set('x-content-type-options', 'nosniff')
  return new Response(response.body, { status: response.status, headers })
})

export default app
