import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { dirs } from '../paths'
import type { AppStateData, RecentWorkspace } from '../../../shared/api'

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

/** Only basic app preferences are global; everything else lives in the workspace. */
export interface AppState extends AppStateData {
  windowBounds?: WindowBounds
}

const DEFAULTS: AppState = {
  recentWorkspaces: [],
  theme: 'dark',
  density: 'compact'
}

let cache: AppState | null = null

export function load(): AppState {
  if (cache) return cache
  try {
    if (existsSync(dirs.appState)) {
      cache = { ...DEFAULTS, ...JSON.parse(readFileSync(dirs.appState, 'utf8')) }
    }
  } catch {
    // corrupted state file -> start fresh
  }
  return (cache ??= { ...DEFAULTS })
}

export function patch(p: Partial<AppState>): AppState {
  const next = { ...load(), ...p }
  cache = next
  try {
    mkdirSync(dirname(dirs.appState), { recursive: true })
    const tmp = dirs.appState + '.tmp'
    writeFileSync(tmp, JSON.stringify(next, null, 2))
    renameSync(tmp, dirs.appState)
  } catch {
    // non-fatal: state persistence is best-effort
  }
  return next
}

export function touchRecent(path: string, name: string): void {
  const st = load()
  const entry: RecentWorkspace = { path, name, lastOpened: new Date().toISOString() }
  patch({
    recentWorkspaces: [entry, ...st.recentWorkspaces.filter((r) => r.path !== path)].slice(0, 10),
    lastWorkspacePath: path
  })
}
