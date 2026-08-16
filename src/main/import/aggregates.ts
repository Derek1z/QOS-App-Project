import type { DuckDBConnection } from '@duckdb/node-api'

/** Incremental aggregate refresh (spec §66): only affected days/weeks/months are recomputed. */

export async function recomputeAggregates(conn: DuckDBConnection, dateIds: number[]): Promise<void> {
  if (dateIds.length === 0) return
  const idList = dateIds.join(',')
  await recomputeCellWeekly(conn, idList)
  await recomputeCellMonthly(conn, idList)
  await recomputeCellKpiWeekly(conn, idList)
  for (const e of ['site', 'district', 'region'] as const) {
    await recomputeEntityDaily(conn, e, idList)
    await recomputeEntityWeekly(conn, e, idList)
    await recomputeEntityMonthly(conn, e, idList)
  }
  await recomputeEntityDaily(conn, 'network', idList)
  await recomputeEntityWeekly(conn, 'network', idList)
  await recomputeEntityMonthly(conn, 'network', idList)
}

const RULESET = `JOIN (SELECT * FROM ruleset ORDER BY version DESC LIMIT 1) r ON true`

/** NC driver KPIs per technology: 2G/3G classify NC on their imported
 *  congestion + drop KPIs instead of the 4G PRB threshold (spec §54a). */
const NC_DRIVER_KEYS: Record<'2G' | '3G', string[]> = {
  '2G': ['tch_congestion', 'drop_call_rate'],
  '3G': ['ce_utilization', 'drop_call_rate']
}

/** The workspace's technology and its NC driver KPI keys, or null for 4G
 *  (which keeps the PRB-threshold rule). */
async function ncDrivers(conn: DuckDBConnection): Promise<{ tech: '2G' | '3G'; keys: string[] } | null> {
  const r = await conn.runAndReadAll(
    `SELECT value FROM workspace_meta WHERE key = 'technology'`
  )
  const v = String(r.getRowObjects()[0]?.value ?? '4G')
  if (v === '2G' || v === '3G') return { tech: v, keys: NC_DRIVER_KEYS[v] }
  return null
}

/** Per-day breach join over the imported extra KPI values: one row per
 *  (cell, day) where any driver KPI breached its editable target. */
function kpiBreachJoin(drivers: { tech: '2G' | '3G'; keys: string[] }): {
  sql: string
  params: (string)[]
} {
  const placeholders = drivers.keys.map(() => '?').join(', ')
  return {
    sql: `
      LEFT JOIN (
        SELECT f2.cell_id, f2.date_id
        FROM fact_extra_metrics f2
        JOIN kpi_defs k2 ON k2.kpi_id = f2.kpi_id
        WHERE k2.technology = ? AND k2.kpi_key IN (${placeholders})
          AND ((k2.worse_is_higher AND f2.value > k2.target)
            OR (NOT k2.worse_is_higher AND f2.value < k2.target))
      ) kb ON kb.cell_id = f.cell_id AND kb.date_id = f.date_id`,
    params: [drivers.tech, ...drivers.keys]
  }
}

/** spec §54a: weekly rollups of per-technology extra KPI values (per cell). */
async function recomputeCellKpiWeekly(conn: DuckDBConnection, idList: string): Promise<void> {
  await conn.run(`DELETE FROM agg_cell_kpi_weekly WHERE week_start IN ${WEEKS(idList)}`)
  await conn.run(`
    INSERT INTO agg_cell_kpi_weekly
      (week_start, cell_id, kpi_id, avg_value, sum_value, max_value, min_value, observed_days)
    SELECT
      d.week_start, f.cell_id, f.kpi_id,
      avg(f.value), sum(f.value), max(f.value), min(f.value), count(*) AS observed_days
    FROM fact_extra_metrics f
    JOIN dim_date d ON d.date_id = f.date_id
    WHERE d.week_start IN ${WEEKS(idList)}
    GROUP BY d.week_start, f.cell_id, f.kpi_id
  `)
}

const WEEKS = (idList: string) => `(SELECT DISTINCT week_start FROM dim_date WHERE date_id IN (${idList}))`
const MONTHS = (idList: string) =>
  `(SELECT DISTINCT CAST(date_trunc('month', date) AS DATE) AS month_start FROM dim_date WHERE date_id IN (${idList}))`

async function recomputeCellWeekly(conn: DuckDBConnection, idList: string): Promise<void> {
  await conn.run(`DELETE FROM agg_cell_weekly WHERE week_start IN ${WEEKS(idList)}`)
  const drivers = await ncDrivers(conn)
  // 2G/3G: a breach day is any imported driver KPI (congestion/drop) past its
  // editable target; 4G keeps the PRB-threshold rule.
  const breachDay = drivers
    ? `count(*) FILTER (WHERE kb.cell_id IS NOT NULL)`
    : `count(*) FILTER (WHERE f.prb_utilization >= r.prb_threshold_pct)`
  const breachJoin = drivers ? kpiBreachJoin(drivers) : null
  await conn.run(
    `
    INSERT INTO agg_cell_weekly
      (week_start, week_end, iso_year, iso_week, cell_id, observed_days, breach_days,
       prb_avg, prb_peak, data_volume_mb_sum, connected_users_sum,
       dl_throughput_kbps_avg, availability_pct_avg, is_nc)
    SELECT
      d.week_start, CAST(d.week_start + INTERVAL 6 DAY AS DATE), d.iso_year, d.iso_week, f.cell_id,
      count(*) AS observed_days,
      ${breachDay} AS breach_days,
      avg(f.prb_utilization), max(f.prb_utilization),
      sum(f.data_volume_mb), sum(f.connected_users),
      avg(f.dl_throughput_kbps), avg(f.availability_pct),
      ${breachDay} >= max(r.weekly_breach_days) AS is_nc
    FROM fact_cell_daily f
    JOIN dim_date d ON d.date_id = f.date_id
    ${RULESET}
    ${breachJoin?.sql ?? ''}
    WHERE d.week_start IN ${WEEKS(idList)}
    GROUP BY d.week_start, d.iso_year, d.iso_week, f.cell_id
  `,
    breachJoin?.params ?? []
  )
}

async function recomputeCellMonthly(conn: DuckDBConnection, idList: string): Promise<void> {
  await conn.run(`DELETE FROM agg_cell_monthly WHERE month_start IN ${MONTHS(idList)}`)
  await conn.run(`
    INSERT INTO agg_cell_monthly
      (month_start, month_end, month, year, cell_id, observed_days, breach_days,
       prb_avg, prb_peak, data_volume_mb_sum, connected_users_sum,
       dl_throughput_kbps_avg, availability_pct_avg, is_nc)
    SELECT
      m.month_start, CAST(m.month_start + INTERVAL 1 MONTH - INTERVAL 1 DAY AS DATE),
      month(m.month_start), year(m.month_start), f.cell_id,
      count(DISTINCT f.date_id) AS observed_days,
      count(*) FILTER (WHERE f.prb_utilization >= r.prb_threshold_pct) AS breach_days,
      avg(f.prb_utilization), max(f.prb_utilization),
      sum(f.data_volume_mb), sum(f.connected_users),
      avg(f.dl_throughput_kbps), avg(f.availability_pct),
      EXISTS (
        SELECT 1 FROM agg_cell_weekly w
        WHERE w.cell_id = f.cell_id AND w.week_start >= m.month_start
          AND w.week_start < m.month_start + INTERVAL 1 MONTH AND w.is_nc
      ) AS is_nc
    FROM fact_cell_daily f
    JOIN (SELECT date_id, CAST(date_trunc('month', date) AS DATE) AS month_start FROM dim_date) m
      ON m.date_id = f.date_id
    ${RULESET}
    WHERE m.month_start IN ${MONTHS(idList)}
    GROUP BY m.month_start, f.cell_id
  `)
}

function entityJoins(entity: string): { idJoin: string; colId: string; selId: string; groupExtra: string } {
  if (entity === 'network') {
    return { idJoin: '', colId: '', selId: '', groupExtra: '' }
  }
  return {
    idJoin: `JOIN dim_cell c ON c.cell_id = f.cell_id AND c.${entity}_id IS NOT NULL`,
    colId: `${entity}_id, `,
    selId: `c.${entity}_id, `,
    groupExtra: `, c.${entity}_id`
  }
}

async function recomputeEntityDaily(conn: DuckDBConnection, entity: string, idList: string): Promise<void> {
  const { idJoin, colId, selId, groupExtra } = entityJoins(entity)
  await conn.run(`DELETE FROM agg_${entity}_daily WHERE period_start IN (SELECT date FROM dim_date WHERE date_id IN (${idList}))`)
  const drivers = await ncDrivers(conn)
  const ncCell = drivers
    ? `count(DISTINCT f.cell_id) FILTER (WHERE kb.cell_id IS NOT NULL)`
    : `count(DISTINCT f.cell_id) FILTER (WHERE f.prb_utilization >= r.prb_threshold_pct)`
  const breachJoin = drivers ? kpiBreachJoin(drivers) : null
  await conn.run(
    `
    INSERT INTO agg_${entity}_daily
      (period_start, period_end, iso_year, iso_week, month, year, ${colId}observed_days, distinct_cells,
       nc_cells, nc_rate, prb_avg, prb_peak, data_volume_mb_sum, connected_users_sum,
       dl_throughput_kbps_avg, availability_pct_avg)
    SELECT
      d.date, d.date, d.iso_year, d.iso_week, d.month, d.year, ${selId}
      count(*) AS observed_days,
      count(DISTINCT f.cell_id) AS distinct_cells,
      ${ncCell} AS nc_cells,
      ROUND(100.0 * ${ncCell}
        / NULLIF(count(DISTINCT f.cell_id), 0), 1) AS nc_rate,
      avg(f.prb_utilization), max(f.prb_utilization), sum(f.data_volume_mb), sum(f.connected_users),
      avg(f.dl_throughput_kbps), avg(f.availability_pct)
    FROM fact_cell_daily f
    JOIN dim_date d ON d.date_id = f.date_id
    ${idJoin}
    ${RULESET}
    ${breachJoin?.sql ?? ''}
    WHERE d.date_id IN (${idList})
    GROUP BY d.date, d.iso_year, d.iso_week, d.month, d.year${groupExtra}
  `,
    breachJoin?.params ?? []
  )
}

async function recomputeEntityWeekly(conn: DuckDBConnection, entity: string, idList: string): Promise<void> {
  const { idJoin, colId, selId, groupExtra } = entityJoins(entity)
  await conn.run(`DELETE FROM agg_${entity}_weekly WHERE period_start IN ${WEEKS(idList)}`)
  await conn.run(`
    INSERT INTO agg_${entity}_weekly
      (period_start, period_end, iso_year, iso_week, month, year, ${colId}observed_days, distinct_cells,
       nc_cells, nc_rate, prb_avg, prb_peak, data_volume_mb_sum, connected_users_sum,
       dl_throughput_kbps_avg, availability_pct_avg)
    SELECT
      d.week_start, CAST(d.week_start + INTERVAL 6 DAY AS DATE), d.iso_year, d.iso_week, NULL, NULL, ${selId}
      count(DISTINCT f.date_id) AS observed_days,
      count(DISTINCT f.cell_id) AS distinct_cells,
      count(DISTINCT f.cell_id) FILTER (WHERE w.is_nc) AS nc_cells,
      ROUND(100.0 * count(DISTINCT f.cell_id) FILTER (WHERE w.is_nc)
        / NULLIF(count(DISTINCT f.cell_id), 0), 1) AS nc_rate,
      avg(f.prb_utilization), max(f.prb_utilization), sum(f.data_volume_mb), sum(f.connected_users),
      avg(f.dl_throughput_kbps), avg(f.availability_pct)
    FROM fact_cell_daily f
    JOIN dim_date d ON d.date_id = f.date_id
    ${idJoin}
    JOIN agg_cell_weekly w ON w.cell_id = f.cell_id AND w.week_start = d.week_start
    ${RULESET}
    WHERE d.week_start IN ${WEEKS(idList)}
    GROUP BY d.week_start, d.iso_year, d.iso_week${groupExtra}
  `)
}

async function recomputeEntityMonthly(conn: DuckDBConnection, entity: string, idList: string): Promise<void> {
  const { idJoin, colId, selId, groupExtra } = entityJoins(entity)
  await conn.run(`DELETE FROM agg_${entity}_monthly WHERE period_start IN ${MONTHS(idList)}`)
  await conn.run(`
    INSERT INTO agg_${entity}_monthly
      (period_start, period_end, iso_year, iso_week, month, year, ${colId}observed_days, distinct_cells,
       nc_cells, nc_rate, prb_avg, prb_peak, data_volume_mb_sum, connected_users_sum,
       dl_throughput_kbps_avg, availability_pct_avg)
    SELECT
      m.month_start, CAST(m.month_start + INTERVAL 1 MONTH - INTERVAL 1 DAY AS DATE), NULL, NULL,
      month(m.month_start), year(m.month_start), ${selId}
      count(DISTINCT f.date_id) AS observed_days,
      count(DISTINCT f.cell_id) AS distinct_cells,
      count(DISTINCT f.cell_id) FILTER (WHERE w.is_nc) AS nc_cells,
      ROUND(100.0 * count(DISTINCT f.cell_id) FILTER (WHERE w.is_nc)
        / NULLIF(count(DISTINCT f.cell_id), 0), 1) AS nc_rate,
      avg(f.prb_utilization), max(f.prb_utilization), sum(f.data_volume_mb), sum(f.connected_users),
      avg(f.dl_throughput_kbps), avg(f.availability_pct)
    FROM fact_cell_daily f
    JOIN (SELECT date_id, CAST(date_trunc('month', date) AS DATE) AS month_start FROM dim_date) m
      ON m.date_id = f.date_id
    ${idJoin}
    JOIN agg_cell_weekly w ON w.cell_id = f.cell_id
      AND w.week_start >= m.month_start AND w.week_start < m.month_start + INTERVAL 1 MONTH
    ${RULESET}
    WHERE m.month_start IN ${MONTHS(idList)}
    GROUP BY m.month_start, month(m.month_start), year(m.month_start)${groupExtra}
  `)
}

/** Full aggregate recompute — used after a ruleset change, because is_nc flags
 *  and entity nc_cells embed the ruleset and every period must be rebuilt. */
export async function recomputeAllAggregates(conn: DuckDBConnection): Promise<void> {
  const r = await conn.runAndReadAll(`SELECT DISTINCT date_id FROM fact_cell_daily`)
  const dateIds = r.getRowObjects().map((x) => Number(x.date_id))
  await recomputeAggregates(conn, dateIds)
  await updateCoverage(conn, dateIds)
}

/** Update coverage_daily for the affected dates (spec §18). */
export async function updateCoverage(conn: DuckDBConnection, dateIds: number[]): Promise<void> {
  if (dateIds.length === 0) return
  const idList = dateIds.join(',')
  await conn.run(`DELETE FROM coverage_daily WHERE date_id IN (${idList})`)
  await conn.run(`
    INSERT INTO coverage_daily (date_id, observed_cells, expected_cells, coverage_pct, missing_cells)
    SELECT
      cur.date_id, cur.observed,
      COALESCE(hist.expected, cur.observed) AS expected,
      ROUND(100.0 * cur.observed / NULLIF(COALESCE(hist.expected, cur.observed), 0), 1) AS coverage_pct,
      NULL
    FROM (
      SELECT date_id, count(DISTINCT cell_id) AS observed
      FROM fact_cell_daily WHERE date_id IN (${idList})
      GROUP BY date_id
    ) cur
    LEFT JOIN (
      SELECT d.date_id,
        (SELECT max(c) FROM (
          SELECT count(DISTINCT f2.cell_id) AS c
          FROM fact_cell_daily f2 JOIN dim_date d2 ON d2.date_id = f2.date_id
          WHERE d2.date >= d.date - INTERVAL 30 DAY AND d2.date < d.date
          GROUP BY d2.date_id
        )) AS expected
      FROM dim_date d WHERE d.date_id IN (${idList})
    ) hist USING (date_id)
  `)
}

