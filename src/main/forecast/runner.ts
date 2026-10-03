import { forecastSeries, type ForecastOptions, type SeriesForecast } from '../analytics/forecasting/engine'

/** Where forecast series are computed: in-process (tests, small on-demand
 *  work) or a pool of Electron utility processes (utilityRunner.ts). Jobs and
 *  results are plain data so they cross process boundaries unchanged. */

export interface SeriesJob { id: number; values: number[]; dates: string[]; opts: ForecastOptions }

export interface ForecastRunner {
  run(jobs: SeriesJob[]): Promise<SeriesForecast[]>
  dispose(): void
}

export function runJobs(jobs: SeriesJob[]): SeriesForecast[] {
  return jobs.map((j) => forecastSeries(j.values, j.dates, j.opts))
}

export const inProcessRunner: ForecastRunner = {
  run: async (jobs) => runJobs(jobs),
  dispose: () => {}
}
