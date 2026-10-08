import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { dirs } from '../paths'
import type { AppStateData, RecentWorkspace, Technology } from '../../../shared/api'

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

export function touchRecent(path: string, name: string, technology?: Technology): void {
  const st = load()
  const entry: RecentWorkspace = { path, name, lastOpened: new Date().toISOString(), ...(technology ? { technology } : {}) }
  patch({
    recentWorkspaces: [entry, ...st.recentWorkspaces.filter((r) => r.path !== path)].slice(0, 10),
    lastWorkspacePath: path
  })
}

/** The most recent workspace of `technology` whose file still exists, other
 *  than `excludePath` (fixed-workspace-technology spec §4.2). Entries written
 *  before workspaces recorded their technology are skipped. */
export function findRecentWorkspace(
  technology: Technology, excludePath: string | undefined, recent: RecentWorkspace[], exists: (p: string) => boolean
): string | null {
  const hit = recent.find((r) => r.technology === technology && r.path !== excludePath && exists(r.path))
  return hit?.path ?? null
}
