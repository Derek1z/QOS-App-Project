import { app, session, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { allowNavigation, isTrustedSender, type AppEntry } from './securityRules'

/** Electron hardening spec §4.1: the window may not open other windows,
 *  navigate away from the app page or embed web views; no permission is ever
 *  granted; IPC answers only the app page. Pure rules live in securityRules.ts. */

/** The app's own page: the dev server in development, else the bundled index.html. */
export function appEntry(): AppEntry {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) return { kind: 'dev', origin: new URL(dev).origin }
  return { kind: 'file', url: pathToFileURL(join(__dirname, '../renderer/index.html')).href }
}

let applied = false

/** Install the guards once, before the first window opens. */
export function applySecurity(): void {
  if (applied) return
  applied = true
  const entry = appEntry()

  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      console.warn(`[security] blocked new window: ${url}`)
      return { action: 'deny' }
    })
    const guard = (event: Electron.Event, url: string): void => {
      if (allowNavigation(url, entry)) return
      event.preventDefault()
      console.warn(`[security] blocked navigation: ${url}`)
    }
    contents.on('will-navigate', guard)
    contents.on('will-redirect', guard)
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
      console.warn('[security] blocked <webview>')
    })
  })

  // nothing in the app needs a browser permission (camera, notifications, …)
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
}

/** Throws unless the call comes from the main frame of the app page. */
export function assertTrustedSender(e: IpcMainInvokeEvent, channel: string): void {
  const frame = e.senderFrame
  const url = frame?.url ?? ''
  const isMainFrame = !!frame && frame === e.sender.mainFrame
  if (frame && isTrustedSender({ url, isMainFrame }, appEntry())) return
  console.warn(`[security] rejected ${channel} from ${url || 'unknown sender'}`)
  throw new Error('Untrusted sender')
}
