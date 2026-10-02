import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'
import { getPerformance } from '../../src/main/services/queryService'

/** Performance Analysis (fix wave 2026-10-01 final review, item 2): the
 *  distributions/scatter must read from the latest *complete* period, not
 *  whatever the newest (possibly partial) row in the aggregate tables is. */
async function build(ws: RealWorkspace, from: string, to: string): Promise<void> {
  const range = `range(DATE '${from}', DATE '${to}' + INTERVAL 1 DAY, INTERVAL 1 DAY) r(d)`
  await ws.conn.run(
    `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
       dl_throughput_kbps, availability_pct, source_import_id)
     SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), 1, 50, 100, 10, 20000, 99.9, 1 FROM ${range}`
  )
  await recomputeAllAggregates(ws.conn)
  await refreshAllIntelligence(ws.conn)
}

describe('Performance Analysis reads the latest complete period (spec §3.1, fix wave item 2)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('data ending on a Wednesday: weekStart is the previous full week', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1'])
    await build(ws, '2026-06-29', '2026-07-22')
    const perf = await getPerformance({ grain: 'weekly', technology: '4G' })
    expect(perf.weekStart).toBe('2026-07-13')
  })

  it('daily grain is unaffected: weekStart is the newest day', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1'])
    await build(ws, '2026-06-29', '2026-07-22')
    const perf = await getPerformance({ grain: 'daily', technology: '4G' })
    expect(perf.weekStart).toBe('2026-07-22')
  })
})
