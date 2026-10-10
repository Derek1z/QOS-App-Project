import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STRICT_CSP, applyStrictCsp } from '../../shared/csp'

/** Electron hardening spec §4.3: the packaged app's Content Security Policy. */

const EXPECTED =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"

const metaContent = (html: string): string | undefined =>
  html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)?.[1]

describe('STRICT_CSP', () => {
  it('is the spec policy', () => {
    expect(STRICT_CSP).toBe(EXPECTED)
  })
  it('allows no inline or eval scripts and no connections', () => {
    const scriptSrc = STRICT_CSP.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'))!
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
    expect(STRICT_CSP).toContain("connect-src 'none'")
    expect(STRICT_CSP).toContain("default-src 'none'")
  })
})

describe('applyStrictCsp', () => {
  const html = readFileSync(join(__dirname, '../../src/renderer/index.html'), 'utf8')

  it('swaps the dev policy for the strict one and leaves the rest of the page alone', () => {
    const out = applyStrictCsp(html)
    expect(metaContent(html)).not.toBe(STRICT_CSP)
    expect(metaContent(out)).toBe(STRICT_CSP)
    const strip = (s: string): string => s.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '')
    expect(strip(out)).toBe(strip(html))
  })

  it('fails loudly when the page has no CSP tag', () => {
    expect(() => applyStrictCsp('<html><head></head><body></body></html>')).toThrow(/Content-Security-Policy/)
  })
})
