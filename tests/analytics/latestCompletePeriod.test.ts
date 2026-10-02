import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'
import {
  getNcLifecycle, getKpiOverview, getCellIntelligence, getCellDetail, getPriorityQueue, getHealth, getExecutiveOverview
} from '../../src/main/services/queryService'

async function build(ws: RealWorkspace, from: string, to: string): Promise<void> {
  const range = `range(DATE '${from}', DATE '${to}' + INTERVAL 1 DAY, INTERVAL 1 DAY) r(d)`
  for (const cellId of [1, 2]) {
    await ws.conn.run(
      `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
         dl_throughput_kbps, availability_pct, source_import_id)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, 50, 100, 10, 20000, 99.9, 1 FROM ${range}`
    )
    await ws.conn.run(
      `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, k.kpi_id, CASE WHEN ${cellId} = 1 THEN 90 ELSE 99 END
       FROM ${range}, kpi_defs k WHERE k.technology = '3G' AND k.kpi_key = 'call_setup_success_3g'`
    )
  }
  await recomputeAllAggregates(ws.conn)
  await refreshAllIntelligence(ws.conn)
}

describe('"latest" is the latest complete week (spec §3.1)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('a dataset ending on a Wednesday reports the previous full week everywhere', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['BAD', 'GOOD'])
    await build(ws, '2026-06-29', '2026-07-22')
    const nc = await getNcLifecycle('weekly')
    expect(nc.weekStart).toBe('2026-07-13')
    expect(nc.periodComplete).toBe(true)
    expect((await getKpiOverview()).weekStart).toBe('2026-07-13')
    expect((await getCellIntelligence({})).rows.every((r) => r.weekStart === '2026-07-13')).toBe(true)
    expect((await getCellDetail(1, 'weekly'))?.current?.weekStart).toBe('2026-07-13')
    expect((await getPriorityQueue('balanced')).every((p) => p.asOf === '2026-07-13')).toBe(true)
    expect((await getHealth('weekly')).cells.every((c) => c.weekStart === '2026-07-13')).toBe(true)
    const exec = await getExecutiveOverview({ grain: 'weekly' })
    expect(exec?.asOf).toBe('2026-07-13')
    expect(exec?.periodComplete).toBe(true)
  })

  it('too little data still shows: the partial week is latest and marked', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['BAD', 'GOOD'])
    await build(ws, '2026-07-20', '2026-07-22')
    const nc = await getNcLifecycle('weekly')
    expect(nc.weekStart).toBe('2026-07-20')
    expect(nc.periodComplete).toBe(false)
    expect(nc.cells.length).toBe(2)
  })
})
