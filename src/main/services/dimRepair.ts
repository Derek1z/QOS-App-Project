import type { DuckDBConnection } from '@duckdb/node-api'
import { recomputeAggregates, updateCoverage } from '../import/aggregates'
import { refreshIntelligence } from '../analytics/engine'

/**
 * Startup repair for legacy workspaces. Older app versions could commit
 * duplicate dimension rows: the same district / site / cell name appearing
 * with different parents within a single import passed the NOT EXISTS guard
 * (which cannot see same-statement inserts), and duplicate cell names then
 * produced double-counted facts. Imports now dedupe up-front, but workspaces
 * created before that fix may still hold duplicates.
 *
 * This repair:
 *  1. merges duplicate names (lowest id wins),
 *  2. re-points / dedupes every referencing table (facts, extra metrics,
 *     anomalies, forecasts, action status, notes),
 *  3. regenerates aggregates, coverage and derived intelligence for the
 *     affected dates.
 * It is idempotent and a cheap no-op on clean workspaces.
 */

export interface DimRepairResult {
  mergedDistricts: number
  mergedSites: number
  mergedCells: number
  repointedFacts: number
  affectedDates: number
}

export async function repairDuplicateDimensions(conn: DuckDBConnection): Promise<DimRepairResult> {
  const zero: DimRepairResult = { mergedDistricts: 0, mergedSites: 0, mergedCells: 0, repointedFacts: 0, affectedDates: 0 }
  const dupDistricts = await removedRowCount(conn, 'dim_district', 'district_id', 'name')
  const dupSites = await removedRowCount(conn, 'dim_site', 'site_id', 'name')
  const dupCells = await removedRowCount(conn, 'dim_cell', 'cell_id', 'name')
  if (dupDistricts === 0 && dupSites === 0 && dupCells === 0) return zero

  await conn.run('BEGIN TRANSACTION')
  try {
    // canonical maps (name -> lowest id) for every table with duplicates
    await buildMap(conn, 'tmp_district_map', 'dim_district', 'district_id', dupDistricts > 0)
    await buildMap(conn, 'tmp_site_map', 'dim_site', 'site_id', dupSites > 0)
    await buildMap(conn, 'tmp_cell_map', 'dim_cell', 'cell_id', dupCells > 0)

    // dates affected by any merged dimension, BEFORE re-pointing removes the dup ids
    const affected = await affectedDateIds(conn)

    if (dupDistricts > 0) await mergeDistricts(conn)
    if (dupSites > 0) await mergeSites(conn)
    let repointedFacts = 0
    if (dupCells > 0) repointedFacts = await mergeCells(conn)

    // regenerate everything derived for the affected dates (aggregates are
    // rebuilt from facts, so stale rows for merged ids are wiped too)
    if (affected.length > 0) {
      await recomputeAggregates(conn, affected)
      await updateCoverage(conn, affected)
      await refreshIntelligence(conn, affected)
    }
    await conn.run('COMMIT')
    return { mergedDistricts: dupDistricts, mergedSites: dupSites, mergedCells: dupCells, repointedFacts, affectedDates: affected.length }
  } catch (e) {
    try {
      await conn.run('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw e instanceof Error ? e : new Error(String(e))
  }
}

/** Number of rows that would be removed (count(name) - 1 summed over dup names). */
async function removedRowCount(conn: DuckDBConnection, table: string, idCol: string, nameCol: string): Promise<number> {
  const r = await conn.runAndReadAll(
    `SELECT COALESCE(sum(c - 1), 0) AS n FROM (SELECT count(*) AS c FROM ${table} GROUP BY ${nameCol} HAVING count(*) > 1)`
  )
  return Number(r.getRowObjects()[0].n)
}

/** CREATE OR REPLACE the canonical map for one dimension table (if needed). */
async function buildMap(conn: DuckDBConnection, mapTable: string, table: string, idCol: string, exists: boolean): Promise<void> {
  if (!exists) {
    await conn.run(`DROP TABLE IF EXISTS ${mapTable}`)
    return
  }
  await conn.run(
    `CREATE OR REPLACE TEMP TABLE ${mapTable} AS
     SELECT name, MIN(${idCol}) AS keep_id FROM ${table} GROUP BY name HAVING count(*) > 1`
  )
}

/** Date ids of facts referencing any merged dimension (dup-named cells, or
 *  cells under dup-named sites/districts) — computed before the merge. */
async function affectedDateIds(conn: DuckDBConnection): Promise<number[]> {
  const parts: string[] = []
  for (const [mapTable, dimTable, idCol] of [
    ['tmp_cell_map', 'dim_cell', 'cell_id'],
    ['tmp_site_map', 'dim_site', 'site_id'],
    ['tmp_district_map', 'dim_district', 'district_id']
  ] as const) {
    parts.push(
      `SELECT DISTINCT f.date_id
       FROM fact_cell_daily f
       JOIN dim_cell c ON c.cell_id = f.cell_id
       JOIN ${dimTable} d ON d.${idCol} = c.${idCol}
       JOIN ${mapTable} m ON m.name = d.name`
    )
  }
  const r = await conn.runAndReadAll(parts.join(' UNION '))
  return [...new Set(r.getRowObjects().map((x) => Number(x.date_id)))]
}

async function mergeDistricts(conn: DuckDBConnection): Promise<void> {
  // re-point children (no PK collision: dim_site/dim_cell key on their own id)
  await conn.run(
    `UPDATE dim_site
     SET district_id = x.keep_id
     FROM (SELECT d.district_id AS dup_id, m.keep_id FROM dim_district d JOIN tmp_district_map m ON m.name = d.name) x
     WHERE dim_site.district_id = x.dup_id`
  )
  await conn.run(
    `UPDATE dim_cell
     SET district_id = x.keep_id
     FROM (SELECT d.district_id AS dup_id, m.keep_id FROM dim_district d JOIN tmp_district_map m ON m.name = d.name) x
     WHERE dim_cell.district_id = x.dup_id`
  )
  await repointEntityStatus(conn, 'district')
  await conn.run(
    `DELETE FROM dim_district WHERE district_id IN (
       SELECT d.district_id FROM dim_district d JOIN tmp_district_map m ON m.name = d.name WHERE d.district_id <> m.keep_id
     )`
  )
}

async function mergeSites(conn: DuckDBConnection): Promise<void> {
  await conn.run(
    `UPDATE dim_cell
     SET site_id = x.keep_id
     FROM (SELECT s.site_id AS dup_id, m.keep_id FROM dim_site s JOIN tmp_site_map m ON m.name = s.name) x
     WHERE dim_cell.site_id = x.dup_id`
  )
  await repointEntityStatus(conn, 'site')
  await conn.run(
    `DELETE FROM dim_site WHERE site_id IN (
       SELECT s.site_id FROM dim_site s JOIN tmp_site_map m ON m.name = s.name WHERE s.site_id <> m.keep_id
     )`
  )
}

/** Merge duplicate cell names. Returns the number of re-pointed fact rows. */
async function mergeCells(conn: DuckDBConnection): Promise<number> {
  const r = await conn.runAndReadAll(
    `SELECT count(*) AS n
     FROM fact_cell_daily f
     JOIN dim_cell c ON c.cell_id = f.cell_id
     JOIN tmp_cell_map m ON m.name = c.name`
  )
  const repointedFacts = Number(r.getRowObjects()[0].n)

  // same logical cell/date was double-counted across the duplicate ids:
  // keep the best row per (date, canonical cell)
  await rebuildCellFacts(conn)
  await rebuildExtraMetrics(conn)

  // derived tables the intelligence refresh regenerates: drop rows for merged ids
  for (const t of ['cell_nc_lifecycle', 'cell_priority_history', 'cell_health_history']) {
    await conn.run(
      `DELETE FROM ${t} WHERE cell_id IN (SELECT cell_id FROM dim_cell c JOIN tmp_cell_map m ON m.name = c.name)`
    )
  }

  // derived tables NOT regenerated by the engine: re-point + dedupe by rebuilding
  await rebuildAnomalies(conn)
  await rebuildForecasts(conn)
  await repointEntityStatus(conn, 'cell')
  await conn.run(
    `UPDATE notes_events
     SET entity_id = x.keep_id
     FROM (SELECT c.cell_id AS dup_id, m.keep_id FROM dim_cell c JOIN tmp_cell_map m ON m.name = c.name) x
     WHERE notes_events.entity_type = 'cell' AND notes_events.entity_id = x.dup_id`
  )

  await conn.run(
    `DELETE FROM dim_cell WHERE cell_id IN (
       SELECT c.cell_id FROM dim_cell c JOIN tmp_cell_map m ON m.name = c.name WHERE c.cell_id <> m.keep_id
     )`
  )
  return repointedFacts
}

/** Rebuild fact_cell_daily after merging duplicate cells (PK date_id, cell_id). */
async function rebuildCellFacts(conn: DuckDBConnection): Promise<void> {
  await conn.run(
    `CREATE TABLE fact_cell_daily_repair (
       date_id INTEGER NOT NULL, cell_id BIGINT NOT NULL,
       prb_utilization DOUBLE, data_volume_mb DOUBLE, connected_users DOUBLE,
       dl_throughput_kbps DOUBLE, availability_pct DOUBLE, source_import_id BIGINT,
       PRIMARY KEY (date_id, cell_id)
     )`
  )
  await conn.run(
    `INSERT INTO fact_cell_daily_repair (date_id, cell_id, prb_utilization, data_volume_mb, connected_users, dl_throughput_kbps, availability_pct, source_import_id)
     SELECT date_id, cell_id, prb_utilization, data_volume_mb, connected_users, dl_throughput_kbps, availability_pct, source_import_id
     FROM fact_cell_daily
     WHERE cell_id NOT IN (SELECT cell_id FROM dim_cell c JOIN tmp_cell_map m ON m.name = c.name)`
  )
  await conn.run(
    `INSERT INTO fact_cell_daily_repair (date_id, cell_id, prb_utilization, data_volume_mb, connected_users, dl_throughput_kbps, availability_pct, source_import_id)
     SELECT date_id, keep_id AS cell_id, prb_utilization, data_volume_mb, connected_users, dl_throughput_kbps, availability_pct, source_import_id
     FROM (
       SELECT f.date_id, m.keep_id, f.prb_utilization, f.data_volume_mb, f.connected_users,
              f.dl_throughput_kbps, f.availability_pct, f.source_import_id,
              row_number() OVER (
                PARTITION BY f.date_id, m.keep_id
                ORDER BY (f.prb_utilization IS NOT NULL)::INT + (f.data_volume_mb IS NOT NULL)::INT +
                         (f.connected_users IS NOT NULL)::INT + (f.dl_throughput_kbps IS NOT NULL)::INT +
                         (f.availability_pct IS NOT NULL)::INT DESC, f.cell_id
              ) AS rn
       FROM fact_cell_daily f
       JOIN dim_cell c ON c.cell_id = f.cell_id
       JOIN tmp_cell_map m ON m.name = c.name
     ) x
     WHERE rn = 1`
  )
  await conn.run('DROP TABLE fact_cell_daily')
  await conn.run('ALTER TABLE fact_cell_daily_repair RENAME TO fact_cell_daily')
}

/** Rebuild fact_extra_metrics after merging duplicate cells (PK date_id, cell_id, kpi_id). */
async function rebuildExtraMetrics(conn: DuckDBConnection): Promise<void> {
  await conn.run(
    `CREATE TABLE fact_extra_metrics_repair (
       date_id INTEGER NOT NULL, cell_id BIGINT NOT NULL, kpi_id BIGINT NOT NULL, value DOUBLE,
       PRIMARY KEY (date_id, cell_id, kpi_id)
     )`
  )
  await conn.run(
    `INSERT INTO fact_extra_metrics_repair (date_id, cell_id, kpi_id, value)
     SELECT date_id, cell_id, kpi_id, value
     FROM fact_extra_metrics
     WHERE cell_id NOT IN (SELECT cell_id FROM dim_cell c JOIN tmp_cell_map m ON m.name = c.name)`
  )
  await conn.run(
    `INSERT INTO fact_extra_metrics_repair (date_id, cell_id, kpi_id, value)
     SELECT date_id, keep_id AS cell_id, kpi_id, value
     FROM (
       SELECT f.date_id, m.keep_id, f.kpi_id, f.value,
              row_number() OVER (PARTITION BY f.date_id, m.keep_id, f.kpi_id ORDER BY (f.value IS NOT NULL)::INT DESC, f.cell_id) AS rn
       FROM fact_extra_metrics f
       JOIN dim_cell c ON c.cell_id = f.cell_id
       JOIN tmp_cell_map m ON m.name = c.name
     ) x
     WHERE rn = 1`
  )
  await conn.run('DROP TABLE fact_extra_metrics')
  await conn.run('ALTER TABLE fact_extra_metrics_repair RENAME TO fact_extra_metrics')
}

/** Rebuild cell_anomalies with merged cell ids, deduped by (cell_id, date_id, metric). */
async function rebuildAnomalies(conn: DuckDBConnection): Promise<void> {
  await conn.run(
    `CREATE TABLE cell_anomalies_repair (
       cell_id BIGINT, date_id INTEGER, metric VARCHAR, score DOUBLE, detail JSON,
       PRIMARY KEY (cell_id, date_id, metric)
     )`
  )
  await conn.run(
    `INSERT INTO cell_anomalies_repair (cell_id, date_id, metric, score, detail)
     SELECT cell_id, date_id, metric, score, detail
     FROM (
       SELECT COALESCE(m.keep_id, a.cell_id) AS cell_id, a.date_id, a.metric, a.score, a.detail,
              row_number() OVER (
                PARTITION BY COALESCE(m.keep_id, a.cell_id), a.date_id, a.metric
                ORDER BY (a.score IS NOT NULL)::INT DESC, a.cell_id
              ) AS rn
       FROM cell_anomalies a
       LEFT JOIN dim_cell c ON c.cell_id = a.cell_id
       LEFT JOIN tmp_cell_map m ON m.name = c.name
     ) x
     WHERE rn = 1`
  )
  await conn.run('DROP TABLE cell_anomalies')
  await conn.run('ALTER TABLE cell_anomalies_repair RENAME TO cell_anomalies')
}

/** Rebuild cell_forecasts with merged cell ids, deduped by (cell_id, metric, horizon, as_of). */
async function rebuildForecasts(conn: DuckDBConnection): Promise<void> {
  await conn.run(
    `CREATE TABLE cell_forecasts_repair (
       cell_id BIGINT, metric VARCHAR, horizon VARCHAR, as_of DATE,
       method VARCHAR, forecast JSON, lower_bound DOUBLE, upper_bound DOUBLE,
       mae DOUBLE, rmse DOUBLE, quality VARCHAR, risk VARCHAR,
       PRIMARY KEY (cell_id, metric, horizon, as_of)
     )`
  )
  await conn.run(
    `INSERT INTO cell_forecasts_repair (cell_id, metric, horizon, as_of, method, forecast, lower_bound, upper_bound, mae, rmse, quality, risk)
     SELECT cell_id, metric, horizon, as_of, method, forecast, lower_bound, upper_bound, mae, rmse, quality, risk
     FROM (
       SELECT COALESCE(m.keep_id, a.cell_id) AS cell_id, a.metric, a.horizon, a.as_of, a.method,
              a.forecast, a.lower_bound, a.upper_bound, a.mae, a.rmse, a.quality, a.risk,
              row_number() OVER (
                PARTITION BY COALESCE(m.keep_id, a.cell_id), a.metric, a.horizon, a.as_of
                ORDER BY a.cell_id
              ) AS rn
       FROM cell_forecasts a
       LEFT JOIN dim_cell c ON c.cell_id = a.cell_id
       LEFT JOIN tmp_cell_map m ON m.name = c.name
     ) x
     WHERE rn = 1`
  )
  await conn.run('DROP TABLE cell_forecasts')
  await conn.run('ALTER TABLE cell_forecasts_repair RENAME TO cell_forecasts')
}

/** Re-point entity_action_status for the merged entity and dedupe collisions.
 *  Re-pointing happens inside the rebuild (the live table keeps its PK, so an
 *  UPDATE would trip the constraint when a re-pointed id already exists). */
async function repointEntityStatus(conn: DuckDBConnection, entity: 'cell' | 'site' | 'district'): Promise<void> {
  const dimTable = entity === 'cell' ? 'dim_cell' : entity === 'site' ? 'dim_site' : 'dim_district'
  const idCol = entity + '_id'
  const mapTable = 'tmp_' + entity + '_map'
  await conn.run(
    `CREATE TABLE entity_action_status_repair (
       entity_type VARCHAR, entity_id BIGINT, status VARCHAR, owner VARCHAR,
       external_ticket VARCHAR, target_review_date DATE, updated_at TIMESTAMP DEFAULT now(),
       PRIMARY KEY (entity_type, entity_id)
     )`
  )
  await conn.run(
    `INSERT INTO entity_action_status_repair (entity_type, entity_id, status, owner, external_ticket, target_review_date, updated_at)
     SELECT entity_type, entity_id, status, owner, external_ticket, target_review_date, updated_at
     FROM (
       SELECT e.entity_type,
              COALESCE(CASE WHEN e.entity_type = '${entity}' THEN m.keep_id END, e.entity_id) AS entity_id,
              e.status, e.owner, e.external_ticket, e.target_review_date, e.updated_at,
              row_number() OVER (
                PARTITION BY e.entity_type, COALESCE(CASE WHEN e.entity_type = '${entity}' THEN m.keep_id END, e.entity_id)
                ORDER BY e.updated_at DESC, e.entity_id
              ) AS rn
       FROM entity_action_status e
       LEFT JOIN ${dimTable} t ON t.${idCol} = e.entity_id AND e.entity_type = '${entity}'
       LEFT JOIN ${mapTable} m ON m.name = t.name
     ) x
     WHERE rn = 1`
  )
  await conn.run('DROP TABLE entity_action_status')
  await conn.run('ALTER TABLE entity_action_status_repair RENAME TO entity_action_status')
}
