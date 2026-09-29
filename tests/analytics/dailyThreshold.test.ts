import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'node:path'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { updateRules } from '../../src/main/analytics/rules'

async function dailyFlag(conn: RealWorkspace['conn']): Promise<Record<string, unknown>> {
  const r = await conn.runAndReadAll(`SELECT is_nc, breach_days FROM agg_cell_daily WHERE cell_id = 1`)
  return r.getRowObjects()[0]
}

describe('daily NC view after lowering the PRB threshold (80 -> 70)', () => {
  let ws: RealWorkspace

  beforeAll(async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1'])
    await ws.conn.run(
      `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
         dl_throughput_kbps, availability_pct, source_import_id)
       VALUES (20260720, 1, 75, 100, 10, 20000, 99.9, 1)`
    )
    await updateRules(ws.conn, { prbThresholdPct: 70 })
  })

  afterAll(async () => {
    await ws.cleanup()
  })

  it('flags a 75% PRB day as NC in a newly created workspace', async () => {
    expect(await dailyFlag(ws.conn)).toEqual({ is_nc: true, breach_days: 1 })
  })

  it('flags a 75% PRB day as NC after the workspace is reopened', async () => {
    const mgr = await import('../../src/main/workspace/manager')
    mgr.closeWorkspace()
    await mgr.openWorkspace(join(ws.dir, 'test.qosdb'))
    expect(await dailyFlag(mgr.getCurrent()!.connection)).toEqual({ is_nc: true, breach_days: 1 })
  })
})
