import type { DuckDBConnection } from '@duckdb/node-api'
import type { Grain } from '../../../shared/api'

/** Complete periods (spec docs/superpowers/specs/2026-10-01-complete-periods-design.md).
 *  A week or month is complete when every one of its days has data
 *  (a coverage_daily row). This file is the only place that decides what
 *  "latest" means and how a period row learns whether it is complete. */

type PeriodGrain = 'weekly' | 'monthly'

/** SELECT of (grain, period_start, days_with_data, days_in_period, is_complete)
 *  for every week and month touched by `dateIdsSql` (a SQL expression giving
 *  date_ids — a literal list or a subquery). Shared by refreshPeriodCoverage
 *  (the INSERT target for a writable open/import) and the read-only TEMP VIEW
 *  fallback (fix wave 2026-10-01 final review, item 3) so both agree on what
 *  "complete" means. */
function periodCoverageRowsSql(dateIdsSql: string): string {
  return `
    SELECT 'weekly' AS grain, d.week_start AS period_start, count(c.date_id) AS days_with_data,
           7 AS days_in_period, count(c.date_id) = 7 AS is_complete
    FROM dim_date d LEFT JOIN coverage_daily c USING (date_id)
    WHERE d.week_start IN (SELECT week_start FROM dim_date WHERE date_id IN (${dateIdsSql}))
    GROUP BY d.week_start
    UNION ALL
    SELECT 'monthly' AS grain, m.month_start AS period_start, count(c.date_id) AS days_with_data,
           day(last_day(m.month_start)) AS days_in_period,
           count(c.date_id) = day(last_day(m.month_start)) AS is_complete
    FROM (SELECT date_id, CAST(date_trunc('month', date) AS DATE) AS month_start FROM dim_date) m
    LEFT JOIN coverage_daily c USING (date_id)
    WHERE m.month_start IN (
      SELECT CAST(date_trunc('month', date) AS DATE) FROM dim_date WHERE date_id IN (${dateIdsSql}))
    GROUP BY m.month_start`
}

/** Rebuild period_coverage for every week and month that contains one of `dateIds`. */
export async function refreshPeriodCoverage(conn: DuckDBConnection, dateIds: number[]): Promise<void> {
  if (dateIds.length === 0) return
  const idList = dateIds.join(',')
  await conn.run(`
    INSERT OR REPLACE INTO period_coverage (grain, period_start, days_with_data, days_in_period, is_complete)
    ${periodCoverageRowsSql(idList)}`)
}

/** A read-only open whose workspace predates `period_coverage` (fix wave
 *  2026-10-01 final review, item 3): DuckDB allows a TEMP VIEW on a
 *  READ_ONLY database, so this stands in for the missing table using the same
 *  derivation as refreshPeriodCoverage, scoped to every day that actually has
 *  coverage_daily data. */
export function periodCoverageViewSql(): string {
  return `CREATE TEMP VIEW period_coverage AS ${periodCoverageRowsSql('SELECT date_id FROM coverage_daily')}`
}

/** Latest period of `grain` (spec §2): newest complete, else newest partial. */
export function latestPeriodSql(grain: Grain): string {
  if (grain === 'daily') return `(SELECT max(d.date) FROM coverage_daily c JOIN dim_date d USING (date_id))`
  return `(SELECT coalesce(max(period_start) FILTER (WHERE is_complete), max(period_start))
           FROM period_coverage WHERE grain = '${grain}')`
}

/** Whether the latest period of `grain` (§2) is itself complete. A workspace
 *  with no coverage record yet counts as complete (fix wave 2026-10-01 final
 *  review, item 7: shared by the two inline copies of this expression). */
export function latestIsCompleteSql(grain: Grain): string {
  if (grain === 'daily') return 'true'
  return `coalesce((SELECT is_complete FROM period_coverage WHERE grain = '${grain}' AND period_start = ${latestPeriodSql(grain)}), true)`
}

/** date_id of the Sunday that ends the latest week (cell_health_history is keyed by week end). */
export function latestWeekEndDateIdSql(): string {
  return `(SELECT CAST(strftime(${latestPeriodSql('weekly')} + 6, '%Y%m%d') AS INTEGER))`
}

/** LEFT JOIN that attaches period_coverage to a row whose period starts at `periodExpr`. Empty for daily. */
export function periodCoverageJoin(grain: Grain, periodExpr: string, alias = 'pc'): string {
  if (grain === 'daily') return ''
  return `LEFT JOIN period_coverage ${alias} ON ${alias}.grain = '${grain as PeriodGrain}' AND ${alias}.period_start = ${periodExpr}`
}

/** Whether the joined period is complete. Rows with no coverage record (not yet backfilled) count as complete. */
export function completeSql(grain: Grain, alias = 'pc'): string {
  return grain === 'daily' ? 'true' : `coalesce(${alias}.is_complete, true)`
}

export function daysWithDataSql(grain: Grain, alias = 'pc'): string {
  return grain === 'daily' ? '1' : `coalesce(${alias}.days_with_data, ${alias}.days_in_period, 7)`
}
