import type { DuckDBConnection } from '@duckdb/node-api'
import { getCurrent } from '../workspace/manager'
import type {
  Summary, NcLifecycleResult, NcLifecycleRow, NcMovementRow, PriorityMode, PriorityRow,
  HealthResult, CellHealthRow, HealthScope, HealthMatrixResult,
  CellIntelligenceResult, CellIntelligenceRow, CellDetail, CellWeekPoint, Lifecycle,
  Trend, Severity,  Rules, RulesPatch, PerformanceResult, MetricDistribution,
  ScatterPoint, ScatterQuadrant, CorrelationRow, PerfMetric,
  ComparisonResult, ComparisonKpi, ComparisonRow, ComparisonType,
  CompareScope, CompareMetric, NcTransition,
  ExplorerLevel, ExplorerResult, ExplorerNode, ExplorerBreadcrumb,
  RegionMapRow, DistrictMapRow,
  InvestigationScope, ActionStatus, PriorityBand, PriorityCenterOpts,
  PriorityCenterResult, PriorityCenterRow, ForecastMetric, ForecastHorizon,
  ForecastRisk, ForecastResult, ForecastRiskRow, ForecastSeries, ForecastPoint,
  ForecastScope, CellKpiValue
} from '../../../shared/api'
import { PRIORITY_MODES } from '../../../shared/api'
import { computeNetworkHealth } from '../analytics/health'
import { getRules, updateRules } from '../analytics/rules'
import { forecastSeries, classifyRisk } from '../analytics/forecast'

/** Spec §64: UI modules call centralized analytics interfaces, not raw SQL. */

function ws() {
  const w = getCurrent()
  if (!w) throw new Error('No workspace is open')
  return w
}

const LIFECYCLES = ['Healthy', 'New NC', 'Recurring NC', 'Persistent NC', 'Recovering'] as const
const TRENDS = ['Improving', 'Stable', 'Worsening'] as const
const SEVERITIES = ['Normal', 'Watch', 'High', 'Critical'] as const

export async function getRulesCurrent(): Promise<Rules | null> {
  const w = getCurrent()
  if (!w) return null
  return getRules(w.connection)
}

export async function updateRulesCurrent(patch: RulesPatch): Promise<Rules> {
  return updateRules(ws().connection, patch)
}

/** Weekly NC movement (spec §28): lifecycle counts per week, newest last. */
export async function getNcMovement(limit = 8): Promise<NcMovementRow[]> {
  const conn = ws().connection
  const r = await conn.runAndReadAll(`
    SELECT CAST(period_start AS VARCHAR) AS week_start,
      count(*) FILTER (WHERE lifecycle = 'New NC') AS new_nc,
      count(*) FILTER (WHERE lifecycle = 'Recurring NC') AS recurring,
      count(*) FILTER (WHERE lifecycle = 'Persistent NC') AS persistent,
      count(*) FILTER (WHERE lifecycle = 'Recovering') AS recovering,
      count(*) FILTER (WHERE is_nc) AS nc_cells,
      count(*) AS total_cells
    FROM cell_nc_lifecycle
    WHERE grain = 'weekly'
      AND ruleset_version = (SELECT max(version) FROM ruleset)
    GROUP BY period_start
    ORDER BY period_start DESC
    LIMIT ?
  `, [limit])
  return r
    .getRowObjects()
    .reverse()
    .map((x) => {
      const total = Number(x.total_cells ?? 0)
      const nc = Number(x.nc_cells ?? 0)
      return {
        weekStart: String(x.week_start),
        newNc: Number(x.new_nc ?? 0),
        recurring: Number(x.recurring ?? 0),
        persistent: Number(x.persistent ?? 0),
        recovering: Number(x.recovering ?? 0),
        ncCells: nc,
        totalCells: total,
        ncRate: total > 0 ? Math.round((nc / total) * 1000) / 10 : null
      }
    })
}

/** Latest completed week's lifecycle/trend/severity summary + per-cell rows. */
export async function getNcLifecycle(): Promise<NcLifecycleResult> {
  const conn = ws().connection
  const rules = await getRules(conn)
  const empty: NcLifecycleResult = {
    weekStart: null,
    totalCells: 0,
    ncCells: 0,
    ncRate: null,
    byLifecycle: { Healthy: 0, 'New NC': 0, 'Recurring NC': 0, 'Persistent NC': 0, Recovering: 0 },
    byTrend: { Improving: 0, Stable: 0, Worsening: 0 },
    bySeverity: { Normal: 0, Watch: 0, High: 0, Critical: 0 },
    cells: []
  }
  if (!rules) return empty
  const r = await conn.runAndReadAll(`
    SELECT CAST(l.period_start AS VARCHAR) AS period_start,
      CAST(l.cell_id AS DOUBLE) AS cell_id, c.name AS cell_name,
      s.name AS site, d.name AS district, rg.name AS region,
      l.is_nc, l.lifecycle, l.trend, l.severity,
      CAST(l.breach_days AS DOUBLE) AS breach_days, l.prb_avg
    FROM cell_nc_lifecycle l
    JOIN dim_cell c ON c.cell_id = l.cell_id
    LEFT JOIN dim_site s ON s.site_id = c.site_id
    LEFT JOIN dim_district d ON d.district_id = c.district_id
    LEFT JOIN dim_region rg ON rg.region_id = c.region_id
    WHERE l.ruleset_version = ${rules.version} AND l.grain = 'weekly'
      AND l.period_start = (SELECT max(period_start) FROM cell_nc_lifecycle WHERE grain = 'weekly')
    ORDER BY l.severity DESC, l.lifecycle, c.name
  `)
  const cells: NcLifecycleRow[] = r.getRowObjects().map((x) => ({
    cellId: Number(x.cell_id),
    cellName: String(x.cell_name ?? ''),
    site: x.site ? String(x.site) : null,
    district: x.district ? String(x.district) : null,
    region: x.region ? String(x.region) : null,
    weekStart: String(x.period_start ?? ''),
    isNc: Boolean(x.is_nc),
    lifecycle: String(x.lifecycle) as NcLifecycleRow['lifecycle'],
    trend: String(x.trend) as NcLifecycleRow['trend'],
    severity: String(x.severity) as NcLifecycleRow['severity'],
    breachDays: Number(x.breach_days ?? 0),
    prbAvg: x.prb_avg == null ? null : Number(x.prb_avg)
  }))
  const weekStart = cells.length > 0 ? cells[0].weekStart : null
  const byLifecycle = { Healthy: 0, 'New NC': 0, 'Recurring NC': 0, 'Persistent NC': 0, Recovering: 0 }
  const byTrend = { Improving: 0, Stable: 0, Worsening: 0 }
  const bySeverity = { Normal: 0, Watch: 0, High: 0, Critical: 0 }
  let ncCells = 0
  for (const c of cells) {
    byLifecycle[c.lifecycle]++
    byTrend[c.trend]++
    bySeverity[c.severity]++
    if (c.isNc) ncCells++
  }
  return {
    weekStart,
    totalCells: cells.length,
    ncCells,
    ncRate: cells.length > 0 ? Math.round((ncCells / cells.length) * 1000) / 10 : null,
    byLifecycle,
    byTrend,
    bySeverity,
    cells
  }
}

/** Current priority queue for one mode, worst first (latest completed week). */
export async function getPriorityQueue(mode: PriorityMode, limit = 50): Promise<PriorityRow[]> {
  const conn = ws().connection
  if (!PRIORITY_MODES.includes(mode)) throw new Error(`Unknown priority mode: ${mode}`)
  const r = await conn.runAndReadAll(`
    SELECT CAST(p.cell_id AS DOUBLE) AS cell_id, c.name AS cell_name,
      s.name AS site, d.name AS district, rg.name AS region,
      CAST(p.as_of AS VARCHAR) AS as_of, p.score, p.band, p.mode, p.weights
    FROM cell_priority_history p
    JOIN dim_cell c ON c.cell_id = p.cell_id
    LEFT JOIN dim_site s ON s.site_id = c.site_id
    LEFT JOIN dim_district d ON d.district_id = c.district_id
    LEFT JOIN dim_region rg ON rg.region_id = c.region_id
    WHERE p.mode = ? AND p.as_of = (
      SELECT max(as_of) FROM cell_priority_history WHERE mode = ?
    )
    ORDER BY p.score DESC, p.cell_id
    LIMIT ?
  `, [mode, mode, limit])
  return r.getRowObjects().map((x) => {
    let components = {
      prbSeverity: 0, persistence: 0, userImpact: 0, trafficImpact: 0,
      throughputDegradation: 0, worseningTrend: 0, kpiBreach: 0
    }
    try {
      const parsed = JSON.parse(String(x.weights ?? '{}'))
      components = { ...components, ...parsed }
    } catch {
      /* ignore */
    }
    return {
      cellId: Number(x.cell_id),
      cellName: String(x.cell_name ?? ''),
      site: x.site ? String(x.site) : null,
      district: x.district ? String(x.district) : null,
      region: x.region ? String(x.region) : null,
      asOf: String(x.as_of ?? ''),
      score: Number(x.score ?? 0),
      band: String(x.band ?? 'Low') as PriorityRow['band'],
      mode: String(x.mode) as PriorityMode,
      components
    }
  })
}

/** Health Matrix (spec §41): entity × week heatmap source. All scopes roll up
 *  from cell_health_history so the methodology is identical across rows. */
export async function getHealthMatrix(
  scope: HealthScope,
  opts: { weeks?: number; limit?: number; sort?: 'worst' | 'name' } = {}
): Promise<HealthMatrixResult> {
  const conn = ws().connection
  const weeksN = Math.min(26, Math.max(2, opts.weeks ?? 12))
  const limit = Math.min(200, Math.max(1, opts.limit ?? 60))
  const sort = opts.sort ?? 'worst'

  const scopeSel: Record<HealthScope, { id: string; name: string; join: string }> = {
    cell: { id: 'c.cell_id', name: 'c.name', join: '' },
    site: { id: 's.site_id', name: 's.name', join: 'JOIN dim_site s ON s.site_id = c.site_id' },
    district: { id: 'd.district_id', name: 'd.name', join: 'JOIN dim_district d ON d.district_id = c.district_id' },
    region: { id: 'r.region_id', name: 'r.name', join: 'JOIN dim_region r ON r.region_id = c.region_id' }
  }
  const sel = scopeSel[scope]

  const r = await conn.runAndReadAll(
    `SELECT ${sel.id} AS entity_id, ${sel.name} AS entity_name,
            CAST(h.date_id AS DOUBLE) AS date_id,
            ROUND(avg(h.health_score), 1) AS score
     FROM cell_health_history h
     JOIN dim_cell c ON c.cell_id = h.cell_id
     ${sel.join}
     WHERE h.date_id IN (
       SELECT DISTINCT date_id FROM cell_health_history
       ORDER BY date_id DESC LIMIT ?
     )
     GROUP BY ${sel.id}, ${sel.name}, h.date_id`,
    [weeksN]
  )

  const rows = r.getRowObjects()
  const weekDates = [...new Set(rows.map((x) => Number(x.date_id)))].sort((a, b) => a - b)
  const byEntity = new Map<number, { name: string; scores: Map<number, number | null> }>()
  for (const x of rows) {
    const id = Number(x.entity_id)
    let e = byEntity.get(id)
    if (!e) {
      e = { name: String(x.entity_name ?? ''), scores: new Map() }
      byEntity.set(id, e)
    }
    e.scores.set(Number(x.date_id), x.score == null ? null : Number(x.score))
  }

  let entities = [...byEntity.entries()]
  if (sort === 'worst') {
    const latestWeek = weekDates[weekDates.length - 1]
    entities.sort((a, b) => {
      const sa = a[1].scores.get(latestWeek)
      const sb = b[1].scores.get(latestWeek)
      return (sa == null ? 101 : sa) - (sb == null ? 101 : sb) || a[1].name.localeCompare(b[1].name)
    })
  } else {
    entities.sort((a, b) => a[1].name.localeCompare(b[1].name))
  }
  entities = entities.slice(0, limit)

  return {
    scope,
    weeks: weekDates.map((d) => String(d)),
    rows: entities.map(([id, e]) => ({
      id,
      name: e.name,
      scores: weekDates.map((w) => e.scores.get(w) ?? null)
    }))
  }
}

/** Cell Intelligence (spec §32): all cells for the latest week with lifecycle/
 *  trend/severity classifications, priority (balanced) and weekly KPIs.
 *  Filtering + pagination run in DuckDB (§67) — the renderer never holds all rows. */
export async function getCellIntelligence(opts: {
  search?: string
  lifecycle?: Lifecycle | ''
  trend?: Trend | ''
  severity?: Severity | ''
  minPriority?: number
  limit?: number
  offset?: number
} = {}): Promise<CellIntelligenceResult> {
  const conn = ws().connection
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100))
  const offset = Math.max(0, opts.offset ?? 0)
  const where: string[] = []
  const params: (string | number)[] = []
  if (opts.search) {
    where.push(`(c.name ILIKE ? OR COALESCE(s.name,'') ILIKE ? OR COALESCE(d.name,'') ILIKE ?)`)
    const like = `%${opts.search}%`
    params.push(like, like, like)
  }
  if (opts.lifecycle) {
    where.push(`l.lifecycle = ?`)
    params.push(opts.lifecycle)
  }
  if (opts.trend) {
    where.push(`l.trend = ?`)
    params.push(opts.trend)
  }
  if (opts.severity) {
    where.push(`l.severity = ?`)
    params.push(opts.severity)
  }
  if (opts.minPriority != null && opts.minPriority > 0) {
    where.push(`p.score >= ?`)
    params.push(opts.minPriority)
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const filterParams = params.slice()
  const base = `
    FROM cell_nc_lifecycle l
    JOIN dim_cell c ON c.cell_id = l.cell_id
    LEFT JOIN dim_site s ON s.site_id = c.site_id
    LEFT JOIN dim_district d ON d.district_id = c.district_id
    LEFT JOIN dim_region rg ON rg.region_id = c.region_id
    LEFT JOIN agg_cell_weekly w ON w.cell_id = l.cell_id AND w.week_start = l.period_start
    LEFT JOIN cell_priority_history p
      ON p.cell_id = l.cell_id AND p.mode = 'balanced' AND p.as_of = l.period_start
    WHERE l.grain = 'weekly'
      AND l.ruleset_version = (SELECT max(version) FROM ruleset)
      AND l.period_start = (SELECT max(period_start) FROM cell_nc_lifecycle WHERE grain = 'weekly')
      ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
  `
  const totalR = await conn.runAndReadAll(`SELECT count(*) AS n ${base}`, filterParams)
  const total = Number(totalR.getRowObjects()[0].n)
  const r = await conn.runAndReadAll(
    `SELECT l.cell_id, c.name AS cell_name, s.name AS site, d.name AS district, rg.name AS region,
       CAST(l.period_start AS VARCHAR) AS week_start, l.is_nc, l.lifecycle, l.trend, l.severity,
       l.prb_avg, CAST(l.breach_days AS DOUBLE) AS breach_days,
       w.dl_throughput_kbps_avg, w.connected_users_sum, w.data_volume_mb_sum,
       w.availability_pct_avg, p.score AS priority_score, p.band AS priority_band
     ${base}
     ORDER BY p.score DESC NULLS LAST, l.cell_id
     LIMIT ? OFFSET ?`,
    [...filterParams, limit, offset]
  )
  const pageRows = r.getRowObjects()
  const weekOf = (x: Record<string, unknown>): string => String(x.week_start ?? '')
  const kpisByCell = await pageCellKpiValues(
    conn,
    pageRows.map((x) => Number(x.cell_id)),
    pageRows.length > 0 ? weekOf(pageRows[0]) : ''
  )
  const rows: CellIntelligenceRow[] = pageRows.map((x) => ({
    cellId: Number(x.cell_id),
    cellName: String(x.cell_name ?? ''),
    site: x.site ? String(x.site) : null,
    district: x.district ? String(x.district) : null,
    region: x.region ? String(x.region) : null,
    weekStart: weekOf(x),
    isNc: Boolean(x.is_nc),
    lifecycle: String(x.lifecycle) as Lifecycle,
    trend: String(x.trend) as Trend,
    severity: String(x.severity) as Severity,
    prbAvg: x.prb_avg == null ? null : Number(x.prb_avg),
    breachDays: Number(x.breach_days ?? 0),
    throughputKbps: x.dl_throughput_kbps_avg == null ? null : Number(x.dl_throughput_kbps_avg),
    users: x.connected_users_sum == null ? null : Number(x.connected_users_sum),
    volumeMb: x.data_volume_mb_sum == null ? null : Number(x.data_volume_mb_sum),
    availability: x.availability_pct_avg == null ? null : Number(x.availability_pct_avg),
    priorityScore: x.priority_score == null ? null : Number(x.priority_score),
    priorityBand: x.priority_band ? (String(x.priority_band) as CellIntelligenceRow['priorityBand']) : null,
    kpis: kpisByCell.get(Number(x.cell_id)) ?? []
  }))
  return { total, rows }
}

/** One query for the whole page: extra KPI values per cell in the latest week. */
async function pageCellKpiValues(
  conn: DuckDBConnection,
  cellIds: number[],
  weekStart: string
): Promise<Map<number, CellKpiValue[]>> {
  const out = new Map<number, CellKpiValue[]>()
  if (cellIds.length === 0) return out
  const r = await conn.runAndReadAll(
    `SELECT w.cell_id, k.kpi_key AS key, k.label, k.unit, k.worse_is_higher, k.target,
       CASE k.agg
         WHEN 'sum' THEN w.sum_value
         WHEN 'max' THEN w.max_value
         WHEN 'min' THEN w.min_value
         ELSE w.avg_value
       END AS value
     FROM agg_cell_kpi_weekly w
     JOIN kpi_defs k ON k.kpi_id = w.kpi_id
     WHERE w.cell_id IN (${cellIds.join(',')}) AND w.week_start = ? AND k.active
     ORDER BY k.sort_order, k.kpi_key`,
    [weekStart]
  )
  for (const x of r.getRowObjects()) {
    const cellId = Number(x.cell_id)
    const value = x.value == null ? null : Number(x.value)
    const target = x.target == null ? null : Number(x.target)
    let breached = false
    if (value != null && target != null) {
      breached = x.worse_is_higher ? value > target : value < target
    }
    const v: CellKpiValue = {
      key: String(x.key),
      label: String(x.label),
      unit: String(x.unit ?? ''),
      value,
      target,
      worseIsHigher: Boolean(x.worse_is_higher),
      breached
    }
    const list = out.get(cellId)
    if (list) list.push(v)
    else out.set(cellId, [v])
  }
  return out
}

/** Extra per-technology KPI values for one cell in one week, with target
 *  breach flags (spec §54a). Aggregation follows each definition's agg mode. */
async function cellKpiValues(
  conn: DuckDBConnection,
  cellId: number,
  weekStart: string
): Promise<CellKpiValue[]> {
  const m = await pageCellKpiValues(conn, [cellId], weekStart)
  return m.get(cellId) ?? []
}

/** Weekly history for one cell — the drawer's aligned time-series source. */
export async function getCellDetail(cellId: number): Promise<CellDetail | null> {
  const conn = ws().connection
  const dimR = await conn.runAndReadAll(
    `SELECT CAST(c.cell_id AS DOUBLE) AS cell_id, c.name AS cell_name,
       s.name AS site, d.name AS district, rg.name AS region
     FROM dim_cell c
     LEFT JOIN dim_site s ON s.site_id = c.site_id
     LEFT JOIN dim_district d ON d.district_id = c.district_id
     LEFT JOIN dim_region rg ON rg.region_id = c.region_id
     WHERE c.cell_id = ?`,
    [cellId]
  )
  const dim = dimR.getRowObjects()[0]
  if (!dim) return null
  const curR = await conn.runAndReadAll(
    `SELECT CAST(p.score AS DOUBLE) AS score, p.band, CAST(p.as_of AS VARCHAR) AS as_of
     FROM cell_priority_history p
     WHERE p.cell_id = ? AND p.mode = 'balanced'
       AND p.as_of = (SELECT max(as_of) FROM cell_priority_history WHERE cell_id = ? AND mode = 'balanced')
     LIMIT 1`,
    [cellId, cellId]
  )
  const cur = curR.getRowObjects()[0]
  const lifeR = await conn.runAndReadAll(
    `SELECT CAST(period_start AS VARCHAR) AS week_start, lifecycle, trend, severity,
       is_nc, prb_avg
     FROM cell_nc_lifecycle
     WHERE cell_id = ? AND grain = 'weekly'
       AND ruleset_version = (SELECT max(version) FROM ruleset)
       AND period_start = (SELECT max(period_start) FROM cell_nc_lifecycle
         WHERE cell_id = ? AND grain = 'weekly')
     LIMIT 1`,
    [cellId, cellId]
  )
  const life = lifeR.getRowObjects()[0]
  const wkR = await conn.runAndReadAll(
    `SELECT CAST(w.week_start AS VARCHAR) AS week_start,
       w.prb_avg, w.dl_throughput_kbps_avg, w.connected_users_sum,
       w.data_volume_mb_sum, w.availability_pct_avg,
       CAST(w.breach_days AS DOUBLE) AS breach_days,
       COALESCE(l.is_nc, false) AS is_nc,
       COALESCE(l.lifecycle, 'Healthy') AS lifecycle,
       COALESCE(l.severity, 'Normal') AS severity
     FROM agg_cell_weekly w
     LEFT JOIN cell_nc_lifecycle l
       ON l.cell_id = w.cell_id AND l.period_start = w.week_start
       AND l.grain = 'weekly' AND l.ruleset_version = (SELECT max(version) FROM ruleset)
     WHERE w.cell_id = ?
     ORDER BY w.week_start`,
    [cellId]
  )
  const weeks: CellWeekPoint[] = wkR.getRowObjects().map((x) => ({
    weekStart: String(x.week_start),
    prbAvg: x.prb_avg == null ? null : Number(x.prb_avg),
    throughputKbps: x.dl_throughput_kbps_avg == null ? null : Number(x.dl_throughput_kbps_avg),
    users: x.connected_users_sum == null ? null : Number(x.connected_users_sum),
    volumeMb: x.data_volume_mb_sum == null ? null : Number(x.data_volume_mb_sum),
    availability: x.availability_pct_avg == null ? null : Number(x.availability_pct_avg),
    breachDays: Number(x.breach_days ?? 0),
    isNc: Boolean(x.is_nc),
    lifecycle: String(x.lifecycle) as Lifecycle,
    severity: String(x.severity) as Severity
  }))
  const latestWeek = weeks.length > 0 ? weeks[weeks.length - 1].weekStart : (life ? String(life.week_start) : '')
  const kpis = latestWeek ? await cellKpiValues(conn, cellId, latestWeek) : []
  return {
    cellId: Number(dim.cell_id),
    cellName: String(dim.cell_name ?? ''),
    site: dim.site ? String(dim.site) : null,
    district: dim.district ? String(dim.district) : null,
    region: dim.region ? String(dim.region) : null,
    current: life
      ? {
          weekStart: String(life.week_start),
          lifecycle: String(life.lifecycle) as Lifecycle,
          trend: String(life.trend) as Trend,
          severity: String(life.severity) as Severity,
          priorityScore: cur ? Number(cur.score) : null,
          priorityBand: cur ? (String(cur.band) as NonNullable<CellDetail['current']>['priorityBand']) : null,
          prbAvg: life.prb_avg == null ? null : Number(life.prb_avg)
        }
      : null,
    weeks,
    kpis
  }
}

/** Network health series + current cell health snapshot (worst first). */
export async function getHealth(): Promise<HealthResult> {
  const conn = ws().connection
  const network = await computeNetworkHealth(conn)
  const r = await conn.runAndReadAll(`
    SELECT CAST(h.cell_id AS DOUBLE) AS cell_id, c.name AS cell_name,
      s.name AS site, d.name AS district, rg.name AS region,
      CAST(dt.week_start AS VARCHAR) AS week_start,
      h.health_score
    FROM cell_health_history h
    JOIN dim_cell c ON c.cell_id = h.cell_id
    LEFT JOIN dim_site s ON s.site_id = c.site_id
    LEFT JOIN dim_district d ON d.district_id = c.district_id
    LEFT JOIN dim_region rg ON rg.region_id = c.region_id
    JOIN dim_date dt ON dt.date_id = h.date_id
    WHERE h.date_id = (SELECT max(date_id) FROM cell_health_history)
    ORDER BY h.health_score ASC, h.cell_id
    LIMIT 200
  `)
  const cells: CellHealthRow[] = r.getRowObjects().map((x) => ({
    cellId: Number(x.cell_id),
    cellName: String(x.cell_name ?? ''),
    site: x.site ? String(x.site) : null,
    district: x.district ? String(x.district) : null,
    region: x.region ? String(x.region) : null,
    weekStart: String(x.week_start ?? ''),
    healthScore: Number(x.health_score ?? 0)
  }))
  return { network, cells }
}

/** Performance Analysis (spec §40): metric percentile distributions, a
 *  PRB-vs-throughput scatter with quadrant bands, and the correlation table.
 *  All math runs in DuckDB — the renderer only receives ready-to-draw shapes. */
export async function getPerformance(): Promise<PerformanceResult> {
  const conn = ws().connection
  const rules = await getRulesCurrent()
  const prbThreshold = rules?.prbThresholdPct ?? 80

  const wkR = await conn.runAndReadAll(
    `SELECT CAST(max(week_start) AS VARCHAR) AS week_start FROM agg_cell_weekly`
  )
  const weekStart = String(wkR.getRowObjects()[0].week_start ?? '')

  const METRICS: Array<{ metric: PerfMetric; label: string; unit: string; col: string }> = [
    { metric: 'prb', label: 'PRB utilization', unit: '%', col: 'prb_avg' },
    { metric: 'throughput', label: 'DL throughput', unit: 'kbps', col: 'dl_throughput_kbps_avg' },
    { metric: 'users', label: 'Connected users', unit: '', col: 'connected_users_sum' },
    { metric: 'volume', label: 'Data volume', unit: 'MB', col: 'data_volume_mb_sum' },
    { metric: 'availability', label: 'Availability', unit: '%', col: 'availability_pct_avg' }
  ]
  const QUANTILES = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1]

  const distributions: MetricDistribution[] = []
  for (const m of METRICS) {
    const r = await conn.runAndReadAll(
      `SELECT quantile_cont(${m.col}, [${QUANTILES.join(',')}]) AS ps,
              avg(${m.col}) AS mean, min(${m.col}) AS min, max(${m.col}) AS max,
              quantile_cont(${m.col}, 0.5) AS p50, quantile_cont(${m.col}, 0.9) AS p90,
              count(*) AS n
       FROM agg_cell_weekly WHERE week_start = ?`,
      [weekStart]
    )
    const row = r.getRowObjects()[0]
    // a LIST column decodes to { items: [...] } in @duckdb/node-api
    const ps = row?.ps as { items?: Array<number | null> } | null
    const items: Array<number | null> = ps?.items ?? []
    distributions.push({
      metric: m.metric,
      label: m.label,
      unit: m.unit,
      points: QUANTILES.map((q, i) => ({
        p: q * 100,
        value: items[i] == null ? null : Number(items[i])
      })),
      mean: row?.mean == null ? null : Number(row.mean),
      min: row?.min == null ? null : Number(row.min),
      max: row?.max == null ? null : Number(row.max),
      p50: row?.p50 == null ? null : Number(row.p50),
      p90: row?.p90 == null ? null : Number(row.p90),
      n: Number(row?.n ?? 0)
    })
  }

  // scatter: latest-week cells with NC state under the active ruleset
  const scR = await conn.runAndReadAll(
    `SELECT CAST(c.cell_id AS DOUBLE) AS cell_id, c.name AS cell_name,
       d.name AS district, rg.name AS region,
       w.prb_avg, w.dl_throughput_kbps_avg, w.connected_users_sum,
       COALESCE(l.is_nc, false) AS is_nc
     FROM agg_cell_weekly w
     JOIN dim_cell c ON c.cell_id = w.cell_id
     LEFT JOIN dim_site s ON s.site_id = c.site_id
     LEFT JOIN dim_district d ON d.district_id = c.district_id
     LEFT JOIN dim_region rg ON rg.region_id = c.region_id
     LEFT JOIN cell_nc_lifecycle l
       ON l.cell_id = w.cell_id AND l.period_start = w.week_start
       AND l.grain = 'weekly' AND l.ruleset_version = (SELECT max(version) FROM ruleset)
     WHERE w.week_start = ?`,
    [weekStart]
  )
  const scRows = scR.getRowObjects()
  const medR = await conn.runAndReadAll(
    `SELECT median(dl_throughput_kbps_avg) AS med FROM agg_cell_weekly WHERE week_start = ?`,
    [weekStart]
  )
  const med = medR.getRowObjects()[0].med
  const throughputMedianKbps = med == null ? null : Number(med)
  const scatter: ScatterPoint[] = scRows.map((x) => {
    const prb = x.prb_avg == null ? null : Number(x.prb_avg)
    const thr = x.dl_throughput_kbps_avg == null ? null : Number(x.dl_throughput_kbps_avg)
    let quadrant: ScatterQuadrant = 'healthy'
    if (prb != null && thr != null && throughputMedianKbps != null) {
      if (prb > prbThreshold) quadrant = thr < throughputMedianKbps ? 'congested' : 'busy'
      else quadrant = thr < throughputMedianKbps ? 'quiet' : 'healthy'
    }
    return {
      cellId: Number(x.cell_id),
      cellName: String(x.cell_name ?? ''),
      district: x.district ? String(x.district) : null,
      region: x.region ? String(x.region) : null,
      prb,
      throughputKbps: thr,
      users: x.connected_users_sum == null ? null : Number(x.connected_users_sum),
      isNc: Boolean(x.is_nc),
      quadrant
    }
  })

  // correlations: Pearson over every weekly row (more signal than one week).
  // Descriptive, never causal (spec §40).
  const corrR = await conn.runAndReadAll(`
    SELECT
      corr(prb_avg, dl_throughput_kbps_avg) AS prb_thr,
      corr(prb_avg, connected_users_sum) AS prb_usr,
      corr(prb_avg, data_volume_mb_sum) AS prb_vol,
      corr(prb_avg, availability_pct_avg) AS prb_avail,
      corr(dl_throughput_kbps_avg, connected_users_sum) AS thr_usr,
      corr(dl_throughput_kbps_avg, data_volume_mb_sum) AS thr_vol,
      corr(dl_throughput_kbps_avg, availability_pct_avg) AS thr_avail,
      corr(connected_users_sum, data_volume_mb_sum) AS usr_vol,
      corr(connected_users_sum, availability_pct_avg) AS usr_avail,
      corr(data_volume_mb_sum, availability_pct_avg) AS vol_avail,
      count(*) AS n
    FROM agg_cell_weekly
  `)
  const crow = corrR.getRowObjects()[0]
  const pairs: Array<[PerfMetric, PerfMetric, string]> = [
    ['prb', 'throughput', 'prb_thr'],
    ['prb', 'users', 'prb_usr'],
    ['prb', 'volume', 'prb_vol'],
    ['prb', 'availability', 'prb_avail'],
    ['throughput', 'users', 'thr_usr'],
    ['throughput', 'volume', 'thr_vol'],
    ['throughput', 'availability', 'thr_avail'],
    ['users', 'volume', 'usr_vol'],
    ['users', 'availability', 'usr_avail'],
    ['volume', 'availability', 'vol_avail']
  ]
  const correlations: CorrelationRow[] = pairs.map(([a, b, key]) => ({
    a,
    b,
    pearson: crow[key] == null ? null : Number(crow[key]),
    n: Number(crow.n ?? 0)
  }))

  return {
    weekStart,
    totalCells: scatter.length,
    prbThreshold,
    throughputMedianKbps,
    distributions,
    scatter,
    correlations
  }
}

/** Comparison Lab (spec §42): period-vs-period and region-vs-region deltas.
 *  Two view families share one shape: rows carry `current` / `previous` / deltas,
 *  where `previous` is the earlier week (period mode) or the network baseline
 *  (region mode), so the renderer's Actual/Indexed/Delta modes work for both. */
export async function getComparison(opts: {
  type?: ComparisonType
  scope?: CompareScope
  metric?: CompareMetric
} = {}): Promise<ComparisonResult> {
  const conn = ws().connection
  const type: ComparisonType = opts.type ?? 'period'
  // region mode always compares regions against the network baseline
  const scope: CompareScope = type === 'region' ? 'region' : (opts.scope ?? 'cell')
  const metric: CompareMetric = opts.metric ?? 'prb'

  const METRICS: Array<{
    metric: CompareMetric
    label: string
    unit: string
    expr: string
    worseIsHigher: boolean
  }> = [
    { metric: 'prb', label: 'PRB utilization', unit: '%', expr: 'avg(prb_avg)', worseIsHigher: true },
    { metric: 'throughput', label: 'DL throughput', unit: 'kbps', expr: 'avg(dl_throughput_kbps_avg)', worseIsHigher: false },
    { metric: 'users', label: 'Connected users', unit: '', expr: 'sum(connected_users_sum)', worseIsHigher: false },
    { metric: 'volume', label: 'Data volume', unit: 'MB', expr: 'sum(data_volume_mb_sum)', worseIsHigher: false },
    { metric: 'availability', label: 'Availability', unit: '%', expr: 'avg(availability_pct_avg)', worseIsHigher: false },
    { metric: 'nc', label: 'NC cells', unit: '', expr: 'sum(is_nc)', worseIsHigher: true }
  ]

  const wkR = await conn.runAndReadAll(
    `SELECT DISTINCT CAST(week_start AS VARCHAR) AS week_start FROM agg_cell_weekly ORDER BY week_start DESC LIMIT 2`
  )
  const weeks = wkR.getRowObjects().map((x) => String(x.week_start))
  const a = weeks[0] ?? '' // latest
  const b = weeks[1] ?? '' // previous (period mode only)

  const SCOPE: Record<CompareScope, { id: string; name: string; join: string }> = {
    cell: { id: 'c.cell_id', name: 'c.name', join: '' },
    site: { id: 's.site_id', name: 's.name', join: 'JOIN dim_site s ON s.site_id = c.site_id' },
    district: { id: 'd.district_id', name: 'd.name', join: 'JOIN dim_district d ON d.district_id = c.district_id' },
    region: { id: 'rg.region_id', name: 'rg.name', join: 'JOIN dim_region rg ON rg.region_id = c.region_id' }
  }
  const sel = SCOPE[scope]

  /** Network-level KPI snapshot for one week (the `kpis` source). */
  async function networkKpis(weekStart: string): Promise<Record<string, number | null>> {
    const r = await conn.runAndReadAll(
      `SELECT avg(prb_avg) AS prb, avg(dl_throughput_kbps_avg) AS thr,
         sum(connected_users_sum) AS usr, sum(data_volume_mb_sum) AS vol,
         avg(availability_pct_avg) AS avail, sum(is_nc) AS nc
       FROM agg_cell_weekly WHERE week_start = ?`,
      [weekStart]
    )
    const row = r.getRowObjects()[0]
    const out: Record<string, number | null> = {}
    for (const key of ['prb', 'thr', 'usr', 'vol', 'avail', 'nc']) {
      out[key] = row?.[key] == null ? null : Number(row[key])
    }
    return out
  }

  /** Per-entity metric + NC count for one week at the chosen scope. */
  async function scopeRows(weekStart: string): Promise<Map<number, { name: string; value: number | null; nc: number; cells: number }>> {
    const metricDef = METRICS.find((m) => m.metric === metric)!
    const r = await conn.runAndReadAll(
      `SELECT ${sel.id} AS entity_id, ${sel.name} AS entity_name,
              ${metricDef.expr} AS value, sum(is_nc) AS nc, count(*) AS cells
       FROM agg_cell_weekly w
       JOIN dim_cell c ON c.cell_id = w.cell_id
       ${sel.join}
       WHERE w.week_start = ?
       GROUP BY ${sel.id}, ${sel.name}`,
      [weekStart]
    )
    const map = new Map<number, { name: string; value: number | null; nc: number; cells: number }>()
    for (const x of r.getRowObjects()) {
      map.set(Number(x.entity_id), {
        name: String(x.entity_name ?? ''),
        value: x.value == null ? null : Number(x.value),
        nc: Number(x.nc ?? 0),
        cells: Number(x.cells ?? 0)
      })
    }
    return map
  }

  /** Wide variant for region mode: every metric per region (for best/worst). */
  async function scopeAllRows(weekStart: string): Promise<Map<number, { name: string; vals: Record<string, number | null>; nc: number; cells: number }>> {
    const r = await conn.runAndReadAll(
      `SELECT ${sel.id} AS entity_id, ${sel.name} AS entity_name,
              avg(prb_avg) AS prb, avg(dl_throughput_kbps_avg) AS thr,
              sum(connected_users_sum) AS usr, sum(data_volume_mb_sum) AS vol,
              avg(availability_pct_avg) AS avail, sum(is_nc) AS nc, count(*) AS cells
       FROM agg_cell_weekly w
       JOIN dim_cell c ON c.cell_id = w.cell_id
       ${sel.join}
       WHERE w.week_start = ?
       GROUP BY ${sel.id}, ${sel.name}`,
      [weekStart]
    )
    const map = new Map<number, { name: string; vals: Record<string, number | null>; nc: number; cells: number }>()
    for (const x of r.getRowObjects()) {
      const vals: Record<string, number | null> = {}
      for (const key of ['prb', 'thr', 'usr', 'vol', 'avail', 'nc']) {
        vals[key] = x[key] == null ? null : Number(x[key])
      }
      map.set(Number(x.entity_id), {
        name: String(x.entity_name ?? ''),
        vals,
        nc: Number(x.nc ?? 0),
        cells: Number(x.cells ?? 0)
      })
    }
    return map
  }

  const aNet = await networkKpis(a)
  const bNet = type === 'period' ? await networkKpis(b) : null

  if (type === 'region') {
    // regions vs network baseline, latest week only
    const rowsMap = await scopeAllRows(a)
    const kpis: ComparisonKpi[] = METRICS.map((m) => {
      const key = shortKey(m.metric)
      const vals = [...rowsMap.values()]
        .map((r) => r.vals[key])
        .filter((v): v is number => v != null)
      const network = aNet[key] ?? null
      return {
        metric: m.metric,
        label: m.label,
        unit: m.unit,
        worseIsHigher: m.worseIsHigher,
        current: network == null ? null : round2(network),
        previous: null,
        delta: null,
        deltaPct: null,
        best: vals.length > 0 ? round2(Math.max(...vals)) : null,
        worst: vals.length > 0 ? round2(Math.min(...vals)) : null
      }
    })
    const network = aNet[shortKey(metric)] ?? null
    const rows: ComparisonRow[] = [...rowsMap.entries()]
      .map(([id, r]) => {
        const v = r.vals[shortKey(metric)] ?? null
        return {
          id,
          name: r.name,
          current: v == null ? null : round2(v),
          previous: network == null ? null : round2(network),
          delta: v == null || network == null ? null : round2(v - network),
          deltaPct: v == null || network == null || network === 0 ? null : round1(((v - network) / Math.abs(network)) * 100),
          ncCells: r.nc,
          cells: r.cells,
          transition: null
        }
      })
      .sort((x, y) => x.name.localeCompare(y.name))
    return {
      type,
      scope,
      metric,
      aLabel: a,
      bLabel: 'Network avg',
      totalRows: rows.length,
      kpis,
      rows
    }
  }

  // period mode: latest week vs previous week at the chosen scope
  const aRows = await scopeRows(a)
  const bRows = await scopeRows(b)
  const kpis: ComparisonKpi[] = METRICS.map((m) => {
    const cur = aNet[shortKey(m.metric)]
    const prev = bNet?.[shortKey(m.metric)] ?? null
    return {
      metric: m.metric,
      label: m.label,
      unit: m.unit,
      worseIsHigher: m.worseIsHigher,
      current: cur == null ? null : round2(cur),
      previous: prev == null ? null : round2(prev),
      delta: cur == null || prev == null ? null : round2(cur - prev),
      deltaPct: cur == null || prev == null || prev === 0 ? null : round1(((cur - prev) / Math.abs(prev)) * 100),
      best: null,
      worst: null
    }
  })
  const ids = new Set<number>([...aRows.keys(), ...bRows.keys()])
  const rows: ComparisonRow[] = [...ids].map((id) => {
    const A = aRows.get(id)
    const B = bRows.get(id)
    const cur = A?.value ?? null
    const prev = B?.value ?? null
    let transition: NcTransition = 'ok'
    if (A && B) transition = A.nc > 0 && B.nc > 0 ? 'nc' : A.nc > 0 ? 'new' : B.nc > 0 ? 'recovered' : 'ok'
    else if (A) transition = A.nc > 0 ? 'new' : 'ok'
    else if (B) transition = B.nc > 0 ? 'recovered' : 'ok'
    return {
      id,
      name: A?.name ?? B?.name ?? '',
      current: cur == null ? null : round2(cur),
      previous: prev == null ? null : round2(prev),
      delta: cur == null || prev == null ? null : round2(cur - prev),
      deltaPct: cur == null || prev == null || prev === 0 ? null : round1(((cur - prev) / Math.abs(prev)) * 100),
      ncCells: A?.nc ?? 0,
      cells: A?.cells ?? B?.cells ?? 0,
      transition
    }
  })
  return {
    type,
    scope,
    metric,
    aLabel: a,
    bLabel: b,
    totalRows: rows.length,
    kpis,
    rows
  }
}

/** Network Explorer (spec §31): hierarchical drill-down Region → District →
 *  Site → Cell. Node health rolls up from cell_health_history (same methodology
 *  as the Health Matrix); KPIs come from the latest week's aggregates. */
export async function getExplorer(
  level: ExplorerLevel,
  parentId: number | null = null,
  opts: { q?: string } = {}
): Promise<ExplorerResult> {
  const conn = ws().connection
  const q = (opts.q ?? '').trim()

  const E: Record<ExplorerLevel, { id: string; name: string; filter: string; extra: string }> = {
    region: { id: 'rg.region_id', name: 'rg.name', filter: '', extra: '' },
    district: { id: 'd.district_id', name: 'd.name', filter: 'd.region_id = ?', extra: '' },
    site: { id: 's.site_id', name: 's.name', filter: 's.district_id = ?', extra: '' },
    cell: {
      id: 'c.cell_id',
      name: 'c.name',
      filter: 'c.site_id = ?',
      extra: `
      LEFT JOIN cell_nc_lifecycle l
        ON l.cell_id = c.cell_id AND l.grain = 'weekly'
        AND l.ruleset_version = (SELECT max(version) FROM ruleset)
        AND l.period_start = (SELECT max(period_start) FROM cell_nc_lifecycle WHERE grain = 'weekly')
      LEFT JOIN cell_priority_history p
        ON p.cell_id = c.cell_id AND p.mode = 'balanced'
        AND p.as_of = (SELECT max(as_of) FROM cell_priority_history WHERE mode = 'balanced')`
    }
  }
  const e = E[level]

  const where: string[] = []
  const params: (string | number)[] = []
  if (level !== 'region') {
    if (parentId == null) {
      return { level, parentId, breadcrumb: [], nodes: [], ncCells: 0, totalCells: 0 }
    }
    where.push(e.filter)
    params.push(parentId)
  }
  if (q) {
    where.push(`${e.name} ILIKE ?`)
    params.push(`%${q}%`)
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const cellExtra = level === 'cell'
    ? `,
       COALESCE(w.is_nc, false) AS is_nc,
       l.lifecycle, l.severity, p.score AS priority_score, p.band AS priority_band,
       count(*) FILTER (WHERE w.is_nc) AS nc, count(*) AS cells`
    : `,
       false AS is_nc, NULL AS lifecycle, NULL AS severity,
       NULL AS priority_score, NULL AS priority_band,
       sum(CASE WHEN w.is_nc THEN 1 ELSE 0 END) AS nc, count(*) AS cells`
  const groupBy = level === 'cell'
    ? `, COALESCE(w.is_nc, false), l.lifecycle, l.severity, p.score, p.band`
    : ''

  const r = await conn.runAndReadAll(
    `SELECT ${e.id} AS id, ${e.name} AS name,
       round(avg(h.health_score), 1) AS health,
       round(avg(w.prb_avg), 1) AS prb,
       round(avg(w.dl_throughput_kbps_avg), 1) AS thr,
       sum(w.connected_users_sum) AS usr,
       sum(w.data_volume_mb_sum) AS vol,
       round(avg(w.availability_pct_avg), 1) AS avail
       ${cellExtra}
     FROM dim_cell c
     JOIN dim_site s ON s.site_id = c.site_id
     JOIN dim_district d ON d.district_id = c.district_id
     JOIN dim_region rg ON rg.region_id = c.region_id
     LEFT JOIN cell_health_history h ON h.cell_id = c.cell_id
       AND h.date_id = (SELECT max(date_id) FROM cell_health_history)
     LEFT JOIN agg_cell_weekly w ON w.cell_id = c.cell_id
       AND w.week_start = (SELECT max(week_start) FROM agg_cell_weekly)
     ${e.extra}
     ${whereSql}
     GROUP BY ${e.id}, ${e.name}${groupBy}
     ORDER BY health ASC NULLS LAST, ${e.name}`,
    params
  )

  const nodes: ExplorerNode[] = r.getRowObjects().map((x) => ({
    id: Number(x.id),
    name: String(x.name ?? ''),
    level,
    healthScore: x.health == null ? null : Number(x.health),
    ncCells: Number(x.nc ?? 0),
    cells: Number(x.cells ?? 0),
    prbAvg: x.prb == null ? null : Number(x.prb),
    throughputKbps: x.thr == null ? null : Number(x.thr),
    users: x.usr == null ? null : Number(x.usr),
    volumeMb: x.vol == null ? null : Number(x.vol),
    availability: x.avail == null ? null : Number(x.avail),
    isNc: Boolean(x.is_nc),
    lifecycle: x.lifecycle ? (String(x.lifecycle) as Lifecycle) : null,
    severity: x.severity ? (String(x.severity) as Severity) : null,
    priorityScore: x.priority_score == null ? null : Number(x.priority_score),
    priorityBand: x.priority_band ? (String(x.priority_band) as ExplorerNode['priorityBand']) : null
  }))
  return {
    level,
    parentId,
    breadcrumb: await buildBreadcrumb(conn, level, parentId),
    nodes,
    ncCells: nodes.reduce((s, n) => s + n.ncCells, 0),
    totalCells: nodes.reduce((s, n) => s + n.cells, 0)
  }
}

/** Ghana map (Executive Overview): one row per region with latest-week KPIs,
 *  so every region in the map can be colored even where data is sparse. */
export async function getRegionMap(): Promise<RegionMapRow[]> {
  const conn = ws().connection
  const r = await conn.runAndReadAll(`
    SELECT r.region_id AS id, r.name AS name,
      count(DISTINCT c.cell_id) AS cells,
      sum(CASE WHEN w.is_nc THEN 1 ELSE 0 END) AS nc,
      round(avg(h.health_score), 1) AS health,
      round(avg(w.prb_avg), 1) AS prb,
      round(avg(w.dl_throughput_kbps_avg), 1) AS thr,
      sum(w.connected_users_sum) AS usr,
      sum(w.data_volume_mb_sum) AS vol,
      round(avg(w.availability_pct_avg), 1) AS avail
    FROM dim_region r
    LEFT JOIN dim_cell c ON c.region_id = r.region_id
    LEFT JOIN cell_health_history h ON h.cell_id = c.cell_id
      AND h.date_id = (SELECT max(date_id) FROM cell_health_history)
    LEFT JOIN agg_cell_weekly w ON w.cell_id = c.cell_id
      AND w.week_start = (SELECT max(week_start) FROM agg_cell_weekly)
    GROUP BY r.region_id, r.name
    ORDER BY r.name
  `)
  return r.getRowObjects().map((x) => ({
    id: Number(x.id),
    name: String(x.name ?? ''),
    cells: Number(x.cells ?? 0),
    ncCells: Number(x.nc ?? 0),
    healthScore: x.health == null ? null : Number(x.health),
    prbAvg: x.prb == null ? null : Number(x.prb),
    throughputKbps: x.thr == null ? null : Number(x.thr),
    users: x.usr == null ? null : Number(x.usr),
    volumeMb: x.vol == null ? null : Number(x.vol),
    availability: x.avail == null ? null : Number(x.avail)
  }))
}

/** Ghana map drill-down: districts of one region with latest-week KPIs. */
export async function getRegionDistricts(regionId: number): Promise<DistrictMapRow[]> {
  const conn = ws().connection
  const r = await conn.runAndReadAll(
    `SELECT d.district_id AS id, d.name AS name, rg.name AS region,
       count(DISTINCT c.cell_id) AS cells,
       sum(CASE WHEN w.is_nc THEN 1 ELSE 0 END) AS nc,
       round(avg(h.health_score), 1) AS health,
       round(avg(w.prb_avg), 1) AS prb,
       round(avg(w.dl_throughput_kbps_avg), 1) AS thr,
       sum(w.connected_users_sum) AS usr,
       sum(w.data_volume_mb_sum) AS vol,
       round(avg(w.availability_pct_avg), 1) AS avail
     FROM dim_district d
     JOIN dim_region rg ON rg.region_id = d.region_id
     LEFT JOIN dim_cell c ON c.district_id = d.district_id
     LEFT JOIN cell_health_history h ON h.cell_id = c.cell_id
       AND h.date_id = (SELECT max(date_id) FROM cell_health_history)
     LEFT JOIN agg_cell_weekly w ON w.cell_id = c.cell_id
       AND w.week_start = (SELECT max(week_start) FROM agg_cell_weekly)
     WHERE d.region_id = ?
     GROUP BY d.district_id, d.name, rg.name
     ORDER BY health ASC NULLS LAST, d.name`,
    [regionId]
  )
  return r.getRowObjects().map((x) => ({
    id: Number(x.id),
    name: String(x.name ?? ''),
    region: x.region ? String(x.region) : null,
    cells: Number(x.cells ?? 0),
    ncCells: Number(x.nc ?? 0),
    healthScore: x.health == null ? null : Number(x.health),
    prbAvg: x.prb == null ? null : Number(x.prb),
    throughputKbps: x.thr == null ? null : Number(x.thr),
    users: x.usr == null ? null : Number(x.usr),
    volumeMb: x.vol == null ? null : Number(x.vol),
    availability: x.avail == null ? null : Number(x.avail)
  }))
}

async function buildBreadcrumb(
  conn: DuckDBConnection,
  level: ExplorerLevel,
  parentId: number | null
): Promise<ExplorerBreadcrumb[]> {
  if (level === 'region' || parentId == null) return []
  const push = (arr: ExplorerBreadcrumb[], id: number, name: string, lvl: ExplorerLevel): void => {
    arr.unshift({ id, name, level: lvl })
  }
  const out: ExplorerBreadcrumb[] = []
  if (level === 'district') {
    const rr = await conn.runAndReadAll(
      `SELECT region_id AS id, name FROM dim_region WHERE region_id = ?`,
      [parentId]
    )
    const row = rr.getRowObjects()[0]
    if (row) push(out, Number(row.id), String(row.name), 'region')
    return out
  }
  if (level === 'site') {
    const dr = await conn.runAndReadAll(
      `SELECT d.district_id AS id, d.name, d.region_id FROM dim_district d WHERE d.district_id = ?`,
      [parentId]
    )
    const drow = dr.getRowObjects()[0]
    if (!drow) return out
    push(out, Number(drow.id), String(drow.name), 'district')
    const rr = await conn.runAndReadAll(
      `SELECT region_id AS id, name FROM dim_region WHERE region_id = ?`,
      [Number(drow.region_id)]
    )
    const row = rr.getRowObjects()[0]
    if (row) push(out, Number(row.id), String(row.name), 'region')
    return out
  }
  // cell: parent is the site
  const sr = await conn.runAndReadAll(
    `SELECT s.site_id AS id, s.name, s.district_id FROM dim_site s WHERE s.site_id = ?`,
    [parentId]
  )
  const srow = sr.getRowObjects()[0]
  if (!srow) return out
  push(out, Number(srow.id), String(srow.name), 'site')
  const dr = await conn.runAndReadAll(
    `SELECT d.district_id AS id, d.name, d.region_id FROM dim_district d WHERE d.district_id = ?`,
    [Number(srow.district_id)]
  )
  const drow = dr.getRowObjects()[0]
  if (!drow) return out
  push(out, Number(drow.id), String(drow.name), 'district')
  const rr = await conn.runAndReadAll(
    `SELECT region_id AS id, name FROM dim_region WHERE region_id = ?`,
    [Number(drow.region_id)]
  )
  const row = rr.getRowObjects()[0]
  if (row) push(out, Number(row.id), String(row.name), 'region')
  return out
}

/** Priority Center (spec §43–44): a workflow queue across cells / sites /
 *  districts — each entity's latest priority (worst-cell rollup for site and
 *  district scopes) joined with its action status, owner, ticket and review
 *  date. Filtering + pagination run in DuckDB. */
export async function getPriorityCenter(
  opts: PriorityCenterOpts = {}
): Promise<PriorityCenterResult> {
  const conn = ws().connection
  const scope: InvestigationScope = opts.scope ?? 'cell'
  const mode: PriorityMode = opts.mode ?? 'balanced'
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100))
  const offset = Math.max(0, opts.offset ?? 0)

  const BANDS: Array<{ band: PriorityBand; lo: number; hi: number }> = [
    { band: 'Critical', lo: 90, hi: 100 },
    { band: 'High', lo: 75, hi: 89 },
    { band: 'Medium', lo: 50, hi: 74 },
    { band: 'Watch', lo: 25, hi: 49 },
    { band: 'Low', lo: 0, hi: 24 }
  ]

  const SCOPE_SQL: Record<InvestigationScope, { from: string; sel: string; eId: string; groupBy: string }> = {
    cell: {
      from: `dim_cell c
             LEFT JOIN dim_site s ON s.site_id = c.site_id
             LEFT JOIN dim_district d ON d.district_id = c.district_id
             LEFT JOIN dim_region rg ON rg.region_id = c.region_id`,
      sel: `c.cell_id AS id, c.name AS name, rg.name AS r, d.name AS d, s.name AS s2,
            p.score, p.band, st.status, st.owner, st.external_ticket,
            CAST(st.target_review_date AS VARCHAR) AS review_date,
            COALESCE(w.is_nc, false) AS is_nc, 1 AS cells, w.prb_avg AS prb, NULL AS nc`,
      eId: 'c.cell_id',
      groupBy: ''
    },
    site: {
      from: `dim_site s
             JOIN dim_cell c ON c.site_id = s.site_id
             LEFT JOIN dim_district d ON d.district_id = s.district_id
             LEFT JOIN dim_region rg ON rg.region_id = d.region_id`,
      sel: `s.site_id AS id, s.name AS name, rg.name AS r, d.name AS d, NULL AS s2,
            max(p.score) AS score, NULL AS band, st.status, st.owner, st.external_ticket,
            CAST(st.target_review_date AS VARCHAR) AS review_date,
            sum(w.is_nc) AS nc, count(DISTINCT c.cell_id) AS cells, avg(w.prb_avg) AS prb, NULL AS is_nc`,
      eId: 's.site_id',
      groupBy: `GROUP BY s.site_id, s.name, d.name, rg.name, st.status, st.owner, st.external_ticket, st.target_review_date`
    },
    district: {
      from: `dim_district d
             JOIN dim_cell c ON c.district_id = d.district_id
             LEFT JOIN dim_region rg ON rg.region_id = d.region_id`,
      sel: `d.district_id AS id, d.name AS name, rg.name AS r, NULL AS d2, NULL AS s2,
            max(p.score) AS score, NULL AS band, st.status, st.owner, st.external_ticket,
            CAST(st.target_review_date AS VARCHAR) AS review_date,
            sum(w.is_nc) AS nc, count(DISTINCT c.cell_id) AS cells, avg(w.prb_avg) AS prb, NULL AS is_nc`,
      eId: 'd.district_id',
      groupBy: `GROUP BY d.district_id, d.name, rg.name, st.status, st.owner, st.external_ticket, st.target_review_date`
    }
  }
  const cfg = SCOPE_SQL[scope]

  const where: string[] = []
  const params: (string | number)[] = []
  params.push(mode, mode) // priority history joins (mode, mode)
  params.push(scope) // entity_action_status entity_type
  if (opts.status) {
    if (opts.status === 'unset') {
      where.push(`st.status IS NULL`)
    } else {
      where.push(`st.status = ?`)
      params.push(opts.status)
    }
  }
  if (opts.band) {
    const b = BANDS.find((x) => x.band === opts.band)
    if (b) {
      where.push(`p.score >= ? AND p.score <= ?`)
      params.push(b.lo, b.hi)
    }
  }
  if (opts.overdueOnly) {
    where.push(`st.target_review_date < CURRENT_DATE AND COALESCE(st.status, '') NOT IN ('Resolved', 'Deferred')`)
  }
  if (opts.search) {
    where.push(
      `(c.name ILIKE ? OR COALESCE(s.name,'') ILIKE ? OR COALESCE(d.name,'') ILIKE ? OR COALESCE(rg.name,'') ILIKE ?)`
    )
    const like = `%${opts.search}%`
    params.push(like, like, like, like)
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  // cell scope selects p.score directly; site/district aggregate it to the
  // `score` alias, so ORDER BY must reference the alias there (p.score is not
  // in the GROUP BY). `name` is selected in every scope.
  const scoreKey = scope === 'cell' ? 'p.score' : 'score'
  const sortSql =
    opts.sort === 'due'
      ? `ORDER BY st.target_review_date ASC NULLS LAST, ${scoreKey} DESC NULLS LAST, name`
      : opts.sort === 'name'
        ? `ORDER BY name, ${scoreKey} DESC NULLS LAST`
        : `ORDER BY ${scoreKey} DESC NULLS LAST, name`

  const from = `
    FROM ${cfg.from}
    LEFT JOIN cell_priority_history p
      ON p.cell_id = c.cell_id AND p.mode = ? AND p.as_of = (
        SELECT max(as_of) FROM cell_priority_history WHERE mode = ?
      )
    LEFT JOIN entity_action_status st
      ON st.entity_type = ? AND st.entity_id = ${cfg.eId}
    LEFT JOIN agg_cell_weekly w
      ON w.cell_id = c.cell_id AND w.week_start = (SELECT max(week_start) FROM agg_cell_weekly)
  `
  const base = `${from} ${whereSql}`

  const countR = await conn.runAndReadAll(`SELECT count(*) AS n ${base} ${cfg.groupBy}`, params)
  const countRows = countR.getRowObjects()
  const total = scope === 'cell' ? Number(countRows[0]?.n ?? 0) : countRows.length
  // rollup per status: subquery groups entities first (site/district) or emits
  // one row per cell, then we count per status — DuckDB rejects a bare column
  // next to count(*) without GROUP BY, so the grouping lives in the subquery
  const statusR = await conn.runAndReadAll(
    `SELECT COALESCE(x.status, 'unset') AS status, count(*) AS n
     FROM (SELECT st.status ${base} ${cfg.groupBy}) x
     GROUP BY COALESCE(x.status, 'unset') ORDER BY n DESC`,
    params
  )
  const byStatus: Record<string, number> = {}
  for (const x of statusR.getRowObjects()) {
    byStatus[String(x.status)] = Number(x.n)
  }
  const overdueR = await conn.runAndReadAll(
    `SELECT count(*) AS n
     ${from}
     WHERE st.target_review_date < CURRENT_DATE
       AND COALESCE(st.status, '') NOT IN ('Resolved', 'Deferred')
       ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
     ${cfg.groupBy}`,
    params
  )
  const overdueTotal = scope === 'cell'
    ? Number(overdueR.getRowObjects()[0]?.n ?? 0)
    : overdueR.getRowObjects().length

  const r = await conn.runAndReadAll(
    `SELECT ${cfg.sel} ${base} ${cfg.groupBy} ${sortSql} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  const today = new Date().toISOString().slice(0, 10)
  const rows: PriorityCenterRow[] = r.getRowObjects().map((x) => {
    const score = x.score == null ? null : Number(x.score)
    let band: PriorityBand | null = null
    if (score != null) {
      band = (BANDS.find((b) => score >= b.lo && score <= b.hi)?.band ?? 'Low') as PriorityBand
    }
    const path = [x.r, x.d, x.s2].filter((v): v is string => v != null && v !== '')
    path.push(String(x.name ?? ''))
    const reviewDate = x.review_date ? String(x.review_date) : null
    const st = x.status ? (String(x.status) as ActionStatus) : null
    const overdue =
      reviewDate != null && reviewDate < today && st !== 'Resolved' && st !== 'Deferred'
    return {
      id: Number(x.id),
      name: String(x.name ?? ''),
      scope,
      path,
      priorityScore: score,
      priorityBand: band,
      status: st,
      owner: x.owner ? String(x.owner) : null,
      externalTicket: x.external_ticket ? String(x.external_ticket) : null,
      targetReviewDate: reviewDate,
      overdue,
      ncCells: Number(x.is_nc ?? x.nc ?? 0),
      cells: Number(x.cells ?? 1),
      prbAvg: x.prb == null ? null : Number(x.prb)
    }
  })
  return { total, rows, byStatus, overdue: overdueTotal }
}

// --- forecasting & early warning (§45–46) -----------------------------------

const FORECAST_METRICS: Array<{
  metric: ForecastMetric
  label: string
  unit: string
  worseIsHigher: boolean
}> = [
  { metric: 'prb', label: 'PRB utilization', unit: '%', worseIsHigher: true },
  { metric: 'traffic', label: 'Data volume', unit: 'MB', worseIsHigher: false },
  { metric: 'users', label: 'Connected users', unit: '', worseIsHigher: false },
  { metric: 'throughput', label: 'DL throughput', unit: 'kbps', worseIsHigher: false },
  { metric: 'availability', label: 'Availability', unit: '%', worseIsHigher: false }
]

const RISK_RANK: Record<ForecastRisk, number> = {
  'Already Breached': 0,
  'Likely Breach': 1,
  'At Risk': 2,
  Watch: 3,
  Stable: 4
}

/** ISO week label (W31-style), mirroring the renderer's weekLabel. */
function weekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)
  return 'W' + week
}

function horizonWeeks(h: ForecastHorizon): number {
  return h === '1w' ? 1 : h === '2w' ? 2 : h === '4w' ? 4 : 6
}

function addWeeks(dateStr: string, weeks: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + weeks * 7)
  return d.toISOString().slice(0, 10)
}

function forecastThreshold(metric: ForecastMetric, prbThreshold: number): number | null {
  if (metric === 'prb') return prbThreshold
  if (metric === 'availability') return 99.5
  if (metric === 'throughput') return 10_000 // ~10 Mbps floor
  return null // users / volume: no hard threshold — classify by trajectory
}

/** Forecasting & Early Warning (§45–46): simple-first forecasts for the
 *  network or any entity, with early-warning risk states per cell.
 *  History is read from agg_cell_weekly; all math runs in JS (forecast.ts)
 *  so the same model serves network/entity series and per-cell risk rows. */
export async function getForecast(opts: {
  scope?: ForecastScope
  entityId?: number | null
  metric?: ForecastMetric
  horizon?: ForecastHorizon
} = {}): Promise<ForecastResult> {
  const conn = ws().connection
  const scope: ForecastScope = opts.scope ?? 'network'
  const entityId = opts.entityId ?? null
  const metric: ForecastMetric = opts.metric ?? 'prb'
  const horizon: ForecastHorizon = opts.horizon ?? '4w'
  const weeksAhead = horizonWeeks(horizon)
  const metricDef = FORECAST_METRICS.find((m) => m.metric === metric)!

  const rules = await getRules(conn)
  const prbThreshold = rules?.prbThresholdPct ?? 80
  const threshold = forecastThreshold(metric, prbThreshold)

  const scopeWhere =
    scope === 'network' ? ''
    : scope === 'region' ? `AND rg.region_id = ${Number(entityId)}`
    : scope === 'district' ? `AND d.district_id = ${Number(entityId)}`
    : scope === 'site' ? `AND s.site_id = ${Number(entityId)}`
    : `AND c.cell_id = ${Number(entityId)}`

  // one pass: every cell-week under the scope, with hierarchy for paths
  const r = await conn.runAndReadAll(`
    SELECT c.cell_id,
      CAST(w.week_start AS VARCHAR) AS week_start,
      w.prb_avg, w.dl_throughput_kbps_avg, w.connected_users_sum,
      w.data_volume_mb_sum, w.availability_pct_avg, w.is_nc,
      rg.name AS region, d.name AS district, s.name AS site, c.name AS cell
    FROM agg_cell_weekly w
    JOIN dim_cell c ON c.cell_id = w.cell_id
    LEFT JOIN dim_site s ON s.site_id = c.site_id
    LEFT JOIN dim_district d ON d.district_id = c.district_id
    LEFT JOIN dim_region rg ON rg.region_id = c.region_id
    WHERE 1 = 1 ${scopeWhere}
    ORDER BY w.week_start, c.cell_id
  `)
  const rows = r.getRowObjects()
  if (rows.length === 0) {
    throw new Error(`No weekly history for ${scope} ${entityId ?? ''}`)
  }

  // per-cell series, plus entity metadata from the first row
  const cells = new Map<number, { region: string; district: string; site: string; cell: string; weeks: Map<string, { prb: number; thr: number; usr: number; vol: number; avail: number; isNc: boolean }> }>()
  for (const x of rows) {
    const id = Number(x.cell_id)
    let c = cells.get(id)
    if (!c) {
      c = { region: String(x.region ?? ''), district: String(x.district ?? ''), site: String(x.site ?? ''), cell: String(x.cell ?? ''), weeks: new Map() }
      cells.set(id, c)
    }
    c.weeks.set(String(x.week_start), {
      prb: x.prb_avg == null ? NaN : Number(x.prb_avg),
      thr: x.dl_throughput_kbps_avg == null ? NaN : Number(x.dl_throughput_kbps_avg),
      usr: x.connected_users_sum == null ? NaN : Number(x.connected_users_sum),
      vol: x.data_volume_mb_sum == null ? NaN : Number(x.data_volume_mb_sum),
      avail: x.availability_pct_avg == null ? NaN : Number(x.availability_pct_avg),
      isNc: Boolean(x.is_nc)
    })
  }
  const cellList = [...cells.values()]

  // week axis = union of weeks (sorted); entity series aggregates all its cells
  const weekStarts = [...new Set(rows.map((x) => String(x.week_start)))].sort()

  const pick = (m: ForecastMetric, w: { prb: number; thr: number; usr: number; vol: number; avail: number; isNc: boolean } | undefined): number | null => {
    if (!w) return null
    const v = m === 'prb' ? w.prb : m === 'throughput' ? w.thr : m === 'users' ? w.usr : m === 'traffic' ? w.vol : w.avail
    return Number.isFinite(v) ? v : null
  }

  const entityPath = (first: typeof cellList[number]): string[] => {
    const p = [first.region, first.district, first.site].filter((s) => s !== '')
    if (scope === 'cell') p.push(first.cell)
    else if (scope === 'network') p.unshift('Network')
    return p
  }
  const first = cellList[0]
  const entityName =
    scope === 'network' ? 'Network' :
    scope === 'region' ? first.region :
    scope === 'district' ? first.district :
    scope === 'site' ? first.site : first.cell

  // entity-level weekly series for every metric
  const series: ForecastSeries[] = FORECAST_METRICS.map((m) => {
    const points: ForecastPoint[] = weekStarts.map((ws0) => {
      const vals = cellList.map((c) => pick(m.metric, c.weeks.get(ws0))).filter((v): v is number => v != null)
      if (vals.length === 0) return { weekStart: ws0, label: weekLabel(ws0), value: null, kind: 'actual' as const, lower: null, upper: null }
      const value = m.metric === 'users' || m.metric === 'traffic'
        ? vals.reduce((a, b) => a + b, 0)
        : vals.reduce((a, b) => a + b, 0) / vals.length
      return { weekStart: ws0, label: weekLabel(ws0), value: Math.round(value * 100) / 100, kind: 'actual' as const, lower: null, upper: null }
    })
    const fc = forecastSeries(
      points.map((p) => ({ weekStart: p.weekStart, value: p.value })),
      m.label,
      m.unit
    )
    // append forecast points at week + 1..weeksAhead
    let lastWeek = weekStarts[weekStarts.length - 1]
    for (let i = 1; i <= weeksAhead; i++) {
      lastWeek = addWeeks(lastWeek, 7)
      points.push({
        weekStart: lastWeek,
        label: weekLabel(lastWeek),
        value: fc.next == null ? null : Math.round(fc.next * 100) / 100,
        kind: 'forecast',
        lower: fc.lower == null ? null : Math.round(fc.lower * 100) / 100,
        upper: fc.upper == null ? null : Math.round(fc.upper * 100) / 100
      })
    }
    return {
      metric: m.metric,
      label: m.label,
      unit: m.unit,
      worseIsHigher: m.worseIsHigher,
      threshold: forecastThreshold(m.metric, prbThreshold),
      points,
      forecast: fc
    }
  })

  // risk rows: per-cell forecast for the selected metric, worst first
  const historyByCell = new Map<number, { name: string; path: string[]; isNc: boolean; values: Array<{ weekStart: string; value: number | null }> }>()
  for (const [id, c] of cells) {
    const path = [c.region, c.district, c.site, c.cell].filter((s) => s !== '')
    const values = weekStarts.map((ws0) => ({ weekStart: ws0, value: pick(metric, c.weeks.get(ws0)) }))
    historyByCell.set(id, { name: c.cell, path, isNc: [...c.weeks.values()].some((w) => w.isNc), values })
  }
  const riskRows: ForecastRiskRow[] = []
  for (const [id, h] of historyByCell) {
    const fc = forecastSeries(h.values, metricDef.label, metricDef.unit)
    const history = h.values.map((v) => v.value).filter((v): v is number => v != null)
    const cls = classifyRisk({
      metric,
      threshold,
      worseIsHigher: metricDef.worseIsHigher,
      history,
      forecast: fc.next,
      label: metricDef.label
    })
    riskRows.push({
      id,
      name: h.name,
      path: h.path.slice(0, -1),
      current: history.length > 0 ? Math.round(history[history.length - 1] * 100) / 100 : null,
      forecast: fc.next == null ? null : Math.round(fc.next * 100) / 100,
      threshold,
      risk: cls.risk,
      explanation: cls.explanation,
      cells: 1,
      ncCells: h.isNc ? 1 : 0
    })
  }
  riskRows.sort((a, b) => {
    const d = RISK_RANK[a.risk] - RISK_RANK[b.risk]
    if (d !== 0) return d
    return (b.current ?? -Infinity) - (a.current ?? -Infinity)
  })
  const totalEntities = riskRows.length
  const riskCounts: Record<ForecastRisk, number> = { Stable: 0, Watch: 0, 'At Risk': 0, 'Likely Breach': 0, 'Already Breached': 0 }
  for (const row of riskRows) riskCounts[row.risk]++

  // entity-level risk from the selected metric's aggregate series
  const selSeries = series.find((s) => s.metric === metric)!
  const selHistory = selSeries.points.filter((p) => p.kind === 'actual').map((p) => p.value).filter((v): v is number => v != null)
  const selFc = selSeries.forecast
  const entityRisk = classifyRisk({
    metric,
    threshold,
    worseIsHigher: metricDef.worseIsHigher,
    history: selHistory,
    forecast: selFc.next,
    label: metricDef.label
  })

  return {
    asOf: weekStarts[weekStarts.length - 1],
    horizon,
    metric,
    entity: { scope, id: entityId, name: entityName, path: entityPath(first) },
    series,
    risk: entityRisk.risk,
    riskExplanation: entityRisk.explanation,
    riskCounts,
    riskRows: riskRows.slice(0, 60),
    totalEntities
  }
}

function shortKey(m: CompareMetric): string {
  return m === 'throughput' ? 'thr' : m === 'users' ? 'usr' : m === 'volume' ? 'vol' : m === 'availability' ? 'avail' : m
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

export async function getSummary(): Promise<Summary | null> {
  const ws = getCurrent()
  if (!ws) return null
  const r = await ws.connection.runAndReadAll(`
    SELECT
      (SELECT count(*) FROM fact_cell_daily) AS row_count,
      (SELECT CAST(min(d.date) AS VARCHAR) FROM fact_cell_daily f JOIN dim_date d USING (date_id)) AS min_date,
      (SELECT CAST(max(d.date) AS VARCHAR) FROM fact_cell_daily f JOIN dim_date d USING (date_id)) AS max_date,
      (SELECT count(*) FROM dim_cell) AS cells,
      (SELECT count(*) FROM dim_site) AS sites,
      (SELECT count(*) FROM dim_district) AS districts,
      (SELECT count(*) FROM dim_region) AS regions,
      (SELECT max(version) FROM ruleset) AS ruleset_version,
      (SELECT count(*) FROM agg_cell_weekly WHERE is_nc) AS weekly_nc_cells,
      (SELECT count(*) FROM agg_cell_weekly) AS weekly_total_rows,
      (SELECT avg(prb_utilization) FROM fact_cell_daily) AS avg_prb,
      (SELECT sum(data_volume_mb) FROM fact_cell_daily) AS total_volume_mb,
      (SELECT sum(connected_users) FROM fact_cell_daily) AS total_users,
      (SELECT avg(dl_throughput_kbps) FROM fact_cell_daily) AS avg_throughput_kbps,
      (SELECT avg(availability_pct) FROM fact_cell_daily) AS avg_availability
  `)
  const row = r.getRowObjects()[0]
  return {
    rowCount: Number(row.row_count ?? 0),
    minDate: row.min_date ? String(row.min_date) : null,
    maxDate: row.max_date ? String(row.max_date) : null,
    cells: Number(row.cells ?? 0),
    sites: Number(row.sites ?? 0),
    districts: Number(row.districts ?? 0),
    regions: Number(row.regions ?? 0),
    rulesetVersion: row.ruleset_version == null ? null : Number(row.ruleset_version),
    weeklyNcCells: Number(row.weekly_nc_cells ?? 0),
    weeklyTotalRows: Number(row.weekly_total_rows ?? 0),
    avgPrb: row.avg_prb == null ? null : Number(row.avg_prb),
    totalVolumeMb: row.total_volume_mb == null ? null : Number(row.total_volume_mb),
    totalUsers: row.total_users == null ? null : Number(row.total_users),
    avgThroughputKbps: row.avg_throughput_kbps == null ? null : Number(row.avg_throughput_kbps),
    avgAvailability: row.avg_availability == null ? null : Number(row.avg_availability)
  }
}
