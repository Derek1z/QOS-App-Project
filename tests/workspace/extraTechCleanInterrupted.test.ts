import { describe, it, expect, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'

/** If the recompute after the once-on-open cleanup of other-technology KPI
 *  rows fails, the next open must still recompute: the aggregates would
 *  otherwise keep the deleted rows' copies. */

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

/** technology of every weekly connected_users aggregate row, sorted. */
async function weeklyTechs(ws: RealWorkspace): Promise<string[]> {
  return (await ws.conn.runAndReadAll(
    `SELECT k.technology AS t FROM agg_cell_kpi_weekly a JOIN kpi_defs k ON k.kpi_id = a.kpi_id
     WHERE k.kpi_key = 'connected_users' ORDER BY t`
  )).getRowObjects().map((x) => String(x.t))
}

describe('an interrupted other-technology KPI cleanup', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    failRecompute = false
    await ws?.cleanup()
    ws = null
  })

  it('is recomputed on the next open', { timeout: 90000 }, async () => {
    const { recomputeAllAggregates } = await import('../../src/main/import/aggregates')
    const manager = await import('../../src/main/workspace/manager')
    ws = await openRealWorkspace('2G')
    await insertCells(ws.conn, ['CELL'])
    await ws.conn.run(
      `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
         dl_throughput_kbps, availability_pct, source_import_id)
       VALUES (20260720, 1, 50, 100, 12, 20000, 99.9, 1)`
    )
    await ws.conn.run(
      `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
       SELECT 20260720, 1, kpi_id, 12 FROM kpi_defs WHERE kpi_key = 'connected_users'`
    )
    await recomputeAllAggregates(ws.conn)
    await ws.conn.run(`DELETE FROM workspace_meta WHERE key = 'extra_tech_cleaned'`)
    expect(await weeklyTechs(ws)).toEqual(['2G', '3G', '4G'])

    const path = join(ws.dir, 'test.qosdb')
    await manager.closeWorkspace()
    failRecompute = true
    await expect(manager.openWorkspace(path)).rejects.toThrow(/simulated/)
    failRecompute = false

    await manager.openWorkspace(path)
    ws.conn = manager.getCurrent()!.connection
    expect(await weeklyTechs(ws)).toEqual(['2G'])
  })
})
