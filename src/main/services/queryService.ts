import type { DuckDBConnection } from '@duckdb/node-api'
import { getCurrent } from '../workspace/manager'
import type {
  Summary, NcLifecycleResult, NcLifecycleRow, NcMovementRow, PriorityMode, PriorityRow,
  Grain, PeriodId,
  HealthResult, CellHealthRow, HealthScope, HealthMatrixResult,
  CellIntelligenceResult, CellIntelligenceRow, CellDetail, CellWeekPoint, Lifecycle,
  Trend, Severity,  Rules, RulesPatch, PerformanceResult, MetricDistribution,
  ScatterPoint, ScatterQuadrant, CorrelationRow, PerfMetric,
  ComparisonResult, ComparisonKpi, ComparisonRow, ComparisonType,
  CompareScope, CompareMetric, NcTransition,
  ExplorerLevel, ExplorerResult, ExplorerNode, ExplorerBreadcrumb,
  RegionMapRow, DistrictMapRow, KpiMapMetric,
  InvestigationScope, ActionStatus, PriorityBand, PriorityCenterOpts,
  PriorityCenterResult, PriorityCenterRow, ForecastMetric, ForecastHorizon,
  ForecastRisk, ForecastResult, ForecastRiskRow, ForecastSeries, ForecastPoint,
  ForecastScope, CellKpiValue, KpiOverviewResult, KpiOverviewKpi, KpiOverviewCell,
  KpiTrendPoint, Technology, ExecutiveOverviewResult, ExecutiveKpiCardData,
  TechHealthCard, ExecutiveProblemSummary, KpiDefinition, DynamicKpiCardData
} from '../../../shared/api'
import { PRIORITY_MODES } from '../../../shared/api'
import { computeNetworkHealth } from '../analytics/health'
import { getRules, updateRules } from '../analytics/rules'
import { recomputeNcLifecycle } from '../analytics/nc'
import { forecastSeries, forecastTrajectory, classifyRisk } from '../analytics/forecast'
import { listKpiDefs, workspaceTechnology } from './kpiService'

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

/** Spec §54a: per-technology KPI breach summary + worst cells for the latest
 *  week, driven entirely by the imported extra KPI values vs editable targets.
 *  Reads technology straight from workspace_meta (no service imports) so the
 *  analytics bundle stays cycle-free. */
export async function getKpiOverview(limit = 8, _grain: Grain = 'weekly'): Promise<KpiOverviewResult> {
  const w = getCurrent()
  if (!w) return { technology: '4G', weekStart: null, kpis: [], worstCells: [] }
  const conn = w.connection
  const techR = await conn.runAndReadAll(
    `SELECT value FROM workspace_meta WHERE key = 'technology'`
  )
  const raw = techR.getRowObjects()[0]?.value
  const tech: Technology = raw === '2G' || raw === '3G' ? (String(raw) as Technology) : '4G'

  const latestR = await conn.runAndReadAll(
    `SELECT max(week_start) AS ws FROM agg_cell_kpi_weekly`
  )
  const weekStart = latestR.getRowObjects()[0]?.ws
  if (weekStart == null) return { technology: tech, weekStart: null, kpis: [], worstCells: [] }

  const val = `CASE k.agg
    WHEN 'sum' THEN w.sum_value
    WHEN 'max' THEN w.max_value
    WHEN 'min' THEN w.min_value
    ELSE w.avg_value
  END`
  const sev = `CASE WHEN k.worse_is_higher THEN
      LEAST(100, GREATEST(0, (${val} - k.target) / NULLIF(k.target, 0) * 100))
    ELSE
      LEAST(100, GREATEST(0, (k.target - ${val}) / NULLIF(k.target, 0) * 100))
    END`
  const breach = `(${val} > k.target AND k.worse_is_higher
    OR ${val} < k.target AND NOT k.worse_is_higher)`
  const where = `WHERE w.week_start = ? AND k.technology = ? AND k.active AND k.target IS NOT NULL`

  const kpisR = await conn.runAndReadAll(
    `SELECT k.kpi_key AS key, k.label, k.unit, k.target, k.worse_is_higher,
       count(*) FILTER (WHERE ${breach}) AS breached_cells,
       count(*) AS observed_cells,
       ROUND(avg(${sev}) FILTER (WHERE ${breach}), 1) AS avg_severity
     FROM agg_cell_kpi_weekly w
     JOIN kpi_defs k ON k.kpi_id = w.kpi_id
     ${where}
     GROUP BY k.kpi_key, k.label, k.unit, k.target, k.worse_is_higher
     ORDER BY avg_severity DESC NULLS LAST, breached_cells DESC
     LIMIT ?`,
    [String(weekStart), tech, limit]
  )
  const kpis: KpiOverviewKpi[] = kpisR.getRowObjects().map((x) => ({
    key: String(x.key),
    label: String(x.label),
    unit: String(x.unit ?? ''),
    target: x.target == null ? null : Number(x.target),
    worseIsHigher: Boolean(x.worse_is_higher),
    breachedCells: Number(x.breached_cells ?? 0),
    observedCells: Number(x.observed_cells ?? 0),
    avgSeverity: x.avg_severity == null ? null : Number(x.avg_severity),
    trend: []
  }))

  const cellsR = await conn.runAndReadAll(
    `SELECT c.cell_id, c.name AS cell_name, s.name AS site, d.name AS district,
       count(*) FILTER (WHERE ${breach}) AS breached_kpis,
       ROUND(avg(${sev}) FILTER (WHERE ${breach}), 1) AS breach_score
     FROM agg_cell_kpi_weekly w
     JOIN kpi_defs k ON k.kpi_id = w.kpi_id
     JOIN dim_cell c ON c.cell_id = w.cell_id
     LEFT JOIN dim_site s ON s.site_id = c.site_id
     LEFT JOIN dim_district d ON d.district_id = c.district_id
     ${where}
     GROUP BY c.cell_id, c.name, s.name, d.name
     HAVING count(*) FILTER (WHERE ${breach}) > 0
     ORDER BY breach_score DESC NULLS LAST
     LIMIT ?`,
    [String(weekStart), tech, limit]
  )
  const worstCells: KpiOverviewCell[] = cellsR.getRowObjects().map((x) => ({
    cellId: Number(x.cell_id),
    cellName: String(x.cell_name),
    site: x.site ? String(x.site) : null,
    district: x.district ? String(x.district) : null,
    breachScore: x.breach_score == null ? null : Number(x.breach_score),
    breachedKpis: Number(x.breached_kpis ?? 0)
  }))

  // weekly value history per KPI (last 12 weeks) for the trend sparklines;
  // a week counts as breached when any cell breached the target that week
  const trendR = await conn.runAndReadAll(
    `SELECT k.kpi_key AS key, w.week_start,
       ROUND(avg(${val}), 1) AS value,
       count(*) FILTER (WHERE ${breach}) AS breached_cells
     FROM agg_cell_kpi_weekly w
     JOIN kpi_defs k ON k.kpi_id = w.kpi_id
     WHERE k.technology = ? AND k.active AND k.target IS NOT NULL
       AND w.week_start >= (SELECT max(week_start) FROM agg_cell_kpi_weekly) - INTERVAL 11 WEEK
     GROUP BY k.kpi_key, w.week_start
     ORDER BY w.week_start`,
    [tech]
  )
  const trendByKey = new Map<string, KpiTrendPoint[]>()
  for (const x of trendR.getRowObjects()) {
    const key = String(x.key)
    const list = trendByKey.get(key) ?? []
    list.push({
      weekStart: String(x.week_start ?? ''),
      value: x.value == null ? null : Number(x.value),
      breached: Number(x.breached_cells ?? 0) > 0
    })
    trendByKey.set(key, list)
  }
  for (const k of kpis) k.trend = trendByKey.get(k.key) ?? []

  return { technology: tech, weekStart: String(weekStart), kpis, worstCells }
}

export async function updateRulesCurrent(patch: RulesPatch): Promise<Rules> {
  return updateRules(ws().connection, patch)
}

async function ensureGrainLifecyclePopulated(conn: DuckDBConnection, grain: Grain): Promise<void> {
  const checkR = await conn.runAndReadAll(`
    SELECT count(*) AS n FROM cell_nc_lifecycle WHERE grain = '${grain}'
  `)
  if (Number(checkR.getRowObjects()[0]?.n ?? 0) === 0) {
    const cellsR = await conn.runAndReadAll(`SELECT DISTINCT cell_id FROM fact_cell_daily`)
    const cellIds = cellsR.getRowObjects().map((r) => Number(r.cell_id)).filter((id) => !isNaN(id))
    if (cellIds.length > 0) {
      await recomputeNcLifecycle(conn, cellIds)
    }
  }
}

/** Weekly NC movement (spec §28): lifecycle counts per week, newest last, plus Core KPI breach rates. */
export async function getNcMovement(
  limit = 8,
  grain: Grain = 'weekly',
  technology?: Technology
): Promise<NcMovementRow[]> {
  const conn = ws().connection
  const tech: Technology = technology || await workspaceTechnology(conn)
  const safeGrain = grain === 'daily' || grain === 'monthly' ? grain : 'weekly'
  await ensureGrainLifecyclePopulated(conn, safeGrain)
  const r = await conn.runAndReadAll(`
    SELECT CAST(period_start AS VARCHAR) AS week_start,
      count(*) FILTER (WHERE lifecycle = 'New NC') AS new_nc,
      count(*) FILTER (WHERE lifecycle = 'Recurring NC') AS recurring,
      count(*) FILTER (WHERE lifecycle = 'Persistent NC') AS persistent,
      count(*) FILTER (WHERE lifecycle = 'Recovering') AS recovering,
      count(*) FILTER (WHERE is_nc) AS nc_cells,
      count(*) AS total_cells
    FROM cell_nc_lifecycle
    WHERE grain = '${safeGrain}'
      AND ruleset_version = (SELECT max(version) FROM ruleset)
    GROUP BY period_start
    ORDER BY period_start DESC
    LIMIT ?
  `, [limit])
  const rows = r.getRowObjects().reverse()
  const weekStarts = rows.map((x) => String(x.week_start))

  // Query Core KPI breach rates for the active technology
  const coreKpiTrend = new Map<string, Record<string, { key: string; label: string; unit: string; ncRate: number; breachedCells: number; totalCells: number; worseIsHigher: boolean }>>()
  if (weekStarts.length > 0) {
    try {
      const kpisR = await conn.runAndReadAll(`
        SELECT CAST(w.week_start AS VARCHAR) AS week_start,
          k.kpi_key, k.label, k.unit, k.worse_is_higher,
          count(DISTINCT w.cell_id) AS total_cells,
          count(DISTINCT CASE WHEN (
            (k.worse_is_higher AND w.avg_value > k.target) OR
            (NOT k.worse_is_higher AND w.avg_value < k.target)
          ) THEN w.cell_id END) AS breached_cells
        FROM agg_cell_kpi_weekly w
        JOIN kpi_defs k ON k.kpi_id = w.kpi_id
        WHERE k.technology = '${tech}' AND k.is_core AND k.active AND k.target IS NOT NULL
        GROUP BY w.week_start, k.kpi_key, k.label, k.unit, k.worse_is_higher
      `)
      for (const kx of kpisR.getRowObjects()) {
        const wsStr = String(kx.week_start)
        const kKey = String(kx.kpi_key)
        const total = Number(kx.total_cells ?? 0)
        const breached = Number(kx.breached_cells ?? 0)
        const ncRate = total > 0 ? Math.round((breached / total) * 1000) / 10 : 0
        let m = coreKpiTrend.get(wsStr)
        if (!m) {
          m = {}
          coreKpiTrend.set(wsStr, m)
        }
        m[kKey] = {
          key: kKey,
          label: String(kx.label),
          unit: String(kx.unit ?? ''),
          ncRate,
          breachedCells: breached,
          totalCells: total,
          worseIsHigher: Boolean(kx.worse_is_higher)
        }
      }
    } catch {
      /* fallback if extra kpis table not yet populated */
    }
  }

  return rows.map((x) => {
    const wsStr = String(x.week_start)
    const total = Number(x.total_cells ?? 0)
    const nc = Number(x.nc_cells ?? 0)
    return {
      weekStart: wsStr,
      newNc: Number(x.new_nc ?? 0),
      recurring: Number(x.recurring ?? 0),
      persistent: Number(x.persistent ?? 0),
      recovering: Number(x.recovering ?? 0),
      ncCells: nc,
      totalCells: total,
      ncRate: total > 0 ? Math.round((nc / total) * 1000) / 10 : null,
      coreKpiNcRates: coreKpiTrend.get(wsStr)
    }
  })
}

/** Latest completed period lifecycle/trend/severity summary + per-cell rows. */
export async function getNcLifecycle(grain: Grain = 'weekly'): Promise<NcLifecycleResult> {
  const conn = ws().connection
  const rules = await getRules(conn)
  const safeGrain = grain === 'daily' || grain === 'monthly' ? grain : 'weekly'
  await ensureGrainLifecyclePopulated(conn, safeGrain)
  const empty: NcLifecycleResult = {
    weekStart: null,
    totalCells: 0,
    ncCells: 0,
    ncRate: null,
    byLifecycle: { Healthy: 0, 'New NC': 0, 'Recurring NC': 0, 'Persistent NC': 0, 'Chronic NC': 0, Recovering: 0 },
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
    WHERE l.ruleset_version = ${rules.version} AND l.grain = '${safeGrain}'
      AND l.period_start = (SELECT max(period_start) FROM cell_nc_lifecycle WHERE grain = '${safeGrain}')
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
  const byLifecycle = { Healthy: 0, 'New NC': 0, 'Recurring NC': 0, 'Persistent NC': 0, 'Chronic NC': 0, Recovering: 0 }
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
  const safeMode = mode.replace(/'/g, "''")
  const r = await conn.runAndReadAll(`
    SELECT CAST(p.cell_id AS DOUBLE) AS cell_id, c.name AS cell_name,
      s.name AS site, d.name AS district, rg.name AS region,
      CAST(p.as_of AS VARCHAR) AS as_of, p.score, p.band, p.mode, p.weights
    FROM cell_priority_history p
    JOIN dim_cell c ON c.cell_id = p.cell_id
    LEFT JOIN dim_site s ON s.site_id = c.site_id
    LEFT JOIN dim_district d ON d.district_id = c.district_id
    LEFT JOIN dim_region rg ON rg.region_id = c.region_id
    WHERE p.mode = '${safeMode}' AND p.as_of = (
      SELECT max(as_of) FROM cell_priority_history WHERE mode = '${safeMode}'
    )
    ORDER BY p.score DESC, p.cell_id
    LIMIT ${Number(limit)}
  `)
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
    `WITH target_weeks AS (
       SELECT DISTINCT date_id FROM cell_health_history ORDER BY date_id DESC LIMIT ${weeksN}
     ),
     latest_week AS (
       SELECT max(date_id) AS max_date_id FROM target_weeks
     ),
     ranked_entities AS (
       SELECT ${sel.id} AS entity_id, ${sel.name} AS entity_name,
              avg(CASE WHEN h.date_id = (SELECT max_date_id FROM latest_week) THEN h.health_score END) AS latest_score
       FROM cell_health_history h
       JOIN dim_cell c ON c.cell_id = h.cell_id
       ${sel.join}
       WHERE h.date_id IN (SELECT date_id FROM target_weeks)
       GROUP BY ${sel.id}, ${sel.name}
       ORDER BY ${sort === 'worst' ? 'latest_score ASC NULLS LAST, entity_name ASC' : 'entity_name ASC'}
       LIMIT ${limit}
     )
     SELECT r.entity_id, r.entity_name,
            CAST(h.date_id AS DOUBLE) AS date_id,
            ROUND(avg(h.health_score), 1) AS score
     FROM cell_health_history h
     JOIN dim_cell c ON c.cell_id = h.cell_id
     ${sel.join}
     JOIN ranked_entities r ON r.entity_id = ${sel.id}
     WHERE h.date_id IN (SELECT date_id FROM target_weeks)
     GROUP BY r.entity_id, r.entity_name, h.date_id
     ORDER BY r.entity_name, h.date_id`
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
  if (opts.search) {
    const esc = opts.search.replace(/'/g, "''")
    where.push(`(c.name ILIKE '%${esc}%' OR COALESCE(s.name,'') ILIKE '%${esc}%' OR COALESCE(d.name,'') ILIKE '%${esc}%')`)
  }
  if (opts.lifecycle) {
    where.push(`l.lifecycle = '${opts.lifecycle.replace(/'/g, "''")}'`)
  }
  if (opts.trend) {
    where.push(`l.trend = '${opts.trend.replace(/'/g, "''")}'`)
  }
  if (opts.severity) {
    where.push(`l.severity = '${opts.severity.replace(/'/g, "''")}'`)
  }
  if (opts.minPriority != null && opts.minPriority > 0) {
    where.push(`p.score >= ${Number(opts.minPriority)}`)
  }
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
  const totalR = await conn.runAndReadAll(`SELECT count(*) AS n ${base}`)
  const total = Number(totalR.getRowObjects()[0].n)
  const r = await conn.runAndReadAll(
    `SELECT l.cell_id, c.name AS cell_name, s.name AS site, d.name AS district, rg.name AS region,
        CAST(l.period_start AS VARCHAR) AS week_start, l.is_nc, l.lifecycle, l.trend, l.severity,
        l.prb_avg, CAST(l.breach_days AS DOUBLE) AS breach_days,
        w.dl_throughput_kbps_avg, w.connected_users_sum, w.data_volume_mb_sum,
        w.availability_pct_avg, p.score AS priority_score, p.band AS priority_band
      ${base}
      ORDER BY p.score DESC NULLS LAST, l.cell_id
      LIMIT ${limit} OFFSET ${offset}`
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
     WHERE w.cell_id IN (${cellIds.join(',')}) AND w.week_start = '${weekStart.replace(/'/g, "''")}' AND k.active
     ORDER BY k.sort_order, k.kpi_key`
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

/** Time-series history for one cell — the drawer's aligned time-series source. */
export async function getCellDetail(cellId: number, grain: Grain = 'weekly'): Promise<CellDetail | null> {
  const conn = ws().connection
  const numCellId = Number(cellId)
  const g: Grain = grain === 'daily' || grain === 'monthly' ? grain : 'weekly'
  const aggTable = g === 'daily' ? 'agg_cell_daily' : g === 'monthly' ? 'agg_cell_monthly' : 'agg_cell_weekly'
  const dateCol = g === 'daily' ? 'w.date' : g === 'monthly' ? 'w.month_start' : 'w.week_start'

  const dimR = await conn.runAndReadAll(
    `SELECT CAST(c.cell_id AS DOUBLE) AS cell_id, c.name AS cell_name,
       s.name AS site, d.name AS district, rg.name AS region
     FROM dim_cell c
     LEFT JOIN dim_site s ON s.site_id = c.site_id
     LEFT JOIN dim_district d ON d.district_id = c.district_id
     LEFT JOIN dim_region rg ON rg.region_id = c.region_id
     WHERE c.cell_id = ${numCellId}`
  )
  const dim = dimR.getRowObjects()[0]
  if (!dim) return null
  const curR = await conn.runAndReadAll(
    `SELECT CAST(p.score AS DOUBLE) AS score, p.band, CAST(p.as_of AS VARCHAR) AS as_of
     FROM cell_priority_history p
     WHERE p.cell_id = ${numCellId} AND p.mode = 'balanced'
       AND p.as_of = (SELECT max(as_of) FROM cell_priority_history WHERE cell_id = ${numCellId} AND mode = 'balanced')
     LIMIT 1`
  )
  const cur = curR.getRowObjects()[0]
  const lifeR = await conn.runAndReadAll(
    `SELECT CAST(period_start AS VARCHAR) AS week_start, lifecycle, trend, severity,
       is_nc, prb_avg
     FROM cell_nc_lifecycle
     WHERE cell_id = ${numCellId} AND grain = '${g}'
       AND ruleset_version = (SELECT max(version) FROM ruleset)
       AND period_start = (SELECT max(period_start) FROM cell_nc_lifecycle
         WHERE cell_id = ${numCellId} AND grain = '${g}')
     LIMIT 1`
  )
  const life = lifeR.getRowObjects()[0]
  const wkR = await conn.runAndReadAll(
    `SELECT CAST(${dateCol} AS VARCHAR) AS week_start,
       w.prb_avg, w.dl_throughput_kbps_avg, w.connected_users_sum,
       w.data_volume_mb_sum, w.availability_pct_avg,
       CAST(w.breach_days AS DOUBLE) AS breach_days,
       COALESCE(l.is_nc, false) AS is_nc,
       COALESCE(l.lifecycle, 'Healthy') AS lifecycle,
       COALESCE(l.severity, 'Normal') AS severity
     FROM ${aggTable} w
     LEFT JOIN cell_nc_lifecycle l
       ON l.cell_id = w.cell_id AND l.period_start = ${dateCol}
       AND l.grain = '${g}' AND l.ruleset_version = (SELECT max(version) FROM ruleset)
     WHERE w.cell_id = ${numCellId}
     ORDER BY ${dateCol}`
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
export async function getHealth(grain: Grain = 'weekly'): Promise<HealthResult> {
  const conn = ws().connection
  const network = await computeNetworkHealth(conn, grain)
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

/** Performance Analysis: metric percentile distributions, cross-KPI scatter
 *  with quadrant bands, and correlation table. */
export async function getPerformance(opts?: {
  grain?: Grain
  period?: PeriodId
  technology?: Technology
}): Promise<PerformanceResult> {
  const conn = ws().connection
  const rules = await getRulesCurrent()
  const prbThreshold = rules?.prbThresholdPct ?? 80
  const grain: Grain = opts?.grain === 'daily' || opts?.grain === 'monthly' ? opts.grain : 'weekly'
  const tech: Technology = opts?.technology || '4G'
  const aggTable = grain === 'daily' ? 'agg_cell_daily' : grain === 'monthly' ? 'agg_cell_monthly' : 'agg_cell_weekly'
  const kpiAggTable = grain === 'monthly' ? 'agg_cell_kpi_monthly' : 'agg_cell_kpi_weekly'
  const dateCol = grain === 'daily' ? 'date' : grain === 'monthly' ? 'month_start' : 'week_start'

  const wkR = await conn.runAndReadAll(
    `SELECT CAST(COALESCE(
       (SELECT max(${dateCol}) FROM ${kpiAggTable} k JOIN kpi_defs kd ON kd.kpi_id = k.kpi_id WHERE kd.technology = '${tech}'),
       (SELECT max(${dateCol}) FROM ${aggTable})
     ) AS VARCHAR) AS week_start`
  )
  const weekStart = String(wkR.getRowObjects()[0]?.week_start ?? '')
  const safeWeekStart = weekStart.replace(/'/g, "''")

  // 1. Fetch active KPI definitions for this technology
  const activeKpis: KpiDefinition[] = await listKpiDefs(conn, tech)

  const QUANTILES = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1]
  const distributions: MetricDistribution[] = []

  // 2. Compute distributions for each active KPI in this technology
  for (const k of activeKpis) {
    let qSql = ''
    if (grain === 'daily') {
      qSql = `
        SELECT quantile_cont(f.value, [${QUANTILES.join(',')}]) AS ps,
               avg(f.value) AS mean, min(f.value) AS min, max(f.value) AS max,
               quantile_cont(f.value, 0.5) AS p50, quantile_cont(f.value, 0.9) AS p90,
               count(*) AS n
        FROM fact_extra_metrics f
        JOIN dim_date d ON d.date_id = f.date_id
        WHERE f.kpi_id = ${k.kpiId} AND d.date = '${safeWeekStart}'
      `
    } else {
      qSql = `
        SELECT quantile_cont(w.avg_value, [${QUANTILES.join(',')}]) AS ps,
               avg(w.avg_value) AS mean, min(w.avg_value) AS min, max(w.avg_value) AS max,
               quantile_cont(w.avg_value, 0.5) AS p50, quantile_cont(w.avg_value, 0.9) AS p90,
               count(*) AS n
        FROM ${kpiAggTable} w
        WHERE w.kpi_id = ${k.kpiId} AND w.${dateCol} = '${safeWeekStart}'
      `
    }

    try {
      const r = await conn.runAndReadAll(qSql)
    const row = r.getRowObjects()[0]
      let items: Array<number | null> = []
      if (Array.isArray(row?.ps)) {
        items = row.ps as Array<number | null>
      } else if (row?.ps && typeof row?.ps === 'object' && 'items' in (row.ps as unknown as Record<string, unknown>)) {
        items = ((row.ps as unknown) as { items: Array<number | null> }).items ?? []
      }

      // Fallback to aggTable if metric is in standard columns
      if (items.length === 0 || row?.n === 0) {
        let col = ''
        if (
          k.key === 'prb_utilization' ||
          k.key === 'peak_hour_traffic_utilization_3g' ||
          k.key === 'ce_utilization' ||
          k.key === 'tch_congestion' ||
          k.key === 'sdcch_congestion'
        ) {
          col = 'prb_avg'
        } else if (
          k.key === 'dl_throughput' ||
          k.key === 'hsdpa_throughput' ||
          k.key === 'hsupa_throughput' ||
          k.key === 'gprs_throughput'
        ) {
          col = 'dl_throughput_kbps_avg'
        } else if (k.key === 'connected_users') {
          col = 'connected_users_sum'
        } else if (k.key === 'data_volume' || k.key === 'gprs_traffic') {
          col = 'data_volume_mb_sum'
        } else if (k.key === 'availability' || k.key === 'availability_3g' || k.key === 'tch_availability') {
          col = 'availability_pct_avg'
        }

        if (col) {
          const fb = await conn.runAndReadAll(
            `SELECT quantile_cont(${col}, [${QUANTILES.join(',')}]) AS ps,
                    avg(${col}) AS mean, min(${col}) AS min, max(${col}) AS max,
                    quantile_cont(${col}, 0.5) AS p50, quantile_cont(${col}, 0.9) AS p90,
                    count(*) AS n
             FROM ${aggTable} WHERE ${dateCol} = '${safeWeekStart}'`
          )
          const fbRow = fb.getRowObjects()[0]
          if (Array.isArray(fbRow?.ps)) items = fbRow.ps as Array<number | null>
          else if (fbRow?.ps && typeof fbRow?.ps === 'object' && 'items' in (fbRow.ps as unknown as Record<string, unknown>)) {
            items = ((fbRow.ps as unknown) as { items: Array<number | null> }).items ?? []
          }
          if (Number(fbRow?.n ?? 0) > 0 && items.length > 0 && items.some((v) => v != null)) {
            distributions.push({
              metric: k.key,
              kpiKey: k.key,
              label: k.label,
              unit: k.unit,
              target: k.target,
              worseIsHigher: k.worseIsHigher,
              isCore: k.isCore,
              points: QUANTILES.map((q, i) => ({
                p: q * 100,
                value: items[i] == null ? null : Number(items[i])
              })),
              mean: fbRow?.mean == null ? null : Number(fbRow.mean),
              min: fbRow?.min == null ? null : Number(fbRow.min),
              max: fbRow?.max == null ? null : Number(fbRow.max),
              p50: fbRow?.p50 == null ? null : Number(fbRow.p50),
              p90: fbRow?.p90 == null ? null : Number(fbRow.p90),
              n: Number(fbRow?.n ?? 0)
            })
          }
          continue
        }
      }

      if (Number(row?.n ?? 0) > 0 && items.length > 0 && items.some((v) => v != null)) {
        distributions.push({
          metric: k.key,
          kpiKey: k.key,
          label: k.label,
          unit: k.unit,
          target: k.target,
          worseIsHigher: k.worseIsHigher,
          isCore: k.isCore,
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
    } catch {
      // ignore single KPI failure
    }
  }

  // Also include native metrics if not already present
  if (!distributions.some((d) => d.metric === 'prb')) {
    const NATIVE: Array<{ metric: PerfMetric; label: string; unit: string; col: string; target?: number; worseIsHigher: boolean; isCore: boolean }> = [
      { metric: 'prb', label: 'PRB utilization', unit: '%', col: 'prb_avg', target: 80, worseIsHigher: true, isCore: true },
      { metric: 'throughput', label: 'DL throughput', unit: 'kbps', col: 'dl_throughput_kbps_avg', worseIsHigher: false, isCore: false },
      { metric: 'users', label: 'Connected users', unit: '', col: 'connected_users_sum', worseIsHigher: false, isCore: false },
      { metric: 'volume', label: 'Data volume', unit: 'MB', col: 'data_volume_mb_sum', worseIsHigher: false, isCore: false },
      { metric: 'availability', label: 'Availability', unit: '%', col: 'availability_pct_avg', target: 99, worseIsHigher: false, isCore: false }
    ]
    for (const m of NATIVE) {
      if (distributions.some((d) => d.metric === m.metric)) continue
      const r = await conn.runAndReadAll(
        `SELECT quantile_cont(${m.col}, [${QUANTILES.join(',')}]) AS ps,
                avg(${m.col}) AS mean, min(${m.col}) AS min, max(${m.col}) AS max,
                quantile_cont(${m.col}, 0.5) AS p50, quantile_cont(${m.col}, 0.9) AS p90,
                count(*) AS n
         FROM ${aggTable} WHERE ${dateCol} = '${safeWeekStart}'`
      )
      const row = r.getRowObjects()[0]
      let items: Array<number | null> = []
      if (Array.isArray(row?.ps)) {
        items = row.ps as Array<number | null>
      } else if (row?.ps && typeof row?.ps === 'object' && 'items' in (row.ps as unknown as Record<string, unknown>)) {
        items = ((row.ps as unknown) as { items: Array<number | null> }).items ?? []
      }
      if (Number(row?.n ?? 0) > 0) {
        distributions.push({
          metric: m.metric,
          kpiKey: m.metric,
          label: m.label,
          unit: m.unit,
          target: m.target,
          worseIsHigher: m.worseIsHigher,
          isCore: m.isCore,
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
    }
  }

  // 3. Scatter: cell-level points with attached KPIs
  const scR = await conn.runAndReadAll(
    `SELECT CAST(c.cell_id AS DOUBLE) AS cell_id, c.name AS cell_name,
       s.name AS site, d.name AS district, rg.name AS region,
       COALESCE(w.prb_avg, 0) AS prb_avg,
       COALESCE(w.dl_throughput_kbps_avg, 0) AS dl_throughput_kbps_avg,
       COALESCE(w.connected_users_sum, 0) AS connected_users_sum,
       COALESCE(w.data_volume_mb_sum, 0) AS data_volume_mb_sum,
       COALESCE(w.availability_pct_avg, 0) AS availability_pct_avg,
       COALESCE(l.is_nc, false) AS is_nc
     FROM (
       SELECT DISTINCT cell_id FROM ${aggTable} WHERE ${dateCol} = '${safeWeekStart}'
       UNION
       SELECT DISTINCT k.cell_id FROM ${kpiAggTable} k
       JOIN kpi_defs kd ON kd.kpi_id = k.kpi_id
       WHERE kd.technology = '${tech}' AND k.${dateCol} = '${safeWeekStart}'
     ) active_cells
     JOIN dim_cell c ON c.cell_id = active_cells.cell_id
     LEFT JOIN ${aggTable} w ON w.cell_id = c.cell_id AND w.${dateCol} = '${safeWeekStart}'
     LEFT JOIN dim_site s ON s.site_id = c.site_id
     LEFT JOIN dim_district d ON d.district_id = c.district_id
     LEFT JOIN dim_region rg ON rg.region_id = c.region_id
     LEFT JOIN cell_nc_lifecycle l
       ON l.cell_id = c.cell_id AND l.period_start = '${safeWeekStart}'
       AND l.grain = '${grain}' AND l.ruleset_version = (SELECT max(version) FROM ruleset)`
  )

  // Fetch cell KPI values
  const cellKpiMap = new Map<number, Record<string, number | null>>()
  try {
    let kpiCellSql = ''
    if (grain === 'daily') {
      kpiCellSql = `
        SELECT f.cell_id, k.kpi_key, f.value AS val
        FROM fact_extra_metrics f
        JOIN dim_date d ON d.date_id = f.date_id
        JOIN kpi_defs k ON k.kpi_id = f.kpi_id
        WHERE k.technology = '${tech}' AND d.date = '${safeWeekStart}'
      `
    } else {
      kpiCellSql = `
        SELECT w.cell_id, k.kpi_key, w.avg_value AS val
        FROM ${kpiAggTable} w
        JOIN kpi_defs k ON k.kpi_id = w.kpi_id
        WHERE k.technology = '${tech}' AND w.${dateCol} = '${safeWeekStart}'
      `
    }
    const kpiCellR = await conn.runAndReadAll(kpiCellSql)
    for (const r of kpiCellR.getRowObjects()) {
      const cid = Number(r.cell_id)
      const kKey = String(r.kpi_key)
      const val = r.val == null ? null : Number(r.val)
      let m = cellKpiMap.get(cid)
      if (!m) {
        m = {}
        cellKpiMap.set(cid, m)
      }
      m[kKey] = val
    }
  } catch {
    // ignore
  }

  // Populate any fallback standard column values into cellKpiMap
  for (const x of scR.getRowObjects()) {
    const cid = Number(x.cell_id)
    let m = cellKpiMap.get(cid)
    if (!m) {
      m = {}
      cellKpiMap.set(cid, m)
    }
    const prb = x.prb_avg == null ? null : Number(x.prb_avg)
    const thr = x.dl_throughput_kbps_avg == null ? null : Number(x.dl_throughput_kbps_avg)
    const users = x.connected_users_sum == null ? null : Number(x.connected_users_sum)
    const vol = x.data_volume_mb_sum == null ? null : Number(x.data_volume_mb_sum)
    const avail = x.availability_pct_avg == null ? null : Number(x.availability_pct_avg)

    for (const k of activeKpis) {
      if (m[k.key] === undefined || m[k.key] === null) {
        if (
          k.key === 'prb_utilization' ||
          k.key === 'peak_hour_traffic_utilization_3g' ||
          k.key === 'ce_utilization' ||
          k.key === 'tch_congestion' ||
          k.key === 'sdcch_congestion'
        ) {
          if (prb != null) m[k.key] = prb
        } else if (
          k.key === 'dl_throughput' ||
          k.key === 'hsdpa_throughput' ||
          k.key === 'hsupa_throughput' ||
          k.key === 'gprs_throughput'
        ) {
          if (thr != null) m[k.key] = thr
        } else if (k.key === 'connected_users') {
          if (users != null) m[k.key] = users
        } else if (k.key === 'data_volume' || k.key === 'gprs_traffic') {
          if (vol != null) m[k.key] = vol
        } else if (k.key === 'availability' || k.key === 'availability_3g' || k.key === 'tch_availability') {
          if (avail != null) m[k.key] = avail
        }
      }
    }
  }

  const medR = await conn.runAndReadAll(
    `SELECT median(dl_throughput_kbps_avg) AS med FROM ${aggTable} WHERE ${dateCol} = '${safeWeekStart}'`
  )
  const med = medR.getRowObjects()[0]?.med
  const throughputMedianKbps = med == null ? null : Number(med)

  const scatter: ScatterPoint[] = scR.getRowObjects().map((x) => {
    const cid = Number(x.cell_id)
    const prb = x.prb_avg == null ? null : Number(x.prb_avg)
    const thr = x.dl_throughput_kbps_avg == null ? null : Number(x.dl_throughput_kbps_avg)
    const users = x.connected_users_sum == null ? null : Number(x.connected_users_sum)
    let quadrant: ScatterQuadrant = 'healthy'
    if (prb != null && thr != null && throughputMedianKbps != null) {
      if (prb > prbThreshold) quadrant = thr < throughputMedianKbps ? 'congested' : 'busy'
      else quadrant = thr < throughputMedianKbps ? 'quiet' : 'healthy'
    }
    return {
      cellId: cid,
      cellName: String(x.cell_name ?? ''),
      site: x.site ? String(x.site) : null,
      district: x.district ? String(x.district) : null,
      region: x.region ? String(x.region) : null,
      prb,
      throughputKbps: thr,
      users,
      isNc: Boolean(x.is_nc),
      quadrant,
      kpis: cellKpiMap.get(cid) ?? {}
    }
  })

  // 4. Correlations: compute across all active KPIs in this technology
  const correlations: CorrelationRow[] = []
  for (let i = 0; i < activeKpis.length; i++) {
    for (let j = i + 1; j < activeKpis.length; j++) {
      const kA = activeKpis[i]
      const kB = activeKpis[j]
      try {
        let corrSql = ''
        if (grain === 'daily') {
          corrSql = `
            SELECT corr(a.value, b.value) AS pearson, count(*) AS n
            FROM fact_extra_metrics a
            JOIN fact_extra_metrics b ON a.cell_id = b.cell_id AND a.date_id = b.date_id
            WHERE a.kpi_id = ${kA.kpiId} AND b.kpi_id = ${kB.kpiId}
          `
        } else {
          corrSql = `
            SELECT corr(a.avg_value, b.avg_value) AS pearson, count(*) AS n
            FROM ${kpiAggTable} a
            JOIN ${kpiAggTable} b ON a.cell_id = b.cell_id AND a.${dateCol} = b.${dateCol}
            WHERE a.kpi_id = ${kA.kpiId} AND b.kpi_id = ${kB.kpiId}
          `
        }
        const cR = await conn.runAndReadAll(corrSql)
        const cRow = cR.getRowObjects()[0]
        if (cRow && cRow.pearson != null) {
          correlations.push({
            a: kA.key,
            b: kB.key,
            aLabel: kA.label,
            bLabel: kB.label,
            pearson: Number(cRow.pearson),
            n: Number(cRow.n ?? 0)
          })
        }
      } catch {
        // ignore
      }
    }
  }

  // Fallback native correlation pairs if empty
  if (correlations.length === 0) {
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
      FROM ${aggTable} WHERE ${dateCol} = '${safeWeekStart}'
    `)
    const crow = corrR.getRowObjects()[0]
    const n = Number(crow?.n ?? 0)
    if (crow && n > 1) {
      if (tech === '3G') {
        const pairs: Array<[string, string, string, string, string]> = [
          ['peak_hour_traffic_utilization_3g', 'hsdpa_throughput', '3G Traffic Util', 'HSDPA Speed', 'prb_thr'],
          ['peak_hour_traffic_utilization_3g', 'connected_users', '3G Traffic Util', 'Users', 'prb_usr'],
          ['peak_hour_traffic_utilization_3g', 'data_volume', '3G Traffic Util', 'Data Volume', 'prb_vol'],
          ['peak_hour_traffic_utilization_3g', 'availability_3g', '3G Traffic Util', 'Cell Avail', 'prb_avail'],
          ['hsdpa_throughput', 'connected_users', 'HSDPA Speed', 'Users', 'thr_usr'],
          ['hsdpa_throughput', 'data_volume', 'HSDPA Speed', 'Data Volume', 'thr_vol'],
          ['hsdpa_throughput', 'availability_3g', 'HSDPA Speed', 'Cell Avail', 'thr_avail'],
          ['connected_users', 'data_volume', 'Users', 'Data Volume', 'usr_vol'],
          ['connected_users', 'availability_3g', 'Users', 'Cell Avail', 'usr_avail'],
          ['data_volume', 'availability_3g', 'Data Volume', 'Cell Avail', 'vol_avail']
        ]
        for (const [a, b, aLabel, bLabel, col] of pairs) {
          const v = crow[col]
          if (v != null) correlations.push({ a, b, aLabel, bLabel, pearson: Number(v), n })
        }
      } else if (tech === '2G') {
        const pairs: Array<[string, string, string, string, string]> = [
          ['gprs_throughput', 'gprs_traffic', 'GPRS Speed', 'GPRS Traffic', 'thr_vol'],
          ['gprs_throughput', 'connected_users', 'GPRS Speed', 'Users', 'thr_usr'],
          ['gprs_throughput', 'tch_availability', 'GPRS Speed', 'TCH Avail', 'thr_avail'],
          ['connected_users', 'gprs_traffic', 'Users', 'GPRS Traffic', 'usr_vol'],
          ['connected_users', 'tch_availability', 'Users', 'TCH Avail', 'usr_avail'],
          ['gprs_traffic', 'tch_availability', 'GPRS Traffic', 'TCH Avail', 'vol_avail']
        ]
        for (const [a, b, aLabel, bLabel, col] of pairs) {
          const v = crow[col]
          if (v != null) correlations.push({ a, b, aLabel, bLabel, pearson: Number(v), n })
        }
      } else {
        const pairs: Array<[string, string, string, string, string]> = [
          ['prb_utilization', 'dl_throughput', 'PRB', 'Speed', 'prb_thr'],
          ['prb_utilization', 'connected_users', 'PRB', 'Users', 'prb_usr'],
          ['prb_utilization', 'data_volume', 'PRB', 'Volume', 'prb_vol'],
          ['prb_utilization', 'availability', 'PRB', 'Avail', 'prb_avail'],
          ['dl_throughput', 'connected_users', 'Speed', 'Users', 'thr_usr'],
          ['dl_throughput', 'data_volume', 'Speed', 'Volume', 'thr_vol'],
          ['dl_throughput', 'availability', 'Speed', 'Avail', 'thr_avail'],
          ['connected_users', 'data_volume', 'Users', 'Volume', 'usr_vol'],
          ['connected_users', 'availability', 'Users', 'Avail', 'usr_avail'],
          ['data_volume', 'availability', 'Volume', 'Avail', 'vol_avail']
        ]
        for (const [a, b, aLabel, bLabel, col] of pairs) {
          const v = crow[col]
          if (v != null) correlations.push({ a, b, aLabel, bLabel, pearson: Number(v), n })
        }
      }
    }
  }

  return {
    weekStart,
    technology: tech,
    totalCells: scatter.length,
    prbThreshold,
    throughputMedianKbps,
    kpis: activeKpis,
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
  grain?: Grain
  period?: PeriodId
} = {}): Promise<ComparisonResult> {
  const conn = ws().connection
  const type: ComparisonType = opts.type ?? 'period'
  // region mode always compares regions against the network baseline
  const scope: CompareScope = type === 'region' ? 'region' : (opts.scope ?? 'cell')
  const metric: CompareMetric = opts.metric ?? 'prb'
  const grain: Grain = opts.grain === 'daily' || opts.grain === 'monthly' ? opts.grain : 'weekly'

  const aggTable = grain === 'daily' ? 'agg_cell_daily' : grain === 'monthly' ? 'agg_cell_monthly' : 'agg_cell_weekly'
  const dateCol = grain === 'daily' ? 'date' : grain === 'monthly' ? 'month_start' : 'week_start'

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
    `SELECT DISTINCT CAST(${dateCol} AS VARCHAR) AS date_val FROM ${aggTable} ORDER BY ${dateCol} DESC LIMIT 2`
  )
  const weeks = wkR.getRowObjects().map((x) => String(x.date_val))
  const a = weeks[0] ?? '' // latest
  const b = weeks[1] ?? '' // previous (period mode only)

  const SCOPE: Record<CompareScope, { id: string; name: string; join: string }> = {
    cell: { id: 'c.cell_id', name: 'c.name', join: '' },
    site: { id: 's.site_id', name: 's.name', join: 'JOIN dim_site s ON s.site_id = c.site_id' },
    district: { id: 'd.district_id', name: 'd.name', join: 'JOIN dim_district d ON d.district_id = c.district_id' },
    region: { id: 'rg.region_id', name: 'rg.name', join: 'JOIN dim_region rg ON rg.region_id = c.region_id' }
  }
  const sel = SCOPE[scope]

  /** Network-level KPI snapshot for one period (the `kpis` source). */
  async function networkKpis(weekStart: string): Promise<Record<string, number | null>> {
    const safeWk = weekStart.replace(/'/g, "''")
    const r = await conn.runAndReadAll(
      `SELECT avg(prb_avg) AS prb, avg(dl_throughput_kbps_avg) AS thr,
         sum(connected_users_sum) AS usr, sum(data_volume_mb_sum) AS vol,
         avg(availability_pct_avg) AS avail, sum(is_nc) AS nc
       FROM ${aggTable} WHERE ${dateCol} = '${safeWk}'`
    )
    const row = r.getRowObjects()[0]
    const out: Record<string, number | null> = {}
    for (const key of ['prb', 'thr', 'usr', 'vol', 'avail', 'nc']) {
      out[key] = row?.[key] == null ? null : Number(row[key])
    }
    return out
  }

  /** Per-entity metric + NC count for one period at the chosen scope. */
  async function scopeRows(weekStart: string): Promise<Map<number, { name: string; value: number | null; nc: number; cells: number }>> {
    const metricDef = METRICS.find((m) => m.metric === metric)!
    const safeWk = weekStart.replace(/'/g, "''")
    const r = await conn.runAndReadAll(
      `SELECT ${sel.id} AS entity_id, ${sel.name} AS entity_name,
              ${metricDef.expr} AS value, sum(is_nc) AS nc, count(*) AS cells
       FROM ${aggTable} w
       JOIN dim_cell c ON c.cell_id = w.cell_id
       ${sel.join}
       WHERE w.${dateCol} = '${safeWk}'
       GROUP BY ${sel.id}, ${sel.name}`
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
    const safeWk = weekStart.replace(/'/g, "''")
    const r = await conn.runAndReadAll(
      `SELECT ${sel.id} AS entity_id, ${sel.name} AS entity_name,
              avg(prb_avg) AS prb, avg(dl_throughput_kbps_avg) AS thr,
              sum(connected_users_sum) AS usr, sum(data_volume_mb_sum) AS vol,
              avg(availability_pct_avg) AS avail, sum(is_nc) AS nc, count(*) AS cells
       FROM ${aggTable} w
       JOIN dim_cell c ON c.cell_id = w.cell_id
       ${sel.join}
       WHERE w.${dateCol} = '${safeWk}'
       GROUP BY ${sel.id}, ${sel.name}`
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

  const [aNet, bNet] = await Promise.all([
    networkKpis(a),
    type === 'period' && b ? networkKpis(b) : Promise.resolve(null)
  ])

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

  // period mode: latest period vs previous period at the chosen scope in parallel
  const [aRows, bRows] = await Promise.all([
    scopeRows(a),
    b ? scopeRows(b) : Promise.resolve(new Map<number, { name: string; value: number | null; nc: number; cells: number }>())
  ])

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
    const filterExpr = e.filter.replace('?', String(Number(parentId)))
    where.push(filterExpr)
  }
  if (q) {
    const escQ = q.replace(/'/g, "''")
    where.push(`${e.name} ILIKE '%${escQ}%'`)
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
     ORDER BY health ASC NULLS LAST, ${e.name}`
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
export async function getRegionMap(
  technology?: Technology,
  _grain?: Grain,
  _period?: PeriodId
): Promise<RegionMapRow[]> {
  const conn = ws().connection
  const tech: Technology = technology || await workspaceTechnology(conn)

  const r = await conn.runAndReadAll(`
    SELECT r.region_id AS id, r.name AS name,
      count(DISTINCT c.cell_id) AS cells,
      sum(CASE WHEN w.is_nc THEN 1 ELSE 0 END) AS nc,
      round(COALESCE(avg(h.health_score), avg(CASE WHEN f.prb_utilization IS NOT NULL THEN GREATEST(0.0, 100.0 - f.prb_utilization) END)), 1) AS health,
      round(COALESCE(avg(w.prb_avg), avg(f.prb_utilization)), 1) AS prb,
      round(COALESCE(avg(w.dl_throughput_kbps_avg), avg(f.dl_throughput_kbps)), 1) AS thr,
      sum(COALESCE(w.connected_users_sum, f.connected_users, 0)) AS usr,
      sum(COALESCE(w.data_volume_mb_sum, f.data_volume_mb, 0)) AS vol,
      round(COALESCE(avg(w.availability_pct_avg), avg(f.availability_pct)), 1) AS avail
    FROM dim_region r
    LEFT JOIN dim_cell c ON c.region_id = r.region_id
    LEFT JOIN cell_health_history h ON h.cell_id = c.cell_id
      AND h.date_id = (SELECT max(date_id) FROM cell_health_history)
    LEFT JOIN agg_cell_weekly w ON w.cell_id = c.cell_id
      AND w.week_start = (SELECT max(week_start) FROM agg_cell_weekly)
    LEFT JOIN fact_cell_daily f ON f.cell_id = c.cell_id
      AND f.date_id = (SELECT max(date_id) FROM fact_cell_daily)
    GROUP BY r.region_id, r.name
    ORDER BY r.name
  `)

  // Query per-region KPI values and breaches from agg_cell_kpi_weekly
  const kpiR = await conn.runAndReadAll(`
    SELECT r.region_id, k.kpi_key, k.label, k.unit, k.target, k.worse_is_higher, k.is_core,
      round(avg(w.avg_value), 2) AS avg_val,
      count(DISTINCT w.cell_id) AS observed_cells,
      count(DISTINCT CASE WHEN (
        (k.worse_is_higher AND w.avg_value > k.target) OR
        (NOT k.worse_is_higher AND w.avg_value < k.target)
      ) THEN w.cell_id END) AS breached_cells
    FROM dim_region r
    JOIN dim_cell c ON c.region_id = r.region_id
    JOIN agg_cell_kpi_weekly w ON w.cell_id = c.cell_id
      AND w.week_start = (SELECT max(week_start) FROM agg_cell_kpi_weekly)
    JOIN kpi_defs k ON k.kpi_id = w.kpi_id
    WHERE k.technology = '${tech}' AND k.active
    GROUP BY r.region_id, k.kpi_key, k.label, k.unit, k.target, k.worse_is_higher, k.is_core
  `)

  // Query overall Core KPI NC cell count per region
  const coreNcR = await conn.runAndReadAll(`
    SELECT r.region_id, count(DISTINCT w.cell_id) AS core_nc_cells
    FROM dim_region r
    JOIN dim_cell c ON c.region_id = r.region_id
    JOIN agg_cell_kpi_weekly w ON w.cell_id = c.cell_id
      AND w.week_start = (SELECT max(week_start) FROM agg_cell_kpi_weekly)
    JOIN kpi_defs k ON k.kpi_id = w.kpi_id
    WHERE k.technology = '${tech}' AND k.is_core AND k.target IS NOT NULL AND (
      (k.worse_is_higher AND w.avg_value > k.target) OR
      (NOT k.worse_is_higher AND w.avg_value < k.target)
    )
    GROUP BY r.region_id
  `)
  const coreNcByRegion = new Map<number, number>()
  for (const x of coreNcR.getRowObjects()) {
    coreNcByRegion.set(Number(x.region_id), Number(x.core_nc_cells ?? 0))
  }

  const kpisByRegion = new Map<number, Record<string, KpiMapMetric>>()
  for (const x of kpiR.getRowObjects()) {
    const regId = Number(x.region_id)
    const kKey = String(x.kpi_key)
    const obs = Number(x.observed_cells ?? 0)
    const breached = Number(x.breached_cells ?? 0)
    const ncRate = obs > 0 ? Math.round((breached / obs) * 1000) / 10 : 0
    let map = kpisByRegion.get(regId)
    if (!map) {
      map = {}
      kpisByRegion.set(regId, map)
    }
    map[kKey] = {
      key: kKey,
      label: String(x.label),
      unit: String(x.unit ?? ''),
      avg: x.avg_val == null ? null : Number(x.avg_val),
      ncCells: breached,
      ncRate,
      worseIsHigher: Boolean(x.worse_is_higher),
      isCore: Boolean(x.is_core)
    }
  }

  return r.getRowObjects().map((x) => {
    const id = Number(x.id)
    const cells = Number(x.cells ?? 0)
    const coreNc = coreNcByRegion.get(id) ?? Number(x.nc ?? 0)
    const kpiMetrics = kpisByRegion.get(id) || {}

    if (tech === '4G') {
      if (!kpiMetrics['prb_utilization'] && x.prb != null) {
        const prbVal = Number(x.prb)
        kpiMetrics['prb_utilization'] = {
          key: 'prb_utilization',
          label: '4G Peak Hour PRB Utilization',
          unit: '%',
          avg: prbVal,
          ncCells: prbVal > 80 ? Math.round(cells * 0.1) : 0,
          ncRate: prbVal > 80 ? 10 : 0,
          worseIsHigher: true,
          isCore: true
        }
      }
      if (!kpiMetrics['dl_throughput'] && x.thr != null) {
        kpiMetrics['dl_throughput'] = {
          key: 'dl_throughput',
          label: 'DL Throughput',
          unit: 'kbps',
          avg: Number(x.thr),
          ncCells: 0,
          ncRate: 0,
          worseIsHigher: false,
          isCore: false
        }
      }
      if (!kpiMetrics['connected_users'] && x.usr != null) {
        kpiMetrics['connected_users'] = {
          key: 'connected_users',
          label: 'Connected Users',
          unit: '',
          avg: Number(x.usr),
          ncCells: 0,
          ncRate: 0,
          worseIsHigher: false,
          isCore: false
        }
      }
      if (!kpiMetrics['data_volume'] && x.vol != null) {
        kpiMetrics['data_volume'] = {
          key: 'data_volume',
          label: 'Data Volume',
          unit: 'MB',
          avg: Number(x.vol),
          ncCells: 0,
          ncRate: 0,
          worseIsHigher: false,
          isCore: false
        }
      }
    }

    return {
      id,
      name: String(x.name ?? ''),
      cells,
      ncCells: coreNc,
      healthScore: x.health == null ? null : Number(x.health),
      prbAvg: x.prb == null ? null : Number(x.prb),
      throughputKbps: x.thr == null ? null : Number(x.thr),
      users: x.usr == null ? null : Number(x.usr),
      volumeMb: x.vol == null ? null : Number(x.vol),
      availability: x.avail == null ? null : Number(x.avail),
      kpiMetrics
    }
  })
}

/** Ghana map drill-down: districts of one region with latest-week KPIs. */
export async function getRegionDistricts(
  regionId: number,
  technology?: Technology,
  _grain?: Grain,
  _period?: PeriodId
): Promise<DistrictMapRow[]> {
  const conn = ws().connection
  const numRegionId = Number(regionId)
  const tech: Technology = technology || await workspaceTechnology(conn)

  const r = await conn.runAndReadAll(
    `SELECT d.district_id AS id, d.name AS name, rg.name AS region,
       count(DISTINCT c.cell_id) AS cells,
       sum(CASE WHEN w.is_nc THEN 1 ELSE 0 END) AS nc,
       round(COALESCE(avg(h.health_score), avg(CASE WHEN f.prb_utilization IS NOT NULL THEN GREATEST(0.0, 100.0 - f.prb_utilization) END)), 1) AS health,
       round(COALESCE(avg(w.prb_avg), avg(f.prb_utilization)), 1) AS prb,
       round(COALESCE(avg(w.dl_throughput_kbps_avg), avg(f.dl_throughput_kbps)), 1) AS thr,
       sum(COALESCE(w.connected_users_sum, f.connected_users, 0)) AS usr,
       sum(COALESCE(w.data_volume_mb_sum, f.data_volume_mb, 0)) AS vol,
       round(COALESCE(avg(w.availability_pct_avg), avg(f.availability_pct)), 1) AS avail
     FROM dim_district d
     JOIN dim_region rg ON rg.region_id = d.region_id
     LEFT JOIN dim_cell c ON c.district_id = d.district_id
     LEFT JOIN cell_health_history h ON h.cell_id = c.cell_id
       AND h.date_id = (SELECT max(date_id) FROM cell_health_history)
     LEFT JOIN agg_cell_weekly w ON w.cell_id = c.cell_id
       AND w.week_start = (SELECT max(week_start) FROM agg_cell_weekly)
     LEFT JOIN fact_cell_daily f ON f.cell_id = c.cell_id
       AND f.date_id = (SELECT max(date_id) FROM fact_cell_daily)
     WHERE d.region_id = ${numRegionId}
     GROUP BY d.district_id, d.name, rg.name
     ORDER BY health ASC NULLS LAST, d.name`
  )

  // Query per-district KPI values and breaches from agg_cell_kpi_weekly
  const kpiR = await conn.runAndReadAll(`
    SELECT d.district_id, k.kpi_key, k.label, k.unit, k.target, k.worse_is_higher, k.is_core,
      round(avg(w.avg_value), 2) AS avg_val,
      count(DISTINCT w.cell_id) AS observed_cells,
      count(DISTINCT CASE WHEN (
        (k.worse_is_higher AND w.avg_value > k.target) OR
        (NOT k.worse_is_higher AND w.avg_value < k.target)
      ) THEN w.cell_id END) AS breached_cells
    FROM dim_district d
    JOIN dim_cell c ON c.district_id = d.district_id
    JOIN agg_cell_kpi_weekly w ON w.cell_id = c.cell_id
      AND w.week_start = (SELECT max(week_start) FROM agg_cell_kpi_weekly)
    JOIN kpi_defs k ON k.kpi_id = w.kpi_id
    WHERE d.region_id = ${numRegionId} AND k.technology = '${tech}' AND k.active
    GROUP BY d.district_id, k.kpi_key, k.label, k.unit, k.target, k.worse_is_higher, k.is_core
  `)

  // Query overall Core KPI NC cell count per district
  const coreNcR = await conn.runAndReadAll(`
    SELECT d.district_id, count(DISTINCT w.cell_id) AS core_nc_cells
    FROM dim_district d
    JOIN dim_cell c ON c.district_id = d.district_id
    JOIN agg_cell_kpi_weekly w ON w.cell_id = c.cell_id
      AND w.week_start = (SELECT max(week_start) FROM agg_cell_kpi_weekly)
    JOIN kpi_defs k ON k.kpi_id = w.kpi_id
    WHERE d.region_id = ${numRegionId} AND k.technology = '${tech}' AND k.is_core AND k.target IS NOT NULL AND (
      (k.worse_is_higher AND w.avg_value > k.target) OR
      (NOT k.worse_is_higher AND w.avg_value < k.target)
    )
    GROUP BY d.district_id
  `)
  const coreNcByDistrict = new Map<number, number>()
  for (const x of coreNcR.getRowObjects()) {
    coreNcByDistrict.set(Number(x.district_id), Number(x.core_nc_cells ?? 0))
  }

  const kpisByDistrict = new Map<number, Record<string, KpiMapMetric>>()
  for (const x of kpiR.getRowObjects()) {
    const distId = Number(x.district_id)
    const kKey = String(x.kpi_key)
    const obs = Number(x.observed_cells ?? 0)
    const breached = Number(x.breached_cells ?? 0)
    const ncRate = obs > 0 ? Math.round((breached / obs) * 1000) / 10 : 0
    let map = kpisByDistrict.get(distId)
    if (!map) {
      map = {}
      kpisByDistrict.set(distId, map)
    }
    map[kKey] = {
      key: kKey,
      label: String(x.label),
      unit: String(x.unit ?? ''),
      avg: x.avg_val == null ? null : Number(x.avg_val),
      ncCells: breached,
      ncRate,
      worseIsHigher: Boolean(x.worse_is_higher),
      isCore: Boolean(x.is_core)
    }
  }

  return r.getRowObjects().map((x) => {
    const id = Number(x.id)
    const cells = Number(x.cells ?? 0)
    const coreNc = coreNcByDistrict.get(id) ?? Number(x.nc ?? 0)
    const kpiMetrics = kpisByDistrict.get(id) || {}

    if (tech === '4G') {
      if (!kpiMetrics['prb_utilization'] && x.prb != null) {
        const prbVal = Number(x.prb)
        kpiMetrics['prb_utilization'] = {
          key: 'prb_utilization',
          label: '4G Peak Hour PRB Utilization',
          unit: '%',
          avg: prbVal,
          ncCells: prbVal > 80 ? Math.round(cells * 0.1) : 0,
          ncRate: prbVal > 80 ? 10 : 0,
          worseIsHigher: true,
          isCore: true
        }
      }
      if (!kpiMetrics['dl_throughput'] && x.thr != null) {
        kpiMetrics['dl_throughput'] = {
          key: 'dl_throughput',
          label: 'DL Throughput',
          unit: 'kbps',
          avg: Number(x.thr),
          ncCells: 0,
          ncRate: 0,
          worseIsHigher: false,
          isCore: false
        }
      }
      if (!kpiMetrics['connected_users'] && x.usr != null) {
        kpiMetrics['connected_users'] = {
          key: 'connected_users',
          label: 'Connected Users',
          unit: '',
          avg: Number(x.usr),
          ncCells: 0,
          ncRate: 0,
          worseIsHigher: false,
          isCore: false
        }
      }
      if (!kpiMetrics['data_volume'] && x.vol != null) {
        kpiMetrics['data_volume'] = {
          key: 'data_volume',
          label: 'Data Volume',
          unit: 'MB',
          avg: Number(x.vol),
          ncCells: 0,
          ncRate: 0,
          worseIsHigher: false,
          isCore: false
        }
      }
    }

    return {
      id,
      name: String(x.name ?? ''),
      region: x.region ? String(x.region) : null,
      cells,
      ncCells: coreNc,
      healthScore: x.health == null ? null : Number(x.health),
      prbAvg: x.prb == null ? null : Number(x.prb),
      throughputKbps: x.thr == null ? null : Number(x.thr),
      users: x.usr == null ? null : Number(x.usr),
      volumeMb: x.vol == null ? null : Number(x.vol),
      availability: x.avail == null ? null : Number(x.avail),
      kpiMetrics
    }
  })
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
  const numParentId = Number(parentId)
  const out: ExplorerBreadcrumb[] = []
  if (level === 'district') {
    const rr = await conn.runAndReadAll(
      `SELECT region_id AS id, name FROM dim_region WHERE region_id = ${numParentId}`
    )
    const row = rr.getRowObjects()[0]
    if (row) push(out, Number(row.id), String(row.name), 'region')
    return out
  }
  if (level === 'site') {
    const dr = await conn.runAndReadAll(
      `SELECT d.district_id AS id, d.name, d.region_id FROM dim_district d WHERE d.district_id = ${numParentId}`
    )
    const drow = dr.getRowObjects()[0]
    if (!drow) return out
    push(out, Number(drow.id), String(drow.name), 'district')
    const rr = await conn.runAndReadAll(
      `SELECT region_id AS id, name FROM dim_region WHERE region_id = ${Number(drow.region_id)}`
    )
    const row = rr.getRowObjects()[0]
    if (row) push(out, Number(row.id), String(row.name), 'region')
    return out
  }
  // cell: parent is the site
  const sr = await conn.runAndReadAll(
    `SELECT s.site_id AS id, s.name, s.district_id FROM dim_site s WHERE s.site_id = ${numParentId}`
  )
  const srow = sr.getRowObjects()[0]
  if (!srow) return out
  push(out, Number(srow.id), String(srow.name), 'site')
  const dr = await conn.runAndReadAll(
    `SELECT d.district_id AS id, d.name, d.region_id FROM dim_district d WHERE d.district_id = ${Number(srow.district_id)}`
  )
  const drow = dr.getRowObjects()[0]
  if (!drow) return out
  push(out, Number(drow.id), String(drow.name), 'district')
  const rr = await conn.runAndReadAll(
    `SELECT region_id AS id, name FROM dim_region WHERE region_id = ${Number(drow.region_id)}`
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
    },
    region: {
      from: `dim_region rg
             JOIN dim_cell c ON c.region_id = rg.region_id`,
      sel: `rg.region_id AS id, rg.name AS name, NULL AS r, NULL AS d2, NULL AS s2,
            max(p.score) AS score, NULL AS band, st.status, st.owner, st.external_ticket,
            CAST(st.target_review_date AS VARCHAR) AS review_date,
            sum(w.is_nc) AS nc, count(DISTINCT c.cell_id) AS cells, avg(w.prb_avg) AS prb, NULL AS is_nc`,
      eId: 'rg.region_id',
      groupBy: `GROUP BY rg.region_id, rg.name, st.status, st.owner, st.external_ticket, st.target_review_date`
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
      where.push(`st.status = '${opts.status.replace(/'/g, "''")}'`)
    }
  }
  if (opts.band) {
    const b = BANDS.find((x) => x.band === opts.band)
    if (b) {
      where.push(`p.score >= ${b.lo} AND p.score <= ${b.hi}`)
    }
  }
  if (opts.overdueOnly) {
    where.push(`st.target_review_date < CURRENT_DATE AND COALESCE(st.status, '') NOT IN ('Resolved', 'Deferred')`)
  }
  if (opts.search) {
    const esc = opts.search.replace(/'/g, "''")
    if (scope === 'cell') {
      where.push(
        `(c.name ILIKE '%${esc}%' OR COALESCE(s.name,'') ILIKE '%${esc}%' OR COALESCE(d.name,'') ILIKE '%${esc}%' OR COALESCE(rg.name,'') ILIKE '%${esc}%')`
      )
    } else if (scope === 'site') {
      where.push(
        `(s.name ILIKE '%${esc}%' OR COALESCE(d.name,'') ILIKE '%${esc}%' OR COALESCE(rg.name,'') ILIKE '%${esc}%')`
      )
    } else {
      where.push(
        `(d.name ILIKE '%${esc}%' OR COALESCE(rg.name,'') ILIKE '%${esc}%')`
      )
    }
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

  const safeMode = mode.replace(/'/g, "''")
  const safeScope = scope.replace(/'/g, "''")
  const from = `
    FROM ${cfg.from}
    LEFT JOIN cell_priority_history p
      ON p.cell_id = c.cell_id AND p.mode = '${safeMode}' AND p.as_of = (
        SELECT max(as_of) FROM cell_priority_history WHERE mode = '${safeMode}'
      )
    LEFT JOIN entity_action_status st
      ON st.entity_type = '${safeScope}' AND st.entity_id = ${cfg.eId}
    LEFT JOIN agg_cell_weekly w
      ON w.cell_id = c.cell_id AND w.week_start = (SELECT max(week_start) FROM agg_cell_weekly)
  `
  const base = `${from} ${whereSql}`

  const countR = await conn.runAndReadAll(`SELECT count(*) AS n ${base} ${cfg.groupBy}`)
  const countRows = countR.getRowObjects()
  const total = scope === 'cell' ? Number(countRows[0]?.n ?? 0) : countRows.length
  // rollup per status: subquery groups entities first (site/district) or emits
  // one row per cell, then we count per status — DuckDB rejects a bare column
  // next to count(*) without GROUP BY, so the grouping lives in the subquery
  const statusR = await conn.runAndReadAll(
    `SELECT COALESCE(x.status, 'unset') AS status, count(*) AS n
     FROM (SELECT st.status ${base} ${cfg.groupBy}) x
     GROUP BY COALESCE(x.status, 'unset') ORDER BY n DESC`
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
     ${cfg.groupBy}`
  )
  const overdueTotal = scope === 'cell'
    ? Number(overdueR.getRowObjects()[0]?.n ?? 0)
    : overdueR.getRowObjects().length

  const r = await conn.runAndReadAll(
    `SELECT ${cfg.sel} ${base} ${cfg.groupBy} ${sortSql} LIMIT ${limit} OFFSET ${offset}`
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

function horizonSteps(h: ForecastHorizon, grain: Grain = 'weekly'): number {
  if (grain === 'daily') {
    return h === '1w' ? 7 : h === '2w' ? 14 : h === '4w' ? 28 : 42
  }
  if (grain === 'monthly') {
    return h === '1w' ? 1 : h === '2w' ? 2 : h === '4w' ? 4 : 6
  }
  return h === '1w' ? 1 : h === '2w' ? 2 : h === '4w' ? 4 : 6
}

function addPeriod(dateStr: string, steps: number, grain: Grain = 'weekly'): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  if (grain === 'daily') {
    d.setUTCDate(d.getUTCDate() + steps)
  } else if (grain === 'monthly') {
    d.setUTCMonth(d.getUTCMonth() + steps)
  } else {
    d.setUTCDate(d.getUTCDate() + steps * 7)
  }
  return d.toISOString().slice(0, 10)
}

function formatTimeLabel(dateStr: string, grain: Grain = 'weekly'): string {
  if (!dateStr) return ''
  if (grain === 'daily') {
    return dateStr.length >= 10 ? dateStr.slice(5) : dateStr
  }
  if (grain === 'monthly') {
    return dateStr.slice(0, 7)
  }
  return weekLabel(dateStr)
}

function forecastThreshold(metric: ForecastMetric, prbThreshold: number): number | null {
  if (metric === 'prb') return prbThreshold
  if (metric === 'availability') return 99.5
  if (metric === 'throughput') return 10_000 // ~10 Mbps floor
  return null // users / volume: no hard threshold — classify by trajectory
}

/** Forecasting & Early Warning (§45–46): simple-first forecasts for the
 *  network or any entity, with early-warning risk states per cell.
 *  History is read from the aggregate tables per grain; all math runs in JS (forecast.ts)
 *  so the same model serves network/entity series and per-cell risk rows. */
export async function getForecast(opts: {
  scope?: ForecastScope
  entityId?: number | null
  metric?: ForecastMetric
  horizon?: ForecastHorizon
  grain?: Grain
  period?: PeriodId
} = {}): Promise<ForecastResult> {
  const conn = ws().connection
  const scope: ForecastScope = opts.scope ?? 'network'
  const entityId = opts.entityId ?? null
  const metric: ForecastMetric = opts.metric ?? 'prb'
  const horizon: ForecastHorizon = opts.horizon ?? '4w'
  const grain: Grain = opts.grain === 'daily' || opts.grain === 'monthly' ? opts.grain : 'weekly'
  const stepsAhead = horizonSteps(horizon, grain)
  const metricDef = FORECAST_METRICS.find((m) => m.metric === metric)!

  const rules = await getRules(conn)
  const prbThreshold = rules?.prbThresholdPct ?? 80
  const threshold = forecastThreshold(metric, prbThreshold)

  const numId = entityId != null ? Number(entityId) : null
  const scopeWhere =
    scope === 'network' || numId == null || isNaN(numId) ? ''
    : scope === 'region' ? `AND (rg.region_id = ${numId} OR c.region_id = ${numId})`
    : scope === 'district' ? `AND (d.district_id = ${numId} OR c.district_id = ${numId})`
    : scope === 'site' ? `AND (s.site_id = ${numId} OR c.site_id = ${numId})`
    : `AND c.cell_id = ${numId}`

  const aggTable = grain === 'daily' ? 'agg_cell_daily' : grain === 'monthly' ? 'agg_cell_monthly' : 'agg_cell_weekly'
  const dateCol = grain === 'daily' ? 'w.date' : grain === 'monthly' ? 'w.month_start' : 'w.week_start'

  // one pass: every cell-period under the scope, with hierarchy for paths
  const r = await conn.runAndReadAll(`
    SELECT c.cell_id,
      CAST(${dateCol} AS VARCHAR) AS week_start,
      w.prb_avg, w.dl_throughput_kbps_avg, w.connected_users_sum,
      w.data_volume_mb_sum, w.availability_pct_avg, w.is_nc,
      rg.name AS region, d.name AS district, s.name AS site, c.name AS cell
    FROM ${aggTable} w
    JOIN dim_cell c ON c.cell_id = w.cell_id
    LEFT JOIN dim_site s ON s.site_id = c.site_id
    LEFT JOIN dim_district d ON d.district_id = c.district_id
    LEFT JOIN dim_region rg ON rg.region_id = c.region_id
    WHERE 1 = 1 ${scopeWhere}
    ORDER BY ${dateCol}, c.cell_id
  `)
  const rows = r.getRowObjects()
  if (rows.length === 0) {
    throw new Error(`No history for ${scope} ${entityId ?? ''}`)
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

  // time axis = union of periods (sorted); entity series aggregates all its cells
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

  // entity-level series for every metric
  const series: ForecastSeries[] = FORECAST_METRICS.map((m) => {
    const points: ForecastPoint[] = weekStarts.map((ws0) => {
      const vals = cellList.map((c) => pick(m.metric, c.weeks.get(ws0))).filter((v): v is number => v != null)
      if (vals.length === 0) return { weekStart: ws0, label: formatTimeLabel(ws0, grain), value: null, kind: 'actual' as const, lower: null, upper: null }
      const value = m.metric === 'users' || m.metric === 'traffic'
        ? vals.reduce((a, b) => a + b, 0)
        : vals.reduce((a, b) => a + b, 0) / vals.length
      return { weekStart: ws0, label: formatTimeLabel(ws0, grain), value: Math.round(value * 100) / 100, kind: 'actual' as const, lower: null, upper: null }
    })
    const traj = forecastTrajectory(
      points.map((p) => ({ weekStart: p.weekStart, value: p.value })),
      m.metric,
      m.label,
      m.unit,
      stepsAhead,
      grain
    )
    const fc = traj.summary
    // append forecast points at period + 1..stepsAhead
    let lastPeriod = weekStarts[weekStarts.length - 1]
    for (let i = 0; i < stepsAhead; i++) {
      lastPeriod = addPeriod(lastPeriod, 1, grain)
      const p = traj.points[i]
      points.push({
        weekStart: lastPeriod,
        label: formatTimeLabel(lastPeriod, grain),
        value: p?.value ?? (fc.next == null ? null : Math.round(fc.next * 100) / 100),
        kind: 'forecast',
        lower: p?.lower ?? (fc.lower == null ? null : Math.round(fc.lower * 100) / 100),
        upper: p?.upper ?? (fc.upper == null ? null : Math.round(fc.upper * 100) / 100)
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
    const fc = forecastSeries(h.values, metricDef.label, metricDef.unit, metricDef.metric, grain)
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

function summaryWindow(period: PeriodId): { startSql: string; label: string } {
  switch (period) {
    case '7d': return { startSql: `(SELECT max(date) - INTERVAL 6 DAY FROM dim_date)`, label: '7d' }
    case '4w': return { startSql: `(SELECT max(date) - INTERVAL 27 DAY FROM dim_date)`, label: '4w' }
    case '12w': return { startSql: `(SELECT max(date) - INTERVAL 83 DAY FROM dim_date)`, label: '12w' }
    case 'mtd': return { startSql: `(SELECT date_trunc('month', max(date)) FROM dim_date)`, label: 'mtd' }
    case '3m': return { startSql: `(SELECT max(date) - INTERVAL 89 DAY FROM dim_date)`, label: '3m' }
  }
}

// tiny TTL cache: summaries are read on module mount and grain/period switch;
// aggregates only change on import, so a few seconds of staleness is safe.
const summaryCache = new Map<string, { at: number; value: Summary | null }>()
const SUMMARY_TTL_MS = 5000

export function invalidateSummaryCache(): void {
  summaryCache.clear()
}

export async function getSummary(
  opts: { period?: PeriodId; grain?: Grain; technology?: Technology } = {}
): Promise<Summary | null> {
  const period = opts.period ?? '4w'
  const grain = opts.grain ?? 'weekly'
  const key = period + '|' + grain + '|' + (opts.technology ?? '')
  const hit = summaryCache.get(key)
  if (hit && Date.now() - hit.at < SUMMARY_TTL_MS) return hit.value
  const ws = getCurrent()
  if (!ws) return null
  const win = summaryWindow(period)
  const r = await ws.connection.runAndReadAll(`
    SELECT
      (SELECT count(*) FROM dim_cell) AS cells,
      (SELECT count(*) FROM dim_site) AS sites,
      (SELECT count(*) FROM dim_district) AS districts,
      (SELECT count(*) FROM dim_region) AS regions,
      (SELECT max(version) FROM ruleset) AS ruleset_version,
      (SELECT count(*) FROM agg_cell_weekly WHERE is_nc) AS nc_cells,
      (SELECT count(*) FROM fact_cell_daily) AS row_count,
      (SELECT CAST(min(d.date) AS VARCHAR) FROM fact_cell_daily f JOIN dim_date d USING (date_id)) AS min_date,
      (SELECT CAST(max(d.date) AS VARCHAR) FROM fact_cell_daily f JOIN dim_date d USING (date_id)) AS max_date,
      CASE '${grain}' WHEN 'daily' THEN (SELECT count(*) FROM fact_cell_daily f JOIN dim_date d USING (date_id) WHERE d.date >= ${win.startSql}) WHEN 'weekly' THEN COALESCE((SELECT sum(observed_days) FROM agg_cell_weekly WHERE week_start >= ${win.startSql}), 0) ELSE COALESCE((SELECT sum(observed_days) FROM agg_cell_monthly WHERE month_start >= ${win.startSql}), 0) END AS observed_rows,
      COALESCE((SELECT avg(prb_avg) FROM agg_network_${grain} WHERE period_start >= ${win.startSql}), (SELECT avg(prb_utilization) FROM fact_cell_daily)) AS avg_prb,
      COALESCE((SELECT sum(data_volume_mb_sum) FROM agg_network_${grain} WHERE period_start >= ${win.startSql}), (SELECT sum(data_volume_mb) FROM fact_cell_daily)) AS total_volume_mb,
      COALESCE((SELECT sum(connected_users_sum) FROM agg_network_${grain} WHERE period_start >= ${win.startSql}), (SELECT sum(connected_users) FROM fact_cell_daily)) AS total_users,
      COALESCE((SELECT avg(dl_throughput_kbps_avg) FROM agg_network_${grain} WHERE period_start >= ${win.startSql}), (SELECT avg(dl_throughput_kbps) FROM fact_cell_daily)) AS avg_throughput_kbps,
      COALESCE((SELECT avg(availability_pct_avg) FROM agg_network_${grain} WHERE period_start >= ${win.startSql}), (SELECT avg(availability_pct) FROM fact_cell_daily)) AS avg_availability
  `, [])
  const row = r.getRowObjects()[0]
  const value: Summary | null = {
    rowCount: Number(row.row_count ?? 0),
    minDate: row.min_date ? String(row.min_date) : null,
    maxDate: row.max_date ? String(row.max_date) : null,
    cells: Number(row.cells ?? 0),
    sites: Number(row.sites ?? 0),
    districts: Number(row.districts ?? 0),
    regions: Number(row.regions ?? 0),
    rulesetVersion: row.ruleset_version == null ? null : Number(row.ruleset_version),
    weeklyNcCells: Number(row.nc_cells ?? 0),
    weeklyTotalRows: Number(row.observed_rows ?? 0),
    avgPrb: row.avg_prb == null ? null : Number(row.avg_prb),
    totalVolumeMb: row.total_volume_mb == null ? null : Number(row.total_volume_mb),
    totalUsers: row.total_users == null ? null : Number(row.total_users),
    avgThroughputKbps: row.avg_throughput_kbps == null ? null : Number(row.avg_throughput_kbps),
    avgAvailability: row.avg_availability == null ? null : Number(row.avg_availability),
    grain,
    periodStart: null,
    periodEnd: null
  }
  summaryCache.set(key, { at: Date.now(), value })
  return value
}

export async function getExecutiveOverview(opts?: { period?: PeriodId; grain?: Grain }): Promise<ExecutiveOverviewResult | null> {
  const wsObj = getCurrent()
  if (!wsObj) return null
  const conn = wsObj.connection
  const activeTech: Technology = await workspaceTechnology(conn)

  const activeGrain = opts?.grain ?? 'weekly'
  const sparkLimit = opts?.period === '12w' ? 12 : opts?.period === '7d' ? 7 : 4
  const healthSeries = await computeNetworkHealth(conn, activeGrain)
  const curHealth = healthSeries[healthSeries.length - 1]
  const prevHealth = healthSeries.length > 1 ? healthSeries[healthSeries.length - 2] : null

  const overallHealthScore = curHealth ? curHealth.score : 85
  const overallHealthDelta = curHealth && prevHealth ? Math.round((curHealth.score - prevHealth.score) * 10) / 10 : null

  // Latest week start
  const latestWkR = await conn.runAndReadAll(
    `SELECT CAST(max(week_start) AS VARCHAR) AS max_wk FROM agg_cell_weekly`
  )
  const latestWk = latestWkR.getRowObjects()[0]?.max_wk ? String(latestWkR.getRowObjects()[0].max_wk) : null
  const asOf = latestWk ?? new Date().toISOString().slice(0, 10)

  // Get active rules & KPI definitions
  const allKpiDefs = await listKpiDefs(conn)

  // Query cell lifecycle counts for Chronic / Persistent / Critical
  const lifeCountsR = await conn.runAndReadAll(`
    SELECT
      count(*) FILTER (WHERE lifecycle = 'Chronic NC') AS chronic_count,
      count(*) FILTER (WHERE lifecycle = 'Persistent NC') AS persistent_count,
      count(*) FILTER (WHERE severity = 'Critical') AS critical_count
    FROM cell_nc_lifecycle
    WHERE grain = 'weekly' AND ruleset_version = (SELECT max(version) FROM ruleset)
      AND period_start = (SELECT max(period_start) FROM cell_nc_lifecycle WHERE grain = 'weekly')
  `)
  const lifeCounts = lifeCountsR.getRowObjects()[0] ?? {}
  const chronicCellCount = Number(lifeCounts.chronic_count ?? 0)
  const persistentCellCount = Number(lifeCounts.persistent_count ?? 0)
  const criticalCellCount = Number(lifeCounts.critical_count ?? 0)

  // Degrading districts
  const distR = await conn.runAndReadAll(`
    SELECT d.name, avg(w.prb_avg) AS avg_prb
    FROM agg_cell_weekly w
    JOIN dim_cell c ON c.cell_id = w.cell_id
    JOIN dim_district d ON d.district_id = c.district_id
    WHERE w.week_start = (SELECT max(week_start) FROM agg_cell_weekly) AND w.is_nc
    GROUP BY d.name
    ORDER BY count(*) DESC
    LIMIT 3
  `)
  const degradingDistricts = distR.getRowObjects().map((r) => String(r.name))

  // Total cell count in latest week
  const totalCellsR = await conn.runAndReadAll(`
    SELECT count(DISTINCT cell_id) AS total_cells FROM agg_cell_weekly
    WHERE week_start = (SELECT max(week_start) FROM agg_cell_weekly)
  `)
  const totalObservedCells = Math.max(1, Number(totalCellsR.getRowObjects()[0]?.total_cells ?? 1))

  // Helper to build Dynamic KPI card data
  const buildKpiCard = async (def: KpiDefinition): Promise<DynamicKpiCardData> => {
    let curVal: number | null = null
    let prevVal: number | null = null
    const sparkline: number[] = []
    const sparklineDates: string[] = []
    let ncCellCount = 0

    const isDerived = Boolean(
      def.isDerived ||
      def.key.startsWith('3g_') ||
      def.key.includes('congestion') ||
      def.key === '3g_dl_power_congestion' ||
      def.key === '3g_ul_ce_congestion' ||
      def.key === '3g_phych_failures'
    )

    if (def.key === 'prb_utilization') {
      const r = await conn.runAndReadAll(`
        SELECT period_start, prb_avg FROM agg_network_weekly
        ORDER BY period_start DESC LIMIT ${sparkLimit}
      `)
      const rows = r.getRowObjects().reverse()
      for (const row of rows) {
        if (row.prb_avg != null) {
          sparkline.push(Math.round(Number(row.prb_avg) * 10) / 10)
          sparklineDates.push(String(row.period_start))
        }
      }
      if (sparkline.length > 0) curVal = sparkline[sparkline.length - 1]
      if (sparkline.length > 1) prevVal = sparkline[sparkline.length - 2]

      const ncR = await conn.runAndReadAll(`
        SELECT count(DISTINCT cell_id) AS nc_count
        FROM agg_cell_weekly
        WHERE week_start = (SELECT max(week_start) FROM agg_cell_weekly) AND is_nc
      `)
      ncCellCount = Number(ncR.getRowObjects()[0]?.nc_count ?? 0)
    } else {
      const numKpiId = Number(def.kpiId)
      const r = await conn.runAndReadAll(`
        SELECT d.week_start, avg(w.avg_value) AS avg_val
        FROM agg_cell_kpi_weekly w
        JOIN dim_date d ON d.week_start = w.week_start
        WHERE w.kpi_id = ${numKpiId}
        GROUP BY d.week_start
        ORDER BY d.week_start DESC LIMIT ${sparkLimit}
      `)
      const rows = r.getRowObjects().reverse()
      for (const row of rows) {
        if (row.avg_val != null) {
          sparkline.push(Math.round(Number(row.avg_val) * 100) / 100)
          sparklineDates.push(String(row.week_start))
        }
      }
      if (sparkline.length > 0) curVal = sparkline[sparkline.length - 1]
      if (sparkline.length > 1) prevVal = sparkline[sparkline.length - 2]

      if (def.target != null) {
        const breachCond = def.worseIsHigher ? `w.avg_value > ${Number(def.target)}` : `w.avg_value < ${Number(def.target)}`
        const ncR = await conn.runAndReadAll(`
          SELECT count(DISTINCT w.cell_id) AS nc_count
          FROM agg_cell_kpi_weekly w
          WHERE w.kpi_id = ${numKpiId}
            AND w.week_start = (SELECT max(week_start) FROM agg_cell_kpi_weekly WHERE kpi_id = ${numKpiId})
            AND ${breachCond}
        `)
        ncCellCount = Number(ncR.getRowObjects()[0]?.nc_count ?? 0)
      }
    }

    let delta: number | null = null
    let deltaPct: number | null = null
    if (curVal != null && prevVal != null) {
      delta = Math.round((curVal - prevVal) * 100) / 100
      if (prevVal !== 0) deltaPct = Math.round(((curVal - prevVal) / Math.abs(prevVal)) * 1000) / 10
    }

    const isBreached = curVal != null && def.target != null
      ? (def.betterDirection === 'lower_is_better' ? curVal > def.target : curVal < def.target)
      : false

    let complianceStatus: 'compliant' | 'warning' | 'non_compliant' | 'unavailable' = 'unavailable'
    if (curVal == null) {
      complianceStatus = 'unavailable'
    } else if (def.target == null) {
      complianceStatus = 'compliant'
    } else if (!isBreached) {
      complianceStatus = 'compliant'
    } else {
      if (def.criticalThreshold != null && (def.worseIsHigher ? curVal >= def.criticalThreshold : curVal <= def.criticalThreshold)) {
        complianceStatus = 'non_compliant'
      } else if (def.warningThreshold != null && (def.worseIsHigher ? curVal >= def.warningThreshold : curVal <= def.warningThreshold)) {
        complianceStatus = 'warning'
      } else {
        complianceStatus = 'non_compliant'
      }
    }

    let trend: 'improving' | 'worsening' | 'stable' | 'unknown' = 'unknown'
    if (delta == null || Math.abs(delta) < 0.001) {
      trend = 'stable'
    } else if (def.key === 'prb_utilization' || def.key.includes('prb')) {
      const warnLevel = def.warningThreshold ?? (def.target != null ? def.target * 0.88 : 70)
      if (curVal != null && curVal >= warnLevel) {
        trend = delta > 0 ? 'worsening' : 'improving'
      } else {
        // Safe PRB levels: increasing utilization is normal network usage/growth, not worsening
        trend = 'stable'
      }
    } else if (def.worseIsHigher) {
      trend = delta > 0 ? 'worsening' : 'improving'
    } else {
      trend = delta > 0 ? 'improving' : 'worsening'
    }

    const formattedValue = curVal != null ? `${curVal}${def.unit ? ` ${def.unit}` : ''}` : 'Data unavailable'
    const ncPct = totalObservedCells > 0 ? Math.round((ncCellCount / totalObservedCells) * 1000) / 10 : 0

    return {
      kpiId: def.kpiId,
      key: def.key,
      label: def.label,
      unit: def.unit,
      technology: def.technology,
      category: def.category,
      isCore: def.isCore,
      isDerived,
      currentValue: curVal,
      previousValue: prevVal,
      formattedValue,
      target: def.target,
      warningThreshold: def.warningThreshold,
      criticalThreshold: def.criticalThreshold,
      betterDirection: def.betterDirection,
      worseIsHigher: def.worseIsHigher,
      complianceStatus,
      trend,
      delta,
      deltaPct,
      nonCompliantCellCount: ncCellCount,
      nonCompliantCellPct: ncPct,
      persistentNcCount: Math.min(ncCellCount, persistentCellCount),
      sparkline,
      sparklineDates,
      isBreached
    }
  }

  // Build Tech Cards for 2G, 3G, 4G
  const techs: Technology[] = ['2G', '3G', '4G']
  const techCards: TechHealthCard[] = []

  for (const tech of techs) {
    const techDefs = allKpiDefs.filter((k) => k.technology === tech)
    const cards: DynamicKpiCardData[] = []
    for (const d of techDefs) {
      const card = await buildKpiCard(d)
      cards.push(card)
    }

    // Filter and prioritize cards: Core -> Enabled Derived -> Other with data
    const coreCards = cards.filter((c) => c.isCore)
    const derivedCards = cards.filter((c) => !c.isCore && c.isDerived)
    const otherCardsWithData = cards.filter((c) => !c.isCore && !c.isDerived && c.currentValue != null)

    const availableKpiCards = [...coreCards, ...derivedCards, ...otherCardsWithData]
    const primaryKpis = coreCards.length > 0 ? coreCards : availableKpiCards.slice(0, 4)

    // Cell counts and compliance
    const techCellsR = await conn.runAndReadAll(`
      SELECT
        count(DISTINCT w.cell_id) AS cell_count,
        count(DISTINCT w.cell_id) FILTER (WHERE w.is_nc) AS nc_count
      FROM agg_cell_weekly w
      WHERE w.week_start = (SELECT max(week_start) FROM agg_cell_weekly)
    `)
    const techCellRow = techCellsR.getRowObjects()[0] ?? {}
    const cellCount = Number(techCellRow.cell_count ?? 0)
    const ncCellCount = Number(techCellRow.nc_count ?? 0)
    const compliancePct = cellCount > 0 ? Math.round((1 - ncCellCount / cellCount) * 1000) / 10 : 100

    const breachedCount = primaryKpis.filter((k) => k.isBreached).length
    const techHealth = Math.round(Math.max(20, Math.min(100, compliancePct - breachedCount * 5)) * 10) / 10

    techCards.push({
      technology: tech,
      healthScore: techHealth,
      previousHealthScore: techHealth,
      healthDelta: 0,
      cellCount,
      ncCellCount,
      compliancePct,
      primaryKpis,
      availableKpiCards
    })
  }

  const activeTechCard = techCards.find((t) => t.technology === activeTech) ?? techCards[0]
  const availableKpiCards = activeTechCard?.availableKpiCards ?? []

  // Network cards (cross-tech)
  const networkDefs = allKpiDefs.filter((k) => k.showInExecutiveView)
  const networkKpiCards: DynamicKpiCardData[] = []
  for (const d of networkDefs.slice(0, 8)) {
    networkKpiCards.push(await buildKpiCard(d))
  }

  // Recommendations
  const recs: string[] = []
  if (chronicCellCount > 0) {
    recs.push(`Prioritize physical site investigations for ${chronicCellCount} chronic non-compliant cells (7+ weeks breached).`)
  }
  if (degradingDistricts.length > 0) {
    recs.push(`Focus capacity expansion and tilt optimization on top degraded districts: ${degradingDistricts.join(', ')}.`)
  }
  if (overallHealthScore < 80) {
    recs.push('Schedule parameter optimization audit across high-congestion clusters.')
  } else {
    recs.push('Network QoS is currently stable across core indicators. Continue continuous KPI monitoring.')
  }

  const problemSummary: ExecutiveProblemSummary = {
    topProblemCategory: chronicCellCount > 0 ? 'Chronic Congestion' : 'Radio Quality',
    criticalCellCount,
    chronicCellCount,
    persistentCellCount,
    degradingDistricts,
    keyRecommendations: recs
  }

  return {
    asOf,
    periodLabel: `Week of ${asOf}`,
    overallHealthScore,
    overallHealthDelta,
    activeTechnology: activeTech,
    technologies: techCards,
    problemSummary,
    availableKpiCards,
    networkKpiCards
  }
}