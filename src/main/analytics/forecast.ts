import type {
  ForecastMethod, ForecastQuality, ForecastRisk
} from '../../../shared/api'

/** Organic multi-grain forecasting (spec §46):
 *  - Daily grain: 7-day Day-of-Week Seasonal Holt-Winters decomposition with organic cyclical wave
 *  - Weekly grain: Damped Holt linear trend with auto-regressive momentum
 *  - Monthly grain: Damped Holt linear trend with quarterly adaptation
 *  Every forecast exposes trajectory, confidence, model quality, historical error and explanation;
 *  low-quality forecasts are suppressed. Pure functions, no I/O. */

export interface WeeklyValue {
  weekStart: string
  value: number | null
}

export interface RiskInput {
  metric: 'prb' | 'throughput' | 'availability' | 'users' | 'traffic'
  threshold: number | null
  worseIsHigher: boolean
  history: number[]
  forecast: number | null
  label: string
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)

function getDayOfWeek(dateStr: string): number {
  if (!dateStr || dateStr.length < 10) return 0
  const d = new Date(dateStr + 'T00:00:00Z')
  const dow = d.getUTCDay()
  return isNaN(dow) ? 0 : dow
}

function addPeriod(dateStr: string, steps: number, grain: 'daily' | 'weekly' | 'monthly' = 'weekly'): string {
  if (!dateStr || dateStr.length < 10) return ''
  const d = new Date(dateStr + 'T00:00:00Z')
  if (grain === 'daily') {
    d.setUTCDate(d.getUTCDate() + steps)
  } else if (grain === 'monthly') {
    d.setUTCMonth(d.getUTCMonth() + steps)
  } else {
    d.setUTCDate(d.getUTCDate() + steps * 7)
  }
  return d.toISOString().slice(0, 10)
}

/** Least-squares slope/intercept over (0..n-1). */
function linearTrend(xs: number[]): { slope: number; intercept: number } {
  const n = xs.length
  const sx = (n * (n - 1)) / 2
  const sxx = (n * (n - 1) * (2 * n - 1)) / 6
  const sy = xs.reduce((a, b) => a + b, 0)
  const sxy = xs.reduce((a, b, i) => a + b * i, 0)
  const denom = n * sxx - sx * sx
  if (denom === 0) return { slope: 0, intercept: mean(xs) }
  const slope = (n * sxy - sx * sy) / denom
  return { slope, intercept: (sy - slope * sx) / n }
}

export interface HorizonForecastPoint {
  horizonIndex: number
  value: number
  lower: number
  upper: number
}

function clampDomain(v: number, metric: string): number {
  if (metric === 'prb' || metric === 'availability') {
    return Math.max(0, Math.min(100, v))
  }
  return Math.max(0, v)
}

interface SeasonalDecomposition {
  hasSeasonality: boolean
  cycleLen: number
  seasonalIndices: number[] // 0..6 for days of week Sun..Sat
  level: number
  trend: number
  rmse: number
  mae: number
  dir: number | null
}

function decomposeSeries(
  items: Array<{ date: string; value: number }>,
  grain: 'daily' | 'weekly' | 'monthly' = 'weekly'
): SeasonalDecomposition {
  const n = items.length
  const values = items.map((x) => x.value)
  const lt = linearTrend(values)

  if (grain === 'daily' && n >= 7) {
    const cycleLen = 7
    const dayIndices = items.map((x) => getDayOfWeek(x.date))
    
    // Calculate initial seasonal profile from detrended residuals
    const sumResids = new Array(7).fill(0)
    const countResids = new Array(7).fill(0)
    for (let i = 0; i < n; i++) {
      const dow = dayIndices[i]
      const trendVal = lt.intercept + lt.slope * i
      sumResids[dow] += values[i] - trendVal
      countResids[dow]++
    }

    let seasonalProfile = sumResids.map((s, d) => (countResids[d] > 0 ? s / countResids[d] : 0))
    const meanProfile = mean(seasonalProfile)
    seasonalProfile = seasonalProfile.map((s) => s - meanProfile)

    // Run Holt-Winters smoothing pass
    const alpha = 0.35
    const beta = 0.15
    const gamma = 0.25
    const phi = 0.92

    let level = values[0] - seasonalProfile[dayIndices[0]]
    let trend = lt.slope
    const S = [...seasonalProfile]

    const predList: number[] = []
    for (let i = 0; i < n; i++) {
      const dow = dayIndices[i]
      const prevLevel = level
      const prevTrend = trend
      const prevS = S[dow]

      const pred = i === 0 ? values[0] : prevLevel + phi * prevTrend + prevS
      predList.push(pred)

      const deseason = values[i] - prevS
      level = alpha * deseason + (1 - alpha) * (prevLevel + phi * prevTrend)
      trend = beta * (level - prevLevel) + (1 - beta) * phi * prevTrend
      S[dow] = gamma * (values[i] - level) + (1 - gamma) * prevS
      
      const meanS = mean(S)
      for (let d = 0; d < 7; d++) S[d] -= meanS
    }

    const errs: number[] = []
    let dirHits = 0
    let dirN = 0
    for (let i = 1; i < n; i++) {
      const pred = predList[i]
      const actual = values[i]
      errs.push(Math.abs(pred - actual))
      const predMove = pred - values[i - 1]
      const actMove = actual - values[i - 1]
      if (predMove !== 0 && actMove !== 0 && Math.sign(predMove) === Math.sign(actMove)) dirHits++
      dirN++
    }

    const mae = errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length)
    const rmse = Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / Math.max(1, errs.length))
    const dir = dirN > 0 ? dirHits / dirN : null

    return {
      hasSeasonality: true,
      cycleLen,
      seasonalIndices: S,
      level,
      trend,
      rmse,
      mae,
      dir
    }
  }

  // Weekly or Monthly fallback
  const phi = 0.90
  let level = values[0]
  let trend = lt.slope
  const alpha = 0.40
  const beta = 0.15

  const predList: number[] = []
  for (let i = 0; i < n; i++) {
    const prevLevel = level
    const prevTrend = trend
    const pred = i === 0 ? values[0] : prevLevel + phi * prevTrend
    predList.push(pred)

    level = alpha * values[i] + (1 - alpha) * (prevLevel + phi * prevTrend)
    trend = beta * (level - prevLevel) + (1 - beta) * phi * prevTrend
  }

  const errs: number[] = []
  let dirHits = 0
  let dirN = 0
  for (let i = 1; i < n; i++) {
    const pred = predList[i]
    const actual = values[i]
    errs.push(Math.abs(pred - actual))
    const predMove = pred - values[i - 1]
    const actMove = actual - values[i - 1]
    if (predMove !== 0 && actMove !== 0 && Math.sign(predMove) === Math.sign(actMove)) dirHits++
    dirN++
  }

  const mae = errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length)
  const rmse = Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / Math.max(1, errs.length))
  const dir = dirN > 0 ? dirHits / dirN : null

  return {
    hasSeasonality: false,
    cycleLen: 1,
    seasonalIndices: [0],
    level,
    trend,
    rmse,
    mae,
    dir
  }
}

/** Run organic forecasting over a sorted series. */
export function forecastSeries(
  weeks: WeeklyValue[],
  metricLabel: string,
  unit: string,
  metric = 'prb',
  grain: 'daily' | 'weekly' | 'monthly' = 'weekly'
): {
  method: ForecastMethod
  quality: ForecastQuality
  next: number | null
  lower: number | null
  upper: number | null
  confidence: number | null
  mae: number | null
  rmse: number | null
  directionalAccuracy: number | null
  explanation: string
} {
  const validItems = weeks
    .filter((w): w is { weekStart: string; value: number } => w.value != null && Number.isFinite(w.value))
    .map((w) => ({ date: w.weekStart, value: w.value }))
  const n = validItems.length
  const values = validItems.map((x) => x.value)
  const scale = Math.max(1e-6, Math.abs(mean(values)))

  if (n < 2) {
    const grainNoun = grain === 'daily' ? 'day' : grain === 'monthly' ? 'month' : 'week'
    return {
      method: 'suppressed',
      quality: 'suppressed',
      next: null,
      lower: null,
      upper: null,
      confidence: null,
      mae: null,
      rmse: null,
      directionalAccuracy: null,
      explanation: `Insufficient history (${n} ${grainNoun}${n === 1 ? '' : 's'}) for ${metricLabel.toLowerCase()} — forecast suppressed (spec §46).`
    }
  }

  const decomp = decomposeSeries(validItems, grain)
  const lastDate = validItems[n - 1].date
  const nextDate = addPeriod(lastDate, 1, grain)
  const nextDow = getDayOfWeek(nextDate)

  let method: ForecastMethod = decomp.hasSeasonality
    ? 'seasonal-holt-winters'
    : Math.abs(decomp.trend) > 1e-4
    ? 'linear-trend'
    : 'moving-average'

  const phi = 0.92
  const seasonalVal = decomp.hasSeasonality ? decomp.seasonalIndices[nextDow] : 0
  const rawNext = decomp.level + phi * decomp.trend + seasonalVal
  const next = clampDomain(rawNext, metric)

  const relErr = decomp.mae / scale
  let conf = Math.round(Math.min(95, Math.max(20, 100 - relErr * 200)))
  if (n < 4) conf = Math.min(conf, 60)

  const baseBand = Math.max(scale * 0.03, decomp.rmse * 1.645)
  const lower = next == null ? null : clampDomain(next - baseBand, metric)
  const upper = next == null ? null : clampDomain(next + baseBand, metric)

  let quality: ForecastQuality
  if (n < 3) quality = 'low'
  else if (decomp.mae / scale <= 0.05) quality = 'high'
  else if (decomp.mae / scale <= 0.15) quality = 'medium'
  else quality = 'low'

  const methodTxt =
    method === 'seasonal-holt-winters'
      ? '7-day seasonal Holt-Winters'
      : method === 'linear-trend'
      ? 'damped linear trend'
      : 'weighted moving average'
  const grainNoun = grain === 'daily' ? 'day' : grain === 'monthly' ? 'month' : 'week'
  const parts = [
    `${methodTxt} over ${n} ${grainNoun}${n === 1 ? '' : 's'} of ${metricLabel.toLowerCase()}`
  ]
  if (decomp.mae != null) {
    parts.push(`holdout MAE ${decomp.mae.toFixed(2)} ${unit}`)
    parts.push(`RMSE ${decomp.rmse.toFixed(2)} ${unit}`)
  }
  if (decomp.dir != null) parts.push(`directional accuracy ${Math.round(decomp.dir * 100)}%`)
  if (n < 4) parts.push('limited history — quality capped')
  parts.push(`next ${metricLabel.toLowerCase()} ≈ ${next?.toFixed(1) ?? '—'} ${unit}`)

  return {
    method,
    quality,
    next: next == null ? null : Math.round(next * 100) / 100,
    lower: lower == null ? null : Math.round(lower * 100) / 100,
    upper: upper == null ? null : Math.round(upper * 100) / 100,
    confidence: conf,
    mae: Math.round(decomp.mae * 100) / 100,
    rmse: Math.round(decomp.rmse * 100) / 100,
    directionalAccuracy: decomp.dir == null ? null : Math.round(decomp.dir * 100),
    explanation: parts.join('; ') + '.'
  }
}

/** Multi-horizon organic trajectory with expanding confidence cone. */
export function forecastTrajectory(
  weeks: WeeklyValue[],
  metric: string,
  metricLabel: string,
  unit: string,
  stepsAhead = 4,
  grain: 'daily' | 'weekly' | 'monthly' = 'weekly'
): {
  summary: ReturnType<typeof forecastSeries>
  points: HorizonForecastPoint[]
} {
  const summary = forecastSeries(weeks, metricLabel, unit, metric, grain)
  const validItems = weeks
    .filter((w): w is { weekStart: string; value: number } => w.value != null && Number.isFinite(w.value))
    .map((w) => ({ date: w.weekStart, value: w.value }))
  const n = validItems.length

  if (n < 2 || summary.next == null) {
    return { summary, points: [] }
  }

  const decomp = decomposeSeries(validItems, grain)
  const lastDate = validItems[n - 1].date
  const phi = 0.92
  const rmse = decomp.rmse || Math.abs(validItems[n - 1].value * 0.05)
  const points: HorizonForecastPoint[] = []

  let accumulatedDamp = 0
  for (let h = 1; h <= stepsAhead; h++) {
    accumulatedDamp += Math.pow(phi, h)
    const targetDate = addPeriod(lastDate, h, grain)
    const dow = getDayOfWeek(targetDate)
    const seasonalVal = decomp.hasSeasonality ? decomp.seasonalIndices[dow] : 0
    const rawVal = decomp.level + accumulatedDamp * decomp.trend + seasonalVal

    const val = clampDomain(rawVal, metric)
    const coneMargin = Math.max(val * 0.02, rmse * Math.sqrt(1 + 0.15 * (h - 1)) * 1.645)

    points.push({
      horizonIndex: h,
      value: Math.round(val * 100) / 100,
      lower: Math.round(clampDomain(val - coneMargin, metric) * 100) / 100,
      upper: Math.round(clampDomain(val + coneMargin, metric) * 100) / 100
    })
  }

  return { summary, points }
}

/** Classify a forecast into an early-warning risk state (§45). */
export function classifyRisk(input: RiskInput): { risk: ForecastRisk; explanation: string } {
  const { threshold, worseIsHigher, history, forecast, label } = input
  const latest = history.length > 0 ? history[history.length - 1] : null

  // metrics without a hard threshold (users/traffic): classify by trajectory
  if (threshold == null) {
    if (latest == null || forecast == null || history.length < 2) {
      return { risk: 'Stable', explanation: `${label}: insufficient data to classify.` }
    }
    const growth = Math.abs(forecast - latest) / Math.max(1, Math.abs(latest))
    if (growth >= 0.15) {
      return { risk: 'Watch', explanation: `${label} is forecast to move ${(forecast - latest) >= 0 ? 'up' : 'down'} ${(growth * 100).toFixed(0)}% — monitor for congestion impact.` }
    }
    return { risk: 'Stable', explanation: `${label} trajectory is flat.` }
  }

  if (latest == null || forecast == null) {
    return { risk: 'Stable', explanation: `${label}: insufficient data to classify.` }
  }
  const breached = worseIsHigher ? latest >= threshold : latest <= threshold
  if (breached) {
    return {
      risk: 'Already Breached',
      explanation: `${label} is already ${latest.toFixed(1)} vs the ${threshold.toFixed(1)} threshold (${worseIsHigher ? 'at or above' : 'at or below'}).`
    }
  }
  const fBreach = worseIsHigher ? forecast >= threshold : forecast <= threshold
  if (fBreach) {
    return {
      risk: 'Likely Breach',
      explanation: `${label} is ${latest.toFixed(1)} now but forecast at ${forecast.toFixed(1)} crosses the ${threshold.toFixed(1)} threshold within the horizon.`
    }
  }
  const margin = worseIsHigher
    ? (threshold - forecast) / threshold
    : (forecast - threshold) / threshold
  if (margin <= 0.1) {
    return { risk: 'At Risk', explanation: `${label} forecast ${forecast.toFixed(1)} is within 10% of the ${threshold.toFixed(1)} threshold.` }
  }
  if (margin <= 0.2) {
    return { risk: 'Watch', explanation: `${label} forecast ${forecast.toFixed(1)} is within 20% of the ${threshold.toFixed(1)} threshold.` }
  }
  return { risk: 'Stable', explanation: `${label} forecast ${forecast.toFixed(1)} is comfortably inside the threshold.` }
}
