/** The one non-compliance rule used by every grain (daily view, daily
 *  lifecycle, weekly and monthly aggregates): a cell-day breaches when one of
 *  its core (regulatory NCA) KPIs misses its target. Diagnostic counters and
 *  other non-core KPIs never count. The wide PRB column is 4G's peak-hour
 *  traffic utilization, so it counts only in a 4G workspace (2G/3G files map
 *  other utilizations into that slot), against the 4G Peak Hour Traffic
 *  Utilization target in kpi_defs.
 *  Weekly/monthly NC = breach days >= the ruleset's weekly/monthly breach days. */

import { PRB_TARGET_SQL } from './targets'

export const WORKSPACE_TECH_SQL =
  `(SELECT coalesce(max(value), '4G') FROM workspace_meta WHERE key = 'technology')`

/** SELECT of distinct (cell_id, date_id) breach days. `dateIdFilter` is an
 *  optional SQL condition on date_id, e.g. `IN (20260720, 20260721)`. */
export function coreBreachDaysSql(dateIdFilter = ''): string {
  const onDates = (col: string): string => (dateIdFilter ? `AND ${col} ${dateIdFilter}` : '')
  return `SELECT DISTINCT cell_id, date_id FROM (
      SELECT e.cell_id, e.date_id
      FROM fact_extra_metrics e
      JOIN kpi_defs k ON k.kpi_id = e.kpi_id
      WHERE k.is_core AND k.active AND k.target IS NOT NULL
        AND ((k.worse_is_higher AND e.value > k.target) OR (NOT k.worse_is_higher AND e.value < k.target))
        ${onDates('e.date_id')}
      UNION ALL
      SELECT f.cell_id, f.date_id
      FROM fact_cell_daily f
      WHERE ${WORKSPACE_TECH_SQL} = '4G'
        AND f.prb_utilization >= ${PRB_TARGET_SQL}
        ${onDates('f.date_id')}
    )`
}
