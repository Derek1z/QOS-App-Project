import { existsSync, statSync, unlinkSync } from 'node:fs'
import { join, basename } from 'node:path'
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api'
import { SCHEMA_SQL } from './schema'
import { acquireLock, releaseLock } from './lock'
import * as appState from '../services/appState'
import { seedKpiDefs, workspaceTechnology } from '../services/kpiService'
import { repairDuplicateDimensions } from '../services/dimRepair'
import type { WorkspaceInfo, Technology } from '../../../shared/api'

interface OpenWorkspace {
  path: string
  name: string
  readOnly: boolean
  instance: DuckDBInstance
  connection: DuckDBConnection
  lockHeld: boolean
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

export function closeWorkspace(): void {
  if (!current) return
  const ws = current
  current = null
  closeHandle(ws)
}

/** Backfill schema additions on workspaces created before a given feature
 *  landed. Runs on writable open only; every statement is idempotent. */
async function ensureUpgradeSchema(connection: DuckDBConnection): Promise<void> {
  await connection.run(`CREATE SEQUENCE IF NOT EXISTS seq_kpi_defs START 1`)
  await connection.run(`CREATE TABLE IF NOT EXISTS kpi_defs (
     kpi_id BIGINT DEFAULT nextval('seq_kpi_defs') PRIMARY KEY,
     technology VARCHAR NOT NULL CHECK (technology IN ('2G', '3G', '4G')),
     kpi_key VARCHAR NOT NULL,
     label VARCHAR NOT NULL,
     unit VARCHAR NOT NULL DEFAULT '',
     worse_is_higher BOOLEAN NOT NULL DEFAULT true,
     target DOUBLE,
     agg VARCHAR NOT NULL DEFAULT 'avg' CHECK (agg IN ('avg', 'sum', 'max', 'min')),
     source_headers JSON,
     is_custom BOOLEAN NOT NULL DEFAULT false,
     active BOOLEAN NOT NULL DEFAULT true,
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMP DEFAULT now(),
     updated_at TIMESTAMP DEFAULT now(),
     UNIQUE (technology, kpi_key)
   )`)
  await connection.run(`CREATE TABLE IF NOT EXISTS fact_extra_metrics (
     date_id INTEGER NOT NULL,
     cell_id BIGINT NOT NULL,
     kpi_id BIGINT NOT NULL,
     value DOUBLE,
     PRIMARY KEY (date_id, cell_id, kpi_id)
   )`)
  await connection.run(`CREATE TABLE IF NOT EXISTS agg_cell_kpi_weekly (
     week_start DATE NOT NULL,
     cell_id BIGINT NOT NULL,
     kpi_id BIGINT NOT NULL,
     avg_value DOUBLE, sum_value DOUBLE, max_value DOUBLE, min_value DOUBLE,
     observed_days INTEGER,
     PRIMARY KEY (week_start, cell_id, kpi_id)
   )`)
  await connection.run(
    `CREATE TABLE IF NOT EXISTS raw_archive (
       archive_id BIGINT DEFAULT nextval('seq_raw_archive') PRIMARY KEY,
       import_id BIGINT, filename VARCHAR,
       archived_path VARCHAR, size_bytes BIGINT, checksum VARCHAR,
       imported_at TIMESTAMP DEFAULT now(), retention_until TIMESTAMP
     )`
  )
  await connection.run(`CREATE SEQUENCE IF NOT EXISTS seq_raw_archive START 1`)
  await connection.run(`ALTER TABLE workspace_snapshots ADD COLUMN IF NOT EXISTS path VARCHAR`)
  await connection.run(`CREATE TABLE IF NOT EXISTS maintenance_settings (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     enabled BOOLEAN DEFAULT false,
     cadence_hours INTEGER DEFAULT 24,
     actions JSON DEFAULT '["integrity","purge"]',
     run_on_open BOOLEAN DEFAULT true,
     last_run_at TIMESTAMP,
     last_ok BOOLEAN,
     last_summary VARCHAR,
     updated_at TIMESTAMP DEFAULT now()
   )`)
  await connection.run(`INSERT INTO maintenance_settings (id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM maintenance_settings)`)
  await connection.run(`CREATE SEQUENCE IF NOT EXISTS seq_maintenance_runs START 1`)
  await connection.run(`CREATE TABLE IF NOT EXISTS maintenance_runs (
     run_id BIGINT DEFAULT nextval('seq_maintenance_runs') PRIMARY KEY,
     ran_at TIMESTAMP DEFAULT now(),
     ok BOOLEAN, actions JSON, summary VARCHAR, duration_ms BIGINT
   )`)
}

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
    sizeBytes: statSync(ws.path).size
  }
}

export async function getCurrentInfo(): Promise<WorkspaceInfo | null> {
  if (!current) return null
  return assemble(current)
}

/** Switch the active workspace's technology and re-seed its KPI set. */
export async function setWorkspaceTechnology(technology: Technology): Promise<WorkspaceInfo> {
  if (!current) throw new Error('No workspace is open')
  if (current.readOnly) throw new Error('Workspace is open read-only — switch technology on the writable workspace')
  const tech = technology === '2G' || technology === '3G' ? technology : '4G'
  await current.connection.run(
    `UPDATE workspace_meta SET value = ? WHERE key = 'technology'`,
    [tech]
  )
  await seedKpiDefs(current.connection, tech)
  return assemble(current)
}

// --- lifecycle ---

export async function createWorkspace(dir: string, name: string, technology?: string): Promise<WorkspaceInfo> {
  const tech = technology === '2G' || technology === '3G' ? technology : '4G'
  const safe = name.trim().replace(/[\\/:*?"<>|]+/g, '_')
  if (!safe) throw new Error('Workspace name is empty')
  const path = join(dir, safe.toLowerCase().endsWith('.qosdb') ? safe : `${safe}.qosdb`)
  if (existsSync(path)) throw new Error(`Workspace already exists: ${path}`)
  if (current) await closeWorkspace()

  let instance: DuckDBInstance | null = null
  try {
    instance = await DuckDBInstance.create(path)
    const connection = await instance.connect()
    try {
      try {
        await connection.run(`PRAGMA memory_limit = '512MB'; PRAGMA threads = auto; PRAGMA preserve_insertion_order = false;`)
      } catch {}
      for (const sql of SCHEMA_SQL) await connection.run(sql)
      const now = new Date().toISOString()
      const esc = safe.replace(/'/g, "''")
      await connection.run(
        `INSERT INTO workspace_meta (key, value) VALUES ` +
        `('schema_version', '0.1.0'), ('created_at', '${now}'), ('name', '${esc}'), ('technology', '${tech}')`
      )
      await seedKpiDefs(connection, tech as Technology)
      const lockHeld = acquireLock(path)
      current = { path, name: safe, readOnly: false, instance, connection, lockHeld }
      await appState.touchRecent(path, safe)
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

export async function openWorkspace(
  path: string,
  opts: { readOnly?: boolean } = {}
): Promise<WorkspaceInfo> {
  if (!existsSync(path)) throw new Error(`Workspace file not found: ${path}`)
  if (current) await closeWorkspace()

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
      try {
        await connection.run(`PRAGMA memory_limit = '512MB'; PRAGMA threads = auto; PRAGMA preserve_insertion_order = false;`)
      } catch {}
      if (!readOnly) {
        await ensureUpgradeSchema(connection)
        // spec §54a: every workspace ships with its technology's KPI set
        const tech = await workspaceTechnology(connection)
        await seedKpiDefs(connection, tech)
        // legacy workspaces may hold duplicate dimension names (pre-import
        // dedupe fix); merge them so lookups/joins stay unambiguous — this is
        // best-effort and never blocks opening the workspace
        try {
          const repaired = await repairDuplicateDimensions(connection)
          if (repaired.mergedCells > 0 || repaired.mergedSites > 0 || repaired.mergedDistricts > 0) {
            console.log(
              '[dimRepair] merged ' + repaired.mergedDistricts + ' district(s), ' +
              repaired.mergedSites + ' site(s), ' + repaired.mergedCells + ' cell(s)'
            )
          }
        } catch (e) {
          console.error('[dimRepair] failed (workspace still opens): ' + (e instanceof Error ? e.message : String(e)))
        }
      }
      const info = await describe(connection)
      const ws: OpenWorkspace = {
        path, name: nameFromPath(path), readOnly, instance, connection, lockHeld
      }
      current = ws
      await appState.touchRecent(path, ws.name)
      return { ...info, path, name: ws.name, readOnly, sizeBytes: statSync(path).size }
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
