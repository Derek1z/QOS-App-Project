import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { getRegionMap, getRegionDistricts } from '../../src/main/services/queryService'

describe('Ghana map PRB non-compliance (4G, PRB-only data)', () => {
  let ws: RealWorkspace

  beforeAll(async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1', 'C2', 'C3', 'C4', 'C5'])
    // "latest" is the latest *complete* week (spec §3.1): mark this week complete
    // since the inserted rows are a direct agg_cell_weekly fixture, not a real import.
    await ws.conn.run(
      `INSERT INTO period_coverage (grain, period_start, days_with_data, days_in_period, is_complete)
       VALUES ('weekly', DATE '2026-07-20', 7, 7, true)`
    )
    // region average 85% (> 80) while exactly 3 of 5 cells are at/above the 80% threshold
    const prb = [95, 95, 95, 70, 70]
    for (let i = 0; i < prb.length; i++) {
      await ws.conn.run(
        `INSERT INTO agg_cell_weekly (week_start, week_end, iso_year, iso_week, cell_id, observed_days,
           breach_days, prb_avg, prb_peak, data_volume_mb_sum, connected_users_sum,
           dl_throughput_kbps_avg, availability_pct_avg, is_nc)
         VALUES (DATE '2026-07-20', DATE '2026-07-26', 2026, 30, ?, 7, ?, ?, ?, 1000, 100, 20000, 99.9, ?)`,
        [i + 1, prb[i] >= 80 ? 7 : 0, prb[i], prb[i], prb[i] >= 80]
      )
    }
  })

  afterAll(async () => {
    await ws.cleanup()
  })

  it('counts the cells that actually breach the PRB threshold on the region map', async () => {
    const [region] = await getRegionMap('4G')
    expect(region.kpiMetrics?.prb_utilization).toMatchObject({ avg: 85, ncCells: 3, ncRate: 60 })
  })

  it('counts the cells that actually breach the PRB threshold on the district drill-down', async () => {
    const [district] = await getRegionDistricts(1, '4G')
    expect(district.kpiMetrics?.prb_utilization).toMatchObject({ avg: 85, ncCells: 3, ncRate: 60 })
  })
})
