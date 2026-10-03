import type { DuckDBConnection } from '@duckdb/node-api'
import type {
  ForecastOpts, ForecastResult, ForecastSeries, ForecastSummary, ForecastPoint, ForecastRisk,
  ForecastRiskRow, ForecastScope, Grain, Technology
} from '../../../shared/api'
import { FORECAST_HORIZONS, DEFAULT_HORIZON, PERIOD_NOUN, addPeriods, forecastPeriodLabel } from '../../../shared/forecast'
import { periodLabel } from '../../../shared/periods'
import { getCurrent } from '../workspace/manager'
import { workspaceTechnology } from './kpiService'
import { latestCompletePeriodSql } from '../analytics/periods'
import { forecastSeries, maxBacktestableHorizon, type SeriesForecast } from '../analytics/forecasting/engine'
import { classifyRisk, RISK_RANK } from '../analytics/forecasting/risk'
import {
  forecastableKpis, readDisplaySeries, readOverTargetSeries, readCellSeriesBatch, readCellValuesAt,
  domainOf, scopeCellsSql, type ForecastKpi, type ScopeRef, type PeriodValue
} from '../forecast/series'
import { readStoredForecasts } from '../forecast/job'
import { diagnoseRca } from '../forecast/rca'
import { forecastStatus } from '../forecast/scheduler'

/** Forecasting page and report API (honest-forecasting spec §9): real KPI
 *  series, the engine's backtested forecast, stored per-cell forecasts read
 *  against the current kpi_defs targets, and rule-of-thumb hints. */

const RISK_ROWS_RETURNED = 100
const DAILY_NOTE = 'Per-cell daily risk is available for a site or cell — or switch to weekly'
const NOT_BUILT_NOTE = 'Per-cell forecasts not built — open the workspace writable once'
const RCA_KEYS = ['Capacity Exhaustion', 'RF Overshoot & Interference', 'Hardware & VSWR', 'Parameter & Handover', 'Traffic Surge', 'Normal / Stable', 'No hint']
const AVAILABILITY_KEY: Record<Technology, string> = { '4G': 'availability', '3G': 'availability_3g', '2G': 'tch_availability' }

const r2 = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100)
const dmy = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

function ws() {
  const w = getCurrent()
  if (!w) throw new Error('No workspace is open')
  return w
}

function emptyRiskCounts(): Record<ForecastRisk, number> {
  return { Stable: 0, Watch: 0, 'At Risk': 0, 'Likely Breach': 0, 'Already Breached': 0, Withheld: 0 }
}

function withheld(reason: string): SeriesForecast {
  return { method: null, quality: 'Withheld', points: [], maeByH: [], mase: null, backtestOrigins: 0, withheldReason: reason, bandNote: null }
}

async function scalar(conn: DuckDBConnection, sql: string): Promise<string | null> {
  const r = await conn.runAndReadAll(sql)
  const v = Object.values(r.getRowObjects()[0] ?? {})[0]
  return v == null ? null : String(v)
}

async function entityInfo(conn: DuckDBConnection, s: ScopeRef): Promise<{ name: string; path: string[] }> {
  if (s.scope === 'network' || s.id == null) return { name: 'Network', path: ['Network'] }
  const id = Number(s.id)
  const sql: Record<Exclude<ForecastScope, 'network'>, string> = {
    region: `SELECT NULL AS r, NULL AS d, NULL AS s, name AS n FROM dim_region WHERE region_id = ${id}`,
    district: `SELECT rg.name AS r, NULL AS d, NULL AS s, d.name AS n FROM dim_district d LEFT JOIN dim_region rg USING (region_id) WHERE d.district_id = ${id}`,
    site: `SELECT rg.name AS r, d.name AS d, NULL AS s, s.name AS n FROM dim_site s LEFT JOIN dim_district d USING (district_id)
           LEFT JOIN dim_region rg ON rg.region_id = d.region_id WHERE s.site_id = ${id}`,
    cell: `SELECT rg.name AS r, d.name AS d, s.name AS s, c.name AS n FROM dim_cell c LEFT JOIN dim_site s ON s.site_id = c.site_id
           LEFT JOIN dim_district d ON d.district_id = c.district_id LEFT JOIN dim_region rg ON rg.region_id = c.region_id WHERE c.cell_id = ${id}`
  }
  const x = (await conn.runAndReadAll(sql[s.scope])).getRowObjects()[0]
  if (!x) throw new Error(`No ${s.scope} with id ${id}`)
  const path = [x.r, x.d, x.s, x.n].filter((v): v is string => v != null && v !== '').map(String)
  return { name: String(x.n ?? ''), path }
}

function summaryOf(f: SeriesForecast, horizon: number, growthPct: number | null): ForecastSummary {
  return {
    method: f.method,
    quality: f.quality,
    maeH1: r2(f.maeByH[0]),
    maeH: r2(f.maeByH[horizon - 1]),
    mase: f.mase == null ? null : Math.round(f.mase * 1000) / 1000,
    betterThanNaivePct: f.method == null ? null : f.method === 'naive' ? 0 : Math.round((1 - (f.mase ?? 1)) * 100),
    backtestOrigins: f.backtestOrigins,
    withheldReason: f.withheldReason,
    bandNote: f.bandNote,
    growthPct
  }
}

/** Forecast a display series: complete points fitted, stale series withheld. */
function forecastDisplay(
  display: PeriodValue[], grain: Grain, horizon: number, asOf: string | null, kpi: ForecastKpi | null
): { forecast: SeriesForecast; complete: PeriodValue[] } {
  const complete = display.filter((p) => p.complete && p.value != null)
  const noun = PERIOD_NOUN[grain].many
  if (asOf == null) return { forecast: withheld(`needs ≥ 4 complete ${noun}, has 0`), complete }
  const last = complete[complete.length - 1]
  if (last && last.period !== asOf) return { forecast: withheld(`no data since ${dmy(last.period)}`), complete }
  const f = forecastSeries(
    complete.map((p) => p.value as number),
    complete.map((p) => p.period),
    { grain, horizon, domain: kpi ? domainOf(kpi) : 'nonNegative', periodNoun: noun }
  )
  return { forecast: f, complete }
}

function buildSeries(
  key: string, label: string, unit: string, worseIsHigher: boolean, threshold: number | null,
  display: PeriodValue[], f: SeriesForecast, complete: PeriodValue[], grain: Grain, horizon: number, growthPct: number | null
): ForecastSeries {
  const points: ForecastPoint[] = display.map((p) => ({
    weekStart: p.period,
    label: periodLabel(forecastPeriodLabel(p.period, grain), grain, p.period, p),
    value: r2(p.value),
    kind: 'actual',
    lower: null,
    upper: null,
    complete: p.complete,
    daysWithData: p.daysWithData
  }))
  const base = complete[complete.length - 1]?.period
  if (base) {
    for (const hp of f.points.filter((x) => x.h <= horizon)) {
      const period = addPeriods(base, hp.h, grain)
      points.push({
        weekStart: period, label: forecastPeriodLabel(period, grain), value: r2(hp.value), kind: 'forecast',
        lower: r2(hp.lower), upper: r2(hp.upper), complete: true, daysWithData: 0
      })
    }
  }
  return { metric: key, label, unit, worseIsHigher, threshold, points, forecast: summaryOf(f, horizon, growthPct) }
}

async function previousCompletePeriods(conn: DuckDBConnection, grain: Grain, asOf: string, n: number): Promise<string[]> {
  const sql = grain === 'daily'
    ? `SELECT CAST(d.date AS VARCHAR) AS p FROM coverage_daily c JOIN dim_date d USING (date_id) WHERE d.date < DATE '${asOf}' ORDER BY d.date DESC LIMIT ${n}`
    : `SELECT CAST(period_start AS VARCHAR) AS p FROM period_coverage WHERE grain = '${grain}' AND is_complete AND period_start < DATE '${asOf}' ORDER BY period_start DESC LIMIT ${n}`
  return (await conn.runAndReadAll(sql)).getRowObjects().map((x) => String(x.p))
}

export async function getForecast(opts: ForecastOpts = {}): Promise<ForecastResult> {
  const cur = ws()
  const conn = cur.connection
  const technology: Technology = opts.technology ?? (await workspaceTechnology(conn))
  const grain: Grain = opts.grain === 'daily' || opts.grain === 'monthly' ? opts.grain : 'weekly'
  const scope: ForecastScope = opts.scope ?? 'network'
  const scopeRef: ScopeRef = { scope, id: scope === 'network' ? null : opts.entityId ?? null }
  const entity = await entityInfo(conn, scopeRef)
  const status = forecastStatus()
  const noun = PERIOD_NOUN[grain]

  const { available, notImported } = await forecastableKpis(conn, technology, scopeRef)
  const isStored = (k: ForecastKpi): boolean => k.target != null || k.capacity
  const metrics = available.map((k) => ({ key: k.key, label: k.label, unit: k.unit, hasTarget: k.target != null, stored: isStored(k) }))
  const base = {
    grain, technology, entity: { scope, id: scopeRef.id, ...entity }, metrics, notImported, status,
    rcaCounts: Object.fromEntries(RCA_KEYS.map((k) => [k, 0])) as Record<string, number>
  }

  const kpi = available.find((k) => k.key === opts.metric) ?? available.find((k) => k.target != null) ?? available[0]
  if (!kpi) {
    return {
      ...base, asOf: null, horizon: opts.horizon ?? DEFAULT_HORIZON[grain], metric: opts.metric ?? '', series: null,
      overTarget: null, horizons: FORECAST_HORIZONS[grain].map((h) => ({ horizon: h, available: false, reason: 'no KPI imported' })),
      risk: null, riskExplanation: 'No KPI has imported values for this scope.', riskCounts: emptyRiskCounts(),
      riskRows: [], totalEntities: 0, riskTableNote: null
    }
  }

  const asOf = await scalar(conn, `SELECT CAST(${latestCompletePeriodSql(grain)} AS VARCHAR)`)
  const display = await readDisplaySeries(conn, grain, kpi, scopeRef)
  const n = display.filter((p) => p.complete && p.value != null).length
  const horizons = FORECAST_HORIZONS[grain].map((h) => ({
    horizon: h,
    available: h <= maxBacktestableHorizon(n),
    reason: h <= maxBacktestableHorizon(n) ? null : `needs ≥ ${h + 3} complete ${noun.many}`
  }))
  const requested = FORECAST_HORIZONS[grain].includes(Number(opts.horizon)) ? Number(opts.horizon) : DEFAULT_HORIZON[grain]
  const availableHs = horizons.filter((h) => h.available).map((h) => h.horizon)
  const horizon = availableHs.includes(requested) || availableHs.length === 0
    ? requested
    : Math.max(...availableHs.filter((h) => h <= requested), availableHs[0])

  // aggregate (or single-cell) series
  const main = forecastDisplay(display, grain, horizon, asOf, kpi)
  const latestAgg = main.complete[main.complete.length - 1]?.value ?? null
  const aggRisk = classifyRisk({
    latest: latestAgg, target: kpi.target, worseIsHigher: kpi.worseIsHigher, forecast: main.forecast,
    horizon, label: kpi.label, unit: kpi.unit
  })
  const series = buildSeries(kpi.key, kpi.label, kpi.unit, kpi.worseIsHigher, kpi.target, display, main.forecast, main.complete, grain, horizon, aggRisk.growthPct)

  let overTarget: ForecastSeries | null = null
  if (scope !== 'cell') {
    const over = await readOverTargetSeries(conn, grain, kpi, scopeRef)
    if (over) {
      const o = forecastDisplay(over, grain, horizon, asOf, null)
      overTarget = buildSeries(`${kpi.key}:over_target`, `Cells past the ${kpi.label} target`, 'cells', true, null, over, o.forecast, o.complete, grain, horizon, null)
    }
  }

  // per-cell risk rows
  const riskCounts = emptyRiskCounts()
  const rcaCounts = base.rcaCounts
  let riskRows: ForecastRiskRow[] = []
  let riskTableNote: string | null = null
  const smallScope = scope === 'cell' || scope === 'site'
  let perCell: Map<number, SeriesForecast> | null = null

  if (asOf == null) {
    riskTableNote = `No complete ${noun.one} yet — per-cell forecasts start once a ${noun.one} is complete`
  } else if (grain === 'daily' && !smallScope) {
    riskTableNote = DAILY_NOTE
  } else if (grain !== 'daily' && isStored(kpi)) {
    const cellIds = (await conn.runAndReadAll(`SELECT CAST(cell_id AS INTEGER) AS c FROM (${scopeCellsSql(scopeRef)})`))
      .getRowObjects().map((x) => Number(x.c))
    const stored = await readStoredForecasts(conn, grain, kpi.key, cellIds)
    if (stored.size > 0) {
      perCell = new Map([...stored].map(([c, s]) => [c, s.forecast]))
    } else if (cur.readOnly) {
      riskTableNote = NOT_BUILT_NOTE
    } else if (status.running) {
      riskTableNote = `Forecasts updating — ${status.done.toLocaleString('en-US')} of ${status.total.toLocaleString('en-US')} cells`
    } else if (!smallScope) {
      riskTableNote = 'Per-cell forecasts not built yet — they are computed in the background after an import'
    }
  } else if (!smallScope) {
    riskTableNote = `Per-cell forecasts for ${kpi.label} are available for a site or cell — it has no target`
  }

  if (!perCell && riskTableNote == null && asOf != null) {
    // on demand: small scopes (daily, untargeted KPIs, or nothing stored yet)
    const cellIds = (await conn.runAndReadAll(`SELECT CAST(cell_id AS INTEGER) AS c FROM (${scopeCellsSql(scopeRef)})`))
      .getRowObjects().map((x) => Number(x.c))
    const batch = await readCellSeriesBatch(conn, grain, [kpi], cellIds)
    perCell = new Map()
    for (const [cell, m] of batch) {
      const s = m.get(kpi.key)
      if (!s || s.values.length === 0) continue
      perCell.set(cell, s.lastComplete !== asOf
        ? withheld(`no data since ${dmy(s.lastComplete!)}`)
        : forecastSeries(s.values, s.dates, { grain, horizon, domain: domainOf(kpi), periodNoun: noun.many }))
    }
  }

  if (perCell && asOf != null) {
    const byKey = new Map(available.map((k) => [k.key, k]))
    const ctxKeys = [kpi.key, AVAILABILITY_KEY[technology], 'prb_utilization', 'data_volume', 'connected_users']
    const ctxKpis = [...new Set(ctxKeys)].map((k) => byKey.get(k)).filter((k): k is ForecastKpi => k != null)
    const prior = await previousCompletePeriods(conn, grain, asOf, 4)
    const values = await readCellValuesAt(conn, grain, ctxKpis, scopeRef, [asOf, ...prior])
    const names = new Map(
      (await conn.runAndReadAll(
        `SELECT CAST(c.cell_id AS INTEGER) AS id, c.name AS n, rg.name AS r, d.name AS d, s.name AS s
         FROM dim_cell c LEFT JOIN dim_site s ON s.site_id = c.site_id LEFT JOIN dim_district d ON d.district_id = c.district_id
         LEFT JOIN dim_region rg ON rg.region_id = c.region_id WHERE c.cell_id IN (${scopeCellsSql(scopeRef)})`
      )).getRowObjects().map((x) => [Number(x.id), x])
    )
    const kpiMap = Object.fromEntries(ctxKpis.map((k) => [k.key, k]))
    for (const [cell, f] of perCell) {
      const v = values.get(cell)
      const latest: Record<string, number | null> = {}
      const priorMean: Record<string, number | null> = {}
      for (const k of ctxKpis) {
        const byPeriod = v?.get(k.key)
        latest[k.key] = byPeriod?.get(asOf) ?? null
        const pv = prior.map((p) => byPeriod?.get(p)).filter((x): x is number => x != null)
        priorMean[k.key] = pv.length > 0 ? pv.reduce((a, b) => a + b, 0) / pv.length : null
      }
      const cls = classifyRisk({
        latest: latest[kpi.key], target: kpi.target, worseIsHigher: kpi.worseIsHigher, forecast: f,
        horizon, label: kpi.label, unit: kpi.unit
      })
      const rca = diagnoseRca({ tech: technology, selected: kpi, risk: cls.risk, latest, priorMean, kpis: kpiMap })
      const nm = names.get(cell)
      const atH = f.points.filter((p) => p.h <= horizon).pop()
      riskRows.push({
        id: cell,
        name: String(nm?.n ?? cell),
        path: [nm?.r, nm?.d, nm?.s].filter((x): x is string => x != null && x !== '').map(String),
        current: r2(latest[kpi.key]),
        forecast: r2(atH?.value),
        threshold: kpi.target,
        risk: cls.risk,
        growthPct: cls.growthPct,
        explanation: cls.explanation,
        withheld: f.quality === 'Withheld',
        hint: rca.hint,
        hintNote: rca.hintNote
      })
      if (cls.risk) riskCounts[cls.risk]++
      rcaCounts[rca.hint?.category ?? 'No hint'] = (rcaCounts[rca.hint?.category ?? 'No hint'] ?? 0) + 1
    }
    riskRows.sort((a, b) => {
      const d = (a.risk ? RISK_RANK[a.risk] : 9) - (b.risk ? RISK_RANK[b.risk] : 9)
      if (d !== 0) return d
      return (b.current ?? -Infinity) - (a.current ?? -Infinity)
    })
  }
  const totalEntities = riskRows.length
  riskRows = riskRows.slice(0, RISK_ROWS_RETURNED)

  return {
    ...base,
    asOf,
    horizon,
    metric: kpi.key,
    series,
    overTarget,
    horizons,
    risk: aggRisk.risk,
    riskExplanation: aggRisk.explanation,
    riskCounts,
    rcaCounts,
    riskRows,
    totalEntities,
    riskTableNote
  }
}
