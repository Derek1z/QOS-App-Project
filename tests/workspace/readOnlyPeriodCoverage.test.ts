import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { openRealWorkspace, insertCells, setSchemaVersion, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'

/** A pre-feature workspace opened read-only has no period_coverage, since
 *  ensureUpgradeSchema/backfill only run on writable opens (fix wave
 *  2026-10-01 final review, item 3). Every weekly/monthly screen must still
 *  work instead of throwing "Table with name period_coverage does not
 *  exist!" — a read-only open backfills a TEMP VIEW instead. */
describe('a read-only open without period_coverage still serves weekly/monthly analytics', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('getNcLifecycle and getRegionMap work after DROP TABLE period_coverage + reopen read-only', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1', 'C2'])
    const range = `range(DATE '2026-06-29', DATE '2026-07-22' + INTERVAL 1 DAY, INTERVAL 1 DAY) r(d)`
    for (const cellId of [1, 2]) {
      await ws.conn.run(
        `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
           dl_throughput_kbps, availability_pct, source_import_id)
         SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, 50, 100, 10, 20000, 99.9, 1 FROM ${range}`
      )
    }
    await recomputeAllAggregates(ws.conn)
    await refreshAllIntelligence(ws.conn)

    // Simulate a pre-feature workspace: period_coverage never existed in it.
    await ws.conn.run(`DROP TABLE period_coverage`)
    // a workspace that never had the table is older than step 1
    await setSchemaVersion(ws.conn, 0)

    const manager = await import('../../src/main/workspace/manager')
    const path = join(ws.dir, 'test.qosdb')
    await manager.closeWorkspace()
    await manager.openWorkspace(path, { readOnly: true })
    ws.conn = manager.getCurrent()!.connection

    const { getNcLifecycle, getRegionMap } = await import('../../src/main/services/queryService')
    const nc = await getNcLifecycle('weekly')
    expect(nc.weekStart).toBe('2026-07-13')
    const regions = await getRegionMap('4G')
    expect(regions.length).toBeGreaterThan(0)
  })
})
