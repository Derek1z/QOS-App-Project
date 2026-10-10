import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { appEntry } from './security'

/** The app window (Electron hardening spec §4.1): sandboxed renderer, context
 *  isolation, no Node in the page; the preload exposes `window.api` only.
 *  Loads the dev server in development, else the bundled index.html. */
export function createMainWindow(
  opts: { show?: boolean; offscreen?: boolean; icon?: Electron.NativeImage | string } = {}
): BrowserWindow {
  const win = new BrowserWindow({
    title: '2G/3G/4G QoS Network Intelligence',
    icon: opts.icon,
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: opts.show ?? false,
    backgroundColor: '#0e1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      offscreen: opts.offscreen ?? false
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    // the exact URL the IPC and navigation checks compare against (loadFile
    // builds its own, which differs for folder names containing '%')
    const entry = appEntry()
    void win.loadURL(entry.kind === 'file' ? entry.url : entry.origin)
  }
  return win
}
