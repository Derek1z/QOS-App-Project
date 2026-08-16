import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api'
import type { Lifecycle, Trend, Severity, Rules } from '../../../shared/api'
import { getRules } from './rules'

/** NC Intelligence (spec §35-§39): every cell-week is classified along three
 *  independent dimensions — Lifecycle, Trend, Severity — and written to
 *  cell_nc_lifecycle. Raw facts are never touched. */

interface WeekRow {
  cellId: number
  weekStart: string
  isNc: boolean
  breachDays: number
  observedDays: number
  prbAvg: number | null
  prbPeak: number | null
  volume: number | null
  users: number | null
  throughput: number | null
  availability: number | null
}

// Trend tolerances (§38): noise below these thresholds is not classified.
const TOL = { prb: 3, breach: 1, throughputPct: 10, volumePct: 10, usersPct: 10 }

function pctChange(prev: number | null, cur: number | null): number | null {
  if (prev == null || cur == null || prev === 0) return null
  return ((cur - prev) / prev) * 100
}

/** Weekly sums are only comparable after normalizing per observed day. */
function perDay(v: number | null, days: number): number | null {
  if (v == null || days <= 0) return null
  return v / days
}

function classifyTrend(prev: WeekRow | null, cur: WeekRow): Trend {
  if (!prev) return 'Stable'
  let improving = 0
  let worsening = 0
  const prb = (cur.prbAvg ?? 0) - (prev.prbAvg ?? 0)
  if (prb <= -TOL.prb) improving++
  else if (prb >= TOL.prb) worsening++
  const breach = cur.breachDays - prev.breachDays
  if (breach <= -TOL.breach) improving++
  else if (breach >= TOL.breach) worsening++
  const thrpt = pctChange(prev.throughput, cur.throughput)
  if (thrpt != null && thrpt >= TOL.throughputPct) improving++
  else if (thrpt != null && thrpt <= -TOL.throughputPct) worsening++
  const vol = pctChange(perDay(prev.volume, prev.observedDays), perDay(cur.volume, cur.observedDays))
  if (vol != null && vol <= -TOL.volumePct) improving++
  else if (vol != null && vol >= TOL.volumePct) worsening++
  const users = pctChange(perDay(prev.users, prev.observedDays), perDay(cur.users, cur.observedDays))
  if (users != null && users <= -TOL.usersPct) improving++
  else if (users != null && users >= TOL.usersPct) worsening++
  const net = improving - worsening
  if (net >= 2) return 'Improving'
  if (net <= -2) return 'Worsening'
  return 'Stable'
}

function classifySeverity(
  cur: WeekRow,
  lifecycle: Lifecycle,
  trend: Trend,
  rules: Rules
): Severity {
  if (!cur.isNc) return 'Normal'
  let score = 0
  switch (lifecycle) {
    case 'New NC':
      score += 40
      break
    case 'Recurring NC':
      score += 60
      break
    case 'Persistent NC':
      score += 80
      break
    default:
      score += 40
  }
  const excess = (cur.prbAvg ?? rules.prbThresholdPct) - rules.prbThresholdPct
  if (excess >= 20) score += 25
  else if (excess >= 10) score += 15
  else if (excess >= 5) score += 10
  else if (excess >= 0) score += 5
  score += Math.min(15, cur.breachDays * 2)
  if (trend === 'Worsening') score += 10
  if (cur.availability != null && cur.availability < 99) score += 5
  score = Math.min(100, score)
  if (score >= 75) return 'Critical'
  if (score >= 45) return 'High'
  return 'Watch'
}

/** Recompute lifecycle/trend/severity for the given cells across their full
 *  weekly history (chains need prior weeks, so per-cell full recompute is the
 *  correct incremental unit). */
export async function recomputeNcLifecycle(conn: DuckDBConnection, cellIds: number[]): Promise<void> {
  if (cellIds.length === 0) return
  const rules = await getRules(conn)
  if (!rules) return
  const idList = cellIds.join(',')

  const r = await conn.runAndReadAll(`
    SELECT w.cell_id, CAST(w.week_start AS VARCHAR) AS week_start,
      w.is_nc, CAST(w.breach_days AS DOUBLE) AS breach_days,
      CAST(w.observed_days AS DOUBLE) AS observed_days,
      w.prb_avg, w.prb_peak, w.data_volume_mb_sum, w.connected_users_sum,
      w.dl_throughput_kbps_avg, w.availability_pct_avg
    FROM agg_cell_weekly w
    WHERE w.cell_id IN (${idList})
    ORDER BY w.cell_id, w.week_start
  `)
  const rows = r.getRowObjects()

  await conn.run(`DELETE FROM cell_nc_lifecycle WHERE cell_id IN (${idList})`)
  if (rows.length === 0) return

  const inserts: string[] = []
  const params: DuckDBValue[] = []
  let curCell = -1
  let prev: WeekRow | null = null
  let streak = 0
  let prevNc = false

  const flushPrev = (): void => {
    prev = null
    streak = 0
    prevNc = false
  }

  const buildWeekRow = (x: Record<string, unknown>): WeekRow => ({
    cellId: Number(x.cell_id),
    weekStart: String(x.week_start),
    isNc: Boolean(x.is_nc),
    breachDays: Number(x.breach_days ?? 0),
    observedDays: Number(x.observed_days ?? 0),
    prbAvg: x.prb_avg == null ? null : Number(x.prb_avg),
    prbPeak: x.prb_peak == null ? null : Number(x.prb_peak),
    volume: x.data_volume_mb_sum == null ? null : Number(x.data_volume_mb_sum),
    users: x.connected_users_sum == null ? null : Number(x.connected_users_sum),
    throughput: x.dl_throughput_kbps_avg == null ? null : Number(x.dl_throughput_kbps_avg),
    availability: x.availability_pct_avg == null ? null : Number(x.availability_pct_avg)
  })

  for (const x of rows) {
    const w = buildWeekRow(x)
    if (w.cellId !== curCell) {
      flushPrev()
      curCell = w.cellId
    }
    if (w.isNc) streak++
    else streak = 0

    let lifecycle: Lifecycle
    if (w.isNc) {
      if (streak >= rules.persistentWeeks) lifecycle = 'Persistent NC'
      else if (streak === 1) lifecycle = 'New NC'
      else lifecycle = 'Recurring NC'
    } else if (prevNc) {
      lifecycle = 'Recovering'
    } else {
      lifecycle = 'Healthy'
    }

    const trend = classifyTrend(prev, w)
    const severity = classifySeverity(w, lifecycle, trend, rules)

    inserts.push(
      `(${w.cellId}, ?, 'weekly', ${rules.version}, ${w.isNc ? 'true' : 'false'}, ` +
        `?, ?, ?, ${w.breachDays}, ?, now())`
    )
    params.push(w.weekStart, lifecycle, trend, severity, w.prbAvg)

    prev = w
    prevNc = w.isNc
  }

  // batch insert in chunks (DuckDB statement size limits)
  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500)
    const chunkParams = params.slice(i * 5, (i + 500) * 5)
    await conn.run(
      `INSERT INTO cell_nc_lifecycle
         (cell_id, period_start, grain, ruleset_version, is_nc, lifecycle, trend, severity,
          breach_days, prb_avg, computed_at)
       VALUES ${chunk.join(', ')}`,
      chunkParams
    )
  }
}
