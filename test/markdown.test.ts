import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/utils/markdown'

describe('Markdown preview renderer', () => {
  it('renders GitHub-flavored tables and a linked table of contents', () => {
    const html = renderMarkdown(
      '# 概览\n\n## 安装步骤\n\n| 名称 | 状态 |\n| --- | --- |\n| GKD | 正常 |',
    )
    expect(html).toContain('class="markdown-toc"')
    expect(html).toContain('href="#md-安装步骤"')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>名称</th>')
  })

  it('generates stable unique ids for duplicate headings', () => {
    const html = renderMarkdown('## 配置\n\n## 配置')
    expect(html).toContain('id="md-配置"')
    expect(html).toContain('id="md-配置-2"')
    expect(html).toContain('href="#md-配置-2"')
  })

  it('does not render raw HTML or executable links', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n[bad](javascript:alert(1))')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('&lt;script&gt;')
  })

  it('highlights registered code languages and safely escapes unknown languages', () => {
    const html = renderMarkdown(
      '```typescript\nconst answer: number = 42\n```\n\n```unknown-lang\n<svg onload=alert(1)>\n```',
    )
    expect(html).toContain('class="hljs language-typescript"')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('&lt;svg')
    expect(html).not.toContain('<svg onload')
  })

  it('adds safe external-link attributes and lazy image loading', () => {
    const html = renderMarkdown(
      '[docs](https://example.com)\n\n![image](https://example.com/a.png)',
    )
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('decoding="async"')
  })

  it('keeps linked heading labels plain in the generated table of contents', () => {
    const html = renderMarkdown('## [安装指南](https://example.com)')
    expect(html).toContain('href="#md-安装指南"')
    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain('<a href="#md-安装指南"><a')
  })

  it('provides a copy action for fenced code blocks', () => {
    const html = renderMarkdown('```js\nconsole.log(1)\n```')
    expect(html).toContain('class="copy-code"')
    expect(html).toContain('复制代码')
  })
})
