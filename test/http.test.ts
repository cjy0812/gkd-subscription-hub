import { describe, expect, it } from 'vitest'
import { escapeHtml, htmlPreviewSecurityHeaders, mime, wantsHtml } from '../src/utils/http'

describe('HTTP helpers', () => {
  it('negotiates HTML by Accept', () => {
    expect(wantsHtml(new Request('https://x/a', { headers: { accept: '*/*' } }))).toBe(false)
    expect(wantsHtml(new Request('https://x/a', { headers: { accept: 'text/html' } }))).toBe(true)
  })
  it('supports the source-view query without changing the file URL', () =>
    expect(wantsHtml(new Request('https://x/a.json5?view=source', { headers: { accept: 'text/html' } }))).toBe(true))
  it('keeps source-view query requests raw for App-style fetches', () => {
    expect(
      wantsHtml(
        new Request('https://x/a.json5?view=source', {
          headers: {
            accept: 'application/json5, */*',
            'sec-fetch-mode': 'cors',
            'sec-fetch-dest': 'empty',
          },
        }),
      ),
    ).toBe(false)
  })
  it('raw query overrides Accept and source view', () =>
    expect(
      wantsHtml(new Request('https://x/a?raw=1&view=source', { headers: { accept: 'text/html' } })),
    ).toBe(false))
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
  it('sets a restrictive policy for generated HTML previews', () => {
    expect(htmlPreviewSecurityHeaders['content-security-policy']).toContain("default-src 'none'")
    expect(htmlPreviewSecurityHeaders['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    )
    expect(htmlPreviewSecurityHeaders['referrer-policy']).toBe('no-referrer')
    expect(htmlPreviewSecurityHeaders['x-content-type-options']).toBe('nosniff')
  })
})
