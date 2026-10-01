import type { DuckDBConnection } from '@duckdb/node-api'
import { getRules } from './rules'
import { coreBreachDaysSql, WORKSPACE_TECH_SQL } from './ncRule'
import { getPrbTarget } from './targets'
import { periodsFor, type NcGrain, type GrainPeriods } from '../../../shared/ruleDefaults'
import { LIFECYCLE_RANK as R, SEVERITY_BASE, lifecycleFromRankSql, rankTableSql } from '../../../shared/lifecycle'
import { periodCoverageJoin, completeSql } from './periods'

/** NC periods (spec docs/superpowers/specs/2026-09-29-nc-lifecycle-design.md).
 *  1. Label each grain on its own (§3): runs of NC periods (a period with no
 *     data neither breaks nor extends a run), look-back, intermittent window,
 *     recovery window — all counted in periods of that grain.
 *  2. Roll up (§4): an NC week takes the worst label of its days; an NC month
 *     the worst of its days and of the weeks starting in it.
 *  3. Score trend and severity once per row and write cell_nc_lifecycle.
 *  Raw facts are never touched. */

/** Period number: consecutive periods differ by exactly 1 (2000-01-03 is a Monday). */
const PIDX: Record<NcGrain, string> = {
  daily: `date_diff('day', DATE '2000-01-03', period_date)`,
  weekly: `date_diff('day', DATE '2000-01-03', period_date) // 7`,
  monthly: `year(period_date) * 12 + month(period_date)`
}

function sourceSql(grain: NcGrain, idList: string): string {
  if (grain === 'daily') {
    return `
      SELECT f.cell_id, d.date AS period_date, (ex.cell_id IS NOT NULL) AS is_nc,
             CAST(CASE WHEN ex.cell_id IS NOT NULL THEN 1 ELSE 0 END AS DOUBLE) AS breach_days,
             1.0 AS observed_days, f.prb_utilization AS prb_avg,
             f.data_volume_mb AS vol, f.connected_users AS usr,
             f.dl_throughput_kbps AS thr, f.availability_pct AS avail,
             true AS complete
      FROM fact_cell_daily f
      JOIN dim_date d USING (date_id)
      LEFT JOIN (${coreBreachDaysSql()}) ex ON ex.cell_id = f.cell_id AND ex.date_id = f.date_id
      WHERE f.cell_id IN (${idList})`
  }
  const [table, col] = grain === 'weekly' ? ['agg_cell_weekly', 'week_start'] : ['agg_cell_monthly', 'month_start']
  return `
      SELECT w.cell_id, w.${col} AS period_date, w.is_nc,
             CAST(coalesce(w.breach_days, 0) AS DOUBLE) AS breach_days,
             CAST(greatest(coalesce(w.observed_days, 1), 1) AS DOUBLE) AS observed_days,
             w.prb_avg, w.data_volume_mb_sum AS vol, w.connected_users_sum AS usr,
             w.dl_throughput_kbps_avg AS thr, w.availability_pct_avg AS avail,
             ${completeSql(grain)} AS complete
      FROM ${table} w
      ${periodCoverageJoin(grain, `w.${col}`)}
      WHERE w.cell_id IN (${idList})`
}

/** Label rank per spec §3, first match wins. */
function rankSql(p: GrainPeriods): string {
  return `CASE
      WHEN is_nc THEN CASE
        WHEN streak >= ${p.chronic} THEN ${R['Chronic NC']}
        WHEN streak >= ${p.persistent} THEN ${R['Persistent NC']}
        WHEN runs_in_window >= ${p.intermittentRuns} THEN ${R['Intermittent NC']}
        WHEN run_start - prev_run_end <= ${p.lookback} THEN ${R['Recurring NC']}
        ELSE ${R['New NC']} END
      WHEN prev_nc_pidx IS NOT NULL AND pidx - prev_nc_pidx <= ${p.recovery} THEN ${R['Recovering']}
      ELSE ${R['Healthy']} END`
}

/** Improving/Worsening from five period-over-period signals (spec §38). A
 *  partial period has no trend (spec §3.4). */
const TREND_SQL = `CASE
    WHEN NOT complete THEN NULL
    WHEN prev_is_nc IS NULL AND prev_prb IS NULL THEN 'Stable'
    WHEN improving - worsening >= 2 THEN 'Improving'
    WHEN improving - worsening <= -2 THEN 'Worsening'
    ELSE 'Stable' END`

function stageGrainSql(grain: NcGrain, idList: string, p: GrainPeriods): string {
  const byCell = 'PARTITION BY cell_id ORDER BY pidx'
  const byCellComplete = 'PARTITION BY cell_id, complete ORDER BY pidx'
  return `
    INSERT INTO stg_nc_lifecycle
    WITH src AS (
      SELECT *, ${PIDX[grain]} AS pidx FROM (${sourceSql(grain, idList)}) WHERE complete OR is_nc
    ),
    runs AS (
      SELECT *,
        sum(CASE WHEN is_nc THEN 0 ELSE 1 END) OVER (${byCell}) AS grp,
        max(CASE WHEN is_nc THEN pidx END) OVER (${byCell} ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_nc_pidx,
        lag(is_nc) OVER (${byCellComplete}) AS prev_is_nc,
        lag(prb_avg) OVER (${byCellComplete}) AS prev_prb,
        lag(breach_days) OVER (${byCellComplete}) AS prev_breach,
        lag(thr) OVER (${byCellComplete}) AS prev_thr,
        lag(vol / observed_days) OVER (${byCellComplete}) AS prev_vol_pd,
        lag(usr / observed_days) OVER (${byCellComplete}) AS prev_usr_pd
      FROM src
    ),
    streaks AS (
      SELECT *,
        CASE WHEN is_nc THEN sum(CASE WHEN is_nc THEN 1 ELSE 0 END) OVER (PARTITION BY cell_id, grp ORDER BY pidx) ELSE 0 END AS streak,
        min(CASE WHEN is_nc THEN pidx END) OVER (PARTITION BY cell_id, grp) AS run_start,
        count(DISTINCT CASE WHEN is_nc THEN grp END)
          OVER (${byCell} RANGE BETWEEN ${p.intermittentWindow - 1} PRECEDING AND CURRENT ROW) AS runs_in_window
      FROM runs
    ),
    labelled AS (
      SELECT *, max(CASE WHEN pidx = run_start THEN prev_nc_pidx END) OVER (PARTITION BY cell_id, grp) AS prev_run_end,
        coalesce(prb_avg, 0) - coalesce(prev_prb, 0) AS d_prb,
        breach_days - coalesce(prev_breach, 0) AS d_breach,
        CASE WHEN prev_thr > 0 THEN (thr - prev_thr) / prev_thr * 100 END AS p_thr,
        CASE WHEN prev_vol_pd > 0 THEN (vol / observed_days - prev_vol_pd) / prev_vol_pd * 100 END AS p_vol,
        CASE WHEN prev_usr_pd > 0 THEN (usr / observed_days - prev_usr_pd) / prev_usr_pd * 100 END AS p_usr
      FROM streaks
    ),
    scored AS (
      SELECT *,
        (CASE WHEN d_prb <= -3 THEN 1 ELSE 0 END) + (CASE WHEN d_breach <= -1 THEN 1 ELSE 0 END)
          + (CASE WHEN p_thr >= 10 THEN 1 ELSE 0 END) + (CASE WHEN p_vol <= -10 THEN 1 ELSE 0 END)
          + (CASE WHEN p_usr <= -10 THEN 1 ELSE 0 END) AS improving,
        (CASE WHEN d_prb >= 3 THEN 1 ELSE 0 END) + (CASE WHEN d_breach >= 1 THEN 1 ELSE 0 END)
          + (CASE WHEN p_thr <= -10 THEN 1 ELSE 0 END) + (CASE WHEN p_vol >= 10 THEN 1 ELSE 0 END)
          + (CASE WHEN p_usr >= 10 THEN 1 ELSE 0 END) AS worsening
      FROM labelled
    )
    SELECT cell_id, '${grain}', period_date, is_nc, ${rankSql(p)}, ${TREND_SQL}, breach_days, prb_avg, avail
    FROM scored`
}

/** Partial periods that are not NC (spec 2026-10-01 §3.3): skipped by runs, so
 *  they carry the cell's last label of the grain, with is_nc false and no trend. */
function stageSkippedSql(grain: NcGrain, idList: string): string {
  return `
    INSERT INTO stg_nc_lifecycle
    SELECT s.cell_id, '${grain}', s.period_date, false, coalesce(k.lc_rank, ${R['Healthy']}), NULL,
           s.breach_days, s.prb_avg, s.avail
    FROM (SELECT * FROM (${sourceSql(grain, idList)}) WHERE NOT complete AND NOT is_nc) s
    ASOF LEFT JOIN (SELECT cell_id, period_date, lc_rank FROM stg_nc_lifecycle WHERE grain = '${grain}') k
      ON s.cell_id = k.cell_id AND s.period_date > k.period_date`
}

/** Raise NC weeks and months to the worst label inside them (spec §4). */
const ROLL_UP_SQL = [
  `UPDATE stg_nc_lifecycle AS w SET lc_rank = x.worst
   FROM (
     SELECT wk.cell_id, wk.period_date, max(d.lc_rank) AS worst
     FROM stg_nc_lifecycle wk
     JOIN stg_nc_lifecycle d ON d.cell_id = wk.cell_id AND d.grain = 'daily'
       AND d.period_date BETWEEN wk.period_date AND wk.period_date + 6
     WHERE wk.grain = 'weekly' AND wk.is_nc
     GROUP BY wk.cell_id, wk.period_date
   ) x
   WHERE w.grain = 'weekly' AND w.cell_id = x.cell_id AND w.period_date = x.period_date AND x.worst > w.lc_rank`,
  // A month takes the worst of its own days and of every week with a bad day
  // in that month — a week straddling two months counts where its bad days are.
  `UPDATE stg_nc_lifecycle AS m SET lc_rank = x.worst
   FROM (
     SELECT cell_id, month_start, max(lc_rank) AS worst
     FROM (
       SELECT cell_id, CAST(date_trunc('month', period_date) AS DATE) AS month_start, lc_rank
       FROM stg_nc_lifecycle WHERE grain = 'daily'
       UNION ALL
       SELECT DISTINCT wk.cell_id, CAST(date_trunc('month', d.period_date) AS DATE), wk.lc_rank
       FROM stg_nc_lifecycle wk
       JOIN stg_nc_lifecycle d ON d.cell_id = wk.cell_id AND d.grain = 'daily' AND d.is_nc
         AND d.period_date BETWEEN wk.period_date AND wk.period_date + 6
       WHERE wk.grain = 'weekly'
     )
     GROUP BY cell_id, month_start
   ) x
   WHERE m.grain = 'monthly' AND m.is_nc AND m.cell_id = x.cell_id AND m.period_date = x.month_start
     AND x.worst > m.lc_rank`
]

/** Recompute lifecycle, trend and severity for the given cells across their
 *  full daily, weekly and monthly history. */
export async function recomputeNcLifecycle(conn: DuckDBConnection, cellIds: number[]): Promise<void> {
  if (cellIds.length === 0) return
  const rules = await getRules(conn)
  if (!rules) return
  const tech = String((await conn.runAndReadAll(`SELECT ${WORKSPACE_TECH_SQL} AS t`)).getRowObjects()[0].t)
  // PRB is 4G's Peak Hour Traffic Utilization; 2G/3G put other utilizations in that column (ncRule.ts)
  const prb = tech === '4G' ? await getPrbTarget(conn) : null
  const prbPoints = prb == null
    ? '0'
    : `CASE WHEN coalesce(prb_avg, ${prb}) - ${prb} >= 20 THEN 25
            WHEN coalesce(prb_avg, ${prb}) - ${prb} >= 10 THEN 15
            WHEN coalesce(prb_avg, ${prb}) - ${prb} >= 5 THEN 10
            WHEN coalesce(prb_avg, ${prb}) - ${prb} >= 0 THEN 5 ELSE 0 END`
  const grains: NcGrain[] = ['daily', 'weekly', 'monthly']

  const BATCH_SIZE = 2500
  for (let b = 0; b < cellIds.length; b += BATCH_SIZE) {
    const idList = cellIds.slice(b, b + BATCH_SIZE).join(',')
    await conn.run(`CREATE OR REPLACE TEMP TABLE stg_nc_lifecycle (
      cell_id BIGINT, grain VARCHAR, period_date DATE, is_nc BOOLEAN, lc_rank INTEGER,
      trend VARCHAR, breach_days DOUBLE, prb_avg DOUBLE, avail DOUBLE)`)
    for (const g of grains) {
      await conn.run(stageGrainSql(g, idList, periodsFor(g, rules)))
      if (g !== 'daily') await conn.run(stageSkippedSql(g, idList))
    }
    for (const sql of ROLL_UP_SQL) await conn.run(sql)

    await conn.run(`DELETE FROM cell_nc_lifecycle WHERE cell_id IN (${idList})`)
    await conn.run(`
      INSERT INTO cell_nc_lifecycle
        (cell_id, period_start, grain, ruleset_version, is_nc, lifecycle, trend, severity, breach_days, prb_avg, computed_at)
      SELECT cell_id, period_date, grain, ${rules.version}, is_nc, ${lifecycleFromRankSql('lc_rank')}, trend,
        CASE WHEN NOT is_nc THEN 'Normal' WHEN score >= 75 THEN 'Critical' WHEN score >= 45 THEN 'High' ELSE 'Watch' END,
        breach_days, prb_avg, now()
      FROM (
        SELECT *,
          ${rankTableSql(SEVERITY_BASE, 'lc_rank')} + (${prbPoints}) + least(15, breach_days * 2)
            + (CASE WHEN trend = 'Worsening' THEN 10 ELSE 0 END)
            + (CASE WHEN avail IS NOT NULL AND avail < 99 THEN 5 ELSE 0 END) AS score
        FROM stg_nc_lifecycle
      )`)
  }
  await conn.run(`DROP TABLE IF EXISTS stg_nc_lifecycle`)
}
