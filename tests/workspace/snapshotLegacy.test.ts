import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, setSchemaVersion, type RealWorkspace } from '../helpers/realWorkspace'
import { snapshotKpis } from '../../src/main/services/snapshotService'

/** A snapshot .qosdb is opened directly with DuckDBInstance (READ_ONLY),
 *  bypassing openWorkspace/ensureUpgradeSchema — so a snapshot taken before
 *  `period_coverage` existed (fix wave 2026-10-01, complete periods) never
 *  gets that table backfilled. snapshotKpis() must still return values for
 *  such a file instead of throwing a catalog/binder error. */
describe('comparing a snapshot taken before period_coverage existed', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('reads KPIs from a legacy snapshot file without period_coverage', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['CELL-A', 'CELL-B'])

    // Simulate a snapshot file saved before this feature landed: the table
    // simply never existed in it.
    await ws.conn.run(`DROP TABLE period_coverage`)
    await setSchemaVersion(ws.conn, 0)

    const manager = await import('../../src/main/workspace/manager')
    const path = manager.getCurrent()!.path
    manager.closeWorkspace()

    const kpis = await snapshotKpis(path)
    expect(kpis.cells).toBe(2)
    expect(kpis.rows).toBe(0)
  })
})
