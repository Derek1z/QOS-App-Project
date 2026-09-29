import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputePriority } from '../../src/main/analytics/priority'

describe('priority score and imported KPI breaches', () => {
  let ws: RealWorkspace
  let score: Record<string, number>

  beforeAll(async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['CELL-BREACH', 'CELL-OK', 'CELL-NOKPI'])
    // identical classical inputs: PRB 60 (below the 80 threshold), network-average
    // users/volume/throughput, no NC history -> classical balanced score = 10 * 50 / 100 = 5.0
    for (const id of [1, 2, 3]) {
      await ws.conn.run(
        `INSERT INTO agg_cell_weekly (week_start, week_end, iso_year, iso_week, cell_id, observed_days,
           breach_days, prb_avg, prb_peak, data_volume_mb_sum, connected_users_sum,
           dl_throughput_kbps_avg, availability_pct_avg, is_nc)
         VALUES (DATE '2026-07-20', DATE '2026-07-26', 2026, 30, ?, 7, 0, 60, 60, 1000, 100, 20000, 99.9, false)`,
        [id]
      )
    }
    // 4G call drop rate target is 1.0 (worse is higher): 2.0 breaches by 100%, 0.5 is compliant
    await ws.conn.run(
      `INSERT INTO agg_cell_kpi_weekly (week_start, cell_id, kpi_id, avg_value, sum_value, max_value, min_value, observed_days)
       SELECT DATE '2026-07-20', v.cell_id, k.kpi_id, v.val, v.val, v.val, v.val, 7
       FROM (VALUES (1, 2.0), (2, 0.5)) v(cell_id, val)
       JOIN kpi_defs k ON k.technology = '4G' AND k.kpi_key = 'call_drop_rate_4g'`
    )
    await recomputePriority(ws.conn, [1, 2, 3])
    const r = await ws.conn.runAndReadAll(
      `SELECT c.name, p.score FROM cell_priority_history p JOIN dim_cell c USING (cell_id) WHERE p.mode = 'balanced'`
    )
    score = Object.fromEntries(r.getRowObjects().map((x) => [String(x.name), Number(x.score)]))
  })

  afterAll(async () => {
    await ws.cleanup()
  })

  it('ranks a cell breaching an imported KPI target above an otherwise identical compliant cell', () => {
    expect(score['CELL-BREACH']).toBeGreaterThan(score['CELL-OK'])
  })

  it('keeps the classical score for a cell with no imported KPI data', () => {
    expect(score['CELL-NOKPI']).toBe(5)
  })
})
