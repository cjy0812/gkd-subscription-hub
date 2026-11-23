import { describe, expect, it } from 'vitest'
import { renderJson5Preview } from '../src/utils/json5-preview'

describe('JSON5 read-only tree preview', () => {
  it('renders objects, arrays and typed primitive values', () => {
    const html = renderJson5Preview(
      "{ id: 233, title: '订阅', enabled: true, items: [1, null] }",
      'dist/gkd.json5',
    )
    expect(html).toContain('<h1>dist/gkd.json5</h1>')
    expect(html).toContain('json-kind">对象')
    expect(html).toContain('json-kind">数组')
    expect(html).toContain('json-string')
    expect(html).toContain('json-boolean')
    expect(html).toContain('json-null')
    expect(html).toContain('全部展开')
    expect(html).toContain('json-search')
  })

  it('escapes values and keys before rendering HTML', () => {
    const html = renderJson5Preview("{ '<img src=x onerror=alert(1)>': '<script>alert(1)</script>' }", 'x.json5')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('shows a readable parse error and escaped source fallback', () => {
    const html = renderJson5Preview('{ broken: <script> }', 'broken.json5')
    expect(html).toContain('JSON5 解析失败')
    expect(html).toContain('json-source')
    expect(html).toContain('&lt;script&gt;')
  })

  it('skips interactive rendering for oversized source', () => {
    const html = renderJson5Preview(' '.repeat(512_001), 'large.json5')
    expect(html).toContain('超过 500 KB')
    expect(html).not.toContain('json-viewer')
  })

  it('bounds the number of rendered nodes', () => {
    const source = `[${Array.from({ length: 20_050 }, (_, index) => index).join(',')}]`
    const html = renderJson5Preview(source, 'large-list.json5')
    expect(html).toContain('节点数量超过 20,000')
  })
})
