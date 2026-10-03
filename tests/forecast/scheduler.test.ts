import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import type { RealWorkspace } from '../helpers/realWorkspace'
import { forecastWorkspace, count } from '../helpers/forecastData'
import {
  scheduleForecastRefresh, cancelForecastRefresh, forecastStatus, onForecastProgress, setDefaultRunnerFactory
} from '../../src/main/forecast/scheduler'
import { inProcessRunner, runJobs, type ForecastRunner } from '../../src/main/forecast/runner'

async function until(cond: () => Promise<boolean> | boolean, ms = 30000): Promise<void> {
  const t0 = Date.now()
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 25))
  }
}

async function meta(conn: RealWorkspace['conn'], key: string): Promise<string | null> {
  const r = await conn.runAndReadAll(`SELECT value FROM workspace_meta WHERE key = ?`, [key])
  const v = r.getRowObjects()[0]?.value
  return v == null ? null : String(v)
}

/** A runner whose batches wait until released; dispose rejects the waiting batch. */
function gatedRunner(): ForecastRunner & { started: () => boolean } {
  let reject: ((e: Error) => void) | null = null
  let started = false
  return {
    run: (jobs) => new Promise((resolve, rej) => {
      started = true
      reject = rej
      void jobs
    }),
    dispose: () => reject?.(new Error('disposed')),
    started: () => started
  }
}

describe('background forecast recompute (spec §6.1)', () => {
  let ws: RealWorkspace | null = null
  beforeEach(() => setDefaultRunnerFactory(() => inProcessRunner))
  afterEach(async () => {
    await cancelForecastRefresh()
    await ws?.cleanup()
    ws = null
  })

  it('a scheduled refresh stores forecasts and reports progress to the end', { timeout: 120000 }, async () => {
    ws = await forecastWorkspace()
    const seen: Array<[number, number]> = []
    const off = onForecastProgress((s) => seen.push([s.done, s.total]))
    scheduleForecastRefresh()
    await until(async () => (await meta(ws!.conn, 'forecasts_weekly_as_of')) != null && !forecastStatus().running)
    off()
    expect(await count(ws, `SELECT count(*) FROM cell_forecasts`)).toBeGreaterThan(0)
    const last = seen[seen.length - 1]
    expect(last[0]).toBe(last[1])
    expect(forecastStatus().asOf.weekly).toBe('2026-07-06')
  })

  it('closing the workspace cancels a running job, which is redone on the next run (Review Focus 4)', { timeout: 120000 }, async () => {
    ws = await forecastWorkspace()
    const mgr = await import('../../src/main/workspace/manager')
    const path = mgr.getCurrent()!.path
    const gated = gatedRunner()
    scheduleForecastRefresh(() => gated)
    await until(() => gated.started())
    expect(forecastStatus().running).toBe(true)
    await mgr.closeWorkspace() // must not hang on the gated batch
    expect(forecastStatus().running).toBe(false)
    await mgr.openWorkspace(path)
    ws.conn = mgr.getCurrent()!.connection
    expect(await meta(ws.conn, 'forecasts_weekly_as_of')).toBeNull()
    scheduleForecastRefresh()
    await until(async () => (await meta(ws!.conn, 'forecasts_weekly_as_of')) != null && !forecastStatus().running)
    expect(await meta(ws.conn, 'forecasts_weekly_as_of')).toBe('2026-07-06')
  })

  it('a schedule during a run leads to one final consistent state', { timeout: 120000 }, async () => {
    ws = await forecastWorkspace()
    scheduleForecastRefresh()
    scheduleForecastRefresh()
    await until(async () => (await meta(ws!.conn, 'forecasts_weekly_as_of')) != null && !forecastStatus().running)
    await new Promise((r) => setTimeout(r, 200))
    expect(forecastStatus().running).toBe(false)
    const keys = await count(ws, `SELECT count(DISTINCT kpi_key) FROM cell_forecasts WHERE grain = 'weekly'`)
    expect(await count(ws, `SELECT count(*) FROM cell_forecasts WHERE grain = 'weekly'`)).toBe(3 * keys)
  })

  it('a read-only workspace never runs the job', { timeout: 120000 }, async () => {
    ws = await forecastWorkspace()
    const mgr = await import('../../src/main/workspace/manager')
    const path = mgr.getCurrent()!.path
    await mgr.closeWorkspace()
    await mgr.openWorkspace(path, { readOnly: true })
    ws.conn = mgr.getCurrent()!.connection
    scheduleForecastRefresh(() => ({ run: async (j) => runJobs(j), dispose: () => {} }))
    await new Promise((r) => setTimeout(r, 300))
    expect(forecastStatus().running).toBe(false)
    expect(await count(ws, `SELECT count(*) FROM cell_forecasts`)).toBe(0)
  })
})
