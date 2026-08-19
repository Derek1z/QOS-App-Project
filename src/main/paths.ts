import { app } from 'electron'
import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'

/** Root of the portable folder.
 *  - Packaged portable build: electron-builder's portable target sets
 *    PORTABLE_EXECUTABLE_DIR to the folder holding 4G_QoS.exe.
 *  - Packaged non-portable: next to the exe.
 *  - Dev: the project root (where package.json lives).
 */
export function portableRoot(): string {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR
  if (app?.isPackaged) return dirname(process.execPath)
  if (app?.getAppPath) return app.getAppPath()
  return process.cwd()
}

export const dirs = {
  get root(): string { return portableRoot() },
  get workspaces(): string { return join(portableRoot(), 'workspaces') },
  get backups(): string { return join(portableRoot(), 'backups') },
  get snapshots(): string { return join(portableRoot(), 'backups', 'snapshots') },
  get exports(): string { return join(portableRoot(), 'exports') },
  get appState(): string { return join(portableRoot(), 'app_state.json') }
}

// Test hook: the headless smoke run points backups/snapshots/exports at its
// temp dir so it never litters the portable folder.
let backupsOverride: string | null = null
let snapshotsOverride: string | null = null
let exportsOverride: string | null = null
export function overrideDataDirs(opts: { backups?: string; snapshots?: string; exports?: string }): void {
  if (opts.backups) { backupsOverride = opts.backups; mkdirSync(opts.backups, { recursive: true }) }
  if (opts.snapshots) { snapshotsOverride = opts.snapshots; mkdirSync(opts.snapshots, { recursive: true }) }
  if (opts.exports) { exportsOverride = opts.exports; mkdirSync(opts.exports, { recursive: true }) }
}

export function backupsDir(): string {
  return backupsOverride ?? dirs.backups
}

export function snapshotsDir(): string {
  return snapshotsOverride ?? dirs.snapshots
}

export function exportsDir(): string {
  return exportsOverride ?? dirs.exports
}

export function ensureDirs(): void {
  for (const d of [dirs.workspaces, dirs.backups, dirs.snapshots, dirs.exports]) {
    mkdirSync(d, { recursive: true })
  }
}
