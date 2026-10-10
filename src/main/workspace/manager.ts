import { existsSync, statSync, unlinkSync, openSync, readSync, closeSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import os from 'node:os'
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api'
import { SCHEMA_SQL } from './schema'
import { acquireLock, releaseLock, lockedByOther } from './lock'
import * as appState from '../services/appState'
import { seedKpiDefs, workspaceTechnology } from '../services/kpiService'
import { ensureDerivedKpiSchema } from '../services/derivedKpiService'
import { recomputeAllAggregates } from '../import/aggregates'
import { refreshAllIntelligence } from '../analytics/engine'
import { backupsDir } from '../paths'
import { backupOpenDatabase } from './backup'
import { LATEST, MIGRATIONS, readSchemaVersion, runMigrations, runReadOnlyShims } from './migrations'
import type { WorkspaceInfo, Technology } from '../../../shared/api'

export { inferWorkspaceTechnology } from './migrations'


export async function configureDuckDbSession(connection: DuckDBConnection): Promise<void> {
  const totalRamGb = Math.floor(os.totalmem() / (1024 * 1024 * 1024))
  const memLimitGb = Math.max(4, Math.min(32, Math.floor(totalRamGb * 0.75)))
  const cpuThreads = Math.max(1, os.cpus().length)
  try {
    await connection.run(
      `PRAGMA memory_limit = '${memLimitGb}GB'; PRAGMA preserve_insertion_order = false; PRAGMA threads = ${cpuThreads};`
    )
  } catch (err) {
    console.warn('[duckdb] session config warning:', err)
  }
}

function isValidDuckDbFile(path: string): boolean {
  try {
    const size = statSync(path).size
    if (size === 0) return true
    const len = Math.min(size, 4096)
    if (len < 4) return false
    const buf = Buffer.alloc(len)
    const fd = openSync(path, 'r')
    readSync(fd, buf, 0, len, 0)
    closeSync(fd)
    if (buf.includes('DUCK') || buf.includes('SQLite format 3')) {
      return true
    }
    return false
  } catch {
    return false
  }
}

interface OpenWorkspace {
  path: string
  name: string
  readOnly: boolean
  instance: DuckDBInstance
  connection: DuckDBConnection
  lockHeld: boolean
  /** set when the file was saved by a newer app (its schema is above LATEST) */
  readOnlyReason?: 'newerVersion'
}

let current: OpenWorkspace | null = null

export function getCurrent(): OpenWorkspace | null {
  return current
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function nameFromPath(path: string): string {
  return basename(path, '.qosdb')
}

// --- lock file: one writable instance per workspace (spec §8) ---
// Helpers live in ./lock so the import worker can hold the lock while the
// main handle is closed for a background import.

function closeHandle(ws: OpenWorkspace): void {
  try {
    ws.connection.closeSync()
  } catch {
    /* ignore */
  }
  try {
    ws.instance.closeSync()
  } catch {
    /* ignore */
  }
  if (ws.lockHeld) releaseLock(ws.path)
}

const beforeClose: Array<() => Promise<void>> = []

/** Run `fn` (awaited) before the workspace handle closes — e.g. to stop a
 *  background job that is using the connection. */
export function onBeforeClose(fn: () => Promise<void>): void {
  beforeClose.push(fn)
}

/** Queued with opens and creates: a close that arrives while an open is
 *  running waits for it, so the workspace does not reappear afterwards. */
export function closeWorkspace(): Promise<void> {
  return queued(closeWorkspaceNow)
}

async function closeWorkspaceNow(): Promise<void> {
  if (!current) return
  for (const fn of beforeClose) {
    try {
      await fn()
    } catch {
      /* a failing hook never keeps the workspace open */
    }
  }
  if (!current) return
  const ws = current
  current = null
  closeHandle(ws)
}

/** Backfill schema additions on workspaces created before a given feature
 *  landed. Runs on writable open only; every statement is idempotent. */
// --- description / validation ---

async function describe(connection: DuckDBConnection): Promise<Omit<WorkspaceInfo, 'path' | 'name' | 'readOnly' | 'sizeBytes'>> {
  const r = await connection.runAndReadAll(`
    SELECT
      (SELECT value FROM workspace_meta WHERE key = 'schema_version') AS schema_version,
      (SELECT value FROM workspace_meta WHERE key = 'created_at') AS created_at,
      (SELECT count(*) FROM fact_cell_daily) AS row_count,
      (SELECT CAST(min(d.date) AS VARCHAR) FROM fact_cell_daily f JOIN dim_date d USING (date_id)) AS min_date,
      (SELECT CAST(max(d.date) AS VARCHAR) FROM fact_cell_daily f JOIN dim_date d USING (date_id)) AS max_date,
      (SELECT count(*) FROM dim_region) AS regions,
      (SELECT count(*) FROM dim_district) AS districts,
      (SELECT count(*) FROM dim_site) AS sites,
      (SELECT count(*) FROM dim_cell) AS cells,
      (SELECT max(version) FROM ruleset) AS ruleset_version,
      (SELECT value FROM workspace_meta WHERE key = 'technology') AS technology
  `)
  const row = r.getRowObjects()[0]
  if (!row || !row.schema_version) {
    throw new Error('Not a valid 2G/3G/4G QoS workspace (missing workspace metadata)')
  }
  const techRaw = row.technology ? String(row.technology) : '4G'
  return {
    schemaVersion: String(row.schema_version),
    createdAt: row.created_at ? String(row.created_at) : null,
    rowCount: Number(row.row_count ?? 0),
    minDate: row.min_date ? String(row.min_date) : null,
    maxDate: row.max_date ? String(row.max_date) : null,
    dims: {
      regions: Number(row.regions ?? 0),
      districts: Number(row.districts ?? 0),
      sites: Number(row.sites ?? 0),
      cells: Number(row.cells ?? 0)
    },
    rulesetVersion: row.ruleset_version == null ? null : Number(row.ruleset_version),
    technology: techRaw === '2G' || techRaw === '3G' ? (techRaw as Technology) : '4G'
  }
}

async function assemble(ws: OpenWorkspace): Promise<WorkspaceInfo> {
  const base = await describe(ws.connection)
  return {
    ...base,
    path: ws.path,
    name: ws.name,
    readOnly: ws.readOnly,
    ...(ws.readOnlyReason ? { readOnlyReason: ws.readOnlyReason } : {}),
    sizeBytes: statSync(ws.path).size
  }
}

export async function getCurrentInfo(): Promise<WorkspaceInfo | null> {
  if (!current) return null
  return assemble(current)
}

// --- upgrade backup ---

/** backups/<name>-before-v<LATEST>-<YYYYMMDD-HHmmss>.qosdb, taken from the
 *  open database before the first pending migration. */
async function backupBeforeUpgrade(conn: DuckDBConnection, path: string): Promise<string> {
  const d = new Date()
  const p2 = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
  mkdirSync(backupsDir(), { recursive: true })
  const dest = join(backupsDir(), `${nameFromPath(path)}-before-v${LATEST}-${stamp}.qosdb`)
  await backupOpenDatabase(conn, dest)
  return dest
}

// --- lifecycle ---

// Opens, creates and closes run one at a time: a second open starting while
// the first is still opening would put two DuckDB instances on the same file
// (a technology tab is a single click away from an open). Inside a queued
// step, call the *Now variants, never the queued ones (that would deadlock).
let lifecycleQueue: Promise<unknown> = Promise.resolve()
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = lifecycleQueue.then(fn, fn)
  lifecycleQueue = run.catch(() => {})
  return run
}

export function createWorkspace(dir: string, name: string, technology?: string): Promise<WorkspaceInfo> {
  return queued(() => createWorkspaceNow(dir, name, technology))
}

async function createWorkspaceNow(dir: string, name: string, technology?: string): Promise<WorkspaceInfo> {
  const tech = technology === '2G' || technology === '3G' ? technology : '4G'
  const safe = name.trim().replace(/[\\/:*?"<>|]+/g, '_')
  if (!safe) throw new Error('Workspace name is empty')
  const path = join(dir, safe.toLowerCase().endsWith('.qosdb') ? safe : `${safe}.qosdb`)
  if (existsSync(path)) throw new Error(`Workspace already exists: ${path}`)
  if (current) await closeWorkspaceNow()

  let instance: DuckDBInstance | null = null
  try {
    instance = await DuckDBInstance.create(path)
    const connection = await instance.connect()
    try {
      await configureDuckDbSession(connection)
      for (const sql of SCHEMA_SQL) await connection.run(sql)
      const now = new Date().toISOString()
      const esc = safe.replace(/'/g, "''")
      await connection.run(
        `INSERT INTO workspace_meta (key, value) VALUES ` +
        `('schema_version', '${LATEST}'), ('created_at', '${now}'), ('name', '${esc}'), ('technology', '${tech}')`
      )
      await seedKpiDefs(connection, '2G')
      await seedKpiDefs(connection, '3G')
      await seedKpiDefs(connection, '4G')
      await ensureDerivedKpiSchema(connection)
      const lockHeld = acquireLock(path)
      current = { path, name: safe, readOnly: false, instance, connection, lockHeld }
      await appState.touchRecent(path, safe, tech)
      return assemble(current)
    } catch (e) {
      try {
        connection.closeSync()
      } catch {
        /* ignore */
      }
      try {
        instance.closeSync()
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(path)
      } catch {
        /* ignore */
      }
      throw new Error(`Failed to initialize workspace: ${errMessage(e)}`)
    }
  } catch (e) {
    if (instance) {
      try {
        instance.closeSync()
      } catch {
        /* ignore */
      }
    }
    throw e instanceof Error ? e : new Error(String(e))
  }
}

export function openWorkspace(path: string, opts: { readOnly?: boolean } = {}): Promise<WorkspaceInfo> {
  return queued(() => openWorkspaceNow(path, opts))
}

async function openWorkspaceNow(
  path: string,
  opts: { readOnly?: boolean } = {}
): Promise<WorkspaceInfo> {
  if (!existsSync(path)) throw new Error(`Workspace file not found: ${path}`)
  if (!isValidDuckDbFile(path)) throw new Error(`Not a valid database workspace file: ${path}`)
  // fail before closing the open workspace, so a refused open leaves it open
  if (!opts.readOnly && current?.path !== path && lockedByOther(path).locked) {
    throw new Error('This workspace is open in another instance. Open it read-only instead.')
  }
  if (current) await closeWorkspaceNow()

  const readOnly = !!opts.readOnly
  const lockHeld = readOnly ? false : acquireLock(path)
  if (!readOnly && !lockHeld) {
    throw new Error('This workspace is open in another instance. Open it read-only instead.')
  }

  let instance: DuckDBInstance | null = null
  try {
    const config = readOnly ? { access_mode: 'READ_ONLY' } : undefined
    instance = await DuckDBInstance.create(path, config)
    const connection = await instance.connect()
    try {
      await configureDuckDbSession(connection)
      const version = await readSchemaVersion(connection)
      if (!readOnly && version > LATEST) {
        // saved by a newer app: never write to it — reopen read-only
        connection.closeSync()
        instance.closeSync()
        if (lockHeld) releaseLock(path)
        return await openWorkspaceNow(path, { readOnly: true })
      }
      const readOnlyReason = version > LATEST ? ('newerVersion' as const) : undefined
      if (!readOnly) {
        // versioned migrations: the steps this workspace has not had, in
        // order, once, after a backup (spec 2026-10-10-versioned-migrations)
        await runMigrations(connection, MIGRATIONS, version, {
          backup: () => backupBeforeUpgrade(connection, path),
          recompute: async (c) => {
            await recomputeAllAggregates(c)
            await refreshAllIntelligence(c)
          }
        })
        // the built-in KPI catalogue stays current on every open
        for (const t of ['2G', '3G', '4G'] as Technology[]) await seedKpiDefs(connection, t)
      } else {
        // read-only opens never write: stand-ins (temp views) for the steps an
        // older workspace is missing
        await runReadOnlyShims(connection, MIGRATIONS, version)
      }
      const info = await describe(connection)
      const ws: OpenWorkspace = {
        path, name: nameFromPath(path), readOnly, instance, connection, lockHeld, readOnlyReason
      }
      current = ws
      await appState.touchRecent(path, ws.name, info.technology)
      return {
        ...info, path, name: ws.name, readOnly, ...(readOnlyReason ? { readOnlyReason } : {}), sizeBytes: statSync(path).size
      }
    } catch (e) {
      try {
        connection.closeSync()
      } catch {
        /* ignore */
      }
      try {
        instance.closeSync()
      } catch {
        /* ignore */
      }
      if (lockHeld) releaseLock(path)
      throw e instanceof Error ? e : new Error(String(e))
    }
  } catch (e) {
    if (instance) {
      try {
        instance.closeSync()
      } catch {
        /* ignore */
      }
    }
    if (lockHeld) releaseLock(path)
    if (e instanceof Error && /lock/i.test(e.message)) {
      throw new Error('Workspace is locked by another process. Open it read-only instead.')
    }
    throw e instanceof Error ? e : new Error(String(e))
  }
}
