import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as ws from './workspace/manager'
import { recomputeAllAggregates } from './import/aggregates'
import { planForecastJob, runForecastJob } from './forecast/job'
import { createUtilityRunner } from './forecast/utilityRunner'
import { inProcessRunner } from './forecast/runner'

/** `--bench-forecast` (honest-forecasting spec §6.4): time a full recompute of
 *  stored forecasts on a throwaway 4G workspace with 25,000 cells, 52 weeks and
 *  8 stored series per cell (4 NC KPIs + 4 capacity fields). One cell gets
 *  real daily facts, so coverage and period completeness come from the normal
 *  path; the other cells' weekly/monthly aggregates are generated directly,
 *  because the job reads aggregates, not facts. */
export async function runForecastBench(cells = 25000): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'qos-bench-'))
  process.env.PORTABLE_EXECUTABLE_DIR = dir
  try {
    await ws.createWorkspace(dir, 'bench', '4G')
    const conn = ws.getCurrent()!.connection
    const from = '2025-07-07' // Monday; 52 complete weeks to Sun 05/07/2026
    const to = '2026-07-05'
    await conn.run(`INSERT INTO dim_region VALUES (1, 'R1')`)
    await conn.run(`INSERT INTO dim_district VALUES (1, 'D1', 1)`)
    await conn.run(`INSERT INTO dim_site VALUES (1, 'S1', 1)`)
    await conn.run(`INSERT INTO dim_cell SELECT i, 'C' || i, 1, 1, 1 FROM range(1, ${cells + 1}) t(i)`)
    for (const [key, target] of [['call_setup_success_4g', 98.5], ['call_drop_rate_4g', 1.5], ['data_service_failure_4g', 1.0]] as const) {
      await conn.run(`UPDATE kpi_defs SET target = ${target} WHERE technology = '4G' AND kpi_key = '${key}'`)
    }
    const days = `range(DATE '${from}', DATE '${to}' + INTERVAL 1 DAY, INTERVAL 1 DAY) r(d)`
    await conn.run(
      `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users, dl_throughput_kbps, availability_pct, source_import_id)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), 1, 60, 1000, 100, 20000, 99.9, 1 FROM ${days}`
    )
    await conn.run(
      `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), 1, k.kpi_id, 99.0 FROM ${days}, kpi_defs k
       WHERE k.technology = '4G' AND k.kpi_key IN ('call_setup_success_4g', 'call_drop_rate_4g', 'data_service_failure_4g')`
    )
    await recomputeAllAggregates(conn)
    // generated aggregates for cells 2..N (trend + noise per cell)
    const noise = (salt: number): string => `(hash(c.i * 7919 + w.n * 104729 + ${salt}) % 1000) / 1000.0`
    await conn.run(
      `INSERT INTO agg_cell_weekly (week_start, week_end, iso_year, iso_week, cell_id, observed_days, breach_days,
         prb_avg, prb_peak, data_volume_mb_sum, connected_users_sum, dl_throughput_kbps_avg, availability_pct_avg, is_nc)
       SELECT ws, ws + 6, year(ws), week(ws), c.i, 7, 0,
         50 + w.n * 0.3 + ${noise(1)} * 8, 70, 7000 + w.n * 40 + ${noise(2)} * 500, 700 + ${noise(3)} * 90,
         20000 - w.n * 30 + ${noise(4)} * 2000, 99.5 + ${noise(5)} * 0.4, false
       FROM range(2, ${cells + 1}) c(i), (SELECT n, DATE '${from}' + CAST(n * 7 AS INTEGER) AS ws FROM range(0, 52) t(n)) w`
    )
    await conn.run(
      `INSERT INTO agg_cell_kpi_weekly (week_start, cell_id, kpi_id, avg_value, sum_value, max_value, min_value, observed_days)
       SELECT w.ws, c.i, k.kpi_id, v, v * 7, v, v, 7 FROM range(2, ${cells + 1}) c(i),
         (SELECT n, DATE '${from}' + CAST(n * 7 AS INTEGER) AS ws FROM range(0, 52) t(n)) w,
         (SELECT kpi_id, kpi_key FROM kpi_defs WHERE technology = '4G'
            AND kpi_key IN ('call_setup_success_4g', 'call_drop_rate_4g', 'data_service_failure_4g')) k,
         LATERAL (SELECT CASE k.kpi_key WHEN 'call_setup_success_4g' THEN 99.3 - w.n * 0.004 + ${noise(6)} * 0.3
                                        WHEN 'call_drop_rate_4g' THEN 0.6 + w.n * 0.004 + ${noise(7)} * 0.2
                                        ELSE 0.4 + ${noise(8)} * 0.2 END AS v)`
    )
    await conn.run(
      `INSERT INTO agg_cell_monthly (month_start, month_end, month, year, cell_id, observed_days, breach_days,
         prb_avg, prb_peak, data_volume_mb_sum, connected_users_sum, dl_throughput_kbps_avg, availability_pct_avg, is_nc)
       SELECT month_start, last_day(month_start), month(month_start), year(month_start), cell_id, 30, 0,
         avg(prb_avg), max(prb_peak), sum(data_volume_mb_sum), sum(connected_users_sum), avg(dl_throughput_kbps_avg), avg(availability_pct_avg), false
       FROM (SELECT CAST(date_trunc('month', week_start) AS DATE) AS month_start, * FROM agg_cell_weekly WHERE cell_id > 1)
       GROUP BY ALL`
    )
    await conn.run(
      `INSERT INTO agg_cell_kpi_monthly (month_start, cell_id, kpi_id, avg_value, sum_value, max_value, min_value, observed_days)
       SELECT CAST(date_trunc('month', week_start) AS DATE), cell_id, kpi_id, avg(avg_value), sum(sum_value), max(max_value), min(min_value), 30
       FROM agg_cell_kpi_weekly WHERE cell_id > 1 GROUP BY ALL`
    )
    await conn.run('CHECKPOINT')

    // BENCH_RUNNER=inprocess measures the engine on one thread, for comparison
    const runner = process.env.BENCH_RUNNER === 'inprocess' ? inProcessRunner : createUtilityRunner()
    const timings: Record<string, number> = {}
    let series = 0
    try {
      const plans = await planForecastJob(conn)
      for (const grain of ['weekly', 'monthly'] as const) {
        const t0 = Date.now()
        const phase = { read: 0, compute: 0, write: 0 }
        const r = await runForecastJob(conn, plans.filter((p) => p.grain === grain), runner, { timings: phase })
        timings[`${grain}Ms`] = Date.now() - t0
        timings[`${grain}ReadMs`] = phase.read
        timings[`${grain}ComputeMs`] = phase.compute
        timings[`${grain}WriteMs`] = phase.write
        series += r.series
      }
    } finally {
      runner.dispose()
    }
    console.log('BENCH_FORECAST ' + JSON.stringify({
      cells, series, ...timings, totalMs: (timings.weeklyMs ?? 0) + (timings.monthlyMs ?? 0), poolSize: Math.max(1, (await import('node:os')).cpus().length - 1)
    }))
  } finally {
    await ws.closeWorkspace()
    rmSync(dir, { recursive: true, force: true })
  }
}
