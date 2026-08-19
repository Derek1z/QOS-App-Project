import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api'
import type { PriorityMode, PriorityBand, Lifecycle, Trend } from '../../../shared/api'
import { PRIORITY_MODES } from '../../../shared/api'
import { getRules } from './rules'
import { cellKpiBreachByCell } from './kpiBreach'

/** How much the imported-KPI target-breach component weighs in the score.
 *  The six classical components keep 80%; the editable targets drive 20%. */
const KPI_BREACH_WEIGHT = 0.2

/** Priority Score (spec §43): transparent 0-100 score from six weighted
 *  components. Default weights 25/20/15/15/15/10; five modes rebalance them.
 *  Higher score = more urgent. Bands: Critical 90+, High 75+, Medium 50+,
 *  Watch 25+, Low below. */

// [prbSeverity, persistence, userImpact, trafficImpact, throughputDegradation, worseningTrend]
const MODE_WEIGHTS: Record<Exclude<PriorityMode, 'balanced'>, number[]> = {
  customer: [10, 15, 30, 25, 20, 0], // customer impact: users + traffic lead
  congestion: [45, 15, 5, 10, 15, 10], // congestion severity: PRB leads
  persistence: [15, 45, 10, 10, 10, 10], // persistence: recurrence leads
  deterioration: [20, 15, 10, 10, 15, 30] // rapid deterioration: trend leads
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function bandFor(score: number): PriorityBand {
  if (score >= 90) return 'Critical'
  if (score >= 75) return 'High'
  if (score >= 50) return 'Medium'
  if (score >= 25) return 'Watch'
  return 'Low'
}

const PERSISTENCE_BY_LIFECYCLE: Record<Lifecycle, number> = {
  'Healthy': 0,
  'Recovering': 0,
  'New NC': 35,
  'Recurring NC': 70,
  'Persistent NC': 90,
  'Chronic NC': 100
}

const TREND_COMPONENT: Record<Trend, number> = {
  'Improving': 0,
  'Stable': 50,
  'Worsening': 100
}

export async function recomputePriority(conn: DuckDBConnection, cellIds: number[]): Promise<void> {
  if (cellIds.length === 0) return
  const rules = await getRules(conn)
  if (!rules) return
  const idList = cellIds.join(',')

  await conn.run(`DELETE FROM cell_priority_history WHERE cell_id IN (${idList})`)

  const w = rules.priorityWeights ?? [25, 20, 15, 15, 15, 10]
  const prbThresh = rules.prbThresholdPct ?? 80

  await conn.run(`
    WITH latest AS (
      SELECT cell_id, week_start,
        row_number() OVER (PARTITION BY cell_id ORDER BY week_start DESC) AS rn
      FROM agg_cell_weekly
    ),
    peers AS (
      SELECT week_start,
        avg(connected_users_sum) AS avg_users,
        avg(data_volume_mb_sum) AS avg_volume,
        avg(dl_throughput_kbps_avg) AS avg_throughput
      FROM agg_cell_weekly
      GROUP BY week_start
    ),
    kpi_breach_agg AS (
      SELECT w.cell_id, w.week_start,
        ROUND(COALESCE(
          AVG(
            LEAST(100.0, GREATEST(0.0,
              CASE
                WHEN k.target IS NULL OR k.target = 0 THEN 0.0
                WHEN k.worse_is_higher THEN (100.0 * (
                  CASE k.agg
                    WHEN 'sum' THEN w.sum_value
                    WHEN 'max' THEN w.max_value
                    WHEN 'min' THEN w.min_value
                    ELSE w.avg_value
                  END - k.target)) / k.target
                ELSE (100.0 * (k.target -
                  CASE k.agg
                    WHEN 'sum' THEN w.sum_value
                    WHEN 'max' THEN w.max_value
                    WHEN 'min' THEN w.min_value
                    ELSE w.avg_value
                  END)) / k.target
              END
            ))
          ),
          0.0
        ), 1) AS kpi_breach_score
      FROM agg_cell_kpi_weekly w
      JOIN kpi_defs k ON k.kpi_id = w.kpi_id
      WHERE k.active AND k.target IS NOT NULL
        AND w.cell_id IN (${idList})
      GROUP BY w.cell_id, w.week_start
    ),
    cell_base AS (
      SELECT w.cell_id, CAST(w.week_start AS VARCHAR) AS week_start,
        w.prb_avg, w.connected_users_sum, w.data_volume_mb_sum, w.dl_throughput_kbps_avg,
        COALESCE(l.lifecycle, 'Healthy') AS lifecycle,
        COALESCE(l.trend, 'Stable') AS trend,
        p.avg_users, p.avg_volume, p.avg_throughput,
        COALESCE(kb.kpi_breach_score, 0.0) AS kpi_breach
      FROM latest lw
      JOIN agg_cell_weekly w ON w.cell_id = lw.cell_id AND w.week_start = lw.week_start
      JOIN peers p ON p.week_start = lw.week_start
      LEFT JOIN cell_nc_lifecycle l
        ON l.cell_id = lw.cell_id AND l.period_start = lw.week_start
        AND l.grain = 'weekly' AND l.ruleset_version = ${rules.version}
      LEFT JOIN kpi_breach_agg kb
        ON kb.cell_id = lw.cell_id AND kb.week_start = lw.week_start
      WHERE lw.cell_id IN (${idList}) AND lw.rn = 1
    ),
    comp AS (
      SELECT b.cell_id, b.week_start,
        ROUND(LEAST(100.0, GREATEST(0.0, (100.0 * (COALESCE(b.prb_avg, ${prbThresh}) - ${prbThresh})) / 40.0)), 1) AS prb_sev,
        CASE b.lifecycle
          WHEN 'Chronic NC' THEN 100.0
          WHEN 'Persistent NC' THEN 90.0
          WHEN 'Recurring NC' THEN 70.0
          WHEN 'New NC' THEN 35.0
          ELSE 0.0
        END AS persistence,
        CASE WHEN b.avg_users > 0 THEN ROUND(LEAST(100.0, GREATEST(0.0, (100.0 * (b.connected_users_sum - b.avg_users)) / b.avg_users)), 1) ELSE 0.0 END AS user_imp,
        CASE WHEN b.avg_volume > 0 THEN ROUND(LEAST(100.0, GREATEST(0.0, (100.0 * (b.data_volume_mb_sum - b.avg_volume)) / b.avg_volume)), 1) ELSE 0.0 END AS traffic_imp,
        CASE WHEN b.avg_throughput > 0 THEN ROUND(LEAST(100.0, GREATEST(0.0, (100.0 * (b.avg_throughput - b.dl_throughput_kbps_avg)) / b.avg_throughput)), 1) ELSE 0.0 END AS thrpt_deg,
        CASE b.trend
          WHEN 'Worsening' THEN 100.0
          WHEN 'Stable' THEN 50.0
          ELSE 0.0
        END AS trend_comp,
        b.kpi_breach AS kpi_breach
      FROM cell_base b
    ),
    modes(mode_name, w_prb, w_pers, w_user, w_vol, w_thrpt, w_trend) AS (
      VALUES
        ('balanced', ${w[0]}, ${w[1]}, ${w[2]}, ${w[3]}, ${w[4]}, ${w[5]}),
        ('customer', 10, 15, 30, 25, 20, 0),
        ('congestion', 45, 15, 5, 10, 15, 10),
        ('persistence', 15, 45, 10, 10, 10, 10),
        ('deterioration', 20, 15, 10, 10, 15, 30)
    ),
    scored AS (
      SELECT c.cell_id, c.week_start, m.mode_name,
        ROUND(
          (m.w_prb * c.prb_sev + m.w_pers * c.persistence + m.w_user * c.user_imp +
           m.w_vol * c.traffic_imp + m.w_thrpt * c.thrpt_deg + m.w_trend * c.trend_comp) / 100.0, 1
        ) AS final_score,
        json_object(
          'prbSeverity', c.prb_sev,
          'persistence', c.persistence,
          'userImpact', c.user_imp,
          'trafficImpact', c.traffic_imp,
          'throughputDegradation', c.thrpt_deg,
          'worseningTrend', c.trend_comp,
          'kpiBreach', c.kpi_breach
        ) AS weights_json
      FROM comp c CROSS JOIN modes m
    )
    INSERT INTO cell_priority_history
      (cell_id, as_of, score, band, mode, weights, ruleset_version)
    SELECT cell_id, week_start, final_score,
      CASE
        WHEN final_score >= 90 THEN 'Critical'
        WHEN final_score >= 75 THEN 'High'
        WHEN final_score >= 50 THEN 'Medium'
        WHEN final_score >= 25 THEN 'Watch'
        ELSE 'Low'
      END AS band,
      mode_name, weights_json, ${rules.version}
    FROM scored
  `)
}
