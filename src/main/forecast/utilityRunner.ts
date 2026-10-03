import os from 'node:os'
import { utilityProcess, type UtilityProcess } from 'electron'
import forecastWorkerPath from './forecastWorker?modulePath'
import type { SeriesForecast } from '../analytics/forecasting/engine'
import type { ForecastRunner, SeriesJob } from './runner'

/** A pool of Electron utility processes running the forecast engine — the
 *  mechanism the import uses (2026-10-02), so a packaged build resolves the
 *  worker script the same way. Each run() call is split across the pool;
 *  dispose() kills the processes and rejects any run in flight. */
export function createUtilityRunner(size = Math.max(1, os.cpus().length - 1)): ForecastRunner {
  let pool: UtilityProcess[] | null = null
  let nextId = 0
  const pending = new Map<number, { resolve: (r: SeriesForecast[]) => void; reject: (e: Error) => void }>()

  const failAll = (e: Error): void => {
    for (const p of pending.values()) p.reject(e)
    pending.clear()
  }

  const start = (): UtilityProcess[] => {
    if (pool) return pool
    pool = Array.from({ length: size }, () => {
      const child = utilityProcess.fork(forecastWorkerPath, [], { serviceName: 'QoS forecast', stdio: 'inherit' })
      child.on('message', (msg: { id: number; results?: SeriesForecast[]; error?: string }) => {
        const p = pending.get(msg.id)
        if (!p) return
        pending.delete(msg.id)
        if (msg.error != null) p.reject(new Error(msg.error))
        else p.resolve(msg.results ?? [])
      })
      child.on('exit', (code) => {
        if (pool) failAll(new Error(`Forecast process exited with code ${code}`))
      })
      return child
    })
    return pool
  }

  const send = (child: UtilityProcess, jobs: SeriesJob[]): Promise<SeriesForecast[]> =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      child.postMessage({ id, jobs })
    })

  return {
    async run(jobs) {
      if (jobs.length === 0) return []
      const children = start()
      const per = Math.ceil(jobs.length / children.length)
      const parts = await Promise.all(
        children.map((c, i) => {
          const slice = jobs.slice(i * per, (i + 1) * per)
          return slice.length === 0 ? Promise.resolve([]) : send(c, slice)
        })
      )
      return parts.flat()
    },
    dispose() {
      const p = pool
      pool = null
      failAll(new Error('Forecast pool disposed'))
      for (const c of p ?? []) c.kill()
    }
  }
}
