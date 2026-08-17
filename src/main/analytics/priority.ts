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
  'Persistent NC': 100
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

  // latest weekly row per cell + its lifecycle classification + peer averages
  const r = await conn.runAndReadAll(`
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
    )
    SELECT w.cell_id, CAST(w.week_start AS VARCHAR) AS week_start,
      w.prb_avg, w.connected_users_sum, w.data_volume_mb_sum, w.dl_throughput_kbps_avg,
      COALESCE(l.lifecycle, 'Healthy') AS lifecycle,
      COALESCE(l.trend, 'Stable') AS trend,
      p.avg_users, p.avg_volume, p.avg_throughput
    FROM latest lw
    JOIN agg_cell_weekly w ON w.cell_id = lw.cell_id AND w.week_start = lw.week_start
    JOIN peers p ON p.week_start = lw.week_start
    LEFT JOIN cell_nc_lifecycle l
      ON l.cell_id = lw.cell_id AND l.period_start = lw.week_start
      AND l.grain = 'weekly' AND l.ruleset_version = ${rules.version}
    WHERE lw.cell_id IN (${idList}) AND lw.rn = 1
  `)
  const rows = r.getRowObjects()
  if (rows.length === 0) return

  // spec §54a: editable per-technology KPI targets feed the score — a cell whose
  // imported KPIs breach their targets (e.g. TCH congestion > 2%) is more urgent
  const weekStart = rows[0].week_start == null ? null : String(rows[0].week_start)
  const kpiBreach = await cellKpiBreachByCell(conn, rows.map((x) => Number(x.cell_id)), weekStart)

  await conn.run(`DELETE FROM cell_priority_history WHERE cell_id IN (${idList})`)

  const insert = async (mode: PriorityMode, weights: number[]): Promise<void> => {
    const inserts: string[] = []
    const params: DuckDBValue[] = []
    for (const x of rows) {
      const prbAvg = x.prb_avg == null ? rules.prbThresholdPct : Number(x.prb_avg)
      const users = Number(x.connected_users_sum ?? 0)
      const volume = Number(x.data_volume_mb_sum ?? 0)
      const throughput = Number(x.dl_throughput_kbps_avg ?? 0)
      const avgUsers = Number(x.avg_users ?? 0)
      const avgVolume = Number(x.avg_volume ?? 0)
      const avgThroughput = Number(x.avg_throughput ?? 0)
      const lifecycle = String(x.lifecycle) as Lifecycle
      const trend = String(x.trend) as Trend

      const kpiBreachScore = kpiBreach.get(Number(x.cell_id)) ?? 0
      const components = {
        prbSeverity: Math.round(clamp((100 * (prbAvg - rules.prbThresholdPct)) / 40, 0, 100) * 10) / 10,
        persistence: PERSISTENCE_BY_LIFECYCLE[lifecycle] ?? 0,
        userImpact: avgUsers > 0 ? Math.round(clamp((100 * (users - avgUsers)) / avgUsers, 0, 100) * 10) / 10 : 0,
        trafficImpact: avgVolume > 0 ? Math.round(clamp((100 * (volume - avgVolume)) / avgVolume, 0, 100) * 10) / 10 : 0,
        throughputDegradation: avgThroughput > 0 ? Math.round(clamp((100 * (avgThroughput - throughput)) / avgThroughput, 0, 100) * 10) / 10 : 0,
        worseningTrend: TREND_COMPONENT[trend] ?? 50,
        kpiBreach: kpiBreachScore
      }
      const classical =
        (weights[0] * components.prbSeverity +
          weights[1] * components.persistence +
          weights[2] * components.userImpact +
          weights[3] * components.trafficImpact +
          weights[4] * components.throughputDegradation +
          weights[5] * components.worseningTrend) / 100
      // editable targets modulate the score: 80% classical + 20% KPI breach
      const score = (1 - KPI_BREACH_WEIGHT) * classical + KPI_BREACH_WEIGHT * components.kpiBreach
      const rounded = Math.round(score * 10) / 10
      inserts.push(`(${Number(x.cell_id)}, ?, ?, ?, '${mode}', ?, ${rules.version})`)
      params.push(
        String(x.week_start),
        rounded,
        bandFor(rounded),
        JSON.stringify(components)
      )
    }
    const BATCH_SIZE = 2500
    for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
      const chunk = inserts.slice(i, i + BATCH_SIZE)
      const chunkParams = params.slice(i * 4, (i + BATCH_SIZE) * 4)
      await conn.run(
        `INSERT INTO cell_priority_history
           (cell_id, as_of, score, band, mode, weights, ruleset_version)
         VALUES ${chunk.join(', ')}`,
        chunkParams
      )
    }
  }

  for (const mode of PRIORITY_MODES) {
    const weights = mode === 'balanced' ? rules.priorityWeights : MODE_WEIGHTS[mode]
    await insert(mode, weights)
  }
}
