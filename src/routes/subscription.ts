import { Hono } from 'hono'
import { fetchProjectFile } from '../services/providers'
import { archiveHistoricalSnapshot, readVersionContent } from '../services/version-history'
import { get } from '../storage/projects'
import type { Env, Project } from '../types'
import {
  getVersionSnapshot,
  getVersionSnapshotById,
  listVersionSnapshots,
  type VersionSnapshot,
} from '../storage/versions'
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

async function previewApp(req: Request, assets: Fetcher) {
  const assetUrl = new URL(req.url)
  assetUrl.pathname = '/'
  const response = await assets.fetch(new Request(assetUrl, req))
  const headers = new Headers(response.headers)
  const vary = new Set(
    (headers.get('vary') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  for (const value of ['Accept', 'Sec-Fetch-Mode', 'Sec-Fetch-Dest']) {
    if (![...vary].some((item) => item.toLowerCase() === value.toLowerCase())) vary.add(value)
  }
  headers.set('vary', [...vary].join(', '))
  headers.set('cache-control', 'no-store')
  headers.set('x-content-type-options', 'nosniff')
  headers.set('referrer-policy', 'no-referrer')
  headers.set('x-frame-options', 'DENY')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function directory(project: Project, versions: Awaited<ReturnType<typeof listVersionSnapshots>>) {
  const rows = project.distFiles
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => {
      const path = file.path.split('/').map(encodeURIComponent).join('/')
      const type = mime(file.path).split(';', 1)[0]
      const href = `/${project.id}/${path}`
      return `<tr><td><a href="${href}">${escapeHtml(file.path)}</a></td><td>${escapeHtml(type)}</td><td>${file.size.toLocaleString()} bytes</td></tr>`
    })
    .join('')
  const historyRows = versions
    .slice()
    .sort((a, b) => b.version - a.version)
    .map((item) => {
      const status =
        item.archiveStatus === 'r2'
          ? 'Cloudflare R2 已归档'
          : item.archiveStatus === 'git-only'
            ? '旧版本待迁移'
            : item.archiveStatus === 'pending'
              ? '归档处理中'
              : '暂不可用'
      return `<tr><td><a href="/${project.id}/v${item.version}/gkd.json5">v${item.version}</a></td><td>${escapeHtml(status)}</td><td>${escapeHtml(new Date(item.createdAt).toLocaleString())}</td></tr>`
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
    const numericId = Number(id)
    if (!Number.isSafeInteger(version) || !Number.isSafeInteger(numericId)) {
      return bad('Invalid version', 400)
    }
    const project = await get(c.env, numericId)
    let snapshot: VersionSnapshot | null
    if (project) {
      snapshot = await getVersionSnapshot(c.env, numericId, version, project)
    } else {
      const lookup = await getVersionSnapshotById(c.env, numericId, version)
      if (lookup.ambiguous) {
        return bad(
          'This subscription ID has multiple repository histories; register the original repository to disambiguate',
          409,
        )
      }
      snapshot = lookup.snapshot
    }
    if (!snapshot) return bad('Historical version not found', 404)

    if (wantsHtml(req) && url.searchParams.get('raw') !== '1') return previewApp(req, c.env.ASSETS)

    if (snapshot.archiveStatus !== 'r2') {
      snapshot = await archiveHistoricalSnapshot(c.env, snapshot)
    }
    if (snapshot.archiveStatus !== 'r2' || !snapshot.contentSha256 || !snapshot.objectKey) {
      return bad(snapshot.archiveError || '历史版本尚未完成 Cloudflare R2 归档', 503)
    }

    const etag = `"${snapshot.contentSha256}"`
    const headers = new Headers({
      'content-type': 'application/json5; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public,max-age=31536000,immutable',
      'x-content-type-options': 'nosniff',
      'x-gkd-subscription-id': id,
      'x-gkd-subscription-version': String(version),
      etag,
      vary: 'Accept, Sec-Fetch-Mode, Sec-Fetch-Dest',
    })
    if (req.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers })
    }

    const cacheUrl = new URL(req.url)
    cacheUrl.searchParams.set('__archive', snapshot.contentSha256)
    const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' })
    const cache = await caches.open('gkd-subscription-history-v1')
    if (req.method === 'GET') {
      const cached = await cache.match(cacheKey)
      if (cached)
        return new Response(cached.body, { status: cached.status, headers: cached.headers })
    }

    let source: Uint8Array
    try {
      if (req.method === 'HEAD') {
        return new Response(null, { status: 200, headers })
      }
      source = await readVersionContent(c.env, snapshot)
    } catch (error) {
      return bad(error instanceof Error ? error.message : 'R2 历史归档读取失败', 502)
    }
    const body = source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength,
    ) as ArrayBuffer
    const response = new Response(body, { status: 200, headers })
    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()))
    return response
  }

  if (!path || path === 'dist' || path === 'dist/') {
    const project = await get(c.env, Number(id))
    if (!project) return bad('Subscription not registered', 404)
    const versions = await listVersionSnapshots(c.env, Number(id), project)
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
  if (wantsHtml(req) && url.searchParams.get('raw') !== '1' && /\.json5?$/i.test(path))
    return previewApp(req, c.env.ASSETS)

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
