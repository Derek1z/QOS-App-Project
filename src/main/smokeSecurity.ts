import { BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { STRICT_CSP } from '../../shared/csp'
import { applySecurity, appEntry } from './security'
import { isAppUrl } from './securityRules'
import { createMainWindow } from './window'
import { registerIpc } from './ipc'

/** Smoke step for the Electron hardening spec (§6 item 2): open the real app
 *  window offscreen from the built page and try each attack. Every check
 *  runs; a failure lists all failed checks by name. */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The window's first load (createMainWindow does not wait for it). */
function loaded(win: BrowserWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('app page did not load within 20 s')), 20_000)
    const done = (): void => { clearTimeout(t); resolve() }
    if (!win.webContents.isLoading()) return done()
    win.webContents.once('did-finish-load', done)
    win.webContents.once('did-fail-load', (_e, code, desc) => { clearTimeout(t); reject(new Error(`load failed ${code} ${desc}`)) })
  })
}

export async function runSecuritySmoke(): Promise<void> {
  applySecurity()
  const failures: string[] = []
  const check = async (name: string, fn: () => Promise<boolean> | boolean): Promise<void> => {
    try {
      if (!(await fn())) failures.push(name)
    } catch (e) {
      failures.push(`${name} (${e instanceof Error ? e.message : String(e)})`)
    }
    // printed as it happens: an unguarded check can take the process down
    console.log(`[SMOKE] security: ${failures.at(-1)?.startsWith(name) ? 'FAILED' : 'ok'} — ${name}`)
  }

  const win = createMainWindow({ show: false, offscreen: true })
  // CSP violations are reported on the page's console (final review 4)
  const consoleLines: string[] = []
  win.webContents.on('console-message', (details) => consoleLines.push(details.message))
  const cspViolations = (): string[] => consoleLines.filter((m) => /Content Security Policy/i.test(m))
  // the smoke run calls services directly; the page's API needs the real channels
  registerIpc(() => win)
  const report = new BrowserWindow({ show: false, webPreferences: { sandbox: true, offscreen: true } })
  // a page that is not the app, with the app's preload (so it has window.api)
  const stranger = new BrowserWindow({
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, offscreen: true }
  })
  try {
    await loaded(win)
    const page = (js: string): Promise<unknown> => win.webContents.executeJavaScript(js, true)
    const onAppPage = (): boolean => isAppUrl(win.webContents.getURL(), appEntry())

    // the preload runs in Electron's isolated world (999): without the sandbox
    // Node's global `process` is there; a sandboxed renderer has none (probed
    // 10/10/2026: 'object' with sandbox off, 'undefined' with it on)
    await check('sandbox', async () =>
      (await win.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `typeof process` }])) === 'undefined')
    for (const target of ['https://example.com/', 'file:///etc/hostname']) {
      await check(`navigation to ${target} blocked`, async () => {
        // not awaited: a navigation that succeeds unloads the page, and the
        // script's promise never settles
        void page(`location.href = ${JSON.stringify(target)}; true`).catch(() => undefined)
        await sleep(1500)
        if (!onAppPage()) {
          // put the page back for the remaining checks
          // loadURL resolves once the page has loaded
          await win.loadURL(appEntry().kind === 'dev' ? (appEntry() as { origin: string }).origin : (appEntry() as { url: string }).url)
          return false
        }
        return true
      })
    }
    await check('permission denied', async () => (await page(`Notification.requestPermission()`)) === 'denied')
    // the real UI renders under the strict CSP: React mounted, nothing refused
    await sleep(1500)
    await check('app UI renders under the strict CSP', async () => {
      const mounted = (await page(`document.getElementById('root')?.childElementCount ?? 0`)) as number
      const refused = cspViolations()
      if (refused.length) console.log(`[SMOKE] CSP violations: ${refused.slice(0, 3).join(' | ')}`)
      return mounted > 0 && refused.length === 0
    })
    await check('strict CSP in the built page', async () =>
      (await page(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content`)) === STRICT_CSP)
    await check('no inline script in the built page', async () => (await page(`[...document.scripts].every((s) => !!s.src)`)) === true)
    // the detector above must see a refusal when one happens (self-test)
    await check('CSP refusals are detected', async () => {
      const before = cspViolations().length
      await page(`{ const s = document.createElement('script'); s.src = 'data:text/javascript,1'; document.head.appendChild(s) } true`)
      await sleep(500)
      return cspViolations().length > before
    })
    await check('injected inline script does not run', async () => {
      await page(`{ const s = document.createElement('script'); s.textContent = 'window.__inl = 1'; document.head.appendChild(s) } true`)
      await sleep(200)
      return (await page(`typeof window.__inl`)) === 'undefined'
    })
    await check('blob download still downloads', async () => {
      const seen = new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 2000)
        session.defaultSession.once('will-download', (_e, item) => {
          clearTimeout(t)
          item.cancel()
          resolve(true)
        })
      })
      await page(`{ const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['x'])); a.download = 't.txt'; document.body.appendChild(a); a.click(); a.remove() } true`)
      return seen
    })
    await check('main-process data: page still loads (report window)', async () => {
      await report.loadURL('data:text/html,<p>r</p>')
      return (await report.webContents.executeJavaScript(`document.body.textContent`)) === 'r'
    })
    const appCall = `window.api.appState.get().then((s) => Array.isArray(s.recentWorkspaces), (e) => 'rejected: ' + e.message)`
    await check('IPC answers the app page', async () => (await page(appCall)) === true)
    await check('IPC rejects another page', async () => {
      await stranger.loadURL('data:text/html,<p>x</p>')
      const r = await stranger.webContents.executeJavaScript(appCall, true)
      return typeof r === 'string' && r.includes('Untrusted sender')
    })
    await check('IPC still answers the app page afterwards', async () => (await page(appCall)) === true)
    // last: without the guard this opens a real window, which a headless run cannot survive
    await check('window.open blocked', async () => (await page(`window.open('https://example.com') === null`)) === true)
  } finally {
    win.destroy()
    report.destroy()
    stranger.destroy()
  }
  if (failures.length) throw new Error(`security smoke failed: ${failures.join('; ')}`)
  console.log('[SMOKE] security guards verified (sandbox, navigation, windows, permissions, CSP, downloads).')
}
