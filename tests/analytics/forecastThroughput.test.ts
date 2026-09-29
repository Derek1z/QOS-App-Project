import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { getForecast } from '../../src/main/services/queryService'
import type { ForecastRisk } from '../../shared/api'

describe('4G DL speed forecast risk (target 10 Mbps)', () => {
  let ws: RealWorkspace
  let riskByCell: Record<string, ForecastRisk>

  beforeAll(async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['HEALTHY', 'SLOW'])
    const weeks = ['2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']
    const kbps: Record<number, number[]> = {
      1: [18200, 19100, 17800, 18900, 19400], // ~19 Mbps
      2: [5200, 4900, 5100, 5000, 4800] // ~5 Mbps
    }
    for (const [cellId, series] of Object.entries(kbps)) {
      for (let i = 0; i < weeks.length; i++) {
        await ws.conn.run(
          `INSERT INTO agg_cell_weekly (week_start, week_end, iso_year, iso_week, cell_id, observed_days,
             breach_days, prb_avg, prb_peak, data_volume_mb_sum, connected_users_sum,
             dl_throughput_kbps_avg, availability_pct_avg, is_nc)
           VALUES (CAST(? AS DATE), CAST(? AS DATE) + 6, 2026, ?, ?, 7, 0, 50, 50, 1000, 100, ?, 99.9, false)`,
          [weeks[i], weeks[i], 27 + i, Number(cellId), series[i]]
        )
      }
    }
    const res = await getForecast({ scope: 'network', metric: 'throughput', technology: '4G', grain: 'weekly' })
    riskByCell = Object.fromEntries(res.riskRows.map((r) => [r.name, r.risk]))
  })

  afterAll(async () => {
    await ws.cleanup()
  })

  it('does not report a ~19 Mbps cell as already breaching', () => {
    expect(riskByCell['HEALTHY']).not.toBe('Already Breached')
  })

  it('reports a ~5 Mbps cell as already breaching', () => {
    expect(riskByCell['SLOW']).toBe('Already Breached')
  })
})
