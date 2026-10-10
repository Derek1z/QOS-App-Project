import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'node:path'
import type { Technology, PriorityRow } from '../../shared/api'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputePriority } from '../../src/main/analytics/priority'

/** The priority score's capacity part is measured per technology: PRB only in
 *  4G, TCH/SDCCH congestion in 2G, not scored in 3G yet (the user picks the 3G
 *  measure later). The 4G PRB rule never touches a 2G or 3G cell. */

interface Cell { name: string; prb: number; kpis?: Record<string, number> }

/** Cells with identical network-average classical inputs (users, volume,
 *  throughput, Healthy, Stable) so only the capacity part and the KPI-breach
 *  blend differ. Classical balanced score without capacity = 10 × 50 / 100. */
async function scoreCells(tech: Technology, cells: Cell[]): Promise<{ ws: RealWorkspace; rows: Record<string, PriorityRow> }> {
  const ws = await openRealWorkspace(tech)
  await insertCells(ws.conn, cells.map((c) => c.name))
  await ws.conn.run(
    `INSERT INTO period_coverage (grain, period_start, days_with_data, days_in_period, is_complete)
     VALUES ('weekly', DATE '2026-07-20', 7, 7, true)`
  )
  for (let i = 0; i < cells.length; i++) {
    const id = i + 1
    await ws.conn.run(
      `INSERT INTO agg_cell_weekly (week_start, week_end, iso_year, iso_week, cell_id, observed_days,
         breach_days, prb_avg, prb_peak, data_volume_mb_sum, connected_users_sum,
         dl_throughput_kbps_avg, availability_pct_avg, is_nc)
       VALUES (DATE '2026-07-20', DATE '2026-07-26', 2026, 30, ?, 7, 0, ?, ?, 1000, 100, 20000, 99.9, false)`,
      [id, cells[i].prb, cells[i].prb]
    )
    for (const [key, val] of Object.entries(cells[i].kpis ?? {})) {
      await ws.conn.run(
        `INSERT INTO agg_cell_kpi_weekly (week_start, cell_id, kpi_id, avg_value, sum_value, max_value, min_value, observed_days)
         SELECT DATE '2026-07-20', ?, kpi_id, ?, ?, ?, ?, 7 FROM kpi_defs WHERE technology = ? AND kpi_key = ?`,
        [id, val, val, val, val, tech, key]
      )
    }
  }
  await recomputePriority(ws.conn, cells.map((_, i) => i + 1))
  const { getPriorityQueue } = await import('../../src/main/services/queryService')
  const q = await getPriorityQueue('balanced', 50)
  return { ws, rows: Object.fromEntries(q.map((r) => [r.cellName, r])) }
}

describe('2G: capacity = the worse of TCH and SDCCH congestion against their targets', () => {
  let ws: RealWorkspace
  let rows: Record<string, PriorityRow>
  beforeAll(async () => {
    // both congestion targets are 1.0 % (worse is higher)
    ;({ ws, rows } = await scoreCells('2G', [
      { name: 'TCH-2X', prb: 99, kpis: { tch_congestion: 2.0, sdcch_congestion: 0.5 } },
      { name: 'SDCCH-1.5X', prb: 10, kpis: { tch_congestion: 0.5, sdcch_congestion: 1.5 } },
      { name: 'HIGH-UTIL-OK', prb: 99, kpis: { tch_congestion: 0.5, sdcch_congestion: 0.5 } },
      { name: 'NO-KPI', prb: 99 }
    ]))
  })
  afterAll(async () => {
    await ws?.cleanup()
  })

  it('scores congestion relative to target, worst KPI wins', () => {
    expect(rows['TCH-2X'].components.capacitySeverity).toBe(100)
    expect(rows['SDCCH-1.5X'].components.capacitySeverity).toBe(50)
  })

  it('ignores the utilization column (the 4G PRB rule never applies)', () => {
    expect(rows['HIGH-UTIL-OK'].components.capacitySeverity).toBe(0)
    expect(rows['NO-KPI'].components.capacitySeverity).toBe(0)
    expect(rows['NO-KPI'].score).toBe(5)
  })

  it('feeds the balanced score: 0.8 × (25 × 100 + 10 × 50) / 100 + 0.2 × KPI breach 50', () => {
    expect(rows['TCH-2X'].score).toBe(34)
  })

  it('is called congestion severity in reports', async () => {
    const { overrideDataDirs } = await import('../../src/main/paths')
    overrideDataDirs({ exports: join(ws.dir, 'exports') })
    const { generateReportPack } = await import('../../src/main/services/reportingService')
    const md = (await generateReportPack({ sections: ['priority-queue'], formats: ['md'] })).files.md?.content ?? ''
    expect(md).toContain('Congestion severity')
  })
})

describe('3G: capacity is not scored until a 3G measure is chosen', () => {
  let ws: RealWorkspace
  let rows: Record<string, PriorityRow>
  beforeAll(async () => {
    ;({ ws, rows } = await scoreCells('3G', [{ name: 'HIGH-UTIL', prb: 99 }, { name: 'LOW-UTIL', prb: 10 }]))
  })
  afterAll(async () => {
    await ws?.cleanup()
  })

  it('has no capacity value, whatever the utilization column holds', () => {
    expect(rows['HIGH-UTIL'].components.capacitySeverity).toBeNull()
    expect(rows['LOW-UTIL'].components.capacitySeverity).toBeNull()
  })

  it('rescales the other five parts to 0-100: 10 × 50 / (100 − 25)', () => {
    expect(rows['HIGH-UTIL'].score).toBe(6.7)
    expect(rows['LOW-UTIL'].score).toBe(6.7)
  })
})

describe('4G: capacity stays PRB against the PRB target', () => {
  let ws: RealWorkspace
  let rows: Record<string, PriorityRow>
  beforeAll(async () => {
    // PRB target 80: 100 % is 20 points over, on a 40-point scale
    ;({ ws, rows } = await scoreCells('4G', [{ name: 'PRB-100', prb: 100 }, { name: 'PRB-60', prb: 60 }]))
  })
  afterAll(async () => {
    await ws?.cleanup()
  })

  it('scores PRB over target on the 40-point scale', () => {
    expect(rows['PRB-100'].components.capacitySeverity).toBe(50)
    expect(rows['PRB-60'].components.capacitySeverity).toBe(0)
    expect(rows['PRB-60'].score).toBe(5)
  })
})

describe('v8 migration', () => {
  let ws: RealWorkspace
  beforeAll(async () => {
    ws = await openRealWorkspace('2G')
  })
  afterAll(async () => {
    await ws?.cleanup()
  })

  it('asks for a recompute only when stored priority scores exist', async () => {
    const { MIGRATIONS, LATEST } = await import('../../src/main/workspace/migrations')
    const v8 = MIGRATIONS.find((m) => m.version === 8)!
    expect(v8.name).toBe('Per-technology priority')
    expect(LATEST).toBe(8)
    expect(await v8.up(ws.conn)).toBe(false)
    await ws.conn.run(
      `INSERT INTO cell_priority_history (cell_id, as_of, score, band, mode, weights, ruleset_version)
       VALUES (1, DATE '2026-07-20', 40, 'Watch', 'balanced', '{"prbSeverity": 90}', 1)`
    )
    expect(await v8.up(ws.conn)).toBe(true)
  })
})
