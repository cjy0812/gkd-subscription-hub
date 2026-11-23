import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const languages = {
  bash,
  sh: bash,
  shell: bash,
  css,
  diff,
  java,
  javascript,
  js: javascript,
  json,
  json5: json,
  kotlin,
  kt: kotlin,
  markdown,
  md: markdown,
  python,
  py: python,
  rust,
  rs: rust,
  sql,
  typescript,
  ts: typescript,
  xml,
  html: xml,
  svg: xml,
  yaml,
  yml: yaml,
}

for (const [name, grammar] of Object.entries(languages)) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, grammar)
}

const md = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  highlight(code, language) {
    const normalized = language.toLowerCase().trim()
    if (!normalized || !hljs.getLanguage(normalized)) return ''
    try {
      return hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value
    } catch {
      return ''
    }
  },
})

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKC')
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_-]+/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  )
}

function addHeadingIds(tokens: ReturnType<typeof md.parse>) {
  const used = new Map<string, number>()
  const headings: Array<{ id: string; label: string; level: number }> = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type !== 'heading_open') continue
    const inline = tokens[index + 1]
    if (!inline || inline.type !== 'inline') continue

    const headingText = inline.children?.map((child) => child.content).join('') || inline.content
    const base = `md-${slugify(headingText)}`
    const count = used.get(base) || 0
    used.set(base, count + 1)
    const id = count ? `${base}-${count + 1}` : base
    token.attrSet('id', id)
    headings.push({
      id,
      label: md.utils.escapeHtml(headingText),
      level: Number(token.tag.slice(1)) || 1,
    })
  }

  return headings
}

md.renderer.rules.heading_close = (tokens, index) => {
  const open = tokens[index - 2]
  const id = open?.attrGet('id')
  const anchor = id
    ? `<a class="heading-anchor" href="#${id}" aria-label="标题链接" title="标题链接">¶</a>`
    : ''
  return `</${tokens[index].tag}>${anchor}`
}

const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, index, options, env, self) => self.renderToken(tokens, index, options))

md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index]
  const href = token.attrGet('href') || ''
  if (/^(https?:)?\/\//i.test(href)) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
  }
  return defaultLinkOpen(tokens, index, options, env, self)
}

const defaultImage =
  md.renderer.rules.image ||
  ((tokens, index, options, env, self) => self.renderToken(tokens, index, options))

md.renderer.rules.image = (tokens, index, options, env, self) => {
  tokens[index].attrSet('loading', 'lazy')
  tokens[index].attrSet('decoding', 'async')
  return defaultImage(tokens, index, options, env, self)
}

md.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index]
  const language = token.info.trim().split(/\s+/, 1)[0]
  const highlighted = options.highlight
    ? options.highlight(token.content, language, '')
    : ''
  const code =
    highlighted && highlighted !== token.content
      ? highlighted
      : md.utils.escapeHtml(token.content)
  const label = language ? md.utils.escapeHtml(language) : '纯文本'
  return (
    `<div class="code-block"><div class="code-block-toolbar"><span>${label}</span>` +
    '<button class="copy-code" type="button">复制代码</button></div>' +
    `<pre><code class="hljs${language ? ` language-${label}` : ''}">${code}</code></pre></div>\n`
  )
}

export function renderMarkdown(source: string): string {
  const tokens = md.parse(source, {})
  const headings = addHeadingIds(tokens)
  const content = md.renderer.render(tokens, md.options, {})
  if (!headings.length) return content

  const items = headings
    .map(
      ({ id, label, level }) =>
        `<li class="toc-level-${level}"><a href="#${id}">${label}</a></li>`,
    )
    .join('')
  return `<nav class="markdown-toc" aria-label="文章目录"><strong>目录</strong><ol>${items}</ol></nav>${content}`
}
