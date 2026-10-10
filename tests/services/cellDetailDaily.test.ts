import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { openTechWorkspace } from '../helpers/techWorkspace'
import type { RealWorkspace } from '../helpers/realWorkspace'

/**
 * The cell drawer at daily grain reads agg_cell_daily, which carries the
 * weekly/monthly column names (prb_avg, dl_throughput_kbps_avg, ...), not the
 * fact_cell_daily ones. Data: the real synthetic generator through the real
 * import core (only the utility-process hop is swapped, see techWorkspace).
 */
vi.setConfig({ testTimeout: 30000 })

vi.mock('../../src/main/import/importer', async (orig) => ({
  ...(await orig<typeof import('../../src/main/import/importer')>()),
  runImport: (await import('../helpers/techWorkspace')).inProcessRunImport
}))

describe('getCellDetail at daily grain on a real 4G workspace', () => {
  let ws: RealWorkspace
  let cellId = 0
  beforeAll(async () => {
    ws = await openTechWorkspace('4G', { weeks: 3, cells: 4 })
    cellId = Number((await ws.conn.runAndReadAll(`SELECT min(cell_id) AS id FROM dim_cell`)).getRowObjects()[0].id)
  }, 180000)
  afterAll(async () => {
    await ws?.cleanup()
  })

  it('returns one point per day carrying the daily fact values', async () => {
    const { getCellDetail } = await import('../../src/main/services/queryService')
    const detail = await getCellDetail(cellId, 'daily')
    expect(detail).not.toBeNull()

    const facts = (await ws.conn.runAndReadAll(
      `SELECT CAST(d.date AS VARCHAR) AS date, f.prb_utilization, f.dl_throughput_kbps,
         f.connected_users, f.data_volume_mb, f.availability_pct
       FROM fact_cell_daily f JOIN dim_date d USING (date_id)
       WHERE f.cell_id = ${cellId} ORDER BY d.date`
    )).getRowObjects()
    expect(facts.length).toBeGreaterThan(0)
    expect(detail!.weeks.map((w) => w.weekStart)).toEqual(facts.map((f) => String(f.date)))

    const first = detail!.weeks[0]
    const num = (v: unknown): number | null => (v == null ? null : Number(v))
    expect(first.prbAvg).toBe(num(facts[0].prb_utilization))
    expect(first.throughputKbps).toBe(num(facts[0].dl_throughput_kbps))
    expect(first.users).toBe(num(facts[0].connected_users))
    expect(first.volumeMb).toBe(num(facts[0].data_volume_mb))
    expect(first.availability).toBe(num(facts[0].availability_pct))
  })
})
