import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { openRealWorkspace, type RealWorkspace } from '../helpers/realWorkspace'
import { getKpiTarget } from '../../src/main/analytics/targets'

/** Make the open workspace look like one written before kpi_defs owned
 *  targets, with `prb` in the ruleset, then close and reopen it. */
async function reopenAsLegacy(ws: RealWorkspace, prb: number, cssr: number): Promise<void> {
  await ws.conn.run(`ALTER TABLE ruleset ADD COLUMN IF NOT EXISTS prb_threshold_pct DOUBLE DEFAULT 80`)
  await ws.conn.run(`ALTER TABLE ruleset ADD COLUMN IF NOT EXISTS cssr_threshold_pct DOUBLE DEFAULT 95`)
  await ws.conn.run(`UPDATE ruleset SET prb_threshold_pct = ?, cssr_threshold_pct = ?`, [prb, cssr])
  await ws.conn.run(`DELETE FROM workspace_meta WHERE key = 'targets_owner'`)
  const manager = await import('../../src/main/workspace/manager')
  await manager.closeWorkspace()
  await manager.openWorkspace(join(ws.dir, 'test.qosdb'))
  ws.conn = manager.getCurrent()!.connection
}

describe('upgrade carries custom ruleset targets into kpi_defs (spec §8.5)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('a workspace with PRB 85 in the ruleset opens with the 4G PRB target at 85', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('4G')
    await reopenAsLegacy(ws, 85, 96)
    expect(await getKpiTarget(ws.conn, '4G', 'prb_utilization')).toBe(85)
    expect(await getKpiTarget(ws.conn, '2G', 'call_setup_success_2g')).toBe(96)
    expect(await getKpiTarget(ws.conn, '3G', 'call_setup_success_3g')).toBe(96)
  })

  it('a target already edited in kpi_defs wins over the ruleset copy', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('4G')
    await ws.conn.run(`UPDATE kpi_defs SET target = 82 WHERE technology = '4G' AND kpi_key = 'prb_utilization'`)
    await reopenAsLegacy(ws, 85, 95)
    expect(await getKpiTarget(ws.conn, '4G', 'prb_utilization')).toBe(82)
  })

  it('runs once', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('4G')
    await reopenAsLegacy(ws, 85, 95)
    await ws.conn.run(`UPDATE kpi_defs SET target = 80 WHERE technology = '4G' AND kpi_key = 'prb_utilization'`)
    const manager = await import('../../src/main/workspace/manager')
    await manager.closeWorkspace()
    await manager.openWorkspace(join(ws.dir, 'test.qosdb'))
    ws.conn = manager.getCurrent()!.connection
    expect(await getKpiTarget(ws.conn, '4G', 'prb_utilization')).toBe(80)
  })
})
