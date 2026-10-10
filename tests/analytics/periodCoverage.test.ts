import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { openRealWorkspace, insertCells, setSchemaVersion, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates, recomputeAggregates, updateCoverage } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'
import { latestPeriodSql } from '../../src/main/analytics/periods'

/** One row per day from `from` to `to` for cell 1 (CSSR 99, compliant). */
async function days(ws: RealWorkspace, from: string, to: string): Promise<number[]> {
  const range = `range(DATE '${from}', DATE '${to}' + INTERVAL 1 DAY, INTERVAL 1 DAY) r(d)`
  await ws.conn.run(
    `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
       dl_throughput_kbps, availability_pct, source_import_id)
     SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), 1, 50, 100, 10, 20000, 99.9, 1 FROM ${range}`
  )
  const r = await ws.conn.runAndReadAll(`SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER) AS id FROM ${range}`)
  return r.getRowObjects().map((x) => Number(x.id))
}

async function coverage(ws: RealWorkspace): Promise<Record<string, string>> {
  const r = await ws.conn.runAndReadAll(
    `SELECT grain || ' ' || CAST(period_start AS VARCHAR) AS k,
            days_with_data || '/' || days_in_period || (CASE WHEN is_complete THEN ' complete' ELSE ' partial' END) AS v
     FROM period_coverage`
  )
  return Object.fromEntries(r.getRowObjects().map((x) => [String(x.k), String(x.v)]))
}

async function latest(ws: RealWorkspace, grain: 'daily' | 'weekly' | 'monthly'): Promise<string> {
  const r = await ws.conn.runAndReadAll(`SELECT CAST(${latestPeriodSql(grain)} AS VARCHAR) AS p`)
  return String(r.getRowObjects()[0].p)
}

describe('period coverage (spec §2, §4.1)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('records how many days each week and month has; latest is the newest complete period', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['C1'])
    await days(ws, '2026-06-29', '2026-07-22') // Mon 29 Jun .. Wed 22 Jul
    await recomputeAllAggregates(ws.conn)
    const c = await coverage(ws)
    expect(c['weekly 2026-07-13']).toBe('7/7 complete')
    expect(c['weekly 2026-07-20']).toBe('3/7 partial')
    expect(c['monthly 2026-06-01']).toBe('2/30 partial')
    expect(c['monthly 2026-07-01']).toBe('22/31 partial')
    expect(await latest(ws, 'weekly')).toBe('2026-07-13')
    expect(await latest(ws, 'monthly')).toBe('2026-07-01') // no complete month: newest partial
    expect(await latest(ws, 'daily')).toBe('2026-07-22')
  })

  it('a dataset that starts mid-week has a partial first week that is never latest', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['C1'])
    await days(ws, '2026-07-01', '2026-07-19') // Wed 1 Jul .. Sun 19 Jul
    await recomputeAllAggregates(ws.conn)
    expect((await coverage(ws))['weekly 2026-06-29']).toBe('5/7 partial')
    expect(await latest(ws, 'weekly')).toBe('2026-07-13')
  })

  it('latest month is the previous full month while the current one is partial', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['C1'])
    await days(ws, '2026-06-01', '2026-07-10')
    await recomputeAllAggregates(ws.conn)
    expect((await coverage(ws))['monthly 2026-06-01']).toBe('30/30 complete')
    expect((await coverage(ws))['monthly 2026-07-01']).toBe('10/31 partial')
    expect(await latest(ws, 'monthly')).toBe('2026-06-01')
  })

  it('with too little data the latest week is the partial one', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['C1'])
    await days(ws, '2026-07-20', '2026-07-22')
    await recomputeAllAggregates(ws.conn)
    expect(await latest(ws, 'weekly')).toBe('2026-07-20')
  })

  it('an import that fills the missing days completes the week', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['C1'])
    await days(ws, '2026-06-29', '2026-07-22')
    await recomputeAllAggregates(ws.conn)
    const ids = await days(ws, '2026-07-23', '2026-07-26')
    await recomputeAggregates(ws.conn, ids)
    await updateCoverage(ws.conn, ids)
    expect((await coverage(ws))['weekly 2026-07-20']).toBe('7/7 complete')
    expect(await latest(ws, 'weekly')).toBe('2026-07-20')
  })

  it('an old workspace without period_coverage builds it on first open', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['C1'])
    await days(ws, '2026-06-29', '2026-07-22')
    await recomputeAllAggregates(ws.conn)
    await refreshAllIntelligence(ws.conn)
    await ws.conn.run(`DROP TABLE period_coverage`)
    await setSchemaVersion(ws.conn, 0) // a workspace without the table predates migration 1
    await ws.conn.run(`DELETE FROM workspace_meta WHERE key = 'nc_periods'`)
    const manager = await import('../../src/main/workspace/manager')
    await manager.closeWorkspace()
    await manager.openWorkspace(join(ws.dir, 'test.qosdb'))
    ws.conn = manager.getCurrent()!.connection
    expect((await coverage(ws))['weekly 2026-07-20']).toBe('3/7 partial')
  })
})
