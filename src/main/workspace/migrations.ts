import type { DuckDBConnection } from '@duckdb/node-api'
import { AGG_CELL_DAILY_SELECT, CELL_FORECASTS_SQL, FORECAST_DIRTY_SQL } from './schema'
import { migrateLegacyTargets } from './migrateTargets'
import { seedKpiDefs } from '../services/kpiService'
import { ensureDerivedKpiSchema } from '../services/derivedKpiService'
import { repairDuplicateDimensions } from '../services/dimRepair'
import { recomputeNcLifecycle } from '../analytics/nc'
import { periodCoverageViewSql } from '../analytics/periods'
import { WORKSPACE_TECH_SQL } from '../analytics/ncRule'
import { NC_PERIOD_FIELDS, NC_PERIOD_KEYS } from '../../../shared/ruleDefaults'
import type { Technology } from '../../../shared/api'

/**
 * Versioned workspace migrations (spec 2026-10-10-versioned-migrations).
 *
 * Every workspace stores one integer `schema_version` in workspace_meta. A
 * writable open runs the migrations above it, in order, once, after a backup;
 * a workspace saved by a newer app (version above LATEST) opens read-only.
 *
 * Rule for schema changes: change SCHEMA_SQL (new workspaces) AND append
 * migration LATEST + 1 (existing workspaces). Never edit or reorder a
 * migration that has shipped. The schema-parity test fails when only one side
 * changes.
 */

export interface Migration {
  version: number
  name: string
  /** Returns true when it changed data that needs the aggregates + intelligence recompute. */
  up(conn: DuckDBConnection): Promise<boolean | void>
  /** Temp views a read-only open needs while the workspace is older than this step. */
  readOnlyShim?(conn: DuckDBConnection): Promise<void>
}

/** A non-negative integer string is that version; anything else (incl. the old '1.0.0') is 0. */
export function parseSchemaVersion(value: unknown): number {
  const s = value == null ? '' : String(value).trim()
  return /^\d+$/.test(s) ? Number(s) : 0
}

async function getMeta(conn: DuckDBConnection, key: string): Promise<string | null> {
  const v = (await conn.runAndReadAll(`SELECT value FROM workspace_meta WHERE key = ?`, [key])).getRowObjects()[0]?.value
  return v == null ? null : String(v)
}

async function setMeta(conn: DuckDBConnection, key: string, value: string): Promise<void> {
  await conn.run(
    `INSERT INTO workspace_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value]
  )
}

export async function readSchemaVersion(conn: DuckDBConnection): Promise<number> {
  return parseSchemaVersion(await getMeta(conn, 'schema_version'))
}

const failure = (m: { version: number; name: string } | undefined, backupPath: string | null, cause: unknown): Error => {
  const where = m ? `step ${m.version} (${m.name})` : 'the final recompute'
  const copy = backupPath ?? 'the backups folder'
  const e = new Error(`Upgrading this workspace failed at ${where}. A copy from before the upgrade is in ${copy}.`)
  ;(e as Error & { cause?: unknown }).cause = cause
  return e
}

/** Run every migration above `from`, in order, after one backup. Versions are
 *  recorded after each step, except while a requested recompute is still
 *  outstanding: `recompute_pending` then marks it, and the next run finishes it
 *  even when no step reports a change. */
export async function runMigrations(
  conn: DuckDBConnection,
  list: Migration[],
  from: number,
  opts: { backup(): Promise<string>; recompute(conn: DuckDBConnection): Promise<void> }
): Promise<{ ran: number[]; backupPath: string | null; recomputed: boolean }> {
  const pending = list.filter((m) => m.version > from).sort((a, b) => a.version - b.version)
  const pendingFlag = await getMeta(conn, 'recompute_pending')
  if (pending.length === 0 && pendingFlag == null) return { ran: [], backupPath: null, recomputed: false }

  let backupPath: string | null = null
  if (pending.length > 0) {
    try {
      backupPath = await opts.backup()
    } catch (e) {
      throw new Error(
        `Upgrading this workspace was not started: the backup failed (${e instanceof Error ? e.message : String(e)}). Nothing was changed.`
      )
    }
  }

  let asker = pendingFlag != null ? list.find((m) => m.version === Number(pendingFlag)) : undefined
  let recomputeOutstanding = pendingFlag != null
  const ran: number[] = []
  for (const m of pending) {
    let wants: boolean | void
    try {
      wants = await m.up(conn)
    } catch (e) {
      throw failure(m, backupPath, e)
    }
    ran.push(m.version)
    if (wants === true) {
      asker = m
      recomputeOutstanding = true
      await setMeta(conn, 'recompute_pending', String(m.version))
    }
    if (!recomputeOutstanding) await setMeta(conn, 'schema_version', String(m.version))
  }

  if (!recomputeOutstanding) return { ran, backupPath, recomputed: false }
  try {
    await opts.recompute(conn)
  } catch (e) {
    throw failure(asker, backupPath, e)
  }
  await conn.run(`DELETE FROM workspace_meta WHERE key = 'recompute_pending'`)
  const last = pending.at(-1)?.version ?? from
  await setMeta(conn, 'schema_version', String(Math.max(last, from)))
  return { ran, backupPath, recomputed: true }
}

/** A read-only open of an older workspace: the stand-ins its missing steps
 *  provide (temp views only; nothing is written to the file). */
export async function runReadOnlyShims(conn: DuckDBConnection, list: Migration[], from: number): Promise<void> {
  for (const m of [...list].sort((a, b) => a.version - b.version)) {
    if (m.version > from && m.readOnlyShim) await m.readOnlyShim(conn)
  }
}

// --- the migrations -----------------------------------------------------------
// Each is safe on a workspace that already has its effect (a legacy workspace
// of unknown state runs them all once). Steps v2, v5–v7 read their pre-
// versioning marker as "already done" but never write markers.

/** v1: tables, columns and views added since the first release. */
async function schemaCatchUp(conn: DuckDBConnection): Promise<void> {
  // cell_forecasts was never written before the honest-forecasting spec; an
  // old-shape table (metric/horizon columns) is replaced, not migrated
  const fcCols = await conn.runAndReadAll(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'cell_forecasts'`
  )
  const fcNames = fcCols.getRowObjects().map((x) => String(x.column_name))
  if (fcNames.length > 0 && !fcNames.includes('kpi_key')) await conn.run('DROP TABLE cell_forecasts')
  await conn.run(CELL_FORECASTS_SQL)
  await conn.run(FORECAST_DIRTY_SQL)
  await conn.run(`CREATE SEQUENCE IF NOT EXISTS seq_kpi_defs START 1`)
  await conn.run(`CREATE TABLE IF NOT EXISTS kpi_defs (
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
  await conn.run(`CREATE TABLE IF NOT EXISTS fact_extra_metrics (
     date_id INTEGER NOT NULL,
     cell_id BIGINT NOT NULL,
     kpi_id BIGINT NOT NULL,
     value DOUBLE,
     PRIMARY KEY (date_id, cell_id, kpi_id)
   )`)
  await conn.run(`CREATE TABLE IF NOT EXISTS agg_cell_kpi_weekly (
     week_start DATE NOT NULL,
     cell_id BIGINT NOT NULL,
     kpi_id BIGINT NOT NULL,
     avg_value DOUBLE, sum_value DOUBLE, max_value DOUBLE, min_value DOUBLE,
     observed_days INTEGER,
     PRIMARY KEY (week_start, cell_id, kpi_id)
   )`)
  await conn.run(
    `CREATE TABLE IF NOT EXISTS raw_archive (
       archive_id BIGINT DEFAULT nextval('seq_raw_archive') PRIMARY KEY,
       import_id BIGINT, filename VARCHAR,
       archived_path VARCHAR, size_bytes BIGINT, checksum VARCHAR,
       imported_at TIMESTAMP DEFAULT now(), retention_until TIMESTAMP
     )`
  )
  await conn.run(`CREATE SEQUENCE IF NOT EXISTS seq_raw_archive START 1`)
  await conn.run(`ALTER TABLE workspace_snapshots ADD COLUMN IF NOT EXISTS path VARCHAR`)
  for (const k of NC_PERIOD_KEYS) {
    const fld = NC_PERIOD_FIELDS[k]
    await conn.run(`ALTER TABLE ruleset ADD COLUMN IF NOT EXISTS ${fld.column} INTEGER DEFAULT ${fld.default}`)
  }
  await conn.run(`CREATE TABLE IF NOT EXISTS period_coverage (
     grain VARCHAR NOT NULL, period_start DATE NOT NULL,
     days_with_data INTEGER NOT NULL, days_in_period INTEGER NOT NULL, is_complete BOOLEAN NOT NULL,
     PRIMARY KEY (grain, period_start)
   )`)
  await conn.run(`CREATE TABLE IF NOT EXISTS maintenance_settings (
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
  await conn.run(`INSERT INTO maintenance_settings (id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM maintenance_settings)`)
  await conn.run(`CREATE SEQUENCE IF NOT EXISTS seq_maintenance_runs START 1`)
  await conn.run(`CREATE TABLE IF NOT EXISTS maintenance_runs (
     run_id BIGINT DEFAULT nextval('seq_maintenance_runs') PRIMARY KEY,
     ran_at TIMESTAMP DEFAULT now(),
     ok BOOLEAN, actions JSON, summary VARCHAR, duration_ms BIGINT
   )`)
  await conn.run(`CREATE OR REPLACE VIEW agg_cell_daily AS ${AGG_CELL_DAILY_SELECT}`)
  await conn.run(`
    CREATE OR REPLACE VIEW agg_cell_kpi_daily AS
    SELECT
      d.date,
      d.date AS period_start,
      d.date AS period_end,
      d.date AS week_start,
      d.date AS month_start,
      d.iso_year,
      d.iso_week,
      d.month,
      d.year,
      f.cell_id,
      f.kpi_id,
      f.value AS avg_value,
      f.value AS sum_value,
      f.value AS max_value,
      f.value AS min_value,
      1 AS observed_days
    FROM fact_extra_metrics f
    JOIN dim_date d USING (date_id)
  `)
}

/** v1's read-only stand-in: weekly/monthly screens need period_coverage. */
async function periodCoverageShim(conn: DuckDBConnection): Promise<void> {
  try {
    await conn.run(`SELECT 1 FROM period_coverage LIMIT 0`)
  } catch {
    await conn.run(periodCoverageViewSql())
  }
}

/** v2: kpi_defs owns every KPI target (the catalogue is seeded first: the
 *  oldest workspaces have none yet, and the move writes into it). */
async function targetsOwnedByKpiDefs(conn: DuckDBConnection): Promise<void> {
  for (const t of ['2G', '3G', '4G'] as Technology[]) await seedKpiDefs(conn, t)
  await migrateLegacyTargets(conn)
}

/** v4: merge duplicate dimension names left by old imports. Best-effort, as
 *  before: a failed repair is logged and never blocks opening the workspace. */
async function mergeDuplicateDimensions(conn: DuckDBConnection): Promise<boolean> {
  try {
    const r = await repairDuplicateDimensions(conn)
    const merged = r.mergedDistricts + r.mergedSites + r.mergedCells
    if (merged > 0) {
      console.log(`[dimRepair] merged ${r.mergedDistricts} district(s), ${r.mergedSites} site(s), ${r.mergedCells} cell(s)`)
    }
    return merged > 0
  } catch (e) {
    console.error('[dimRepair] failed (workspace still opens): ' + (e instanceof Error ? e.message : String(e)))
    return false
  }
}

/** The relabel marker the old once-on-open check wrote (2026-10-01.2:
 *  complete periods); a legacy workspace carrying it is already relabelled. */
const NC_PERIODS_MARKER = '2026-10-01.2'

/** v5: NC lifecycle labels under the current rules (seven labels, months by
 *  bad days, complete periods). The recompute does the relabelling. */
async function ncPeriodsRelabel(conn: DuckDBConnection): Promise<boolean> {
  // Auto-backfill daily/monthly NC lifecycle if missing in existing workspaces
  const dailyLifeR = await conn.runAndReadAll(
    `SELECT count(*) AS n FROM cell_nc_lifecycle WHERE grain = 'daily'`
  )
  if (Number(dailyLifeR.getRowObjects()[0]?.n ?? 0) === 0) {
    const cellsR = await conn.runAndReadAll(`SELECT DISTINCT cell_id FROM fact_cell_daily`)
    const cellIds = cellsR.getRowObjects().map((r) => Number(r.cell_id)).filter((id) => !isNaN(id))
    if (cellIds.length > 0) {
      await recomputeNcLifecycle(conn, cellIds)
    }
  }
  const marker = (await conn.runAndReadAll(`SELECT value FROM workspace_meta WHERE key = 'nc_periods'`)).getRowObjects()[0]?.value
  return marker == null || String(marker) !== NC_PERIODS_MARKER
}

/** The technology holding at least 90% of the imported KPI rows, or null
 *  when there are none or no technology reaches 90%. */
export async function inferWorkspaceTechnology(conn: DuckDBConnection): Promise<Technology | null> {
  const rows = (await conn.runAndReadAll(
    `SELECT k.technology AS technology, count(*) AS n
     FROM fact_extra_metrics e JOIN kpi_defs k ON k.kpi_id = e.kpi_id
     GROUP BY k.technology ORDER BY n DESC`
  )).getRowObjects()
  const total = rows.reduce((a, r) => a + Number(r.n), 0)
  if (total === 0) return null
  const top = rows[0]
  return Number(top.n) / total >= 0.9 ? (String(top.technology) as Technology) : null
}

async function hasMarker(conn: DuckDBConnection, key: string): Promise<boolean> {
  return (await conn.runAndReadAll(`SELECT 1 FROM workspace_meta WHERE key = ?`, [key])).getRowObjects().length > 0
}

/** v6: before workspaces had a fixed technology, the 2G/3G/4G buttons rewrote
 *  it, so an older workspace may hold one technology's data under another's
 *  label. Takes the technology of ≥ 90% of its KPI rows. */
async function correctTechnology(conn: DuckDBConnection): Promise<boolean> {
  if (await hasMarker(conn, 'tech_checked')) return false
  const stored = String((await conn.runAndReadAll(
    `SELECT value FROM workspace_meta WHERE key = 'technology'`
  )).getRowObjects()[0]?.value ?? '4G')
  const inferred = await inferWorkspaceTechnology(conn)
  if (inferred == null || inferred === stored) return false
  console.log(`[techCheck] workspace technology ${stored} -> ${inferred} (from its KPI rows)`)
  await conn.run(
    `INSERT INTO workspace_meta (key, value) VALUES ('technology', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [inferred]
  )
  return true
}

/** v7: before imports resolved KPI keys within the workspace's technology, a
 *  key defined under several technologies (connected_users, data_volume) was
 *  stored once per technology. Drops each other-technology row whose twin
 *  (same cell, day and key) holds the workspace technology's copy. */
async function cleanExtraMetricsTech(conn: DuckDBConnection): Promise<boolean> {
  if (await hasMarker(conn, 'extra_tech_cleaned')) return false
  const countRows = async (): Promise<number> =>
    Number((await conn.runAndReadAll(`SELECT count(*) AS n FROM fact_extra_metrics`)).getRowObjects()[0].n)
  const before = await countRows()
  await conn.run(
    `DELETE FROM fact_extra_metrics AS e
     WHERE EXISTS (
       SELECT 1
       FROM kpi_defs k
       JOIN kpi_defs w ON w.kpi_key = k.kpi_key AND w.technology = ${WORKSPACE_TECH_SQL}
       JOIN fact_extra_metrics t ON t.kpi_id = w.kpi_id AND t.cell_id = e.cell_id AND t.date_id = e.date_id
       WHERE k.kpi_id = e.kpi_id AND k.technology <> ${WORKSPACE_TECH_SQL}
     )`
  )
  const deleted = before - (await countRows())
  if (deleted > 0) console.log(`[extraTech] dropped ${deleted} other-technology KPI row(s)`)
  return deleted > 0
}

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'Schema catch-up', up: schemaCatchUp, readOnlyShim: periodCoverageShim },
  { version: 2, name: 'Targets owned by kpi_defs', up: targetsOwnedByKpiDefs },
  { version: 3, name: 'Derived-KPI tables', up: ensureDerivedKpiSchema },
  { version: 4, name: 'Merge duplicate dimensions', up: mergeDuplicateDimensions },
  { version: 5, name: 'NC periods relabel', up: ncPeriodsRelabel },
  { version: 6, name: 'Technology correction', up: correctTechnology },
  { version: 7, name: 'Extra-KPI technology clean-up', up: cleanExtraMetricsTech }
]

export const LATEST = MIGRATIONS[MIGRATIONS.length - 1].version
