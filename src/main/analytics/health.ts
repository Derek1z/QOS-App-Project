import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api'
import type { HealthComponentRow, Lifecycle, Grain } from '../../../shared/api'
import { getRules } from './rules'
import { cellKpiBreachByCell } from './kpiBreach'

/** KPI target-breach share of the cell health score (spec §54a). */
const KPI_BREACH_WEIGHT = 0.15

/** Health scores (spec §29, §62). Network health is computed on the fly from
 *  agg_network_weekly (cheap, a handful of rows); cell health is persisted in
 *  cell_health_history keyed by the week-end date_id. All components are
 *  transparent and stored so the score is never opaque. */

// Engineering reference for full-throughput health (DL, kbps ≈ 25 Mbps).
const THROUGHPUT_REFERENCE_KBPS = 25_000

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export const NC_HEALTH: Record<Lifecycle, number> = {
  'Healthy': 100,
  'Recovering': 90,
  'New NC': 40,
  'Recurring NC': 25,
  'Persistent NC': 10,
  'Chronic NC': 0
}

/** Network Health Score series, most recent last. */
export async function computeNetworkHealth(
  conn: DuckDBConnection,
  grain: Grain = 'weekly'
): Promise<HealthComponentRow[]> {
  const rules = await getRules(conn)
  if (!rules) return []
  const r = await conn.runAndReadAll(`
    WITH vol AS (
      SELECT period_start, data_volume_mb_sum,
        lag(data_volume_mb_sum) OVER (ORDER BY period_start) AS prev_volume
      FROM agg_network_${grain}
    )
    SELECT CAST(n.period_start AS VARCHAR) AS as_of,
      n.prb_avg, n.nc_rate, n.dl_throughput_kbps_avg, n.availability_pct_avg,
      v.data_volume_mb_sum, v.prev_volume
    FROM agg_network_${grain} n JOIN vol v USING (period_start)
    ORDER BY n.period_start
  `)
  const out: HealthComponentRow[] = []
  for (const x of r.getRowObjects()) {
    const thrpt = Number(x.dl_throughput_kbps_avg ?? 0)
    const avail = Number(x.availability_pct_avg ?? 100)
    const ncRate = Number(x.nc_rate ?? 0)
    const volume = Number(x.data_volume_mb_sum ?? 0)
    const prevVolume = x.prev_volume == null ? null : Number(x.prev_volume)
    const growthPct = prevVolume != null && prevVolume > 0 ? ((volume - prevVolume) / prevVolume) * 100 : 0

    const ncRecurrence = Math.round(clamp(100 - ncRate * 3.5, 0, 100) * 10) / 10
    const coreCompliance = Math.round(clamp(avail, 0, 100) * 10) / 10
    const throughput = Math.round(clamp((100 * thrpt) / THROUGHPUT_REFERENCE_KBPS, 0, 100) * 10) / 10
    const growth = Math.round(clamp(100 - clamp(growthPct, 0, 100) * 2, 0, 100) * 10) / 10
    const score =
      0.45 * ncRecurrence + 0.35 * coreCompliance + 0.10 * throughput + 0.10 * growth

    out.push({
      asOf: String(x.as_of),
      score: Math.round(score * 10) / 10,
      capacity: coreCompliance,
      throughput,
      availability: coreCompliance,
      ncRecurrence,
      growth
    })
  }
  return out
}

/** Persist weekly cell health into cell_health_history (date_id = week end). Vectorized in DuckDB SQL. */
export async function recomputeCellHealth(conn: DuckDBConnection, cellIds: number[]): Promise<void> {
  if (cellIds.length === 0) return
  const rules = await getRules(conn)
  if (!rules) return

  const BATCH_SIZE = 2500
  for (let b = 0; b < cellIds.length; b += BATCH_SIZE) {
    const chunk = cellIds.slice(b, b + BATCH_SIZE)
    const idList = chunk.join(',')

    await conn.run(`DELETE FROM cell_health_history WHERE cell_id IN (${idList})`)

    await conn.run(`
      WITH peers AS (
        SELECT week_start,
          avg(dl_throughput_kbps_avg) AS avg_throughput
        FROM agg_cell_weekly GROUP BY week_start
      ),
      vol AS (
        SELECT cell_id, week_start, data_volume_mb_sum,
          lag(data_volume_mb_sum) OVER (PARTITION BY cell_id ORDER BY week_start) AS prev_volume
        FROM agg_cell_weekly
        WHERE cell_id IN (${idList})
      ),
      kpi_eval AS (
        SELECT w.cell_id, w.week_start,
          AVG(CASE WHEN k.is_core THEN
            LEAST(100.0, GREATEST(0.0,
              CASE
                WHEN k.target IS NULL OR k.target = 0 THEN 100.0
                WHEN k.worse_is_higher THEN
                  CASE WHEN (CASE k.agg WHEN 'sum' THEN w.sum_value WHEN 'max' THEN w.max_value WHEN 'min' THEN w.min_value ELSE w.avg_value END) <= k.target THEN 100.0
                  ELSE 100.0 - (100.0 * ((CASE k.agg WHEN 'sum' THEN w.sum_value WHEN 'max' THEN w.max_value WHEN 'min' THEN w.min_value ELSE w.avg_value END) - k.target)) / k.target
                  END
                ELSE
                  CASE WHEN (CASE k.agg WHEN 'sum' THEN w.sum_value WHEN 'max' THEN w.max_value WHEN 'min' THEN w.min_value ELSE w.avg_value END) >= k.target THEN 100.0
                  ELSE 100.0 - (100.0 * (k.target - (CASE k.agg WHEN 'sum' THEN w.sum_value WHEN 'max' THEN w.max_value WHEN 'min' THEN w.min_value ELSE w.avg_value END))) / k.target
                  END
              END
            )) END) AS core_kpi_score,
          AVG(CASE WHEN NOT k.is_core THEN
            LEAST(100.0, GREATEST(0.0,
              CASE
                WHEN k.target IS NULL OR k.target = 0 THEN 100.0
                WHEN k.worse_is_higher THEN
                  CASE WHEN (CASE k.agg WHEN 'sum' THEN w.sum_value WHEN 'max' THEN w.max_value WHEN 'min' THEN w.min_value ELSE w.avg_value END) <= k.target THEN 100.0
                  ELSE 100.0 - (100.0 * ((CASE k.agg WHEN 'sum' THEN w.sum_value WHEN 'max' THEN w.max_value WHEN 'min' THEN w.min_value ELSE w.avg_value END) - k.target)) / k.target
                  END
                ELSE
                  CASE WHEN (CASE k.agg WHEN 'sum' THEN w.sum_value WHEN 'max' THEN w.max_value WHEN 'min' THEN w.min_value ELSE w.avg_value END) >= k.target THEN 100.0
                  ELSE 100.0 - (100.0 * (k.target - (CASE k.agg WHEN 'sum' THEN w.sum_value WHEN 'max' THEN w.max_value WHEN 'min' THEN w.min_value ELSE w.avg_value END))) / k.target
                  END
              END
            )) END) AS supporting_kpi_score
        FROM agg_cell_kpi_weekly w
        JOIN kpi_defs k ON k.kpi_id = w.kpi_id
        WHERE w.cell_id IN (${idList}) AND k.active
        GROUP BY w.cell_id, w.week_start
      ),
      prep AS (
        SELECT w.cell_id, d.date_id,
          CASE COALESCE(l.lifecycle, 'Healthy')
            WHEN 'Healthy' THEN 100.0
            WHEN 'Recovering' THEN 90.0
            WHEN 'New NC' THEN 40.0
            WHEN 'Recurring NC' THEN 25.0
            WHEN 'Persistent NC' THEN 10.0
            WHEN 'Chronic NC' THEN 0.0
            ELSE 100.0
          END AS nc_health,
          ROUND(COALESCE(ke.core_kpi_score, 100.0), 1) AS core_kpi_health,
          ROUND(COALESCE(ke.supporting_kpi_score,
            (CASE WHEN p.avg_throughput > 0 THEN LEAST(100.0, GREATEST(0.0, (100.0 * COALESCE(w.dl_throughput_kbps_avg, 0)) / p.avg_throughput)) ELSE 100.0 END * 0.5 +
             LEAST(100.0, GREATEST(0.0, COALESCE(w.availability_pct_avg, 100.0))) * 0.5)
          ), 1) AS supporting_kpi_health,
          CASE COALESCE(l.trend, 'Stable')
            WHEN 'Improving' THEN 100.0
            WHEN 'Stable' THEN 75.0
            WHEN 'Worsening' THEN 25.0
            ELSE 75.0
          END AS trend_health
        FROM agg_cell_weekly w
        JOIN peers p USING (week_start)
        JOIN vol v USING (cell_id, week_start)
        LEFT JOIN kpi_eval ke ON ke.cell_id = w.cell_id AND ke.week_start = w.week_start
        LEFT JOIN cell_nc_lifecycle l
          ON l.cell_id = w.cell_id AND l.period_start = w.week_start
          AND l.grain = 'weekly' AND l.ruleset_version = ${rules.version}
        JOIN dim_date d ON d.date = w.week_end
        WHERE w.cell_id IN (${idList})
      ),
      scored AS (
        SELECT cell_id, date_id,
          ROUND(0.45 * nc_health + 0.35 * core_kpi_health + 0.10 * supporting_kpi_health + 0.10 * trend_health, 1) AS final_score,
          json_object(
            'ncHealth', nc_health,
            'coreKpiHealth', core_kpi_health,
            'supportingKpiHealth', supporting_kpi_health,
            'trendHealth', trend_health,
            'capacity', core_kpi_health,
            'throughput', supporting_kpi_health,
            'availability', supporting_kpi_health,
            'growth', trend_health,
            'kpiHealth', core_kpi_health
          ) AS comps_json
        FROM prep
      )
      INSERT INTO cell_health_history (cell_id, date_id, health_score, components)
      SELECT cell_id, date_id, final_score, comps_json
      FROM scored
    `)
  }
}

