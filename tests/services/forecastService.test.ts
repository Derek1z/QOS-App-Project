import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { fillDays, rebuild, setTarget, count, forecastWorkspace } from '../helpers/forecastData'
import { getForecast } from '../../src/main/services/forecastService'
import { planForecastJob, runForecastJob } from '../../src/main/forecast/job'
import { inProcessRunner } from '../../src/main/forecast/runner'
import { saveKpiTargets } from '../../src/main/services/targetService'

const CSSR = 'call_setup_success_4g'

async function storeForecasts(ws: RealWorkspace): Promise<void> {
  await runForecastJob(ws.conn, await planForecastJob(ws.conn), inProcessRunner)
}

describe('forecast service on real KPI series (spec §9, tests 10–16)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('forecasts the imported CSSR, not a formula of PRB (spec test 10)', { timeout: 120000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1'])
    // 12 complete weeks (Mon 20/04 .. Sun 12/07/2026): CSSR falls 99.0 → 97.9, PRB flat
    await fillDays(ws, 1, '2026-04-20', '2026-07-12', { prb: 50 }, { [CSSR]: `99.0 - i * (1.1 / 83)` })
    await rebuild(ws)
    const r = await getForecast({ scope: 'cell', entityId: 1, metric: CSSR, grain: 'weekly', horizon: 4, technology: '4G' })
    const s = r.series!
    expect(r.metric).toBe(CSSR)
    expect(s.forecast.method).not.toBe('naive')
    const actual = s.points.filter((p) => p.kind === 'actual' && p.value != null)
    const fc4 = s.points.filter((p) => p.kind === 'forecast')[3]
    expect(fc4.value!).toBeLessThan(actual[actual.length - 1].value!)
  })

  it('a KPI that was not imported is listed, not offered, and not forecast (spec test 11)', { timeout: 120000 }, async () => {
    ws = await forecastWorkspace()
    const r = await getForecast({ metric: 'data_service_failure_4g', technology: '4G' })
    expect(r.notImported.map((k) => k.key)).toContain('data_service_failure_4g')
    expect(r.metrics.map((k) => k.key)).not.toContain('data_service_failure_4g')
    expect(r.metric).not.toBe('data_service_failure_4g')
    expect(r.metrics.map((k) => k.key)).toContain(r.metric)
  })

  it('a partial week is drawn, marked, and not fitted (spec test 12)', { timeout: 120000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1'])
    await fillDays(ws, 1, '2026-05-04', '2026-07-15', { prb: 50 }, { [CSSR]: 99 }) // ends Wed 15/07
    await rebuild(ws)
    const r = await getForecast({ metric: CSSR, grain: 'weekly', technology: '4G' })
    const actual = r.series!.points.filter((p) => p.kind === 'actual')
    expect(actual[actual.length - 1]).toMatchObject({ weekStart: '2026-07-13', complete: false, daysWithData: 3 })
    expect(r.asOf).toBe('2026-07-06')
    expect(r.series!.points.find((p) => p.kind === 'forecast')!.weekStart).toBe('2026-07-13')
  })

  it('the threshold comes from kpi_defs; a target change moves risk without recomputing (spec test 13)', { timeout: 120000 }, async () => {
    ws = await forecastWorkspace()
    await storeForecasts(ws)
    const before = await getForecast({ metric: CSSR, technology: '4G' })
    expect(before.series!.threshold).toBe(98.5)
    expect(before.riskRows.every((r) => r.risk !== 'Already Breached')).toBe(true)
    const rowsBefore = await count(ws, `SELECT count(*) FROM cell_forecasts`)
    const pointsBefore = (await ws.conn.runAndReadAll(
      `SELECT CAST(points AS VARCHAR) AS p FROM cell_forecasts WHERE cell_id = 1 AND kpi_key = '${CSSR}' AND grain = 'weekly'`
    )).getRowObjects()[0].p
    await saveKpiTargets(ws.conn, [{ technology: '4G', key: CSSR, target: 99.9 }])
    const after = await getForecast({ metric: CSSR, technology: '4G' })
    expect(after.series!.threshold).toBe(99.9)
    expect(after.riskRows.every((r) => r.risk === 'Already Breached')).toBe(true)
    expect(await count(ws, `SELECT count(*) FROM cell_forecasts`)).toBe(rowsBefore)
    const pointsAfter = (await ws.conn.runAndReadAll(
      `SELECT CAST(points AS VARCHAR) AS p FROM cell_forecasts WHERE cell_id = 1 AND kpi_key = '${CSSR}' AND grain = 'weekly'`
    )).getRowObjects()[0].p
    expect(pointsAfter).toBe(pointsBefore)
  })

  it('every one of 160 cells gets its risk from a stored forecast (spec test 14)', { timeout: 180000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, Array.from({ length: 160 }, (_, i) => `C${i + 1}`))
    await setTarget(ws, CSSR, 98.5)
    const range = `range(DATE '2026-05-18', DATE '2026-07-13', INTERVAL 1 DAY) r(d), range(1, 161) c(cell)`
    await ws.conn.run(
      `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
         dl_throughput_kbps, availability_pct, source_import_id)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), cell, 50, 100, 10, NULL, NULL, 1 FROM ${range}`
    )
    await ws.conn.run(
      `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), cell, k.kpi_id, 99 + (cell % 7) * 0.05
       FROM ${range}, kpi_defs k WHERE k.technology = '4G' AND k.kpi_key = '${CSSR}'`
    )
    await rebuild(ws)
    await storeForecasts(ws)
    const r = await getForecast({ metric: CSSR, technology: '4G' })
    expect(r.totalEntities).toBe(160)
    expect(r.riskCounts.Withheld).toBe(0)
    expect(Object.values(r.riskCounts).reduce((a, b) => a + b, 0)).toBe(160)
    expect(r.riskRows.some((row) => row.explanation.includes('stable within target'))).toBe(false)
    expect(r.riskRows.length).toBe(100)
  })

  it('aggregates: mean for rates, total for sums, cells over target (spec test 15)', { timeout: 120000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1', 'C2'])
    await setTarget(ws, CSSR, 98.5)
    await fillDays(ws, 1, '2026-05-04', '2026-07-12', { volume: 100, prb: 50 }, { [CSSR]: 98 })
    await fillDays(ws, 2, '2026-05-04', '2026-07-12', { volume: 300, prb: 50 }, { [CSSR]: 99 })
    await rebuild(ws)
    const r = await getForecast({ metric: CSSR, technology: '4G' })
    const firstActual = r.series!.points.find((p) => p.kind === 'actual')!
    expect(firstActual.value).toBeCloseTo(98.5, 6)
    expect(r.overTarget!.points.find((p) => p.kind === 'actual')!.value).toBe(1)
    const vol = await getForecast({ metric: 'data_volume', technology: '4G' })
    expect(vol.series!.points.find((p) => p.kind === 'actual')!.value).toBe(2800)
    expect(vol.overTarget).toBeNull()
  })

  it('read-only without stored forecasts says so and still forecasts the aggregate (spec test 16)', { timeout: 120000 }, async () => {
    ws = await forecastWorkspace()
    const mgr = await import('../../src/main/workspace/manager')
    const path = mgr.getCurrent()!.path
    await mgr.closeWorkspace()
    await mgr.openWorkspace(path, { readOnly: true })
    ws.conn = mgr.getCurrent()!.connection
    const r = await getForecast({ metric: CSSR, technology: '4G' })
    expect(r.riskTableNote).toBe('Per-cell forecasts not built — open the workspace writable once')
    expect(r.riskRows).toEqual([])
    expect(r.series!.forecast.quality).not.toBe('Withheld')
  })

  it('daily per-cell risk only at site or cell scope', { timeout: 120000 }, async () => {
    ws = await forecastWorkspace()
    const district = await getForecast({ metric: CSSR, grain: 'daily', scope: 'district', entityId: 1, technology: '4G' })
    expect(district.riskTableNote).toBe('Per-cell daily risk is available for a site or cell — or switch to weekly')
    expect(district.riskRows).toEqual([])
    const cell = await getForecast({ metric: CSSR, grain: 'daily', scope: 'cell', entityId: 1, technology: '4G' })
    expect(cell.riskRows).toHaveLength(1)
    expect(cell.riskTableNote).toBeNull()
  })

  it('no complete period: everything withheld, nothing thrown (Review Focus 3)', { timeout: 120000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1'])
    await fillDays(ws, 1, '2026-07-06', '2026-07-10', { prb: 50 }, { [CSSR]: 99 })
    await rebuild(ws)
    const r = await getForecast({ metric: CSSR, technology: '4G' })
    expect(r.series!.forecast.quality).toBe('Withheld')
    expect(r.series!.forecast.withheldReason).toContain('has 0')
    expect(r.riskRows).toEqual([])
    expect(r.asOf).toBeNull()
  })

  it('horizons longer than the history can backtest are unavailable, with the reason', { timeout: 120000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['C1'])
    await fillDays(ws, 1, '2026-06-01', '2026-07-12', { prb: 50 }, { [CSSR]: 99 }) // 6 complete weeks
    await rebuild(ws)
    const r = await getForecast({ metric: CSSR, technology: '4G', horizon: 12 })
    const h = Object.fromEntries(r.horizons.map((x) => [x.horizon, x]))
    expect(h[1].available).toBe(true)
    expect(h[2].available).toBe(true)
    expect(h[4]).toMatchObject({ available: false, reason: 'needs ≥ 7 complete weeks' })
    expect(r.horizon).toBe(2)
  })
})
