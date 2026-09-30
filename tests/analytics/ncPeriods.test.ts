import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'
import { updateRules } from '../../src/main/analytics/rules'

/** One row per day from `from` to `to` where `present` holds; CSSR 90 (target
 *  95, a bad day) where `bad` holds, else 99. Both are SQL predicates on `d`. */
async function days(ws: RealWorkspace, cellId: number, from: string, to: string, bad: string, present = 'true'): Promise<void> {
  const range = `range(DATE '${from}', DATE '${to}' + INTERVAL 1 DAY, INTERVAL 1 DAY) r(d)`
  await ws.conn.run(
    `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
       dl_throughput_kbps, availability_pct, source_import_id)
     SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, 50, 100, 10, 20000, 99.9, 1
     FROM ${range} WHERE ${present}`
  )
  await ws.conn.run(
    `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
     SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, k.kpi_id, CASE WHEN ${bad} THEN 90 ELSE 99 END
     FROM ${range}, kpi_defs k
     WHERE ${present} AND k.technology = '3G' AND k.kpi_key = 'call_setup_success_3g'`
  )
}

async function build(ws: RealWorkspace): Promise<void> {
  await recomputeAllAggregates(ws.conn)
  await refreshAllIntelligence(ws.conn)
}

/** period_start → lifecycle for one cell and grain. */
async function labels(ws: RealWorkspace, cell: string, grain: string): Promise<Record<string, string>> {
  const r = await ws.conn.runAndReadAll(
    `SELECT CAST(l.period_start AS VARCHAR) AS p, l.lifecycle FROM cell_nc_lifecycle l
     JOIN dim_cell c USING (cell_id) WHERE c.name = ? AND l.grain = ?`,
    [cell, grain]
  )
  return Object.fromEntries(r.getRowObjects().map((x) => [String(x.p), String(x.lifecycle)]))
}

describe('NC periods (spec §3, §4)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('daily: New → Persistent at day 21 → Chronic at day 49; Recovering for 21 days, then Healthy',
    { timeout: 60000 }, async () => {
      ws = await openRealWorkspace('3G')
      await insertCells(ws.conn, ['RUN-56', 'ONE-DAY'])
      await days(ws, 1, '2026-07-01', '2026-09-10', `d <= DATE '2026-08-25'`)
      await days(ws, 2, '2026-03-01', '2026-04-10', `d = DATE '2026-03-01'`)
      await build(ws)
      const a = await labels(ws, 'RUN-56', 'daily')
      expect([a['2026-07-01'], a['2026-07-20'], a['2026-07-21']]).toEqual(['New NC', 'New NC', 'Persistent NC'])
      expect([a['2026-08-17'], a['2026-08-18']]).toEqual(['Persistent NC', 'Chronic NC'])
      expect(a['2026-08-26']).toBe('Recovering')
      const b = await labels(ws, 'ONE-DAY', 'daily')
      expect([b['2026-03-01'], b['2026-03-02'], b['2026-03-22'], b['2026-03-23']])
        .toEqual(['New NC', 'Recovering', 'Recovering', 'Healthy'])
    })

  it('a relapse inside the look-back window is Recurring, outside it New', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['BACK-17D', 'BACK-27D'])
    await days(ws, 1, '2026-07-01', '2026-08-10', `d <= DATE '2026-07-03' OR d = DATE '2026-07-20'`)
    await days(ws, 2, '2026-07-01', '2026-08-10', `d <= DATE '2026-07-03' OR d = DATE '2026-07-30'`)
    await build(ws)
    expect((await labels(ws, 'BACK-17D', 'daily'))['2026-07-20']).toBe('Recurring NC')
    expect((await labels(ws, 'BACK-27D', 'daily'))['2026-07-30']).toBe('New NC')
  })

  it('a Tuesdays-only cell is Intermittent daily and Chronic weekly and monthly', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['TUESDAYS'])
    await days(ws, 1, '2026-07-06', '2026-08-30', `dayofweek(d) = 2`)
    await build(ws)
    const d = await labels(ws, 'TUESDAYS', 'daily')
    expect([d['2026-07-07'], d['2026-07-14'], d['2026-07-21']]).toEqual(['New NC', 'Recurring NC', 'Intermittent NC'])
    expect(d['2026-07-22']).toBe('Recovering')
    const w = await labels(ws, 'TUESDAYS', 'weekly')
    expect([w['2026-08-10'], w['2026-08-17']]).toEqual(['Persistent NC', 'Chronic NC'])
    expect((await labels(ws, 'TUESDAYS', 'monthly'))['2026-08-01']).toBe('Chronic NC')
  })

  it('chronic in a day is chronic in its week and its month (tracing)', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['RUN-56'])
    await days(ws, 1, '2026-07-01', '2026-08-31', `d <= DATE '2026-08-25'`)
    await build(ws)
    expect((await labels(ws, 'RUN-56', 'daily'))['2026-08-18']).toBe('Chronic NC')
    expect((await labels(ws, 'RUN-56', 'weekly'))['2026-08-17']).toBe('Chronic NC')
    expect((await labels(ws, 'RUN-56', 'monthly'))['2026-08-01']).toBe('Chronic NC')
  })

  it('month edge: a run ending on the 2nd leaves that month not NC', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['ENDS-2ND'])
    await days(ws, 1, '2026-06-14', '2026-08-20', `d <= DATE '2026-08-02'`)
    await build(ws)
    expect((await labels(ws, 'ENDS-2ND', 'daily'))['2026-08-01']).toBe('Chronic NC')
    const m = (await ws.conn.runAndReadAll(
      `SELECT is_nc, lifecycle FROM cell_nc_lifecycle WHERE grain = 'monthly' AND period_start = DATE '2026-08-01'`
    )).getRowObjects()[0]
    expect(Boolean(m.is_nc)).toBe(false)
    expect(String(m.lifecycle)).toBe('Recovering')
  })

  it('a missing day inside a run neither breaks nor extends it', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['GAP'])
    await days(ws, 1, '2026-07-01', '2026-07-31', `d <= DATE '2026-07-25'`, `d <> DATE '2026-07-10'`)
    await build(ws)
    const g = await labels(ws, 'GAP', 'daily')
    expect(g['2026-07-21']).toBe('New NC') // 20th bad day with data
    expect(g['2026-07-22']).toBe('Persistent NC') // 21st
  })

  it('a shorter recovery setting brings Healthy forward', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['ONE-DAY'])
    await days(ws, 1, '2026-03-01', '2026-03-31', `d = DATE '2026-03-01'`)
    await updateRules(ws.conn, { recoveryWeeks: 1 })
    const b = await labels(ws, 'ONE-DAY', 'daily')
    expect([b['2026-03-08'], b['2026-03-09']]).toEqual(['Recovering', 'Healthy'])
  })

  it('severity ignores PRB outside 4G', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['HOT-3G'])
    await days(ws, 1, '2026-07-06', '2026-07-12', `true`)
    await ws.conn.run(`UPDATE fact_cell_daily SET prb_utilization = 120`)
    await build(ws)
    const s = (await ws.conn.runAndReadAll(
      `SELECT severity FROM cell_nc_lifecycle WHERE grain = 'daily' AND period_start = DATE '2026-07-06'`
    )).getRowObjects()[0].severity
    // New NC 40 + breach 2 + availability 0 = 42 → Watch; with the PRB term (+25) it would be High
    expect(String(s)).toBe('Watch')
  })
})
