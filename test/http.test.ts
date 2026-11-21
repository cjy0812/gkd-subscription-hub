import { describe, expect, it } from 'vitest'
import { escapeHtml, mime, wantsHtml } from '../src/utils/http'

describe('HTTP helpers', () => {
  it('negotiates HTML by Accept', () => {
    expect(wantsHtml(new Request('https://x/a', { headers: { accept: '*/*' } }))).toBe(false)
    expect(wantsHtml(new Request('https://x/a', { headers: { accept: 'text/html' } }))).toBe(true)
  })
  it('raw query overrides Accept', () =>
    expect(wantsHtml(new Request('https://x/a?raw=1', { headers: { accept: 'text/html' } }))).toBe(
      false,
    ))
  it('recognizes browser document navigation', () =>
    expect(
      wantsHtml(
        new Request('https://x/a', {
          headers: { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', accept: '*/*' },
        }),
      ),
    ).toBe(true))
  it('keeps fetch requests raw despite HTML Accept', () =>
    expect(
      wantsHtml(
        new Request('https://x/a', {
          headers: { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', accept: 'text/html' },
        }),
      ),
    ).toBe(false))
  it('escapes HTML', () => expect(escapeHtml("<x&'")).toBe('&lt;x&amp;&#39;'))
  it('sets JSON5 and Markdown MIME', () => {
    expect(mime('a.json5')).toContain('application/json5')
    expect(mime('a.md')).toContain('text/markdown')
  })
})
