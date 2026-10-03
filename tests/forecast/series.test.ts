import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'
import {
  forecastableKpis, readCellSeriesBatch, readDisplaySeries, readOverTargetSeries, domainOf,
  type ForecastKpi
} from '../../src/main/forecast/series'

const NET = { scope: 'network' as const, id: null }

/** Daily rows for one cell: core columns plus extra KPI values (kpi_key → value). */
async function fill(
  ws: RealWorkspace, cellId: number, from: string, to: string,
  core: { prb?: number; users?: number; volume?: number }, kpis: Record<string, number>
): Promise<void> {
  const range = `range(DATE '${from}', DATE '${to}' + INTERVAL 1 DAY, INTERVAL 1 DAY) r(d)`
  await ws.conn.run(
    `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
       dl_throughput_kbps, availability_pct, source_import_id)
     SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, ${core.prb ?? 'NULL'}, ${core.volume ?? 'NULL'},
       ${core.users ?? 'NULL'}, NULL, NULL, 1 FROM ${range}`
  )
  for (const [key, v] of Object.entries(kpis)) {
    await ws.conn.run(
      `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, k.kpi_id, ${v}
       FROM ${range}, kpi_defs k WHERE k.technology = '4G' AND k.kpi_key = '${key}'`
    )
  }
}

async function build(ws: RealWorkspace): Promise<void> {
  await recomputeAllAggregates(ws.conn)
  await refreshAllIntelligence(ws.conn)
}

const byKey = (list: ForecastKpi[], key: string): ForecastKpi => {
  const k = list.find((x) => x.key === key)
  if (!k) throw new Error(`no KPI ${key} in ${list.map((x) => x.key).join(',')}`)
  return k
}

describe('forecast series data layer (spec §4)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('KPI values win over the core column; PRB falls back to the core column; not-imported KPIs are listed', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1'])
    await fill(ws, 1, '2026-06-29', '2026-07-19', { prb: 50, users: 10, volume: 100 }, { call_setup_success_4g: 99 })
    await build(ws)
    const { available, notImported } = await forecastableKpis(ws.conn, '4G', NET)
    expect(byKey(available, 'call_setup_success_4g').source.kind).toBe('kpi')
    expect(byKey(available, 'prb_utilization').source).toEqual({ kind: 'core', column: 'prb_avg' })
    expect(notImported.map((x) => x.key)).toContain('data_service_failure_4g')
    expect(available.map((x) => x.key)).not.toContain('data_service_failure_4g')
    expect(byKey(available, 'connected_users').capacity).toBe(true)
    expect(byKey(available, 'call_setup_success_4g').capacity).toBe(false)
    expect(domainOf(byKey(available, 'call_setup_success_4g'))).toBe('percent')
    expect(domainOf(byKey(available, 'data_volume'))).toBe('nonNegative')
  })

  it('cell series use complete weeks only', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1'])
    // Mon 29/06 .. Wed 22/07: weeks 29/06, 06/07, 13/07 complete; 20/07 has 3 days
    await fill(ws, 1, '2026-06-29', '2026-07-22', { prb: 50 }, { call_setup_success_4g: 99 })
    await build(ws)
    const { available } = await forecastableKpis(ws.conn, '4G', NET)
    const cssr = byKey(available, 'call_setup_success_4g')
    const prb = byKey(available, 'prb_utilization')
    const batch = await readCellSeriesBatch(ws.conn, 'weekly', [cssr, prb], [1])
    for (const k of [cssr, prb]) {
      const s = batch.get(1)!.get(k.key)!
      expect(s.dates).toEqual(['2026-06-29', '2026-07-06', '2026-07-13'])
      expect(s.lastComplete).toBe('2026-07-13')
    }
    expect(batch.get(1)!.get('call_setup_success_4g')!.values).toEqual([99, 99, 99])
  })

  it('the KPI\'s agg rule picks the value; core sums become averages when the KPI is avg', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1'])
    await ws.conn.run(`UPDATE kpi_defs SET agg = 'sum' WHERE technology = '4G' AND kpi_key = 'l_rrc_connreq_msg'`)
    await fill(ws, 1, '2026-06-29', '2026-07-12', { users: 10 }, { call_setup_success_4g: 99, l_rrc_connreq_msg: 10 })
    await build(ws)
    const { available } = await forecastableKpis(ws.conn, '4G', NET)
    const batch = await readCellSeriesBatch(ws.conn, 'weekly',
      [byKey(available, 'call_setup_success_4g'), byKey(available, 'l_rrc_connreq_msg'), byKey(available, 'connected_users')], [1])
    expect(batch.get(1)!.get('call_setup_success_4g')!.values).toEqual([99, 99])
    expect(batch.get(1)!.get('l_rrc_connreq_msg')!.values).toEqual([70, 70])
    // connected_users is avg in kpi_defs; agg_cell_weekly stores the weekly sum (70)
    expect(batch.get(1)!.get('connected_users')!.values).toEqual([10, 10])
  })

  it('display series include the partial period, marked', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1'])
    await fill(ws, 1, '2026-06-29', '2026-07-22', {}, { call_setup_success_4g: 99 })
    await build(ws)
    const { available } = await forecastableKpis(ws.conn, '4G', NET)
    const pts = await readDisplaySeries(ws.conn, 'weekly', byKey(available, 'call_setup_success_4g'), NET)
    expect(pts.map((p) => p.period)).toEqual(['2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20'])
    expect(pts[3]).toMatchObject({ complete: false, daysWithData: 3, value: 99 })
    expect(pts[2]).toMatchObject({ complete: true, daysWithData: 7 })
  })

  it('aggregates: mean for rates, total for sums and users; cells over target counted', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1', 'C2'])
    await ws.conn.run(`UPDATE kpi_defs SET target = 98.5 WHERE technology = '4G' AND kpi_key = 'call_setup_success_4g'`)
    await fill(ws, 1, '2026-06-29', '2026-07-05', { users: 10, volume: 100 }, { call_setup_success_4g: 98 })
    await fill(ws, 2, '2026-06-29', '2026-07-05', { users: 30, volume: 300 }, { call_setup_success_4g: 99 })
    await build(ws)
    const { available } = await forecastableKpis(ws.conn, '4G', NET)
    const cssr = byKey(available, 'call_setup_success_4g')
    expect((await readDisplaySeries(ws.conn, 'weekly', cssr, NET))[0].value).toBeCloseTo(98.5, 9)
    expect((await readDisplaySeries(ws.conn, 'weekly', byKey(available, 'data_volume'), NET))[0].value).toBe(2800)
    expect((await readDisplaySeries(ws.conn, 'weekly', byKey(available, 'connected_users'), NET))[0].value).toBe(40)
    const over = await readOverTargetSeries(ws.conn, 'weekly', cssr, NET)
    expect(over![0].value).toBe(1) // C1 at 98 is below the 98.5 target (higher is better)
    await ws.conn.run(`UPDATE kpi_defs SET target = NULL WHERE technology = '4G' AND kpi_key = 'call_setup_success_4g'`)
    const noTarget = byKey((await forecastableKpis(ws.conn, '4G', NET)).available, 'call_setup_success_4g')
    expect(await readOverTargetSeries(ws.conn, 'weekly', noTarget, NET)).toBeNull()
  })

  it('scope narrows the cells (cell scope reads one cell)', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1', 'C2'])
    await fill(ws, 1, '2026-06-29', '2026-07-05', {}, { call_setup_success_4g: 98 })
    await fill(ws, 2, '2026-06-29', '2026-07-05', {}, { call_setup_success_4g: 96 })
    await build(ws)
    const { available } = await forecastableKpis(ws.conn, '4G', { scope: 'cell', id: 2 })
    const pts = await readDisplaySeries(ws.conn, 'weekly', byKey(available, 'call_setup_success_4g'), { scope: 'cell', id: 2 })
    expect(pts[0].value).toBe(96)
  })
})
