import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'
import { generateReportPack } from '../../src/main/services/reportingService'
import { ensureDirs } from '../../src/main/paths'

/** KPI Trend report table (fix wave 2026-10-01 final review, item 5): the
 *  Week column must carry the partial marker for a partial week, same as
 *  every other period series in the app. */
async function build(ws: RealWorkspace, from: string, to: string): Promise<void> {
  const range = `range(DATE '${from}', DATE '${to}' + INTERVAL 1 DAY, INTERVAL 1 DAY) r(d)`
  await ws.conn.run(
    `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
       dl_throughput_kbps, availability_pct, source_import_id)
     SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), 1, 50, 100, 10, 20000, 99.9, 1 FROM ${range}`
  )
  await recomputeAllAggregates(ws.conn)
  await refreshAllIntelligence(ws.conn)
}

describe('KPI Trend report marks partial weeks (spec §3.2, fix wave item 5)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('the report section rows for a partial week end "· 3 of 7 days"', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1'])
    // Mon 2026-06-29 .. Wed 2026-07-22: 07-20 is a partial week (Mon-Wed, 3 days).
    await build(ws, '2026-06-29', '2026-07-22')
    ensureDirs()
    const pack = await generateReportPack({ sections: ['kpi-trend'], formats: ['md'] })
    const md = pack.files.md?.content ?? ''
    expect(md).toMatch(/2026-07-20 · 3 of 7 days/)
    // A complete week's row stays plain.
    expect(md).toMatch(/\| 2026-07-13 \|/)
  })
})
