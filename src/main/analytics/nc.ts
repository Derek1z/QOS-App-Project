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
    case 'Chronic NC':
      score += 90
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
 *  weekly, daily, and monthly history. Vectorized in DuckDB SQL for blazing performance. */
export async function recomputeNcLifecycle(conn: DuckDBConnection, cellIds: number[]): Promise<void> {
  if (cellIds.length === 0) return
  const rules = await getRules(conn)
  if (!rules) return
  const idList = cellIds.join(',')

  await conn.run(`DELETE FROM cell_nc_lifecycle WHERE cell_id IN (${idList})`)

  const chronicWeeks = rules.chronicWeeks ?? 7
  const persistentWeeks = rules.persistentWeeks ?? 4
  const prbThresh = rules.prbThresholdPct ?? 80

  const grains: Array<{
    grain: 'weekly' | 'daily' | 'monthly'
    fromSql: string
    obsDaysSql: string
    breachDaysSql: string
    chronicThresh: number
    persistentThresh: number
  }> = [
    {
      grain: 'weekly',
      fromSql: `
        SELECT w.cell_id, w.week_start AS period_date, w.is_nc,
               CAST(coalesce(w.breach_days, 0) AS DOUBLE) AS breach_days,
               CAST(coalesce(w.observed_days, 1) AS DOUBLE) AS observed_days,
               w.prb_avg, w.prb_peak, w.data_volume_mb_sum, w.connected_users_sum,
               w.dl_throughput_kbps_avg, w.availability_pct_avg
        FROM agg_cell_weekly w
        WHERE w.cell_id IN (${idList})
      `,
      obsDaysSql: 'CAST(coalesce(w.observed_days, 1) AS DOUBLE)',
      breachDaysSql: 'CAST(coalesce(w.breach_days, 0) AS DOUBLE)',
      chronicThresh: chronicWeeks,
      persistentThresh: persistentWeeks
    },
    {
      grain: 'daily',
      fromSql: `
        SELECT f.cell_id, d.date AS period_date,
               (f.prb_utilization >= ${prbThresh}) AS is_nc,
               CAST(CASE WHEN f.prb_utilization >= ${prbThresh} THEN 1 ELSE 0 END AS DOUBLE) AS breach_days,
               1.0 AS observed_days,
               f.prb_utilization AS prb_avg,
               f.prb_utilization AS prb_peak,
               f.data_volume_mb AS data_volume_mb_sum,
               f.connected_users AS connected_users_sum,
               f.dl_throughput_kbps AS dl_throughput_kbps_avg,
               f.availability_pct AS availability_pct_avg
        FROM fact_cell_daily f
        JOIN dim_date d USING (date_id)
        WHERE f.cell_id IN (${idList})
      `,
      obsDaysSql: '1.0',
      breachDaysSql: 'w.breach_days',
      chronicThresh: Math.max(14, chronicWeeks * 7),
      persistentThresh: Math.max(7, persistentWeeks * 7)
    },
    {
      grain: 'monthly',
      fromSql: `
        SELECT w.cell_id, w.month_start AS period_date, w.is_nc,
               CAST(coalesce(w.breach_days, 0) AS DOUBLE) AS breach_days,
               CAST(coalesce(w.observed_days, 30) AS DOUBLE) AS observed_days,
               w.prb_avg, w.prb_peak, w.data_volume_mb_sum, w.connected_users_sum,
               w.dl_throughput_kbps_avg, w.availability_pct_avg
        FROM agg_cell_monthly w
        WHERE w.cell_id IN (${idList})
      `,
      obsDaysSql: 'CAST(coalesce(w.observed_days, 30) AS DOUBLE)',
      breachDaysSql: 'CAST(coalesce(w.breach_days, 0) AS DOUBLE)',
      chronicThresh: Math.max(2, Math.round(chronicWeeks / 4)),
      persistentThresh: Math.max(2, Math.round(persistentWeeks / 4))
    }
  ]

  for (const g of grains) {
    await conn.run(`
      WITH raw_data AS (
        ${g.fromSql}
      ),
      base AS (
        SELECT w.cell_id, w.period_date, w.is_nc,
               ${g.breachDaysSql} AS breach_days,
               ${g.obsDaysSql} AS observed_days,
               w.prb_avg, w.prb_peak, w.data_volume_mb_sum, w.connected_users_sum,
               w.dl_throughput_kbps_avg, w.availability_pct_avg,
               lag(w.is_nc) OVER (PARTITION BY w.cell_id ORDER BY w.period_date) AS prev_is_nc,
               lag(w.prb_avg) OVER (PARTITION BY w.cell_id ORDER BY w.period_date) AS prev_prb,
               lag(${g.breachDaysSql}) OVER (PARTITION BY w.cell_id ORDER BY w.period_date) AS prev_breach,
               lag(w.dl_throughput_kbps_avg) OVER (PARTITION BY w.cell_id ORDER BY w.period_date) AS prev_thrpt,
               lag(w.data_volume_mb_sum / NULLIF(${g.obsDaysSql}, 0)) OVER (PARTITION BY w.cell_id ORDER BY w.period_date) AS prev_vol_per_day,
               lag(w.connected_users_sum / NULLIF(${g.obsDaysSql}, 0)) OVER (PARTITION BY w.cell_id ORDER BY w.period_date) AS prev_users_per_day,
               w.data_volume_mb_sum / NULLIF(${g.obsDaysSql}, 0) AS cur_vol_per_day,
               w.connected_users_sum / NULLIF(${g.obsDaysSql}, 0) AS cur_users_per_day
        FROM raw_data w
      ),
      groups AS (
        SELECT b.*,
               sum(CASE WHEN is_nc THEN 0 ELSE 1 END) OVER (PARTITION BY cell_id ORDER BY period_date) AS grp
        FROM base b
      ),
      streaks AS (
        SELECT g.*,
               CASE WHEN is_nc THEN row_number() OVER (PARTITION BY cell_id, grp ORDER BY period_date) ELSE 0 END AS streak
        FROM groups g
      ),
      classified AS (
        SELECT s.cell_id, s.period_date, s.is_nc, s.breach_days, s.prb_avg,
               CASE
                 WHEN s.is_nc THEN
                   CASE
                     WHEN s.streak >= ${g.chronicThresh} THEN 'Chronic NC'
                     WHEN s.streak >= ${g.persistentThresh} THEN 'Persistent NC'
                     WHEN s.streak = 1 THEN 'New NC'
                     ELSE 'Recurring NC'
                   END
                 WHEN s.prev_is_nc IS TRUE THEN 'Recovering'
                 ELSE 'Healthy'
               END AS lifecycle,
               CASE
                 WHEN s.prev_is_nc IS NULL AND s.prev_prb IS NULL THEN 'Stable'
                 ELSE
                   CASE
                     WHEN (
                       (CASE WHEN (coalesce(s.prb_avg, 0) - coalesce(s.prev_prb, 0)) <= -3 THEN 1 ELSE 0 END) +
                       (CASE WHEN (s.breach_days - coalesce(s.prev_breach, 0)) <= -1 THEN 1 ELSE 0 END) +
                       (CASE WHEN s.prev_thrpt IS NOT NULL AND s.prev_thrpt > 0 AND ((s.dl_throughput_kbps_avg - s.prev_thrpt) / s.prev_thrpt) * 100 >= 10 THEN 1 ELSE 0 END) +
                       (CASE WHEN s.prev_vol_per_day IS NOT NULL AND s.prev_vol_per_day > 0 AND ((s.cur_vol_per_day - s.prev_vol_per_day) / s.prev_vol_per_day) * 100 <= -10 THEN 1 ELSE 0 END) +
                       (CASE WHEN s.prev_users_per_day IS NOT NULL AND s.prev_users_per_day > 0 AND ((s.cur_users_per_day - s.prev_users_per_day) / s.prev_users_per_day) * 100 <= -10 THEN 1 ELSE 0 END)
                     ) - (
                       (CASE WHEN (coalesce(s.prb_avg, 0) - coalesce(s.prev_prb, 0)) >= 3 THEN 1 ELSE 0 END) +
                       (CASE WHEN (s.breach_days - coalesce(s.prev_breach, 0)) >= 1 THEN 1 ELSE 0 END) +
                       (CASE WHEN s.prev_thrpt IS NOT NULL AND s.prev_thrpt > 0 AND ((s.dl_throughput_kbps_avg - s.prev_thrpt) / s.prev_thrpt) * 100 <= -10 THEN 1 ELSE 0 END) +
                       (CASE WHEN s.prev_vol_per_day IS NOT NULL AND s.prev_vol_per_day > 0 AND ((s.cur_vol_per_day - s.prev_vol_per_day) / s.prev_vol_per_day) * 100 >= 10 THEN 1 ELSE 0 END) +
                       (CASE WHEN s.prev_users_per_day IS NOT NULL AND s.prev_users_per_day > 0 AND ((s.cur_users_per_day - s.prev_users_per_day) / s.prev_users_per_day) * 100 >= 10 THEN 1 ELSE 0 END)
                     ) >= 2 THEN 'Improving'
                     WHEN (
                       (CASE WHEN (coalesce(s.prb_avg, 0) - coalesce(s.prev_prb, 0)) <= -3 THEN 1 ELSE 0 END) +
                       (CASE WHEN (s.breach_days - coalesce(s.prev_breach, 0)) <= -1 THEN 1 ELSE 0 END) +
                       (CASE WHEN s.prev_thrpt IS NOT NULL AND s.prev_thrpt > 0 AND ((s.dl_throughput_kbps_avg - s.prev_thrpt) / s.prev_thrpt) * 100 >= 10 THEN 1 ELSE 0 END) +
                       (CASE WHEN s.prev_vol_per_day IS NOT NULL AND s.prev_vol_per_day > 0 AND ((s.cur_vol_per_day - s.prev_vol_per_day) / s.prev_vol_per_day) * 100 <= -10 THEN 1 ELSE 0 END) +
                       (CASE WHEN s.prev_users_per_day IS NOT NULL AND s.prev_users_per_day > 0 AND ((s.cur_users_per_day - s.prev_users_per_day) / s.prev_users_per_day) * 100 <= -10 THEN 1 ELSE 0 END)
                     ) - (
                       (CASE WHEN (coalesce(s.prb_avg, 0) - coalesce(s.prev_prb, 0)) >= 3 THEN 1 ELSE 0 END) +
                       (CASE WHEN (s.breach_days - coalesce(s.prev_breach, 0)) >= 1 THEN 1 ELSE 0 END) +
                       (CASE WHEN s.prev_thrpt IS NOT NULL AND s.prev_thrpt > 0 AND ((s.dl_throughput_kbps_avg - s.prev_thrpt) / s.prev_thrpt) * 100 <= -10 THEN 1 ELSE 0 END) +
                       (CASE WHEN s.prev_vol_per_day IS NOT NULL AND s.prev_vol_per_day > 0 AND ((s.cur_vol_per_day - s.prev_vol_per_day) / s.prev_vol_per_day) * 100 >= 10 THEN 1 ELSE 0 END) +
                       (CASE WHEN s.prev_users_per_day IS NOT NULL AND s.prev_users_per_day > 0 AND ((s.cur_users_per_day - s.prev_users_per_day) / s.prev_users_per_day) * 100 >= 10 THEN 1 ELSE 0 END)
                     ) <= -2 THEN 'Worsening'
                     ELSE 'Stable'
                   END
               END AS trend,
               s.availability_pct_avg
        FROM streaks s
      )
      INSERT INTO cell_nc_lifecycle
        (cell_id, period_start, grain, ruleset_version, is_nc, lifecycle, trend, severity, breach_days, prb_avg, computed_at)
      SELECT cell_id, CAST(period_date AS VARCHAR), '${g.grain}', ${rules.version}, is_nc, lifecycle, trend,
             CASE
               WHEN NOT is_nc THEN 'Normal'
               ELSE
                 CASE
                   WHEN (
                     (CASE lifecycle WHEN 'New NC' THEN 40 WHEN 'Recurring NC' THEN 60 WHEN 'Persistent NC' THEN 80 WHEN 'Chronic NC' THEN 90 ELSE 40 END) +
                     (CASE WHEN (coalesce(prb_avg, ${prbThresh}) - ${prbThresh}) >= 20 THEN 25
                           WHEN (coalesce(prb_avg, ${prbThresh}) - ${prbThresh}) >= 10 THEN 15
                           WHEN (coalesce(prb_avg, ${prbThresh}) - ${prbThresh}) >= 5 THEN 10
                           WHEN (coalesce(prb_avg, ${prbThresh}) - ${prbThresh}) >= 0 THEN 5 ELSE 0 END) +
                     LEAST(15, breach_days * 2) +
                     (CASE WHEN trend = 'Worsening' THEN 10 ELSE 0 END) +
                     (CASE WHEN availability_pct_avg IS NOT NULL AND availability_pct_avg < 99 THEN 5 ELSE 0 END)
                   ) >= 75 THEN 'Critical'
                   WHEN (
                     (CASE lifecycle WHEN 'New NC' THEN 40 WHEN 'Recurring NC' THEN 60 WHEN 'Persistent NC' THEN 80 WHEN 'Chronic NC' THEN 90 ELSE 40 END) +
                     (CASE WHEN (coalesce(prb_avg, ${prbThresh}) - ${prbThresh}) >= 20 THEN 25
                           WHEN (coalesce(prb_avg, ${prbThresh}) - ${prbThresh}) >= 10 THEN 15
                           WHEN (coalesce(prb_avg, ${prbThresh}) - ${prbThresh}) >= 5 THEN 10
                           WHEN (coalesce(prb_avg, ${prbThresh}) - ${prbThresh}) >= 0 THEN 5 ELSE 0 END) +
                     LEAST(15, breach_days * 2) +
                     (CASE WHEN trend = 'Worsening' THEN 10 ELSE 0 END) +
                     (CASE WHEN availability_pct_avg IS NOT NULL AND availability_pct_avg < 99 THEN 5 ELSE 0 END)
                   ) >= 45 THEN 'High'
                   ELSE 'Watch'
                 END
             END AS severity,
             breach_days, prb_avg, now()
      FROM classified
    `)
  }
}
