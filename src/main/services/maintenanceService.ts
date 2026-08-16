import { existsSync, statSync, copyFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { DuckDBConnection } from '@duckdb/node-api'
import * as ws from '../workspace/manager'
import { backupsDir } from '../paths'
import { recomputeAllAggregates } from '../import/aggregates'
import { refreshAllIntelligence } from '../analytics/engine'
import { purgeRawArchive, rawArchive } from '../import/importer'
import type { MaintenanceAction, MaintenanceResult } from '../../../shared/api'

/** Workspace maintenance (spec §58). State-altering actions (rebuild, compact)
 *  write a pre-action backup to backups/ first, per §58's "create backup first
 *  for state-altering repair operations". Every action reports a structured
 *  result for the Data Manager maintenance log. */

function requireWritable(): void {
  const cur = ws.getCurrent()
  if (!cur) throw new Error('No workspace is open')
  if (cur.readOnly) throw new Error('Workspace is read-only — maintenance actions are blocked')
}

function stamp(): string {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
}

/** The default catalog is named after the workspace file, not "main". */
async function currentCatalog(conn: DuckDBConnection): Promise<string> {
  const r = await conn.runAndReadAll(`SELECT current_database() AS n`)
  return String(r.getRowObjects()[0]?.n ?? 'main')
}

/** Full-database backup while the workspace is open: attach a fresh file and
 *  COPY FROM DATABASE (DuckDB's documented whole-db copy). No file locks. */
async function backupTo(conn: DuckDBConnection, dest: string): Promise<void> {
  if (existsSync(dest)) unlinkSync(dest)
  const esc = dest.replace(/'/g, "''")
  const src = (await currentCatalog(conn)).replace(/"/g, '""')
  await conn.run(`ATTACH '${esc}' AS maintenance_backup`)
  try {
    await conn.run(`COPY FROM DATABASE "${src}" TO maintenance_backup`)
  } finally {
    try {
      await conn.run('DETACH maintenance_backup')
    } catch {
      /* ignore */
    }
  }
}

async function run(
  action: MaintenanceAction,
  fn: () => Promise<{ ok: boolean; message: string; detail?: unknown }>
): Promise<MaintenanceResult> {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  try {
    const res = await fn()
    return { action, ok: res.ok, message: res.message, detail: res.detail, startedAt, durationMs: Date.now() - t0 }
  } catch (e) {
    return {
      action,
      ok: false,
      message: e instanceof Error ? e.message : String(e),
      startedAt,
      durationMs: Date.now() - t0
    }
  }
}

export async function runMaintenance(action: MaintenanceAction): Promise<MaintenanceResult> {
  switch (action) {
    case 'integrity':
      return run(action, integrity)
    case 'optimize':
      return run(action, optimize)
    case 'rebuild':
      return run(action, rebuild)
    case 'compact':
      return run(action, compact)
    case 'purge':
      return run(action, purgeRaw)
    case 'storage':
      return run(action, storage)
  }
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** This DuckDB build exposes no integrity_check pragma, so the check is built
 *  from what it does expose: the catalog must read, every user table must be
 *  queryable, the Date+Cell fact key must be unique, and database_size must
 *  report a sane storage shape. Any failure is an integrity issue. */
async function integrity(): Promise<{ ok: boolean; message: string; detail?: unknown }> {
  const cur = ws.getCurrent()!
  const issues: string[] = []
  const tables: string[] = []
  try {
    const r = await cur.connection.runAndReadAll(
      `SELECT table_name FROM duckdb_tables() WHERE internal = false ORDER BY table_name`
    )
    for (const row of r.getRowObjects()) tables.push(String(row.table_name))
  } catch (e) {
    issues.push(`catalog unreadable: ${errMessage(e)}`)
  }
  for (const t of tables) {
    try {
      await cur.connection.runAndReadAll(`SELECT count(*) AS n FROM "${t.replace(/"/g, '""')}"`)
    } catch (e) {
      issues.push(`table ${t}: ${errMessage(e)}`)
    }
  }
  try {
    const r = await cur.connection.runAndReadAll(
      `SELECT count(*) AS n FROM (SELECT date_id, cell_id FROM fact_cell_daily GROUP BY 1, 2 HAVING count(*) > 1)`
    )
    const dupes = Number(r.getRowObjects()[0].n)
    if (dupes > 0) issues.push(`${dupes} duplicate Date+Cell fact row(s)`)
  } catch (e) {
    issues.push(`fact key check: ${errMessage(e)}`)
  }
  let sizeInfo = ''
  try {
    const d = await cur.connection.runAndReadAll(`PRAGMA database_size`)
    const row = d.getRowObjects()[0]
    sizeInfo = `${String(row.database_size)} on disk${row.wal_size != null && String(row.wal_size) !== '0 bytes' ? `, WAL ${String(row.wal_size)}` : ''}`
  } catch {
    /* non-fatal */
  }
  return {
    ok: issues.length === 0,
    message: issues.length === 0
      ? `Verified ${tables.length} tables readable, Date+Cell facts unique (${sizeInfo}).`
      : `Integrity check found ${issues.length} issue(s): ${issues.join('; ')}`,
    detail: { issues, tables: tables.length }
  }
}

async function optimize(): Promise<{ ok: boolean; message: string; detail?: unknown }> {
  const cur = ws.getCurrent()!
  // this DuckDB build has no `PRAGMA optimize`; the WAL merge is the useful
  // self-maintenance step: force a checkpoint and keep doing it on shutdown.
  await cur.connection.run('PRAGMA force_checkpoint')
  try {
    await cur.connection.run('PRAGMA enable_checkpoint_on_shutdown')
  } catch {
    /* optional */
  }
  return { ok: true, message: 'Checkpoint forced — the WAL was merged into the workspace file; checkpoint-on-shutdown is enabled.' }
}

async function rebuild(): Promise<{ ok: boolean; message: string; detail?: unknown }> {
  requireWritable()
  const cur = ws.getCurrent()!
  const backup = join(backupsDir(), `maintenance-rebuild-${cur.name}-${stamp()}.qosdb`)
  await backupTo(cur.connection, backup)
  const before = await cur.connection.runAndReadAll(`SELECT count(*) AS n FROM fact_cell_daily`)
  await cur.connection.run('BEGIN TRANSACTION')
  try {
    await recomputeAllAggregates(cur.connection)
    await refreshAllIntelligence(cur.connection)
    await cur.connection.run('COMMIT')
  } catch (e) {
    try {
      await cur.connection.run('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw e
  }
  const after = await cur.connection.runAndReadAll(`SELECT count(*) AS n FROM fact_cell_daily`)
  return {
    ok: true,
    message: `All aggregates and derived intelligence recomputed (facts unchanged: ${String(before.getRowObjects()[0].n)} rows before → ${String(after.getRowObjects()[0].n)} after). Pre-action backup: ${backup}`
  }
}

async function compact(): Promise<{ ok: boolean; message: string; detail?: unknown }> {
  requireWritable()
  const cur = ws.getCurrent()!
  const backup = join(backupsDir(), `maintenance-compact-${cur.name}-${stamp()}.qosdb`)
  await backupTo(cur.connection, backup)
  const tmp = `${cur.path}.compact.tmp`
  if (existsSync(tmp)) unlinkSync(tmp)

  const esc = tmp.replace(/'/g, "''")
  const src = (await currentCatalog(cur.connection)).replace(/"/g, '""')
  await cur.connection.run(`ATTACH '${esc}' AS compact_db`)
  try {
    await cur.connection.run(`COPY FROM DATABASE "${src}" TO compact_db`)
  } finally {
    try {
      await cur.connection.run('DETACH compact_db')
    } catch {
      /* ignore */
    }
  }

  const sizeBefore = statSync(cur.path).size
  const path = cur.path
  await ws.closeWorkspace()
  let ok = false
  try {
    copyFileSync(tmp, path)
    unlinkSync(tmp)
    ok = true
  } finally {
    await ws.openWorkspace(path)
  }
  if (!ok) throw new Error('Compact failed — the workspace was reopened unchanged (pre-action backup kept)')
  const sizeAfter = statSync(path).size
  const saved = Math.max(0, sizeBefore - sizeAfter)
  return {
    ok: true,
    message: `Workspace compacted into a fresh copy: ${(sizeBefore / 1024 / 1024).toFixed(1)} MB → ${(sizeAfter / 1024 / 1024).toFixed(1)} MB (${(saved / 1024 / 1024).toFixed(1)} MB saved). Pre-action backup: ${backup}`
  }
}

async function purgeRaw(): Promise<{ ok: boolean; message: string; detail?: unknown }> {
  requireWritable()
  const before = await rawArchive()
  const expiredBefore = before.status.expired
  const after = await purgeRawArchive()
  return {
    ok: true,
    message: expiredBefore > 0
      ? `Purged ${expiredBefore} expired raw source file(s); ${after.total} retained under the 90-day window.`
      : `No expired raw sources to purge — ${after.total} file(s) retained under the 90-day window.`
  }
}

async function storage(): Promise<{ ok: boolean; message: string; detail?: unknown }> {
  const cur = ws.getCurrent()!
  const fileSize = statSync(cur.path).size
  let walSize = 0
  if (existsSync(cur.path + '.wal')) walSize = statSync(cur.path + '.wal').size
  let names: string[] = []
  try {
    const r = await cur.connection.runAndReadAll(
      `SELECT table_name FROM duckdb_tables() WHERE internal = false ORDER BY table_name`
    )
    names = r.getRowObjects().map((x) => String(x.table_name))
  } catch {
    names = [
      'fact_cell_daily', 'dim_cell', 'dim_site', 'dim_district', 'dim_region',
      'agg_cell_weekly', 'agg_cell_monthly', 'agg_network_weekly', 'cell_nc_lifecycle',
      'cell_priority_history', 'cell_health_history', 'import_audit', 'raw_archive',
      'source_mapping_profiles', 'data_quality_scores', 'coverage_daily'
    ]
  }
  const tables: Array<{ table: string; rows: number }> = []
  for (const t of names.slice(0, 80)) {
    try {
      const r = await cur.connection.runAndReadAll(`SELECT count(*) AS n FROM "${t.replace(/"/g, '""')}"`)
      tables.push({ table: t, rows: Number(r.getRowObjects()[0].n) })
    } catch {
      /* table may not exist in an older workspace */
    }
  }
  tables.sort((a, b) => b.rows - a.rows)
  return {
    ok: true,
    message: `Workspace ${(fileSize / 1024 / 1024).toFixed(1)} MB on disk${walSize > 0 ? ` (+ ${(walSize / 1024 / 1024).toFixed(2)} MB WAL pending checkpoint)` : ''}; ${tables.length} tables.`,
    detail: { fileSize, walSize, tables }
  }
}
