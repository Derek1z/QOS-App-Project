import { describe, it, expect } from 'vitest'
import { isAppUrl, isTrustedSender, allowNavigation, type AppEntry } from '../../src/main/securityRules'

/** Electron hardening spec §4.2: what counts as the app's own page. */

const fileEntry: AppEntry = { kind: 'file', url: 'file:///opt/QoS/resources/app.asar/out/renderer/index.html' }
const devEntry: AppEntry = { kind: 'dev', origin: 'http://localhost:5173' }
const base = 'file:///opt/QoS/resources/app.asar/out/renderer'

const fileYes = [`${base}/index.html`, `${base}/index.html#/overview`, `${base}/index.html?x=1`]
const fileNo = [
  `${base}/other.html`,
  `${base}/index.html.evil`,
  'file:///home/u/data.csv', // a file dropped outside the drop zone
  'https://example.com',
  'data:text/html,x',
  'blob:file:///abc',
  'about:blank',
  'not a url'
]
const devYes = ['http://localhost:5173/', 'http://localhost:5173/src/x.tsx']
const devNo = ['http://localhost:5174/', 'http://localhost.evil.com:5173/', 'https://localhost:5173/']

describe('isAppUrl', () => {
  it('accepts the packaged entry page, with or without a route or query', () => {
    for (const u of fileYes) expect(isAppUrl(u, fileEntry), u).toBe(true)
  })
  it('rejects lookalikes and outside pages for the packaged entry', () => {
    for (const u of fileNo) expect(isAppUrl(u, fileEntry), u).toBe(false)
  })
  it('accepts the dev server origin only', () => {
    for (const u of devYes) expect(isAppUrl(u, devEntry), u).toBe(true)
    for (const u of devNo) expect(isAppUrl(u, devEntry), u).toBe(false)
  })
})

describe('isTrustedSender', () => {
  it('trusts only the main frame of the app page', () => {
    expect(isTrustedSender({ url: `${base}/index.html`, isMainFrame: true }, fileEntry)).toBe(true)
    expect(isTrustedSender({ url: `${base}/index.html`, isMainFrame: false }, fileEntry)).toBe(false)
    expect(isTrustedSender({ url: 'data:text/html,x', isMainFrame: true }, fileEntry)).toBe(false)
  })
})

describe('allowNavigation', () => {
  it('agrees with isAppUrl', () => {
    for (const u of [...fileYes, ...fileNo]) expect(allowNavigation(u, fileEntry), u).toBe(isAppUrl(u, fileEntry))
    for (const u of [...devYes, ...devNo]) expect(allowNavigation(u, devEntry), u).toBe(isAppUrl(u, devEntry))
  })
})

/** Final review 1-2: Chromium's canonical page URL vs the entry built in Node. */
describe('file URLs as Chromium reports them', () => {
  const win: AppEntry = { kind: 'file', url: 'file:///c:/Tools/QOS%20Folder/resources/app.asar/out/renderer/index.html' }

  it('matches a Windows drive letter regardless of case (Chromium uppercases it)', () => {
    expect(isAppUrl('file:///C:/Tools/QOS%20Folder/resources/app.asar/out/renderer/index.html', win)).toBe(true)
    expect(isAppUrl('file:///C:/tools/qos%20folder/resources/app.asar/out/renderer/index.html', win)).toBe(true)
  })

  it('still rejects another file on the same drive', () => {
    expect(isAppUrl('file:///C:/Tools/QOS%20Folder/resources/app.asar/out/renderer/other.html', win)).toBe(false)
  })

  it('keeps a literal % in a folder name distinct from an escape', () => {
    const pct: AppEntry = { kind: 'file', url: 'file:///opt/a%2520b/index.html' } // folder literally named "a%20b"
    expect(isAppUrl('file:///opt/a%2520b/index.html', pct)).toBe(true)
    expect(isAppUrl('file:///opt/a%20b/index.html', pct)).toBe(false)
  })

  it('never throws on a malformed escape, and rejects it (the guard must fail closed)', () => {
    expect(() => isAppUrl('file:///tmp/%zz', fileEntry)).not.toThrow()
    expect(isAppUrl('file:///tmp/%zz', fileEntry)).toBe(false)
    expect(allowNavigation('file://host/share/x%zz.html', fileEntry)).toBe(false)
    const bad: AppEntry = { kind: 'file', url: 'file:///opt/100%/index.html' }
    expect(() => isAppUrl('file:///opt/100%/index.html', bad)).not.toThrow()
  })

  it('rejects a UNC file URL even when its path matches', () => {
    expect(isAppUrl('file://host/opt/QoS/resources/app.asar/out/renderer/index.html', fileEntry)).toBe(false)
  })
})
