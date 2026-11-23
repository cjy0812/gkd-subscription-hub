export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
export const bad = (message: string, status = 400) => json({ ok: false, error: message }, status)
export function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
export function wantsHtml(req: Request) {
  const url = new URL(req.url)
  if (url.searchParams.get('raw') === '1') return false
  if (url.searchParams.get('view') === '1') return true
  const mode = req.headers.get('sec-fetch-mode')?.toLowerCase(),
    dest = req.headers.get('sec-fetch-dest')?.toLowerCase()
  if (mode === 'navigate' && dest === 'document') return true
  if (mode === 'cors' || mode === 'no-cors' || dest === 'empty') return false
  return (req.headers.get('accept') || '').toLowerCase().includes('text/html')
}
export function documentPage(title: string, body: string, rawHref?: string) {
  const rawLink = rawHref ? `<a href="${escapeHtml(rawHref)}">查看原始文件</a>` : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{color-scheme:light dark;--page:#f7f8fa;--surface:#fff;--text:#24292f;--muted:#656d76;--border:#d1d9e0;--soft:#f0f2f5;--accent:#0969da;--code:#f6f8fa;--quote:#d1d9e0;--shadow:0 1px 3px #1f23280d}
    @media(prefers-color-scheme:dark){:root{--page:#0d1117;--surface:#161b22;--text:#e6edf3;--muted:#9198a1;--border:#30363d;--soft:#21262d;--accent:#58a6ff;--code:#0d1117;--quote:#3d444d;--shadow:none}}
    *{box-sizing:border-box}
    body{margin:0;background:var(--page);color:var(--text);font:16px/1.7 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .page-shell{width:min(100% - 32px,960px);margin:32px auto 72px}
    .page-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px;color:var(--muted);font-size:13px}
    .page-top a,.markdown-body a{color:var(--accent);text-decoration:none}
    .page-top a:hover,.markdown-body a:hover{text-decoration:underline}
    .markdown-body{min-width:0;padding:clamp(20px,4vw,44px);background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);overflow-wrap:anywhere}
    .markdown-body>:first-child{margin-top:0}
    .markdown-body>:last-child{margin-bottom:0}
    .markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4{line-height:1.3;margin:1.8em 0 .7em;scroll-margin-top:24px}
    .markdown-body h1{font-size:2em;padding-bottom:.35em;border-bottom:1px solid var(--border)}
    .markdown-body h2{font-size:1.55em;padding-bottom:.3em;border-bottom:1px solid var(--border)}
    .markdown-body h3{font-size:1.25em}
    .markdown-body p,.markdown-body ul,.markdown-body ol,.markdown-body blockquote{margin:1em 0}
    .markdown-body li+li{margin-top:.25em}
    .markdown-body blockquote{margin-left:0;padding:.15em 1em;border-left:3px solid var(--quote);color:var(--muted)}
    .markdown-body img{display:block;max-width:100%;height:auto;margin:1.2em auto;border-radius:8px}
    .markdown-body hr{height:1px;border:0;background:var(--border);margin:2em 0}
    .markdown-body table{display:block;width:100%;max-width:100%;overflow-x:auto;border-collapse:collapse;border-spacing:0;margin:1.2em 0}
    .markdown-body th,.markdown-body td{padding:8px 12px;border:1px solid var(--border);text-align:left;vertical-align:top}
    .markdown-body th{background:var(--soft);font-weight:650}
    .markdown-body tr:nth-child(even){background:color-mix(in srgb,var(--soft) 45%,transparent)}
    .markdown-body :not(pre)>code{padding:.15em .4em;border-radius:5px;background:var(--soft);font: .88em ui-monospace,SFMono-Regular,Consolas,monospace}
    .code-block{margin:1.25em 0;border:1px solid var(--border);border-radius:9px;overflow:hidden;background:var(--code)}
    .code-block-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:7px 12px;border-bottom:1px solid var(--border);color:var(--muted);font:12px ui-monospace,SFMono-Regular,Consolas,monospace}
    .copy-code{border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);padding:4px 9px;font:inherit;cursor:pointer}
    .copy-code:hover{border-color:var(--accent);color:var(--accent)}
    .copy-code:focus-visible,.markdown-body a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
    .code-block pre{margin:0;padding:16px;overflow:auto;tab-size:2;font:13px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}
    .code-block code{font:inherit;white-space:pre}
    .markdown-toc{margin:0 0 2em;padding:16px 20px;border:1px solid var(--border);border-radius:9px;background:var(--soft)}
    .markdown-toc>strong{display:block;margin-bottom:8px}
    .markdown-toc ol{margin:0;padding-left:1.4em}
    .markdown-toc li{margin:.25em 0}
    .markdown-toc .toc-level-2{margin-left:1em}
    .markdown-toc .toc-level-3{margin-left:2em;font-size:.94em}
    .heading-anchor{margin-left:.45em;opacity:0;color:var(--muted)!important;font-size:.8em;text-decoration:none}
    h1:hover .heading-anchor,h2:hover .heading-anchor,h3:hover .heading-anchor,h4:hover .heading-anchor,.heading-anchor:focus{opacity:1}
    .json-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:16px 0 12px}
    .json-toolbar input{flex:1 1 220px;min-width:0;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);padding:8px 10px;font:inherit}
    .json-toolbar button{border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);padding:7px 10px;font:inherit;cursor:pointer}
    .json-toolbar button:hover{border-color:var(--accent);color:var(--accent)}
    .json-toolbar :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .json-viewer{padding:12px;border:1px solid var(--border);border-radius:9px;background:var(--code);overflow:auto}
    .json-entry[hidden]{display:none}
    .json-node{margin:2px 0}
    .json-node>summary{display:flex;align-items:baseline;gap:9px;min-height:28px;cursor:pointer;list-style:none;overflow-wrap:anywhere}
    .json-node>summary::-webkit-details-marker{display:none}
    .json-node>summary:before{content:"▸";display:inline-block;width:12px;color:var(--muted);transition:transform .12s ease}
    .json-node[open]>summary:before{transform:rotate(90deg)}
    .json-children{margin-left:12px;padding-left:13px;border-left:1px solid var(--border)}
    .json-leaf{display:flex;align-items:baseline;gap:10px;min-height:27px;padding:3px 0 3px 21px;overflow-wrap:anywhere}
    .json-key{color:var(--text);font-weight:600}
    .json-kind,.json-meta{color:var(--muted);font-size:12px}
    .json-value{overflow-wrap:anywhere;white-space:pre-wrap}
    .json-string{color:#0a7a42}
    .json-number{color:#0969da}
    .json-boolean{color:#8250df}
    .json-null{color:var(--muted);font-style:italic}
    .json-notice,.json-error{margin:14px 0;padding:12px 14px;border:1px solid var(--border);border-radius:8px;background:var(--soft);overflow-wrap:anywhere}
    .json-error{border-color:#cf222e;color:#cf222e}
    .json-summary{color:var(--muted);font-size:13px}
    .json-source{max-height:65vh;overflow:auto;padding:14px;border:1px solid var(--border);border-radius:8px;background:var(--code);white-space:pre-wrap;overflow-wrap:anywhere}
    @media(prefers-color-scheme:dark){.json-string{color:#7ee787}.json-number{color:#79c0ff}.json-boolean{color:#d2a8ff}.json-error{border-color:#f85149;color:#ff7b72}}
    @media(max-width:600px){.json-viewer{padding:8px}.json-leaf{padding-left:16px;gap:7px}.json-children{margin-left:7px;padding-left:8px}}
    .hljs{color:var(--text)}
    .hljs-comment,.hljs-quote{color:#6a737d;font-style:italic}
    .hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-name{color:#d73a49}
    .hljs-string,.hljs-doctag,.hljs-regexp{color:#032f62}
    .hljs-number,.hljs-attr,.hljs-variable,.hljs-template-variable{color:#005cc5}
    .hljs-title,.hljs-section,.hljs-built_in,.hljs-type{color:#6f42c1}
    .hljs-meta,.hljs-symbol,.hljs-bullet{color:#e36209}
    @media(prefers-color-scheme:dark){.hljs-comment,.hljs-quote{color:#8b949e}.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-name{color:#ff7b72}.hljs-string,.hljs-doctag,.hljs-regexp{color:#a5d6ff}.hljs-number,.hljs-attr,.hljs-variable,.hljs-template-variable{color:#79c0ff}.hljs-title,.hljs-section,.hljs-built_in,.hljs-type{color:#d2a8ff}.hljs-meta,.hljs-symbol,.hljs-bullet{color:#ffa657}}
    @media(max-width:600px){.page-shell{width:min(100% - 20px,960px);margin:12px auto 32px}.markdown-body{padding:18px 16px;border-radius:9px}.markdown-body h1{font-size:1.65em}.markdown-body h2{font-size:1.35em}.code-block pre{padding:12px;font-size:12px}.page-top{margin-bottom:10px}}
    @media(prefers-reduced-motion:no-preference){.markdown-body a,.copy-code{transition:color .12s ease,border-color .12s ease}}
  </style>
</head>
<body>
  <main class="page-shell">
    <div class="page-top"><span>GKD 订阅文件预览</span>${rawLink}</div>
    <article class="markdown-body">${body}</article>
  </main>
  <script>
    document.addEventListener('click', async (event) => {
      if (!(event.target instanceof Element)) return
      const button = event.target.closest('.copy-code')
      if (!button) return
      const code = button.closest('.code-block')?.querySelector('code')?.innerText
      if (typeof code !== 'string') return
      const original = button.textContent
      try {
        await navigator.clipboard.writeText(code)
        button.textContent = '已复制'
      } catch {
        button.textContent = '复制失败'
      }
      window.setTimeout(() => { button.textContent = original }, 1600)
    })

    const jsonSearch = document.getElementById('json-search')
    const jsonEntries = Array.from(document.querySelectorAll('.json-entry'))
    jsonSearch?.addEventListener('input', () => {
      const query = jsonSearch.value.trim().toLocaleLowerCase()
      for (const entry of jsonEntries) {
        const matches = !query || (entry.textContent || '').toLocaleLowerCase().includes(query)
        entry.hidden = !matches
        if (query && matches && entry instanceof HTMLDetailsElement) entry.open = true
      }
    })
    document.getElementById('json-expand')?.addEventListener('click', () => {
      document.querySelectorAll('.json-node').forEach((node) => { node.open = true })
    })
    document.getElementById('json-collapse')?.addEventListener('click', () => {
      document.querySelectorAll('.json-node').forEach((node) => { node.open = false })
      const root = document.querySelector('.json-node')
      if (root) root.open = true
    })
  </script>
</body>
</html>`
}
export function mime(path: string) {
  const ext = path.split('.').pop()?.toLowerCase()
  return (
    (
      {
        json: 'application/json; charset=utf-8',
        json5: 'application/json5; charset=utf-8',
        md: 'text/markdown; charset=utf-8',
        txt: 'text/plain; charset=utf-8',
        yaml: 'text/yaml; charset=utf-8',
        yml: 'text/yaml; charset=utf-8',
        xml: 'application/xml; charset=utf-8',
        js: 'text/javascript; charset=utf-8',
        ts: 'text/plain; charset=utf-8',
        css: 'text/css; charset=utf-8',
        html: 'text/html; charset=utf-8',
        svg: 'image/svg+xml',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
      } as Record<string, string>
    )[ext || ''] || 'application/octet-stream'
  )
}
