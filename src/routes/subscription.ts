import { Hono } from 'hono'
import { fetchProjectFile } from '../services/providers'
import { get } from '../storage/projects'
import type { Env, Project } from '../types'
import { getVersionSnapshot, listVersionSnapshots } from '../storage/versions'
import { readVersionContent } from '../services/version-history'
import { renderMarkdown } from '../utils/markdown'
import {
  bad,
  documentPage,
  escapeHtml,
  htmlPreviewSecurityHeaders,
  mime,
  wantsHtml,
} from '../utils/http'

const app = new Hono<{ Bindings: Env }>()

function directory(project: Project, versions: Awaited<ReturnType<typeof listVersionSnapshots>>) {
  const prefix = `/${project.id}/dist/`
  const rows = project.distFiles
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => {
      const path = file.path.split('/').map(encodeURIComponent).join('/')
      const type = mime(file.path).split(';', 1)[0]
      const href = file.path.toLowerCase().endsWith('.json5')
        ? `/preview/${project.id}?file=${encodeURIComponent(file.path)}`
        : `${prefix}${path}`
      return `<tr><td><a href="${href}">${escapeHtml(file.path)}</a></td><td>${escapeHtml(type)}</td><td>${file.size.toLocaleString()} bytes</td></tr>`
    })
    .join('')
  const historyRows = versions
    .slice()
    .sort((a, b) => b.version - a.version)
    .map((item) => {
      const status = item.archiveStatus === 'git-only' ? 'Git 固定提交可用' : '暂不可用'
      return `<tr><td><a href="/preview/${project.id}?version=${item.version}">v${item.version}</a></td><td>${escapeHtml(status)}</td><td>${escapeHtml(new Date(item.createdAt).toLocaleString())}</td></tr>`
    })
    .join('')
  const history = versions.length
    ? '<h2>历史版本</h2><div class="directory-table"><table><thead><tr><th>版本</th><th>归档状态</th><th>记录时间</th></tr></thead><tbody>' +
      historyRows +
      '</tbody></table></div>'
    : '<h2>历史版本</h2><p>尚未记录可恢复的 GKD 版本。版本号变化后会在此显示。</p>'
  const body =
    `<h1>GKD 订阅 · ID ${project.id}</h1>` +
    `<p><a href="${escapeHtml(project.repoUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(project.owner)}/${escapeHtml(project.repo)}</a> · dist/</p>` +
    `<p>${project.distFiles.length} 个文件 · 当前版本 ${project.subscriptionVersion ? `v${project.subscriptionVersion}` : '未识别'}</p>` +
    '<div class="directory-table"><table><thead><tr><th>文件</th><th>类型</th><th>大小</th></tr></thead>' +
    `<tbody>${rows}</tbody></table></div>` +
    history
  return documentPage(`GKD ${project.id} · dist`, body)
}

app.all('*', async (c) => {
  const req = c.req.raw
  if (req.method !== 'GET' && req.method !== 'HEAD') return bad('Method not allowed', 405)
  const url = new URL(req.url)
  const match = url.pathname.match(/^\/(\d+)(?:\/(.*))?$/)
  if (!match) return bad('Not found', 404)
  const id = match[1]
  let path: string
  try {
    path = decodeURIComponent(match[2] || '')
  } catch {
    return bad('Bad path', 400)
  }

  if (/^v[^/]+\/gkd\.json5$/i.test(path) && !/^v[1-9]\d*\/gkd\.json5$/i.test(path)) {
    return bad('Invalid version path', 400)
  }
  const versionMatch = path.match(/^v([1-9]\d*)\/gkd\.json5$/i)
  if (versionMatch) {
    const version = Number(versionMatch[1])
    if (!Number.isSafeInteger(version)) return bad('Invalid version', 400)
    const snapshot = await getVersionSnapshot(c.env, Number(id), version)
    if (!snapshot) return bad('Historical version not found', 404)
    if (wantsHtml(req) && url.searchParams.get('raw') !== '1') {
      return new Response(null, {
        status: 302,
        headers: {
          location: new URL(`/preview/${id}?version=${version}`, url).href,
          vary: 'Accept, Sec-Fetch-Mode, Sec-Fetch-Dest',
          'cache-control': 'private, no-store',
        },
      })
    }
    let source: Uint8Array
    try {
      source = await readVersionContent(c.env, snapshot)
    } catch {
      return bad('历史版本无法从固定 Git 提交中恢复', 502)
    }
    const headers = new Headers({
      'content-type': 'application/json5; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public,max-age=31536000,immutable',
      'x-content-type-options': 'nosniff',
      'x-gkd-subscription-id': id,
      'x-gkd-subscription-version': String(version),
      etag: `"${snapshot.contentSha256}"`,
      vary: 'Accept, Sec-Fetch-Mode, Sec-Fetch-Dest',
    })
    return new Response(req.method === 'HEAD' ? null : source, { status: 200, headers })
  }

  if (!path || path === 'dist' || path === 'dist/') {
    const project = await get(c.env, Number(id))
    if (!project) return bad('Subscription not registered', 404)
    const versions = await listVersionSnapshots(c.env, Number(id))
    const html = directory(project, versions)
    const response = new Response(html, {
      headers: {
        'content-type': 'text/html;charset=utf-8',
        'cache-control': 'no-store',
        ...htmlPreviewSecurityHeaders,
      },
    })
    return req.method === 'HEAD'
      ? new Response(null, { status: response.status, headers: response.headers })
      : response
  }
  const project = await get(c.env, Number(id))
  if (!project) return bad('Subscription not registered', 404)
  if (path.startsWith('dist/')) path = path.slice(5)
  if (!path) return bad('Not found', 404)
  if (
    path
      .split('/')
      .some((part) => !part || part === '.' || part === '..' || part.startsWith('.')) ||
    path.includes(String.fromCharCode(92)) ||
    path.includes(String.fromCharCode(0))
  )
    return bad('Not found', 404)

  const file = project.distFiles.find((item) => item.path === path)
  if (!file) return bad('File not found', 404)
  if (
    wantsHtml(req) &&
    url.searchParams.get('raw') !== '1' &&
    path.toLowerCase().endsWith('.json5')
  ) {
    return Response.redirect(new URL(`/preview/${id}?file=${encodeURIComponent(path)}`, url), 302)
  }

  const response = await fetchProjectFile(c.env, project, file, {
    method: req.method,
    ifNoneMatch: req.headers.get('if-none-match') || undefined,
  })
  if (!response.ok)
    return new Response(response.body, { status: response.status, headers: response.headers })

  if (wantsHtml(req) && url.searchParams.get('raw') !== '1' && path.toLowerCase().endsWith('.md')) {
    const text = await response.text()
    const body = renderMarkdown(text)
    const out = new Response(documentPage(path, body, '?raw=1'), {
      headers: {
        'content-type': 'text/html;charset=utf-8',
        'cache-control': 'public,max-age=60',
        vary: 'Accept, Sec-Fetch-Mode, Sec-Fetch-Dest',
        ...htmlPreviewSecurityHeaders,
      },
    })
    return req.method === 'HEAD'
      ? new Response(null, { status: out.status, headers: out.headers })
      : out
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
