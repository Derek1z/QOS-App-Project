import { describe, it, expect, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'

/** Final review finding 2: if the recompute after a technology correction
 *  fails, the next open must still recompute (the marker may not claim a
 *  consistent workspace that is not). */

let failRecompute = false
vi.mock('../../src/main/import/aggregates', async (orig) => {
  const real = await orig<typeof import('../../src/main/import/aggregates')>()
  return {
    ...real,
    recomputeAllAggregates: async (...a: Parameters<typeof real.recomputeAllAggregates>) => {
      if (failRecompute) throw new Error('simulated recompute failure')
      return real.recomputeAllAggregates(...a)
    }
  }
})

async function ncDays(ws: RealWorkspace): Promise<number> {
  return Number((await ws.conn.runAndReadAll(
    `SELECT count(*) AS n FROM cell_nc_lifecycle WHERE grain = 'daily' AND is_nc`
  )).getRowObjects()[0]?.n)
}

describe('an interrupted technology correction', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    failRecompute = false
    await ws?.cleanup()
    ws = null
  })

  it('is recomputed on the next open', { timeout: 90000 }, async () => {
    const { recomputeAllAggregates } = await import('../../src/main/import/aggregates')
    const { refreshAllIntelligence } = await import('../../src/main/analytics/engine')
    const manager = await import('../../src/main/workspace/manager')
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['CELL'])
    const range = `range(DATE '2026-07-06', DATE '2026-07-06' + INTERVAL 20 DAY, INTERVAL 1 DAY) r(d)`
    await ws.conn.run(
      `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
         dl_throughput_kbps, availability_pct, source_import_id)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), 1, 95, 100, 10, 20000, 99.9, 1 FROM ${range}`
    )
    await ws.conn.run(
      `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), 1, k.kpi_id, 99
       FROM ${range}, kpi_defs k WHERE k.technology = '3G' AND k.kpi_key = 'call_setup_success_3g'`
    )
    await recomputeAllAggregates(ws.conn)
    await refreshAllIntelligence(ws.conn)
    await ws.conn.run(`DELETE FROM workspace_meta WHERE key = 'tech_checked'`)
    expect(await ncDays(ws)).toBe(20)

    const path = join(ws.dir, 'test.qosdb')
    await manager.closeWorkspace()
    failRecompute = true
    await expect(manager.openWorkspace(path)).rejects.toThrow(/simulated/)
    failRecompute = false

    const info = await manager.openWorkspace(path)
    ws.conn = manager.getCurrent()!.connection
    expect(info.technology).toBe('3G')
    expect(await ncDays(ws)).toBe(0)
  })
})
