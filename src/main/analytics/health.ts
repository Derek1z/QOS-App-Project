import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api'
import type { HealthComponentRow, Lifecycle } from '../../../shared/api'
import { getRules } from './rules'

/** Health scores (spec §29, §62). Network health is computed on the fly from
 *  agg_network_weekly (cheap, a handful of rows); cell health is persisted in
 *  cell_health_history keyed by the week-end date_id. All components are
 *  transparent and stored so the score is never opaque. */

// Engineering reference for full-throughput health (DL, kbps ≈ 25 Mbps).
const THROUGHPUT_REFERENCE_KBPS = 25_000

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

const NC_HEALTH: Record<Lifecycle, number> = {
  'Healthy': 100,
  'Recovering': 90,
  'New NC': 60,
  'Recurring NC': 50,
  'Persistent NC': 40
}

/** Network Health Score series, most recent last. */
export async function computeNetworkHealth(conn: DuckDBConnection): Promise<HealthComponentRow[]> {
  const rules = await getRules(conn)
  if (!rules) return []
  const r = await conn.runAndReadAll(`
    WITH vol AS (
      SELECT period_start, data_volume_mb_sum,
        lag(data_volume_mb_sum) OVER (ORDER BY period_start) AS prev_volume
      FROM agg_network_weekly
    )
    SELECT CAST(n.period_start AS VARCHAR) AS as_of,
      n.prb_avg, n.nc_rate, n.dl_throughput_kbps_avg, n.availability_pct_avg,
      v.data_volume_mb_sum, v.prev_volume
    FROM agg_network_weekly n JOIN vol v USING (period_start)
    ORDER BY n.period_start
  `)
  const out: HealthComponentRow[] = []
  for (const x of r.getRowObjects()) {
    const prbAvg = x.prb_avg == null ? rules.prbThresholdPct : Number(x.prb_avg)
    const thrpt = Number(x.dl_throughput_kbps_avg ?? 0)
    const avail = Number(x.availability_pct_avg ?? 100)
    const ncRate = Number(x.nc_rate ?? 0)
    const volume = Number(x.data_volume_mb_sum ?? 0)
    const prevVolume = x.prev_volume == null ? null : Number(x.prev_volume)
    const growthPct = prevVolume != null && prevVolume > 0 ? ((volume - prevVolume) / prevVolume) * 100 : 0

    const capacity = Math.round(clamp(100 - (100 * (prbAvg - rules.prbThresholdPct)) / 40, 0, 100) * 10) / 10
    const throughput = Math.round(clamp((100 * thrpt) / THROUGHPUT_REFERENCE_KBPS, 0, 100) * 10) / 10
    const availability = Math.round(clamp(avail, 0, 100) * 10) / 10
    const ncRecurrence = Math.round(clamp(100 - ncRate * 3, 0, 100) * 10) / 10
    const growth = Math.round(clamp(100 - clamp(growthPct, 0, 100) * 2, 0, 100) * 10) / 10
    const score =
      0.25 * capacity + 0.2 * throughput + 0.2 * availability + 0.2 * ncRecurrence + 0.15 * growth

    out.push({
      asOf: String(x.as_of),
      score: Math.round(score * 10) / 10,
      capacity,
      throughput,
      availability,
      ncRecurrence,
      growth
    })
  }
  return out
}

/** Persist weekly cell health into cell_health_history (date_id = week end). */
export async function recomputeCellHealth(conn: DuckDBConnection, cellIds: number[]): Promise<void> {
  if (cellIds.length === 0) return
  const rules = await getRules(conn)
  if (!rules) return
  const idList = cellIds.join(',')

  const r = await conn.runAndReadAll(`
    WITH peers AS (
      SELECT week_start,
        avg(dl_throughput_kbps_avg) AS avg_throughput
      FROM agg_cell_weekly GROUP BY week_start
    ),
    vol AS (
      SELECT cell_id, week_start, data_volume_mb_sum,
        lag(data_volume_mb_sum) OVER (PARTITION BY cell_id ORDER BY week_start) AS prev_volume
      FROM agg_cell_weekly
    )
    SELECT w.cell_id, CAST(w.week_start AS VARCHAR) AS week_start,
      CAST(w.week_end AS VARCHAR) AS week_end, w.prb_avg, w.data_volume_mb_sum,
      w.dl_throughput_kbps_avg, w.availability_pct_avg,
      COALESCE(l.lifecycle, 'Healthy') AS lifecycle,
      p.avg_throughput, v.prev_volume,
      d.date_id
    FROM agg_cell_weekly w
    JOIN peers p USING (week_start)
    JOIN vol v USING (cell_id, week_start)
    LEFT JOIN cell_nc_lifecycle l
      ON l.cell_id = w.cell_id AND l.period_start = w.week_start
      AND l.grain = 'weekly' AND l.ruleset_version = ${rules.version}
    JOIN dim_date d ON d.date = w.week_end
    WHERE w.cell_id IN (${idList})
  `)
  const rows = r.getRowObjects()
  if (rows.length === 0) return

  await conn.run(`DELETE FROM cell_health_history WHERE cell_id IN (${idList})`)

  const inserts: string[] = []
  const params: DuckDBValue[] = []
  for (const x of rows) {
    const prbAvg = x.prb_avg == null ? rules.prbThresholdPct : Number(x.prb_avg)
    const thrpt = Number(x.dl_throughput_kbps_avg ?? 0)
    const avail = Number(x.availability_pct_avg ?? 100)
    const volume = Number(x.data_volume_mb_sum ?? 0)
    const prevVolume = x.prev_volume == null ? null : Number(x.prev_volume)
    const avgThroughput = Number(x.avg_throughput ?? 0)
    const lifecycle = (String(x.lifecycle) ?? 'Healthy') as Lifecycle
    const growthPct = prevVolume != null && prevVolume > 0 ? ((volume - prevVolume) / prevVolume) * 100 : 0

    const capacity = Math.round(clamp(100 - (100 * (prbAvg - rules.prbThresholdPct)) / 40, 0, 100) * 10) / 10
    const throughput =
      avgThroughput > 0 ? Math.round(clamp((100 * thrpt) / avgThroughput, 0, 100) * 10) / 10 : 100
    const availability = Math.round(clamp(avail, 0, 100) * 10) / 10
    const ncHealth = NC_HEALTH[lifecycle] ?? 100
    const growth = Math.round(clamp(100 - clamp(growthPct, 0, 100) / 0.3, 0, 100) * 10) / 10
    const score =
      0.25 * capacity + 0.2 * throughput + 0.2 * availability + 0.25 * ncHealth + 0.1 * growth

    inserts.push(`(${Number(x.cell_id)}, ?, ?, ?)`)
    params.push(
      Number(x.date_id),
      Math.round(score * 10) / 10,
      JSON.stringify({ capacity, throughput, availability, ncHealth, growth })
    )
  }
  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500)
    const chunkParams = params.slice(i * 3, (i + 500) * 3)
    await conn.run(
      `INSERT INTO cell_health_history (cell_id, date_id, health_score, components)
       VALUES ${chunk.join(', ')}`,
      chunkParams
    )
  }
}

