import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, setSchemaVersion, type RealWorkspace } from '../helpers/realWorkspace'
import { fillDays, rebuild, setTarget, count, forecastWorkspace } from '../helpers/forecastData'
import {
  planForecastJob, runForecastJob, markForecastDirty, storedForecastKpis, readStoredForecasts
} from '../../src/main/forecast/job'
import { inProcessRunner } from '../../src/main/forecast/runner'

const setup = forecastWorkspace

const meta = async (ws: RealWorkspace, key: string): Promise<string | null> => {
  const r = await ws.conn.runAndReadAll(`SELECT value FROM workspace_meta WHERE key = ?`, [key])
  const v = r.getRowObjects()[0]?.value
  return v == null ? null : String(v)
}

describe('stored per-cell forecasts (spec §6.1)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('first run stores every cell × stored KPI for weekly and monthly', { timeout: 120000 }, async () => {
    ws = await setup()
    const keys = (await storedForecastKpis(ws.conn, '4G')).map((k) => k.key)
    expect(keys).toEqual(expect.arrayContaining(['call_setup_success_4g', 'prb_utilization', 'connected_users']))
    expect(keys).not.toContain('l_erab_abnormrel') // spec test 21: counter without a target is not stored
    let lastProgress = [0, 0]
    const res = await runForecastJob(ws.conn, await planForecastJob(ws.conn), inProcessRunner, {
      onProgress: (d, t) => { lastProgress = [d, t] }
    })
    expect(res.cancelled).toBe(false)
    expect(lastProgress[0]).toBe(lastProgress[1])
    expect(await count(ws, `SELECT count(*) FROM cell_forecasts WHERE grain = 'weekly'`)).toBe(3 * keys.length)
    expect(await count(ws, `SELECT count(*) FROM cell_forecasts WHERE grain = 'monthly'`)).toBe(3 * keys.length)
    expect(await meta(ws, 'forecasts_weekly_as_of')).toBe('2026-07-06')
    const stored = await readStoredForecasts(ws.conn, 'weekly', 'call_setup_success_4g', 'all')
    const f = stored.get(1)!
    expect(f.asOf).toBe('2026-07-06')
    expect(f.forecast.quality).not.toBe('Withheld')
    expect(f.forecast.points).toHaveLength(12)
  })

  it('a run with no data change plans nothing (spec test 20)', { timeout: 120000 }, async () => {
    ws = await setup()
    await runForecastJob(ws.conn, await planForecastJob(ws.conn), inProcessRunner)
    expect(await planForecastJob(ws.conn)).toEqual([])
  })

  it('a backfill into a complete week recomputes only the touched cells', { timeout: 120000 }, async () => {
    ws = await setup()
    await runForecastJob(ws.conn, await planForecastJob(ws.conn), inProcessRunner)
    await ws.conn.run(`UPDATE fact_extra_metrics SET value = 90 WHERE cell_id = 2 AND date_id = 20260610`)
    await rebuild(ws)
    await markForecastDirty(ws.conn, [20260610], [2])
    const weekly = (await planForecastJob(ws.conn)).filter((p) => p.grain === 'weekly')
    expect(weekly).toHaveLength(1)
    expect(weekly[0].cellIds).toEqual([2])
  })

  it('a newly completed week recomputes every cell', { timeout: 120000 }, async () => {
    ws = await setup()
    await runForecastJob(ws.conn, await planForecastJob(ws.conn), inProcessRunner)
    for (const id of [1, 2, 3]) {
      await fillDays(ws, id, '2026-07-13', '2026-07-19', { prb: 60, users: 10 }, { call_setup_success_4g: 99, l_erab_abnormrel: 3 })
    }
    await rebuild(ws)
    const weekly = (await planForecastJob(ws.conn)).filter((p) => p.grain === 'weekly')
    expect(weekly[0]).toMatchObject({ cellIds: 'all', asOf: '2026-07-13' })
  })

  it('a KPI that gains a target is added for every cell (spec test 20)', { timeout: 120000 }, async () => {
    ws = await setup()
    await runForecastJob(ws.conn, await planForecastJob(ws.conn), inProcessRunner)
    await setTarget(ws, 'l_erab_abnormrel', 5)
    const plans = await planForecastJob(ws.conn)
    expect(plans.some((p) => p.grain === 'weekly' && p.cellIds === 'all' && p.kpiKeys.includes('l_erab_abnormrel'))).toBe(true)
    await runForecastJob(ws.conn, plans, inProcessRunner)
    expect(await count(ws, `SELECT count(*) FROM cell_forecasts WHERE kpi_key = 'l_erab_abnormrel' AND grain = 'weekly'`)).toBe(3)
  })

  it('a KPI whose target is cleared loses its stored rows (Review Focus 5)', { timeout: 120000 }, async () => {
    ws = await setup()
    await runForecastJob(ws.conn, await planForecastJob(ws.conn), inProcessRunner)
    await setTarget(ws, 'call_setup_success_4g', null)
    const plans = await planForecastJob(ws.conn)
    expect(plans.some((p) => p.deleteKpiKeys.includes('call_setup_success_4g'))).toBe(true)
    await runForecastJob(ws.conn, plans, inProcessRunner)
    expect(await count(ws, `SELECT count(*) FROM cell_forecasts WHERE kpi_key = 'call_setup_success_4g'`)).toBe(0)
  })

  it('a cell with no data in the latest complete week is withheld, not forecast from stale data (Review Focus 2)', { timeout: 120000 }, async () => {
    ws = await setup({ cell3Until: '2026-07-05' })
    await runForecastJob(ws.conn, await planForecastJob(ws.conn), inProcessRunner)
    const f = (await readStoredForecasts(ws.conn, 'weekly', 'call_setup_success_4g', [3])).get(3)!
    expect(f.forecast.quality).toBe('Withheld')
    expect(f.forecast.withheldReason).toBe('no data since 29/06/2026')
    expect(f.forecast.points).toEqual([])
  })

  it('an old-shape cell_forecasts table is replaced on writable open', { timeout: 120000 }, async () => {
    ws = await openRealWorkspace('4G')
    const mgr = await import('../../src/main/workspace/manager')
    const path = mgr.getCurrent()!.path
    await ws.conn.run('DROP TABLE cell_forecasts')
    await ws.conn.run(`CREATE TABLE cell_forecasts (cell_id BIGINT, metric VARCHAR, horizon VARCHAR, as_of DATE,
      method VARCHAR, forecast JSON, lower_bound DOUBLE, upper_bound DOUBLE, mae DOUBLE, rmse DOUBLE,
      quality VARCHAR, risk VARCHAR, PRIMARY KEY (cell_id, metric, horizon, as_of))`)
    await setSchemaVersion(ws.conn, 0) // the old-shape table predates migration 1
    await mgr.closeWorkspace()
    await mgr.openWorkspace(path)
    const cols = (await mgr.getCurrent()!.connection.runAndReadAll(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'cell_forecasts'`
    )).getRowObjects().map((x) => String(x.column_name))
    expect(cols).toEqual(expect.arrayContaining(['kpi_key', 'grain', 'points', 'mase']))
    expect(cols).not.toContain('metric')
    ws.conn = mgr.getCurrent()!.connection
  })
})
