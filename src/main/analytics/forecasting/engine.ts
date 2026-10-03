import {
  holtGrid, holtForecast, holtWintersGrid, holtWintersForecast,
  naiveForecast, driftForecast, seasonalNaiveForecast
} from './models'

/** Forecast engine (spec §5): rolling-origin backtest, selection by MASE
 *  against naive, empirical bands, withheld and quality. Pure, no I/O. */

export type ModelId = 'naive' | 'drift' | 'seasonal-naive' | 'damped-holt' | 'holt-winters'
export type EngineQuality = 'Good' | 'Fair' | 'Naive only' | 'Withheld'
export type UnitDomain = 'percent' | 'nonNegative' | 'none'

export interface HorizonPoint { h: number; value: number; lower: number | null; upper: number | null }

export interface ForecastOptions {
  grain: 'daily' | 'weekly' | 'monthly'
  /** H, in periods of the grain */
  horizon: number
  domain: UnitDomain
  /** plural period noun for the withheld reason, e.g. 'weeks' */
  periodNoun: string
}

export interface SeriesForecast {
  method: ModelId | null
  quality: EngineQuality
  points: HorizonPoint[]
  /** chosen model's backtest MAE at each h (index h − 1); null where not backtestable */
  maeByH: Array<number | null>
  mase: number | null
  backtestOrigins: number
  withheldReason: string | null
  bandNote: string | null
}

const MIN_PERIODS = 4
const MAX_ORIGINS = 20
const MIN_ORIGINS = 3
const MIN_BAND_ERRORS = 5
const BAND_QUANTILE = 0.8
export const NO_BAND_NOTE = 'too little history to estimate a range'

const MIN_FIT: Record<ModelId, number> = {
  naive: 1, drift: 3, 'seasonal-naive': 14, 'damped-holt': 8, 'holt-winters': 21
}
/** tie order: simpler first */
const MODEL_ORDER: ModelId[] = ['naive', 'drift', 'seasonal-naive', 'damped-holt', 'holt-winters']

export function maxBacktestableHorizon(n: number): number {
  return Math.max(0, n - MIN_ORIGINS)
}

/** Forecaster for one model over one series: fit on [0, end), forecast h. */
type Forecaster = (end: number, h: number) => number

/** `ends`: the training ends the caller will ask for (backtest origins and n);
 *  omitted, every end is available (slower; used by backtestForecastAt). */
function forecasterFor(model: ModelId, y: number[], ends?: number[]): Forecaster {
  switch (model) {
    case 'naive':
      return (end) => naiveForecast(y, end)
    case 'drift':
      return (end, h) => driftForecast(y, end, h)
    case 'seasonal-naive':
      return (end, h) => seasonalNaiveForecast(y, end, h)
    case 'damped-holt': {
      const fit = holtGrid(y, ends)
      return (end, h) => holtForecast(fit(end), h)
    }
    case 'holt-winters': {
      const fit = holtWintersGrid(y, ends)
      return (end, h) => holtWintersForecast(fit(end), h)
    }
  }
}

function isConsecutiveDays(dates: string[]): boolean {
  for (let i = 1; i < dates.length; i++) {
    const a = Date.parse(dates[i - 1] + 'T00:00:00Z')
    const b = Date.parse(dates[i] + 'T00:00:00Z')
    if (b - a !== 86400000) return false
  }
  return true
}

function candidatesFor(n: number, dates: string[], grain: ForecastOptions['grain']): ModelId[] {
  const seasonal = grain === 'daily' && isConsecutiveDays(dates)
  return MODEL_ORDER.filter((m) => {
    if (m === 'naive') return false
    if ((m === 'seasonal-naive' || m === 'holt-winters') && !seasonal) return false
    // a candidate needs ≥ 3 origins at or above its minimum
    return n - MIN_FIT[m] >= MIN_ORIGINS
  })
}

function originsFor(n: number, model: ModelId): number[] {
  const out: number[] = []
  for (let t = n - 1; t >= Math.max(1, MIN_FIT[model]) && out.length < MAX_ORIGINS; t--) out.push(t)
  return out
}

/** The model's backtest forecast at origin t (fit on [0, t)), h steps ahead.
 *  Same code path the engine uses; exported for the no-look-ahead tests. */
export function backtestForecastAt(
  values: number[], _dates: string[], _opts: ForecastOptions, model: ModelId, t: number, h: number
): number {
  return forecasterFor(model, values)(t, h)
}

interface Backtest { errorsByH: number[][]; absSum: number; naiveAbsSum: number; origins: number }

function backtest(y: number[], model: ModelId, fc: Forecaster, naive: Forecaster, H: number): Backtest {
  const n = y.length
  const origins = originsFor(n, model)
  const errorsByH: number[][] = Array.from({ length: H }, () => [])
  let absSum = 0
  let naiveAbsSum = 0
  for (const t of origins) {
    for (let h = 1; h <= H && t + h - 1 <= n - 1; h++) {
      const actual = y[t + h - 1]
      const e = Math.abs(actual - fc(t, h))
      errorsByH[h - 1].push(e)
      absSum += e
      naiveAbsSum += Math.abs(actual - naive(t, h))
    }
  }
  return { errorsByH, absSum, naiveAbsSum, origins: origins.length }
}

function clamp(v: number, domain: UnitDomain): number {
  if (domain === 'percent') return Math.min(100, Math.max(0, v))
  if (domain === 'nonNegative') return Math.max(0, v)
  return v
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.floor(q * (sorted.length - 1))]
}

export function forecastSeries(values: number[], dates: string[], opts: ForecastOptions): SeriesForecast {
  // defensive: drop non-finite points (callers pass clean complete-period values)
  const keep = values.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0)
  const y = keep.map((i) => values[i])
  const d = keep.map((i) => dates[i])
  const n = y.length
  const H = Math.max(1, Math.floor(opts.horizon))

  if (n < MIN_PERIODS) {
    return {
      method: null,
      quality: 'Withheld',
      points: [],
      maeByH: [],
      mase: null,
      backtestOrigins: 0,
      withheldReason: `needs ≥ ${MIN_PERIODS} complete ${opts.periodNoun}, has ${n}`,
      bandNote: null
    }
  }

  const naive = forecasterFor('naive', y)
  let chosen: ModelId = 'naive'
  let chosenFc: Forecaster = naive
  let chosenMase = 1
  let chosenBt = backtest(y, 'naive', naive, naive, H)

  for (const m of candidatesFor(n, d, opts.grain)) {
    const fc = forecasterFor(m, y, [...originsFor(n, m), n])
    const bt = backtest(y, m, fc, naive, H)
    if (bt.errorsByH[0].length < MIN_ORIGINS) continue
    // naive error 0 on these origins: nothing can be shown to beat it
    if (bt.naiveAbsSum === 0) continue
    const mase = bt.absSum / bt.naiveAbsSum
    // strict < keeps the simpler model on ties (candidates run in tie order)
    if (mase < 1 && mase < chosenMase) {
      chosen = m
      chosenFc = fc
      chosenMase = mase
      chosenBt = bt
    }
  }

  const maeByH = chosenBt.errorsByH.map((e) => (e.length === 0 ? null : e.reduce((s, x) => s + x, 0) / e.length))
  let missingBand = false
  const points: HorizonPoint[] = []
  for (let h = 1; h <= H; h++) {
    const value = chosenFc(n, h)
    const errs = chosenBt.errorsByH[h - 1]
    let lower: number | null = null
    let upper: number | null = null
    if (errs.length >= MIN_BAND_ERRORS) {
      const q = quantile([...errs].sort((a, b) => a - b), BAND_QUANTILE)
      lower = clamp(value - q, opts.domain)
      upper = clamp(value + q, opts.domain)
    } else {
      missingBand = true
    }
    points.push({ h, value: clamp(value, opts.domain), lower, upper })
  }

  const quality: EngineQuality =
    chosen === 'naive' ? 'Naive only' : chosenMase <= 0.8 ? 'Good' : 'Fair'

  return {
    method: chosen,
    quality,
    points,
    maeByH,
    mase: chosenMase,
    backtestOrigins: chosenBt.origins,
    withheldReason: null,
    bandNote: missingBand ? NO_BAND_NOTE : null
  }
}
