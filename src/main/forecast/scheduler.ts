import type { ForecastStatus } from '../../../shared/api'
import { getCurrent, onBeforeClose } from '../workspace/manager'
import { planForecastJob, runForecastJob } from './job'
import { inProcessRunner, type ForecastRunner } from './runner'

/** Background recompute of stored forecasts (honest-forecasting spec §6.1).
 *  One job at a time on the open writable workspace; a schedule during a run
 *  queues one more pass; closing the workspace cancels the run first. */

let defaultFactory: () => ForecastRunner = () => inProcessRunner
let running: Promise<void> | null = null
let rerun = false
let controller: AbortController | null = null
let activeRunner: ForecastRunner | null = null
const status: ForecastStatus = { running: false, done: 0, total: 0, asOf: { weekly: null, monthly: null } }
const listeners = new Set<(s: ForecastStatus) => void>()

export function setDefaultRunnerFactory(f: () => ForecastRunner): void {
  defaultFactory = f
}

export function forecastStatus(): ForecastStatus {
  return { ...status, asOf: { ...status.asOf } }
}

export function onForecastProgress(fn: (s: ForecastStatus) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(): void {
  const s = forecastStatus()
  for (const fn of listeners) {
    try {
      fn(s)
    } catch {
      /* a listener never stops the job */
    }
  }
}

async function readAsOf(): Promise<void> {
  const ws = getCurrent()
  if (!ws) return
  const r = await ws.connection.runAndReadAll(
    `SELECT key, value FROM workspace_meta WHERE key IN ('forecasts_weekly_as_of', 'forecasts_monthly_as_of')`
  )
  const m = new Map(r.getRowObjects().map((x) => [String(x.key), String(x.value)]))
  status.asOf = { weekly: m.get('forecasts_weekly_as_of') ?? null, monthly: m.get('forecasts_monthly_as_of') ?? null }
}

async function loop(factory: () => ForecastRunner): Promise<void> {
  do {
    rerun = false
    const ws = getCurrent()
    if (!ws || ws.readOnly) return
    // the controller exists before planning so a cancel during planning
    // (which scans the fact tables) stops the job too (final review #4)
    const ctl = new AbortController()
    controller = ctl
    const plans = await planForecastJob(ws.connection)
    if (ctl.signal.aborted) {
      controller = null
      emit()
      return
    }
    if (plans.length === 0) {
      controller = null
      await readAsOf()
      emit()
      continue
    }
    const runner = factory()
    activeRunner = runner
    status.running = true
    status.done = 0
    status.total = 0
    emit()
    try {
      await runForecastJob(ws.connection, plans, runner, {
        signal: ctl.signal,
        onProgress: (done, total) => {
          status.done = done
          status.total = total
          emit()
        }
      })
    } catch (e) {
      if (!ctl.signal.aborted) console.error('[forecast] background recompute failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      runner.dispose()
      controller = null
      activeRunner = null
      status.running = false
    }
    if (ctl.signal.aborted) {
      emit()
      return
    }
    await readAsOf()
    emit()
  } while (rerun)
}

/** Start (or queue one more pass of) the background recompute. No-op without
 *  an open writable workspace. */
export function scheduleForecastRefresh(runnerFactory?: () => ForecastRunner): void {
  const ws = getCurrent()
  if (!ws || ws.readOnly) return
  if (running) {
    rerun = true
    return
  }
  running = loop(runnerFactory ?? defaultFactory).finally(() => {
    running = null
  })
}

/** Stop a running recompute and wait for it to end. */
export async function cancelForecastRefresh(): Promise<void> {
  if (!running) return
  rerun = false
  controller?.abort()
  activeRunner?.dispose()
  await running.catch(() => undefined)
}

onBeforeClose(cancelForecastRefresh)
