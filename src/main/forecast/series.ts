import type { DuckDBConnection } from '@duckdb/node-api'
import type { Technology } from '../../../shared/api'
import type { UnitDomain } from '../analytics/forecasting/engine'
import { periodCoverageJoin, completeSql, daysWithDataSql } from '../analytics/periods'

/** Real KPI series for forecasting (honest-forecasting spec §4). Every value
 *  is an imported value aggregated by the KPI's own `kpi_defs.agg`; nothing is
 *  filled in. Fitting reads complete periods only; display series also carry
 *  the partial period, marked. */

export type CoreColumn = 'prb_avg' | 'connected_users_sum' | 'data_volume_mb_sum' | 'dl_throughput_kbps_avg' | 'availability_pct_avg'
export type SeriesGrain = 'daily' | 'weekly' | 'monthly'
export type KpiAgg = 'avg' | 'sum' | 'max' | 'min'

export interface ForecastKpi {
  key: string
  label: string
  unit: string
  worseIsHigher: boolean
  target: number | null
  agg: KpiAgg
  decimals: number
  capacity: boolean
  isCore: boolean
  source: { kind: 'kpi'; kpiId: number } | { kind: 'core'; column: CoreColumn }
}

export interface ScopeRef { scope: 'network' | 'region' | 'district' | 'site' | 'cell'; id: number | null }
export interface PeriodValue { period: string; value: number | null; complete: boolean; daysWithData: number }
export interface CellSeries { values: number[]; dates: string[]; lastComplete: string | null }

export const CAPACITY_KEYS: Record<Technology, string[]> = {
  '4G': ['connected_users', 'data_volume', 'dl_throughput', 'availability'],
  '3G': ['connected_users', 'data_volume', 'hsdpa_throughput', 'availability_3g'],
  '2G': ['connected_users', 'gprs_throughput', 'tch_availability']
}

/** Core columns of agg_cell_* that hold a KPI's imported value when the KPI has
 *  no values of its own. Only mappings whose import field is unambiguous for the
 *  technology (src/main/import/mapping.ts, checked 2026-10-03): the `prb` field
 *  also takes 3G CE/power utilisation and 2G TCH/SDCCH congestion, and `users`
 *  also takes 2G Erlang, so those are 4G-only / not-2G. */
export const CORE_COLUMN_FALLBACK: Record<Technology, Record<string, CoreColumn>> = {
  '4G': {
    prb_utilization: 'prb_avg',
    connected_users: 'connected_users_sum',
    data_volume: 'data_volume_mb_sum',
    dl_throughput: 'dl_throughput_kbps_avg',
    availability: 'availability_pct_avg'
  },
  '3G': {
    connected_users: 'connected_users_sum',
    data_volume: 'data_volume_mb_sum',
    hsdpa_throughput: 'dl_throughput_kbps_avg',
    availability_3g: 'availability_pct_avg'
  },
  '2G': {
    gprs_throughput: 'dl_throughput_kbps_avg',
    tch_availability: 'availability_pct_avg'
  }
}

/** How each core column is already aggregated over a period in agg_cell_*. */
const CORE_NATURAL: Record<CoreColumn, 'avg' | 'sum'> = {
  prb_avg: 'avg',
  connected_users_sum: 'sum',
  data_volume_mb_sum: 'sum',
  dl_throughput_kbps_avg: 'avg',
  availability_pct_avg: 'avg'
}
const FACT_COLUMN: Record<CoreColumn, string> = {
  prb_avg: 'prb_utilization',
  connected_users_sum: 'connected_users',
  data_volume_mb_sum: 'data_volume_mb',
  dl_throughput_kbps_avg: 'dl_throughput_kbps',
  availability_pct_avg: 'availability_pct'
}

export function domainOf(kpi: ForecastKpi): UnitDomain {
  return kpi.unit === '%' ? 'percent' : 'nonNegative'
}

/** Aggregate across cells: total for sum KPIs and for users, else the mean. */
function crossCellAgg(kpi: ForecastKpi): 'sum' | 'avg' {
  return kpi.agg === 'sum' || kpi.key === 'connected_users' ? 'sum' : 'avg'
}

function tables(grain: SeriesGrain): { core: string; kpi: string; period: string } {
  if (grain === 'daily') return { core: 'agg_cell_daily', kpi: 'agg_cell_kpi_daily', period: 'date' }
  if (grain === 'monthly') return { core: 'agg_cell_monthly', kpi: 'agg_cell_kpi_monthly', period: 'month_start' }
  return { core: 'agg_cell_weekly', kpi: 'agg_cell_kpi_weekly', period: 'week_start' }
}

/** SQL for the cells of a scope. */
export function scopeCellsSql(s: ScopeRef): string {
  const id = s.id != null && Number.isFinite(Number(s.id)) ? Number(s.id) : null
  if (s.scope === 'network' || id == null) return `SELECT cell_id FROM dim_cell`
  const col = s.scope === 'region' ? 'region_id' : s.scope === 'district' ? 'district_id' : s.scope === 'site' ? 'site_id' : 'cell_id'
  return `SELECT cell_id FROM dim_cell WHERE ${col} = ${id}`
}

/** Value of a KPI-source row (alias w) by the KPI's agg. */
function kpiValueSql(agg: KpiAgg, w = 'w'): string {
  return agg === 'sum' ? `${w}.sum_value` : agg === 'max' ? `${w}.max_value` : agg === 'min' ? `${w}.min_value` : `${w}.avg_value`
}

/** Value of a core-source row (alias w) by the KPI's agg; null when not derivable. */
function coreValueSql(col: CoreColumn, agg: KpiAgg, w = 'w'): string | null {
  const nat = CORE_NATURAL[col]
  if (agg === nat) return `${w}.${col}`
  if (agg === 'avg' && nat === 'sum') return `${w}.${col} / NULLIF(${w}.observed_days, 0)`
  if (agg === 'sum' && nat === 'avg') return `${w}.${col} * ${w}.observed_days`
  return null
}

function valueSql(kpi: ForecastKpi, w = 'w'): string {
  return kpi.source.kind === 'kpi' ? kpiValueSql(kpi.agg, w) : coreValueSql(kpi.source.column, kpi.agg, w)!
}

/** FROM … JOIN period_coverage … WHERE <kpi filter> for one KPI's rows (alias w). */
function fromWhereSql(kpi: ForecastKpi, grain: SeriesGrain): string {
  const t = tables(grain)
  const table = kpi.source.kind === 'kpi' ? t.kpi : t.core
  const filter = kpi.source.kind === 'kpi' ? `w.kpi_id = ${kpi.source.kpiId} AND ` : ''
  return `FROM ${table} w ${periodCoverageJoin(grain, `w.${t.period}`)} WHERE ${filter}`
}

/** Active KPIs of the technology with imported values in scope. KPIs that have
 *  a target or are capacity KPIs but have no values are listed as not imported;
 *  other counters without values are simply not offered. */
export async function forecastableKpis(
  conn: DuckDBConnection, tech: Technology, scope: ScopeRef
): Promise<{ available: ForecastKpi[]; notImported: Array<{ key: string; label: string }> }> {
  const defs = await conn.runAndReadAll(
    `SELECT CAST(kpi_id AS INTEGER) AS kpi_id, kpi_key, label, unit, worse_is_higher, target, agg,
            decimal_precision, is_core
     FROM kpi_defs WHERE technology = ? AND active
     ORDER BY is_core DESC, sort_order, kpi_key`,
    [tech]
  )
  const cells = scopeCellsSql(scope)
  const withValues = new Set(
    (await conn.runAndReadAll(
      `SELECT DISTINCT CAST(kpi_id AS INTEGER) AS kpi_id FROM fact_extra_metrics WHERE cell_id IN (${cells})`
    )).getRowObjects().map((x) => Number(x.kpi_id))
  )
  const fallback = CORE_COLUMN_FALLBACK[tech]
  const coreCols = [...new Set(Object.values(fallback))]
  const coreCounts = new Map<CoreColumn, number>()
  if (coreCols.length > 0) {
    const r = await conn.runAndReadAll(
      `SELECT ${coreCols.map((c) => `count(${FACT_COLUMN[c]}) AS ${c}`).join(', ')}
       FROM fact_cell_daily WHERE cell_id IN (${cells})`
    )
    const row = r.getRowObjects()[0] ?? {}
    for (const c of coreCols) coreCounts.set(c, Number(row[c] ?? 0))
  }

  const available: ForecastKpi[] = []
  const notImported: Array<{ key: string; label: string }> = []
  for (const x of defs.getRowObjects()) {
    const key = String(x.kpi_key)
    const agg = (String(x.agg) as KpiAgg) ?? 'avg'
    const base = {
      key,
      label: String(x.label),
      unit: String(x.unit ?? ''),
      worseIsHigher: Boolean(x.worse_is_higher),
      target: x.target == null ? null : Number(x.target),
      agg,
      decimals: Number(x.decimal_precision ?? 1),
      capacity: CAPACITY_KEYS[tech].includes(key),
      isCore: Boolean(x.is_core)
    }
    const kpiId = Number(x.kpi_id)
    const col = fallback[key]
    if (withValues.has(kpiId)) {
      available.push({ ...base, source: { kind: 'kpi', kpiId } })
    } else if (col && (coreCounts.get(col) ?? 0) > 0 && coreValueSql(col, agg) != null) {
      available.push({ ...base, source: { kind: 'core', column: col } })
    } else if (base.target != null || base.capacity) {
      notImported.push({ key, label: base.label })
    }
  }
  return { available, notImported }
}

const epochDaySql = (expr: string): string => `CAST(epoch(CAST(${expr} AS DATE)) / 86400 AS INTEGER)`
const isoFromEpochDay = (d: number): string => new Date(d * 86400000).toISOString().slice(0, 10)

/** Complete-period series per cell and KPI for a batch of cells. Reads numeric
 *  columns only (no per-row objects) so large batches stay cheap. */
export async function readCellSeriesBatch(
  conn: DuckDBConnection, grain: SeriesGrain, kpis: ForecastKpi[], cellIds: number[]
): Promise<Map<number, Map<string, CellSeries>>> {
  const out = new Map<number, Map<string, CellSeries>>()
  if (cellIds.length === 0 || kpis.length === 0) return out
  const t = tables(grain)
  const ids = cellIds.join(',')
  const complete =
    grain === 'daily' ? '' : `JOIN period_coverage pc ON pc.grain = '${grain}' AND pc.period_start = w.${t.period} AND pc.is_complete`
  const push = (cell: number, key: string, day: number, v: number): void => {
    let m = out.get(cell)
    if (!m) out.set(cell, (m = new Map()))
    let s = m.get(key)
    if (!s) m.set(key, (s = { values: [], dates: [], lastComplete: null }))
    const iso = isoFromEpochDay(day)
    s.values.push(v)
    s.dates.push(iso)
    s.lastComplete = iso
  }

  // KPI-source series: one query, numeric columns, ordered by cell, kpi, period
  const kpiSrc = kpis.filter((k) => k.source.kind === 'kpi')
  if (kpiSrc.length > 0) {
    const keyOf = new Map(kpiSrc.map((k) => [(k.source as { kpiId: number }).kpiId, k]))
    const valueCase = `CASE ${kpiSrc.map((k) => `WHEN w.kpi_id = ${(k.source as { kpiId: number }).kpiId} THEN ${kpiValueSql(k.agg)}`).join(' ')} END`
    const r = await conn.runAndReadAll(
      `SELECT CAST(w.cell_id AS INTEGER), CAST(w.kpi_id AS INTEGER), ${epochDaySql(`w.${t.period}`)}, CAST(${valueCase} AS DOUBLE) AS v
       FROM ${t.kpi} w ${complete}
       WHERE w.cell_id IN (${ids}) AND w.kpi_id IN (${[...keyOf.keys()].join(',')})
       ORDER BY 1, 2, 3`
    )
    const [cellCol, kpiCol, dayCol, valCol] = r.getColumns() as unknown as [number[], number[], number[], Array<number | null>]
    for (let i = 0; i < valCol.length; i++) {
      const v = valCol[i]
      if (v == null || !Number.isFinite(v)) continue
      push(cellCol[i], keyOf.get(kpiCol[i])!.key, dayCol[i], v)
    }
  }

  // core-source series: one query, one value column per KPI
  const coreSrc = kpis.filter((k) => k.source.kind === 'core')
  if (coreSrc.length > 0) {
    const r = await conn.runAndReadAll(
      `SELECT CAST(w.cell_id AS INTEGER), ${epochDaySql(`w.${t.period}`)},
              ${coreSrc.map((k) => `CAST(${valueSql(k)} AS DOUBLE)`).join(', ')}
       FROM ${t.core} w ${complete}
       WHERE w.cell_id IN (${ids})
       ORDER BY 1, 2`
    )
    const cols = r.getColumns() as unknown as Array<Array<number | null>>
    for (let i = 0; i < cols[0].length; i++) {
      for (let k = 0; k < coreSrc.length; k++) {
        const v = cols[2 + k][i]
        if (v == null || !Number.isFinite(v)) continue
        push(cols[0][i] as number, coreSrc[k].key, cols[1][i] as number, v)
      }
    }
  }
  return out
}

/** One value per period for the scope (partial periods included, marked). */
export async function readDisplaySeries(
  conn: DuckDBConnection, grain: SeriesGrain, kpi: ForecastKpi, scope: ScopeRef
): Promise<PeriodValue[]> {
  const t = tables(grain)
  const agg = crossCellAgg(kpi)
  const r = await conn.runAndReadAll(
    `SELECT CAST(p AS VARCHAR) AS p, ${agg}(v) AS v, any_value(complete) AS complete, any_value(days) AS days
     FROM (
       SELECT w.${t.period} AS p, ${valueSql(kpi)} AS v,
              ${completeSql(grain)} AS complete, ${daysWithDataSql(grain)} AS days
       ${fromWhereSql(kpi, grain)} w.cell_id IN (${scopeCellsSql(scope)})
     ) x
     WHERE v IS NOT NULL
     GROUP BY p ORDER BY p`
  )
  return r.getRowObjects().map((x) => ({
    period: String(x.p),
    value: x.v == null ? null : Number(x.v),
    complete: Boolean(x.complete),
    daysWithData: Number(x.days)
  }))
}

/** Number of cells past target per period; null when the KPI has no target. */
export async function readOverTargetSeries(
  conn: DuckDBConnection, grain: SeriesGrain, kpi: ForecastKpi, scope: ScopeRef
): Promise<PeriodValue[] | null> {
  if (kpi.target == null) return null
  const t = tables(grain)
  const past = kpi.worseIsHigher ? `v > ${kpi.target}` : `v < ${kpi.target}`
  const r = await conn.runAndReadAll(
    `SELECT CAST(p AS VARCHAR) AS p, count(*) FILTER (WHERE ${past}) AS v,
            any_value(complete) AS complete, any_value(days) AS days
     FROM (
       SELECT w.${t.period} AS p, ${valueSql(kpi)} AS v,
              ${completeSql(grain)} AS complete, ${daysWithDataSql(grain)} AS days
       ${fromWhereSql(kpi, grain)} w.cell_id IN (${scopeCellsSql(scope)})
     ) x
     WHERE v IS NOT NULL
     GROUP BY p ORDER BY p`
  )
  return r.getRowObjects().map((x) => ({
    period: String(x.p),
    value: Number(x.v),
    complete: Boolean(x.complete),
    daysWithData: Number(x.days)
  }))
}
