import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { fillDays, rebuild, setTarget, count, forecastWorkspace } from '../helpers/forecastData'
import { getForecast } from '../../src/main/services/forecastService'
import { planForecastJob, runForecastJob } from '../../src/main/forecast/job'
import { inProcessRunner, type ForecastRunner } from '../../src/main/forecast/runner'
import {
  scheduleForecastRefresh, cancelForecastRefresh, forecastStatus, setDefaultRunnerFactory
} from '../../src/main/forecast/scheduler'
import { runMaintenance } from '../../src/main/services/maintenanceService'

/** Fixes from the final whole-branch review of the honest-forecasting work. */
const CSSR = 'call_setup_success_4g'

async function meta(conn: RealWorkspace['conn'], key: string): Promise<string | null> {
  const r = await conn.runAndReadAll(`SELECT value FROM workspace_meta WHERE key = ?`, [key])
  const v = r.getRowObjects()[0]?.value
  return v == null ? null : String(v)
}
async function until(cond: () => Promise<boolean> | boolean, ms = 30000): Promise<void> {
  const t0 = Date.now()
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe('final review fixes', () => {
  let ws: RealWorkspace | null = null
  beforeEach(() => setDefaultRunnerFactory(() => inProcessRunner))
  afterEach(async () => {
    await cancelForecastRefresh()
    await ws?.cleanup()
    ws = null
  })

  it('#1 a read-only workspace with the old cell_forecasts shape still forecasts and says not built', { timeout: 120000 }, async () => {
    ws = await forecastWorkspace()
    const mgr = await import('../../src/main/workspace/manager')
    const path = mgr.getCurrent()!.path
    await ws.conn.run('DROP TABLE cell_forecasts')
    await ws.conn.run(`CREATE TABLE cell_forecasts (cell_id BIGINT, metric VARCHAR, horizon VARCHAR, as_of DATE,
      method VARCHAR, forecast JSON, lower_bound DOUBLE, upper_bound DOUBLE, mae DOUBLE, rmse DOUBLE,
      quality VARCHAR, risk VARCHAR, PRIMARY KEY (cell_id, metric, horizon, as_of))`)
    await mgr.closeWorkspace()
    await mgr.openWorkspace(path, { readOnly: true })
    ws.conn = mgr.getCurrent()!.connection
    const r = await getForecast({ metric: CSSR, technology: '4G' })
    expect(r.riskTableNote).toBe('Per-cell forecasts not built — open the workspace writable once')
    expect(r.series!.forecast.quality).not.toBe('Withheld')
  })

  it('#2 a cancelled "KPI gained a target" run is completed by the next plan', { timeout: 120000 }, async () => {
    ws = await forecastWorkspace()
    await runForecastJob(ws.conn, await planForecastJob(ws.conn), inProcessRunner)
    await setTarget(ws, 'l_erab_abnormrel', 5)
    const ctl = new AbortController()
    const r = await runForecastJob(ws.conn, await planForecastJob(ws.conn), inProcessRunner, {
      batchCells: 1,
      signal: ctl.signal,
      onProgress: (done) => { if (done >= 1) ctl.abort() }
    })
    expect(r.cancelled).toBe(true)
    expect(await count(ws, `SELECT count(*) FROM cell_forecasts WHERE kpi_key = 'l_erab_abnormrel' AND grain = 'weekly'`)).toBe(1)
    const plans = await planForecastJob(ws.conn)
    expect(plans.some((p) => p.grain === 'weekly' && p.cellIds === 'all' && p.kpiKeys.includes('l_erab_abnormrel'))).toBe(true)
  })

  it('#3 maintenance cancels a running recompute first and recomputes afterwards', { timeout: 120000 }, async () => {
    ws = await forecastWorkspace()
    let started = false
    let rejectRun: ((e: Error) => void) | null = null
    const gated: ForecastRunner = {
      run: () => new Promise((_res, rej) => { started = true; rejectRun = rej }),
      dispose: () => rejectRun?.(new Error('disposed'))
    }
    scheduleForecastRefresh(() => gated)
    await until(() => started)
    await runMaintenance('rebuild') // must not wait on the gated job
    await until(async () => (await meta(ws!.conn, 'forecasts_weekly_as_of')) === '2026-07-06' && !forecastStatus().running)
    expect(await count(ws, `SELECT count(*) FROM cell_forecasts WHERE grain = 'weekly'`)).toBeGreaterThan(0)
  })

  it('#4 a cancel that arrives while the job is planning cancels it', { timeout: 120000 }, async () => {
    ws = await forecastWorkspace()
    scheduleForecastRefresh()
    await cancelForecastRefresh()
    expect(await meta(ws.conn, 'forecasts_weekly_as_of')).toBeNull()
    expect(await count(ws, `SELECT count(*) FROM cell_forecasts`)).toBe(0)
  })

  it('#5 within a risk class the worst cell comes first, also for higher-is-better KPIs', { timeout: 120000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1', 'C2', 'C3'])
    await setTarget(ws, CSSR, 98.5)
    const cssr: Record<number, number> = { 1: 98.2, 2: 97.0, 3: 98.0 }
    for (const id of [1, 2, 3]) await fillDays(ws, id, '2026-05-04', '2026-07-12', { prb: 50 }, { [CSSR]: cssr[id] })
    await rebuild(ws)
    await runForecastJob(ws.conn, await planForecastJob(ws.conn), inProcessRunner)
    const r = await getForecast({ metric: CSSR, technology: '4G' })
    expect(r.riskRows.map((x) => x.name)).toEqual(['C2', 'C3', 'C1'])
  })

  it('#6 the risk × hint cross-tab is counted from the rows, Withheld included', { timeout: 120000 }, async () => {
    ws = await forecastWorkspace({ cell3Until: '2026-07-05' })
    await runForecastJob(ws.conn, await planForecastJob(ws.conn), inProcessRunner)
    const r = await getForecast({ metric: CSSR, technology: '4G' })
    const total = Object.values(r.riskByHint).flatMap((m) => Object.values(m)).reduce((a, b) => a + b, 0)
    expect(total).toBe(r.totalEntities)
    expect(Object.values(r.riskByHint.Withheld ?? {}).reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('#7 at cell scope the risk row uses the chart\'s forecast; elsewhere a stale stored as-of is reported', { timeout: 120000 }, async () => {
    ws = await forecastWorkspace()
    await runForecastJob(ws.conn, await planForecastJob(ws.conn), inProcessRunner) // stored as of 06/07
    for (const id of [1, 2, 3]) {
      await fillDays(ws, id, '2026-07-13', '2026-07-19', { prb: 80, users: 10 }, { [CSSR]: 97.0, l_erab_abnormrel: 3 })
    }
    await rebuild(ws) // latest complete week is now 13/07; stored forecasts are not recomputed
    const cell = await getForecast({ scope: 'cell', entityId: 1, metric: CSSR, technology: '4G', horizon: 4 })
    const chartAtH = cell.series!.points.filter((p) => p.kind === 'forecast').pop()!.value
    expect(cell.riskRows[0].forecast).toBe(chartAtH)
    const net = await getForecast({ metric: CSSR, technology: '4G' })
    expect(net.asOf).toBe('2026-07-13')
    expect(net.storedAsOf).toBe('2026-07-06')
  })
})
