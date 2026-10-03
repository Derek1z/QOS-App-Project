import { dateValue, type DuckDBConnection } from '@duckdb/node-api'
import type { Technology } from '../../../shared/api'
import type { SeriesForecast } from '../analytics/forecasting/engine'
import { latestCompletePeriodSql } from '../analytics/periods'
import { workspaceTechnology } from '../services/kpiService'
import { forecastableKpis, readCellSeriesBatch, domainOf, type ForecastKpi } from './series'
import type { ForecastRunner, SeriesJob } from './runner'

/** Stored per-cell forecasts (honest-forecasting spec §6.1): which KPIs are
 *  stored, when they are recomputed, and the batched run that writes them. */

export type StoredGrain = 'weekly' | 'monthly'
export const STORED_GRAINS: StoredGrain[] = ['weekly', 'monthly']
export const STORED_HORIZON: Record<StoredGrain, number> = { weekly: 12, monthly: 6 }
const PERIOD_NOUN: Record<StoredGrain, string> = { weekly: 'weeks', monthly: 'months' }
export const BATCH_CELLS = 5000

export interface ForecastJobPlan {
  grain: StoredGrain
  asOf: string
  cellIds: number[] | 'all'
  kpiKeys: string[]
  deleteKpiKeys: string[]
}

export interface StoredForecast { asOf: string; forecast: SeriesForecast }

const metaKey = (g: StoredGrain): string => `forecasts_${g}_as_of`

/** KPIs stored for every cell: those with a target, and the capacity KPIs. */
export async function storedForecastKpis(conn: DuckDBConnection, tech: Technology): Promise<ForecastKpi[]> {
  const { available } = await forecastableKpis(conn, tech, { scope: 'network', id: null })
  return available.filter((k) => k.target != null || k.capacity)
}

async function scalar(conn: DuckDBConnection, sql: string, params: unknown[] = []): Promise<string | null> {
  const r = await conn.runAndReadAll(sql, params as never)
  const v = Object.values(r.getRowObjects()[0] ?? {})[0]
  return v == null ? null : String(v)
}

/** What has to be (re)computed, from the workspace state alone: a moved latest
 *  complete period, cells marked dirty by a backfill, KPIs newly in the stored
 *  set, and KPIs that left it. */
export async function planForecastJob(conn: DuckDBConnection): Promise<ForecastJobPlan[]> {
  const tech = await workspaceTechnology(conn)
  const current = (await storedForecastKpis(conn, tech)).map((k) => k.key)
  const plans: ForecastJobPlan[] = []
  for (const grain of STORED_GRAINS) {
    const asOf = await scalar(conn, `SELECT CAST(${latestCompletePeriodSql(grain)} AS VARCHAR)`)
    if (asOf == null) continue
    const storedAsOf = await scalar(conn, `SELECT value FROM workspace_meta WHERE key = ?`, [metaKey(grain)])
    const storedKeys = new Set(
      (await conn.runAndReadAll(`SELECT DISTINCT kpi_key FROM cell_forecasts WHERE grain = ?`, [grain]))
        .getRowObjects().map((x) => String(x.kpi_key))
    )
    const deleteKpiKeys = [...storedKeys].filter((k) => !current.includes(k))
    if (storedAsOf !== asOf) {
      plans.push({ grain, asOf, cellIds: 'all', kpiKeys: current, deleteKpiKeys })
      continue
    }
    const newKeys = current.filter((k) => !storedKeys.has(k))
    if (newKeys.length > 0) plans.push({ grain, asOf, cellIds: 'all', kpiKeys: newKeys, deleteKpiKeys: [] })
    const dirty = (await conn.runAndReadAll(`SELECT CAST(cell_id AS INTEGER) AS c FROM forecast_dirty WHERE grain = ? ORDER BY c`, [grain]))
      .getRowObjects().map((x) => Number(x.c))
    const oldKeys = current.filter((k) => storedKeys.has(k))
    if (dirty.length > 0 && oldKeys.length > 0) plans.push({ grain, asOf, cellIds: dirty, kpiKeys: oldKeys, deleteKpiKeys: [] })
    if (deleteKpiKeys.length > 0) {
      const target = plans.find((p) => p.grain === grain)
      if (target) target.deleteKpiKeys = deleteKpiKeys
      else plans.push({ grain, asOf, cellIds: [], kpiKeys: [], deleteKpiKeys })
    }
  }
  return plans
}

/** Mark the import's cells whose rows fall inside a complete period that
 *  already has stored forecasts (a backfill or correction). Called by the
 *  import with the dates it touched and the cells it staged. */
export async function markForecastDirty(conn: DuckDBConnection, dateIds: number[], cellIds: number[]): Promise<void> {
  if (dateIds.length === 0 || cellIds.length === 0) return
  for (const grain of STORED_GRAINS) {
    const asOf = await scalar(conn, `SELECT value FROM workspace_meta WHERE key = ?`, [metaKey(grain)])
    if (asOf == null) continue
    const periodOf = grain === 'weekly' ? 'week_start' : `CAST(date_trunc('month', date) AS DATE)`
    const inForecast = await scalar(
      conn,
      `SELECT count(*) FROM dim_date WHERE date_id IN (${dateIds.join(',')}) AND ${periodOf} <= DATE '${asOf}'`
    )
    if (Number(inForecast ?? 0) === 0) continue
    await conn.run(
      `INSERT OR IGNORE INTO forecast_dirty (grain, cell_id)
       SELECT '${grain}', cell_id FROM dim_cell WHERE cell_id IN (${cellIds.join(',')})`
    )
  }
}

const dmy = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const epochDay = (iso: string): number => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000)

function staleForecast(lastComplete: string): SeriesForecast {
  return {
    method: null, quality: 'Withheld', points: [], maeByH: [], mase: null, backtestOrigins: 0,
    withheldReason: `no data since ${dmy(lastComplete)}`, bandNote: null
  }
}

/** Run the plans batch by batch. The as-of marker of a grain is written only
 *  after all its plans finished, so a cancelled job is redone next time;
 *  rows already written keep their own as_of. */
export async function runForecastJob(
  conn: DuckDBConnection,
  plans: ForecastJobPlan[],
  runner: ForecastRunner,
  opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {}
): Promise<{ cells: number; series: number; cancelled: boolean }> {
  if (plans.length === 0) return { cells: 0, series: 0, cancelled: false }
  const tech = await workspaceTechnology(conn)
  const kpis = await storedForecastKpis(conn, tech)
  const allCells = (await conn.runAndReadAll(`SELECT CAST(cell_id AS INTEGER) AS c FROM dim_cell ORDER BY c`))
    .getRowObjects().map((x) => Number(x.c))
  const cellsOf = (p: ForecastJobPlan): number[] => (p.cellIds === 'all' ? allCells : p.cellIds)
  const total = plans.reduce((s, p) => s + (p.kpiKeys.length > 0 ? cellsOf(p).length : 0), 0)
  let done = 0
  let series = 0
  opts.onProgress?.(0, total)

  for (const plan of plans) {
    const planKpis = kpis.filter((k) => plan.kpiKeys.includes(k.key))
    const cells = planKpis.length > 0 ? cellsOf(plan) : []
    for (let lo = 0; lo < cells.length; lo += BATCH_CELLS) {
      if (opts.signal?.aborted) return { cells: done, series, cancelled: true }
      const batch = cells.slice(lo, lo + BATCH_CELLS)
      const data = await readCellSeriesBatch(conn, plan.grain, planKpis, batch)
      const jobs: SeriesJob[] = []
      const slots: Array<{ cell: number; kpi: ForecastKpi; job: number | null; stale: string | null }> = []
      for (const cell of batch) {
        const byKpi = data.get(cell)
        for (const kpi of planKpis) {
          const s = byKpi?.get(kpi.key)
          if (!s || s.values.length === 0) continue
          if (s.lastComplete !== plan.asOf) {
            slots.push({ cell, kpi, job: null, stale: s.lastComplete })
            continue
          }
          slots.push({ cell, kpi, job: jobs.length, stale: null })
          jobs.push({
            id: jobs.length,
            values: s.values,
            dates: s.dates,
            opts: { grain: plan.grain, horizon: STORED_HORIZON[plan.grain], domain: domainOf(kpi), periodNoun: PERIOD_NOUN[plan.grain] }
          })
        }
      }
      const results = await runner.run(jobs)
      if (opts.signal?.aborted) return { cells: done, series, cancelled: true }

      const keyList = planKpis.map((k) => `'${k.key.replace(/'/g, "''")}'`).join(',')
      await conn.run(
        `DELETE FROM cell_forecasts WHERE grain = '${plan.grain}' AND kpi_key IN (${keyList}) AND cell_id IN (${batch.join(',')})`
      )
      const app = await conn.createAppender('cell_forecasts')
      const asOfDay = dateValue(epochDay(plan.asOf))
      for (const slot of slots) {
        const f = slot.job == null ? staleForecast(slot.stale!) : results[slot.job]
        app.appendBigInt(BigInt(slot.cell))
        app.appendVarchar(slot.kpi.key)
        app.appendVarchar(plan.grain)
        app.appendDate(asOfDay)
        if (f.method == null) app.appendNull()
        else app.appendVarchar(f.method)
        app.appendVarchar(JSON.stringify({ points: f.points, maeByH: f.maeByH, withheldReason: f.withheldReason, bandNote: f.bandNote }))
        const mae1 = f.maeByH[0]
        if (mae1 == null) app.appendNull()
        else app.appendDouble(mae1)
        if (f.mase == null) app.appendNull()
        else app.appendDouble(f.mase)
        app.appendInteger(f.backtestOrigins)
        app.appendVarchar(f.quality)
        app.endRow()
      }
      app.closeSync()
      series += slots.length
      done += batch.length
      opts.onProgress?.(done, total)
    }
  }

  for (const grain of STORED_GRAINS) {
    const gp = plans.filter((p) => p.grain === grain)
    if (gp.length === 0) continue
    const del = [...new Set(gp.flatMap((p) => p.deleteKpiKeys))]
    if (del.length > 0) {
      await conn.run(
        `DELETE FROM cell_forecasts WHERE grain = '${grain}' AND kpi_key IN (${del.map((k) => `'${k.replace(/'/g, "''")}'`).join(',')})`
      )
    }
    await conn.run(`DELETE FROM forecast_dirty WHERE grain = '${grain}'`)
    await conn.run(
      `INSERT INTO workspace_meta (key, value) VALUES ('${metaKey(grain)}', '${gp[0].asOf}')
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    )
  }
  return { cells: done, series, cancelled: false }
}

/** Stored forecasts of one KPI and grain, by cell. */
export async function readStoredForecasts(
  conn: DuckDBConnection, grain: StoredGrain, kpiKey: string, cellIds: number[] | 'all'
): Promise<Map<number, StoredForecast>> {
  const out = new Map<number, StoredForecast>()
  if (cellIds !== 'all' && cellIds.length === 0) return out
  const r = await conn.runAndReadAll(
    `SELECT CAST(cell_id AS INTEGER) AS cell_id, CAST(as_of AS VARCHAR) AS as_of, method, CAST(points AS VARCHAR) AS points,
            mase, backtest_origins, quality
     FROM cell_forecasts WHERE grain = ? AND kpi_key = ?
     ${cellIds === 'all' ? '' : `AND cell_id IN (${cellIds.join(',')})`}`,
    [grain, kpiKey]
  )
  for (const x of r.getRowObjects()) {
    const p = JSON.parse(String(x.points)) as Pick<SeriesForecast, 'points' | 'maeByH' | 'withheldReason' | 'bandNote'>
    out.set(Number(x.cell_id), {
      asOf: String(x.as_of),
      forecast: {
        method: x.method == null ? null : (String(x.method) as SeriesForecast['method']),
        quality: String(x.quality) as SeriesForecast['quality'],
        points: p.points,
        maeByH: p.maeByH,
        mase: x.mase == null ? null : Number(x.mase),
        backtestOrigins: Number(x.backtest_origins ?? 0),
        withheldReason: p.withheldReason,
        bandNote: p.bandNote
      }
    })
  }
  return out
}
