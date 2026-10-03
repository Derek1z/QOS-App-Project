import { openRealWorkspace, insertCells, type RealWorkspace } from './realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'

/** Daily rows for one cell from `from` to `to`: core columns (fact_cell_daily)
 *  and extra KPI values (fact_extra_metrics). A KPI value may be a SQL
 *  expression of `d` (the date) and `i` (days since `from`) for trends. */
export async function fillDays(
  ws: RealWorkspace, cellId: number, from: string, to: string,
  core: { prb?: number | string; users?: number | string; volume?: number | string },
  kpis: Record<string, number | string>, technology = '4G'
): Promise<void> {
  const range = `range(DATE '${from}', DATE '${to}' + INTERVAL 1 DAY, INTERVAL 1 DAY) r(d)`
  const i = `date_diff('day', DATE '${from}', CAST(d AS DATE))`
  const e = (v: number | string | undefined): string => (v == null ? 'NULL' : String(v).replace(/\bi\b/g, i))
  await ws.conn.run(
    `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
       dl_throughput_kbps, availability_pct, source_import_id)
     SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, ${e(core.prb)}, ${e(core.volume)},
       ${e(core.users)}, NULL, NULL, 1 FROM ${range}`
  )
  for (const [key, v] of Object.entries(kpis)) {
    await ws.conn.run(
      `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, k.kpi_id, ${e(v)}
       FROM ${range}, kpi_defs k WHERE k.technology = '${technology}' AND k.kpi_key = '${key}'`
    )
  }
}

/** Aggregates, coverage and intelligence, as an import would leave them. */
export async function rebuild(ws: RealWorkspace): Promise<void> {
  await recomputeAllAggregates(ws.conn)
  await refreshAllIntelligence(ws.conn)
}

export async function setTarget(ws: RealWorkspace, key: string, target: number | null, technology = '4G'): Promise<void> {
  await ws.conn.run(
    `UPDATE kpi_defs SET target = ${target == null ? 'NULL' : target} WHERE technology = '${technology}' AND kpi_key = '${key}'`
  )
}

export async function count(ws: RealWorkspace, sql: string): Promise<number> {
  const r = await ws.conn.runAndReadAll(sql)
  return Number(Object.values(r.getRowObjects()[0] ?? { n: 0 })[0] ?? 0)
}

/** 3 cells, 10 complete weeks (Mon 04/05 .. Sun 12/07/2026) of PRB, users,
 *  CSSR (target 98.5) and an untargeted counter. */
export async function forecastWorkspace(opts: { cell3Until?: string } = {}): Promise<RealWorkspace> {
  const ws = await openRealWorkspace('4G')
  await insertCells(ws.conn, ['C1', 'C2', 'C3'])
  await setTarget(ws, 'call_setup_success_4g', 98.5)
  await setTarget(ws, 'l_erab_abnormrel', null)
  for (const id of [1, 2, 3]) {
    const until = id === 3 && opts.cell3Until ? opts.cell3Until : '2026-07-12'
    await fillDays(ws, id, '2026-05-04', until, { prb: `50 + i * 0.2`, users: 10 },
      { call_setup_success_4g: `99.5 - i * 0.01`, l_erab_abnormrel: 3 })
  }
  await rebuild(ws)
  return ws
}
