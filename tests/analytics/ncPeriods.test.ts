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

  it('a week counts for the months its bad days fall in, not the month it starts in', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['WEDNESDAYS'])
    // Wednesdays 20 May .. 15 Jul: weeks starting 18 May .. 13 Jul are NC; the 7th
    // (Mon 29 Jun) is Chronic, but its only bad day is Wed 1 Jul.
    await days(ws, 1, '2026-05-01', '2026-07-31', `dayofweek(d) = 3 AND d BETWEEN DATE '2026-05-20' AND DATE '2026-07-15'`)
    await build(ws)
    expect((await labels(ws, 'WEDNESDAYS', 'weekly'))['2026-06-29']).toBe('Chronic NC')
    const m = await labels(ws, 'WEDNESDAYS', 'monthly')
    expect(m['2026-06-01']).toBe('Persistent NC') // its own weeks reach Persistent; the 29 Jun week's bad day is in July
    expect(m['2026-07-01']).toBe('Chronic NC') // 1, 8 and 15 Jul: NC month holding the chronic weeks' bad days
  })

  it('month edge: a run ending on the 2nd leaves that month not NC, and (being partial, data ends 20 Aug of 31) the partial non-NC August carries July\'s label after roll-up (spec 2026-10-01 §3.3)', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['ENDS-2ND'])
    await days(ws, 1, '2026-06-14', '2026-08-20', `d <= DATE '2026-08-02'`)
    await build(ws)
    expect((await labels(ws, 'ENDS-2ND', 'daily'))['2026-08-01']).toBe('Chronic NC')
    const m2 = await labels(ws, 'ENDS-2ND', 'monthly')
    // July's own streak is only Persistent, but the weeks of 20 and 27 Jul are
    // Chronic and have bad days falling in July, so roll-up raises July to
    // Chronic NC (spec §4) — the carried label must reflect that post-roll-up
    // value, not July's pre-roll-up Persistent NC.
    expect(m2['2026-07-01']).toBe('Chronic NC')
    const m = (await ws.conn.runAndReadAll(
      `SELECT is_nc, lifecycle FROM cell_nc_lifecycle WHERE grain = 'monthly' AND period_start = DATE '2026-08-01'`
    )).getRowObjects()[0]
    expect(Boolean(m.is_nc)).toBe(false)
    expect(String(m.lifecycle)).toBe('Chronic NC')
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

  it('look-back boundary: 21 days after is Recurring, 22 days after is New', { timeout: 60000 }, async () => {
    // Default lookback is lookbackWeeks(3) x 7 = 21 days (rankSql:
    // `run_start - prev_run_end <= lookback`). Previous run's last bad day is
    // 2026-07-03 for both cells; date_diff('day', 07-03, 07-24) = 21 (<=21,
    // Recurring), date_diff('day', 07-03, 07-25) = 22 (>21, New).
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['BACK-21D', 'BACK-22D'])
    await days(ws, 1, '2026-07-01', '2026-08-10', `d <= DATE '2026-07-03' OR d = DATE '2026-07-24'`)
    await days(ws, 2, '2026-07-01', '2026-08-10', `d <= DATE '2026-07-03' OR d = DATE '2026-07-25'`)
    await build(ws)
    expect((await labels(ws, 'BACK-21D', 'daily'))['2026-07-24']).toBe('Recurring NC')
    expect((await labels(ws, 'BACK-22D', 'daily'))['2026-07-25']).toBe('New NC')
  })

  it('intermittent window boundary: 3rd run inside the 49-day window is Intermittent, just outside is Recurring',
    { timeout: 60000 }, async () => {
      // Default intermittent window is intermittentWindowWeeks(7) x 7 = 49
      // days; runs_in_window counts distinct runs over
      // `RANGE BETWEEN (window - 1) PRECEDING AND CURRENT ROW`, i.e. pidx in
      // [Y-48, Y] for the 3rd run's first day Y — a 49-day-wide frame ending
      // at Y. Run 1's last bad day A is inside that frame when Y - A <= 48,
      // just outside it when Y - A = 49. Run 2 sits 10 days before run 3 in
      // both cases (within the 21-day lookback), so the "outside" case still
      // has a recent run and falls to Recurring, not New.
      ws = await openRealWorkspace('3G')
      await insertCells(ws.conn, ['WIN-INSIDE', 'WIN-OUTSIDE'])
      // Each cell has one continuous present range with clean (non-NC) days
      // separating three runs: a single bad day, a single bad day 10 days
      // before the 3rd run (inside the 21-day lookback, so a "not
      // Intermittent" result falls to Recurring, not New), then a long 3rd run.
      // WIN-INSIDE: run1 last day 2026-01-01, run3 first day 2026-02-18 (Y-A=48)
      await days(ws, 1, '2026-01-01', '2026-03-10',
        `d = DATE '2026-01-01' OR d = DATE '2026-02-08' OR d >= DATE '2026-02-18'`)
      // WIN-OUTSIDE: run1 last day 2026-01-01, run3 first day 2026-02-19 (Y-A=49)
      await days(ws, 2, '2026-01-01', '2026-03-11',
        `d = DATE '2026-01-01' OR d = DATE '2026-02-09' OR d >= DATE '2026-02-19'`)
      await build(ws)
      expect((await labels(ws, 'WIN-INSIDE', 'daily'))['2026-02-18']).toBe('Intermittent NC')
      expect((await labels(ws, 'WIN-OUTSIDE', 'daily'))['2026-02-19']).toBe('Recurring NC')
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
