import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'
import { saveDerivedKpi } from '../../src/main/services/derivedKpiService'
import { BUILTIN_DERIVED_KPIS } from '../../shared/api'

// one full ISO week, Monday 2026-07-20 .. Sunday 2026-07-26
const DAYS = [20260720, 20260721, 20260722, 20260723, 20260724, 20260725, 20260726]

async function addDays(ws: RealWorkspace, cellId: number, prb: number): Promise<void> {
  for (const d of DAYS) {
    await ws.conn.run(
      `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
         dl_throughput_kbps, availability_pct, source_import_id) VALUES (?, ?, ?, 100, 10, 20000, 99.9, 1)`,
      [d, cellId, prb]
    )
  }
}

async function addKpi(ws: RealWorkspace, cellId: number, tech: string, key: string, value: number): Promise<void> {
  await ws.conn.run(
    `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
     SELECT d.date_id, ?, k.kpi_id, ? FROM (SELECT unnest([${DAYS.join(', ')}]) AS date_id) d
     JOIN kpi_defs k ON k.technology = ? AND k.kpi_key = ?`,
    [cellId, value, tech, key]
  )
}

/** is_nc of every cell in each place the app decides NC, keyed by cell name. */
async function ncEverywhere(ws: RealWorkspace): Promise<Record<string, Record<string, boolean>>> {
  const q = async (sql: string): Promise<Record<string, boolean>> =>
    Object.fromEntries((await ws.conn.runAndReadAll(sql)).getRowObjects().map((x) => [String(x.name), Boolean(x.is_nc)]))
  return {
    dailyView: await q(`SELECT c.name, v.is_nc FROM agg_cell_daily v JOIN dim_cell c USING (cell_id) WHERE v.date = DATE '2026-07-22'`),
    dailyHistory: await q(`SELECT c.name, l.is_nc FROM cell_nc_lifecycle l JOIN dim_cell c USING (cell_id)
      WHERE l.grain = 'daily' AND l.period_start = DATE '2026-07-22'`),
    weekly: await q(`SELECT c.name, w.is_nc FROM agg_cell_weekly w JOIN dim_cell c USING (cell_id)`),
    monthly: await q(`SELECT c.name, m.is_nc FROM agg_cell_monthly m JOIN dim_cell c USING (cell_id)`)
  }
}

describe('one NC rule: a core (NCA) KPI of the cell misses its target', () => {
  let ws: RealWorkspace | null = null

  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('3G: a diagnostic counter or the PRB column never makes a cell NC; a core KPI breach does', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['COUNTER-ONLY', 'CSSR-LOW'])
    await addDays(ws, 1, 85) // a 3G file's utilization column lands in the PRB slot
    await addDays(ws, 2, 50)
    // PhyCh Failures is a derived diagnostic counter (seeded target 30)
    const phych = BUILTIN_DERIVED_KPIS.find((d) => d.id === '3g_phych_failures')!
    await saveDerivedKpi(ws.conn, phych)
    await addKpi(ws, 1, '3G', '3g_phych_failures', 90)
    await addKpi(ws, 1, '3G', 'call_setup_success_3g', 99)
    await addKpi(ws, 2, '3G', 'call_setup_success_3g', 90) // target 95
    await recomputeAllAggregates(ws.conn)
    await refreshAllIntelligence(ws.conn)

    const expected = { 'COUNTER-ONLY': false, 'CSSR-LOW': true }
    expect(await ncEverywhere(ws)).toEqual({ dailyView: expected, dailyHistory: expected, weekly: expected, monthly: expected })
  })

  it('4G: peak-hour PRB above the threshold makes a cell NC; a non-core KPI breach does not', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['PRB-HIGH', 'VOLTE-DROP'])
    await addDays(ws, 1, 85) // ruleset threshold 80
    await addDays(ws, 2, 50)
    await addKpi(ws, 2, '4G', 'volte_drop_call_rate', 3) // non-core, target 1.5
    await recomputeAllAggregates(ws.conn)
    await refreshAllIntelligence(ws.conn)

    const expected = { 'PRB-HIGH': true, 'VOLTE-DROP': false }
    expect(await ncEverywhere(ws)).toEqual({ dailyView: expected, dailyHistory: expected, weekly: expected, monthly: expected })
  })
})
