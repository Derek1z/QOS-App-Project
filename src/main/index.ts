import { app, BrowserWindow, Menu } from 'electron'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import * as ws from './workspace/manager'
import * as appState from './services/appState'
import { ensureDirs } from './paths'
import { registerIpc, broadcastWorkspaceChanged } from './ipc'
import { startScheduler, stopScheduler, maybeRunScheduled } from './services/maintenanceScheduler'
import { runSmokeTest } from './smoke'

let mainWindow: BrowserWindow | null = null

// M0 uses an app-level single instance; per-workspace multi-instance arrives later.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(() => bootstrap())
  app.on('window-all-closed', () => {
    // the smoke run creates (and destroys) a hidden PDF window; the run's
    // own app.exit() handles termination, so a quit here would race it
    if (!process.argv.includes('--smoke')) app.quit()
  })
}

function bootstrap(): void {
  if (process.argv.includes('--smoke')) {
    void runSmokeTest(mkdtempSync(join(tmpdir(), 'qos-smoke-')))
      .then(() => app.exit(0))
      .catch((e) => {
        console.error('SMOKE_FAILED', e)
        if (e instanceof Error && e.stack) console.error('STACK\n' + e.stack)
        app.exit(1)
      })
    return
  }

  Menu.setApplicationMenu(null)
  ensureDirs()
  createWindow()
  registerIpc(() => mainWindow)
  startScheduler()
  app.on('before-quit', () => stopScheduler())
  void restoreLastWorkspace()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: '2G/3G/4G QoS Network Intelligence',
    icon: join(__dirname, '../../build/icon.ico'),
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#0e1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Spec §5: reopen last workspace automatically, validating it first. */
async function restoreLastWorkspace(): Promise<void> {
  const st = appState.load()
  if (!st.lastWorkspacePath) return
  try {
    await ws.openWorkspace(st.lastWorkspacePath)
    void maybeRunScheduled().catch(() => undefined)
  } catch {
    try {
      await ws.openWorkspace(st.lastWorkspacePath, { readOnly: true })
    } catch {
      appState.patch({ lastWorkspacePath: undefined })
    }
  }
  broadcastWorkspaceChanged(mainWindow)
}
