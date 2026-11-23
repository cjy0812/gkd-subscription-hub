import { parseJson5 } from '../services/json5'
import { escapeHtml } from './http'

const MAX_PREVIEW_CHARS = 512_000
const MAX_RENDERED_NODES = 20_000

function displayPrimitive(value: unknown): { type: string; text: string } {
  if (value === null) return { type: 'null', text: 'null' }
  if (typeof value === 'string') return { type: 'string', text: JSON.stringify(value) }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { type: 'number', text: 'NaN' }
    if (value === Infinity) return { type: 'number', text: 'Infinity' }
    if (value === -Infinity) return { type: 'number', text: '-Infinity' }
    return { type: 'number', text: String(value) }
  }
  return { type: typeof value, text: String(value) }
}

export function renderJson5Preview(source: string, path: string): string {
  const heading = `<h1>${escapeHtml(path)}</h1>`
  if (source.length > MAX_PREVIEW_CHARS) {
    return (
      heading +
      '<div class="json-notice">文件超过 500 KB，已跳过交互式解析以避免浏览器卡顿。' +
      '请使用原始文件入口查看完整内容。</div>'
    )
  }

  let value: unknown
  try {
    value = parseJson5(source)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知解析错误'
    return (
      heading +
      `<div class="json-error">JSON5 解析失败：${escapeHtml(message)}</div>` +
      `<pre class="json-source"><code>${escapeHtml(source)}</code></pre>`
    )
  }

  let renderedNodes = 0
  let truncated = false

  const renderValue = (current: unknown, key: string | null, depth: number): string => {
    if (truncated) return ''
    renderedNodes += 1
    if (renderedNodes > MAX_RENDERED_NODES) {
      truncated = true
      return '<div class="json-notice">节点数量超过 20,000，已截断后续内容。请使用搜索或原始文件查看。</div>'
    }

    const keyHtml = key === null ? '' : `<span class="json-key">${escapeHtml(key)}</span>`
    if (Array.isArray(current) || (current !== null && typeof current === 'object')) {
      const isArray = Array.isArray(current)
      const entries = isArray
        ? current.map((item, index) => [String(index), item] as const)
        : Object.entries(current as Record<string, unknown>)
      const typeLabel = isArray ? '数组' : '对象'
      const countLabel = `${entries.length} 项`
      const children: string[] = []
      for (const [childKey, childValue] of entries) {
        if (truncated) break
        children.push(renderValue(childValue, childKey, depth + 1))
      }
      const open = depth === 0 ? ' open' : ''
      return (
        `<details class="json-entry json-node"${open}><summary>${keyHtml}` +
        `<span class="json-kind">${typeLabel}</span><span class="json-meta">${countLabel}</span></summary>` +
        `<div class="json-children">${children.join('')}</div></details>`
      )
    }

    const primitive = displayPrimitive(current)
    return (
      `<div class="json-entry json-leaf">${keyHtml}` +
      `<span class="json-value json-${primitive.type}">${escapeHtml(primitive.text)}</span></div>`
    )
  }

  const tree = renderValue(value, null, 0)
  const truncationNotice = truncated
    ? ''
    : '<p class="json-summary">解析完成 · 可折叠浏览对象与数组，也可搜索键名和值</p>'
  return (
    heading +
    '<div class="json-toolbar">' +
    '<input id="json-search" type="search" aria-label="搜索 JSON5" placeholder="搜索键名或值…">' +
    '<button type="button" id="json-expand">全部展开</button>' +
    '<button type="button" id="json-collapse">全部折叠</button>' +
    '</div>' +
    `<section class="json-viewer" aria-label="JSON5 树形视图">${tree}</section>` +
    truncationNotice
  )
}
