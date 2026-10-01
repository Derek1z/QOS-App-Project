import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates, recomputeAggregates, updateCoverage } from '../../src/main/import/aggregates'
import { refreshAllIntelligence, refreshIntelligence } from '../../src/main/analytics/engine'
import { getNcLifecycle } from '../../src/main/services/queryService'

/** Rows for `cellId` from `from` to `to` where `present`; CSSR 90 (bad, target 95) where `bad`, else 99. */
async function days(ws: RealWorkspace, cellId: number, from: string, to: string, bad: string, present = 'true'): Promise<number[]> {
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
  const r = await ws.conn.runAndReadAll(`SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER) AS id FROM ${range} WHERE ${present}`)
  return r.getRowObjects().map((x) => Number(x.id))
}

async function build(ws: RealWorkspace): Promise<void> {
  await recomputeAllAggregates(ws.conn)
  await refreshAllIntelligence(ws.conn)
}

async function weekly(ws: RealWorkspace, cell: string, week: string): Promise<{ lifecycle: string; isNc: boolean; trend: string | null }> {
  const x = (await ws.conn.runAndReadAll(
    `SELECT l.lifecycle, l.is_nc, l.trend FROM cell_nc_lifecycle l JOIN dim_cell c USING (cell_id)
     WHERE c.name = ? AND l.grain = 'weekly' AND l.period_start = DATE '${week}'`, [cell]
  )).getRowObjects()[0]
  return { lifecycle: String(x.lifecycle), isNc: Boolean(x.is_nc), trend: x.trend == null ? null : String(x.trend) }
}

describe('partial periods in NC labels (spec §3.3, §3.4)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('a chronic cell with two clean days in a partial week stays Chronic', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['CHRONIC'])
    // bad every day 1 Jun .. 19 Jul (weeks 1 Jun .. 13 Jul: the 7th is Chronic); Mon 20 + Tue 21 Jul clean; data ends Tue
    await days(ws, 1, '2026-06-01', '2026-07-21', `d <= DATE '2026-07-19'`)
    await build(ws)
    expect(await weekly(ws, 'CHRONIC', '2026-07-13')).toMatchObject({ lifecycle: 'Chronic NC', isNc: true })
    expect(await weekly(ws, 'CHRONIC', '2026-07-20')).toEqual({ lifecycle: 'Chronic NC', isNc: false, trend: null })
  })

  it('a bad day in the partial week makes it NC and the run continues', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['CHRONIC'])
    await days(ws, 1, '2026-06-01', '2026-07-22', `d <= DATE '2026-07-19' OR d = DATE '2026-07-22'`)
    await build(ws)
    expect(await weekly(ws, 'CHRONIC', '2026-07-20')).toEqual({ lifecycle: 'Chronic NC', isNc: true, trend: null })
  })

  it('trend is compared only between complete weeks', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['CHRONIC'])
    await days(ws, 1, '2026-06-01', '2026-07-22', `d <= DATE '2026-07-19' OR d = DATE '2026-07-22'`)
    await build(ws)
    expect((await weekly(ws, 'CHRONIC', '2026-07-13')).trend).not.toBeNull()
    expect((await weekly(ws, 'CHRONIC', '2026-07-20')).trend).toBeNull()
  })

  it('a hole week in history neither becomes latest nor breaks the run', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['HOLE'])
    // bad every day 1 Jun .. 26 Jul, but no import at all on Wed 8 Jul: week 6 Jul is partial (6/7)
    await days(ws, 1, '2026-06-01', '2026-07-26', 'true', `d <> DATE '2026-07-08'`)
    await build(ws)
    // week 6 Jul is partial but NC (bad days), so it counts: 6th week Persistent; 13 Jul 7th → Chronic
    expect((await weekly(ws, 'HOLE', '2026-07-13')).lifecycle).toBe('Chronic NC')
    expect((await getNcLifecycle('weekly')).weekStart).toBe('2026-07-20')
  })

  it('completing a week relabels every cell in it, including cells with no data on the imported day', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['CHRONIC', 'OTHER'])
    await days(ws, 1, '2026-06-01', '2026-07-21', `d <= DATE '2026-07-19'`)
    await days(ws, 2, '2026-06-01', '2026-07-21', 'false')
    await build(ws)
    expect((await weekly(ws, 'CHRONIC', '2026-07-20')).isNc).toBe(false)
    // only OTHER gets data for Wed..Sun; the week becomes complete; CHRONIC's clean week now counts and breaks its run
    const ids = await days(ws, 2, '2026-07-22', '2026-07-26', 'false')
    await recomputeAggregates(ws.conn, ids)
    await updateCoverage(ws.conn, ids)
    await refreshIntelligence(ws.conn, ids)
    expect(await weekly(ws, 'CHRONIC', '2026-07-20')).toMatchObject({ lifecycle: 'Recovering', isNc: false })
  })

  it('a NULL trend is not counted under a "null" key', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['ONLY'])
    await days(ws, 1, '2026-07-20', '2026-07-22', 'true') // one partial week: latest falls back to it
    await build(ws)
    const nc = await getNcLifecycle('weekly')
    expect(Object.keys(nc.byTrend).sort()).toEqual(['Improving', 'Stable', 'Worsening'])
    expect(nc.cells[0].trend).toBeNull()
  })
})
