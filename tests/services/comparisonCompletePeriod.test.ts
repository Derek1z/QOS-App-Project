import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'
import { getComparison } from '../../src/main/services/queryService'

/** Comparison Lab (fix wave 2026-10-01 final review, item 1): week-on-week
 *  (and month-on-month) comparisons pair complete periods only — a partial
 *  newest period must never become `a`, and `b` must be the complete period
 *  before `a`, not just whatever came before chronologically. */
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

describe('Comparison Lab pairs complete periods only (spec §3.1, fix wave item 1)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('data ending on a Wednesday: latest is the previous full week, baseline the week before that', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1'])
    // Mon 2026-06-29 .. Wed 2026-07-22: full weeks 07-06 and 07-13 are complete,
    // 07-20 (Mon-Wed only) is partial.
    await build(ws, '2026-06-29', '2026-07-22')
    const cmp = await getComparison({ type: 'period', scope: 'cell', metric: 'prb', grain: 'weekly' })
    expect(cmp.aLabel).toBe('2026-07-13')
    expect(cmp.bLabel).toBe('2026-07-06')
  })

  it('falls back to the chronologically previous period when no earlier period is complete', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1'])
    // Only two partial weeks ever recorded: 06-29..07-05 complete (7 days),
    // 07-06..07-08 partial (3 days) — the latest is the partial one since no
    // complete week exists after it, and there's no complete week before it
    // either, so b falls back to the previous period in the data.
    await build(ws, '2026-07-06', '2026-07-08')
    const cmp = await getComparison({ type: 'period', scope: 'cell', metric: 'prb', grain: 'weekly' })
    expect(cmp.aLabel).toBe('2026-07-06')
    expect(cmp.bLabel).toBe('')
  })
})
