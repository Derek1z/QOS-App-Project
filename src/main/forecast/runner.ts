import { forecastSeries, NO_BAND_NOTE, type ForecastOptions, type SeriesForecast } from '../analytics/forecasting/engine'

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

// --- packed transfer for the process pool -----------------------------------
// One Float64Array of values (plus offsets) out, one Float64Array of results
// back: a structured clone of a typed array is a single copy, where an object
// per series cost more than the forecasting itself (bench 2026-10-03).

const METHODS: Array<NonNullable<SeriesForecast['method']>> = ['naive', 'drift', 'seasonal-naive', 'damped-holt', 'holt-winters']
const QUALITIES: Array<SeriesForecast['quality']> = ['Good', 'Fair', 'Naive only', 'Withheld']

export interface PackedJobs {
  values: Float64Array
  /** job i's values are values[offsets[i] .. offsets[i + 1]) */
  offsets: Int32Array
  opts: ForecastOptions[]
  optsIndex: Int32Array
  /** dates only for the jobs that carry them (daily series) */
  dates: Record<number, string[]>
}

export interface PackedResults {
  data: Float64Array
  /** result i starts at data[offsets[i]] */
  offsets: Int32Array
  reasons: Record<number, string>
}

export function packJobs(jobs: SeriesJob[]): PackedJobs {
  const offsets = new Int32Array(jobs.length + 1)
  for (let i = 0; i < jobs.length; i++) offsets[i + 1] = offsets[i] + jobs[i].values.length
  const values = new Float64Array(offsets[jobs.length])
  const opts: ForecastOptions[] = []
  const optsKey = new Map<string, number>()
  const optsIndex = new Int32Array(jobs.length)
  const dates: Record<number, string[]> = {}
  jobs.forEach((j, i) => {
    values.set(j.values, offsets[i])
    const key = `${j.opts.grain}|${j.opts.horizon}|${j.opts.domain}|${j.opts.periodNoun}`
    let k = optsKey.get(key)
    if (k == null) {
      k = opts.length
      opts.push(j.opts)
      optsKey.set(key, k)
    }
    optsIndex[i] = k
    if (j.dates.length > 0) dates[i] = j.dates
  })
  return { values, offsets, opts, optsIndex, dates }
}

const nanIfNull = (v: number | null): number => (v == null ? NaN : v)
const nullIfNan = (v: number): number | null => (Number.isNaN(v) ? null : v)

/** Runs packed jobs; layout per result: method, quality, mase, origins,
 *  nPoints, nMae, then nPoints × (value, lower, upper), then nMae × mae. */
export function runPacked(p: PackedJobs): PackedResults {
  const n = p.optsIndex.length
  const out: number[] = []
  const offsets = new Int32Array(n + 1)
  const reasons: Record<number, string> = {}
  for (let i = 0; i < n; i++) {
    const values = Array.from(p.values.subarray(p.offsets[i], p.offsets[i + 1]))
    const f = forecastSeries(values, p.dates[i] ?? [], p.opts[p.optsIndex[i]])
    offsets[i] = out.length
    out.push(f.method == null ? -1 : METHODS.indexOf(f.method), QUALITIES.indexOf(f.quality), nanIfNull(f.mase), f.backtestOrigins, f.points.length, f.maeByH.length)
    for (const pt of f.points) out.push(pt.value, nanIfNull(pt.lower), nanIfNull(pt.upper))
    for (const m of f.maeByH) out.push(nanIfNull(m))
    if (f.withheldReason != null) reasons[i] = f.withheldReason
  }
  offsets[n] = out.length
  return { data: Float64Array.from(out), offsets, reasons }
}

export function unpackResults(r: PackedResults): SeriesForecast[] {
  const n = r.offsets.length - 1
  const res: SeriesForecast[] = []
  for (let i = 0; i < n; i++) {
    const d = r.data
    let o = r.offsets[i]
    const method = d[o] < 0 ? null : METHODS[d[o]]
    const quality = QUALITIES[d[o + 1]]
    const mase = nullIfNan(d[o + 2])
    const backtestOrigins = d[o + 3]
    const nPoints = d[o + 4]
    const nMae = d[o + 5]
    o += 6
    const points = []
    for (let h = 1; h <= nPoints; h++, o += 3) points.push({ h, value: d[o], lower: nullIfNan(d[o + 1]), upper: nullIfNan(d[o + 2]) })
    const maeByH: Array<number | null> = []
    for (let k = 0; k < nMae; k++, o++) maeByH.push(nullIfNan(d[o]))
    res.push({
      method, quality, points, maeByH, mase, backtestOrigins,
      withheldReason: r.reasons[i] ?? null,
      bandNote: points.some((pt) => pt.lower == null) ? NO_BAND_NOTE : null
    })
  }
  return res
}
