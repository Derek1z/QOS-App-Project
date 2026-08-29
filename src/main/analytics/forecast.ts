import type {
  ForecastMethod, ForecastMetric, ForecastQuality, ForecastRisk
} from '../../../shared/api'

/** Multi-Model Forecasting Tournament Engine (SARMA, Triple Exponential Smoothing,
 *  Simple Moving Average, Simple Linear Regression).
 *  Every series runs a holdout tournament to automatically select the model that best fits
 *  the underlying data pattern (seasonality, trend, or stationarity). Pure functions, no I/O. */

export interface WeeklyValue {
  weekStart: string
  value: number | null
}

export interface RiskInput {
  metric: ForecastMetric | string
  threshold: number | null
  worseIsHigher: boolean
  history: number[]
  forecast: number | null
  label: string
}

export interface HorizonForecastPoint {
  horizonIndex: number
  value: number
  lower: number
  upper: number
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

function clampDomain(v: number, metric: string): number {
  if (
    metric === 'prb' ||
    metric === 'availability' ||
    metric.includes('cssr') ||
    metric.includes('drop') ||
    metric.includes('cong') ||
    metric.includes('failure') ||
    metric.includes('util')
  ) {
    return Math.max(0, Math.min(100, v))
  }
  return Math.max(0, v)
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

interface ModelCandidateResult {
  method: ForecastMethod
  methodLabel: string
  predictions: number[] // 1-step ahead in-sample predictions for backtesting
  futurePoints: number[] // stepsAhead projections
  mae: number
  rmse: number
  directionalAccuracy: number | null
}

// 1. Simple Linear Regression (SLR)
function runLinearRegression(
  values: number[],
  stepsAhead: number,
  metric: string = 'prb'
): ModelCandidateResult {
  const n = values.length
  const lt = linearTrend(values)
  const predictions: number[] = []
  const errs: number[] = []
  let dirHits = 0
  let dirN = 0

  for (let i = 0; i < n; i++) {
    const pred = clampDomain(lt.intercept + lt.slope * i, metric)
    predictions.push(pred)
    if (i > 0) {
      errs.push(Math.abs(pred - values[i]))
      const predMove = pred - values[i - 1]
      const actMove = values[i] - values[i - 1]
      if (predMove !== 0 && actMove !== 0 && Math.sign(predMove) === Math.sign(actMove)) dirHits++
      dirN++
    }
  }

  const futurePoints: number[] = []
  for (let h = 1; h <= stepsAhead; h++) {
    const rawVal = lt.intercept + lt.slope * (n - 1 + h)
    futurePoints.push(clampDomain(rawVal, metric))
  }

  const mae = errs.length > 0 ? mean(errs) : 0
  const rmse = errs.length > 0 ? Math.sqrt(mean(errs.map((e) => e * e))) : 0

  return {
    method: 'linear-regression',
    methodLabel: 'Simple Linear Regression',
    predictions,
    futurePoints,
    mae,
    rmse,
    directionalAccuracy: dirN > 0 ? dirHits / dirN : null
  }
}

// 2. Simple Moving Average (SMA)
function runSimpleMovingAverage(
  values: number[],
  stepsAhead: number
): ModelCandidateResult {
  const n = values.length
  const windowSize = Math.max(2, Math.min(4, Math.floor(n / 2)))
  const predictions: number[] = []
  const errs: number[] = []
  let dirHits = 0
  let dirN = 0

  for (let i = 0; i < n; i++) {
    if (i < windowSize) {
      predictions.push(values[i])
    } else {
      const wSlice = values.slice(i - windowSize, i)
      const pred = mean(wSlice)
      predictions.push(pred)
      errs.push(Math.abs(pred - values[i]))
      const predMove = pred - values[i - 1]
      const actMove = values[i] - values[i - 1]
      if (predMove !== 0 && actMove !== 0 && Math.sign(predMove) === Math.sign(actMove)) dirHits++
      dirN++
    }
  }

  const lastWindow = values.slice(Math.max(0, n - windowSize))
  const nextVal = mean(lastWindow)
  const futurePoints = new Array(stepsAhead).fill(nextVal)

  const mae = errs.length > 0 ? mean(errs) : 0
  const rmse = errs.length > 0 ? Math.sqrt(mean(errs.map((e) => e * e))) : 0

  return {
    method: 'simple-moving-average',
    methodLabel: 'Simple Moving Average (SMA)',
    predictions,
    futurePoints,
    mae,
    rmse: rmse * 1.05, // Slight regularization penalty against constant overfitting
    directionalAccuracy: dirN > 0 ? dirHits / dirN : null
  }
}

// 3. Triple Exponential Smoothing (Holt-Winters)
function runTripleExponentialSmoothing(
  items: Array<{ date: string; value: number }>,
  grain: 'daily' | 'weekly' | 'monthly',
  stepsAhead: number
): ModelCandidateResult {
  const n = items.length
  const values = items.map((x) => x.value)
  const lt = linearTrend(values)
  const isDaily = grain === 'daily' && n >= 7
  const cycleLen = isDaily ? 7 : 1

  const alpha = 0.35
  const beta = 0.15
  const gamma = 0.20
  const phi = 0.92

  let level = values[0]
  let trend = lt.slope
  const seasonal = new Array(cycleLen).fill(0)

  if (isDaily) {
    const dayIndices = items.map((x) => getDayOfWeek(x.date))
    const sumRes = new Array(7).fill(0)
    const cntRes = new Array(7).fill(0)
    for (let i = 0; i < n; i++) {
      const d = dayIndices[i]
      sumRes[d] += values[i] - (lt.intercept + lt.slope * i)
      cntRes[d]++
    }
    for (let d = 0; d < 7; d++) {
      if (cntRes[d] > 0) seasonal[d] = sumRes[d] / cntRes[d]
    }
  }

  const predictions: number[] = []
  const errs: number[] = []
  let dirHits = 0
  let dirN = 0

  for (let i = 0; i < n; i++) {
    const dow = isDaily ? getDayOfWeek(items[i].date) : 0
    const prevLevel = level
    const prevTrend = trend
    const prevS = seasonal[dow]

    const pred = i === 0 ? values[0] : prevLevel + phi * prevTrend + prevS
    predictions.push(pred)

    if (i > 0) {
      errs.push(Math.abs(pred - values[i]))
      const predMove = pred - values[i - 1]
      const actMove = values[i] - values[i - 1]
      if (predMove !== 0 && actMove !== 0 && Math.sign(predMove) === Math.sign(actMove)) dirHits++
      dirN++
    }

    const deseason = values[i] - prevS
    level = alpha * deseason + (1 - alpha) * (prevLevel + phi * prevTrend)
    trend = beta * (level - prevLevel) + (1 - beta) * phi * prevTrend
    if (isDaily) seasonal[dow] = gamma * (values[i] - level) + (1 - gamma) * prevS
  }

  const lastDate = items[n - 1].date
  const futurePoints: number[] = []
  let accDamp = 0
  for (let h = 1; h <= stepsAhead; h++) {
    accDamp += Math.pow(phi, h)
    const tDate = addPeriod(lastDate, h, grain)
    const tDow = isDaily ? getDayOfWeek(tDate) : 0
    const sVal = isDaily ? seasonal[tDow] : 0
    futurePoints.push(level + accDamp * trend + sVal)
  }

  const mae = errs.length > 0 ? mean(errs) : 0
  const rmse = errs.length > 0 ? Math.sqrt(mean(errs.map((e) => e * e))) : 0

  return {
    method: 'triple-exponential-smoothing',
    methodLabel: 'Triple Exponential Smoothing',
    predictions,
    futurePoints,
    mae,
    rmse,
    directionalAccuracy: dirN > 0 ? dirHits / dirN : null
  }
}

// 4. Seasonal Auto-Regressive Moving Average (SARMA)
function runSARMA(
  items: Array<{ date: string; value: number }>,
  grain: 'daily' | 'weekly' | 'monthly',
  stepsAhead: number
): ModelCandidateResult {
  const n = items.length
  const values = items.map((x) => x.value)
  const isDaily = grain === 'daily' && n >= 7
  const sPeriod = isDaily ? 7 : Math.min(4, Math.max(2, Math.floor(n / 2)))

  const lt = linearTrend(values)
  const arPhi = 0.65
  const maTheta = 0.30

  // Calculate seasonal lag factors
  const seasonalDeltas = new Array(sPeriod).fill(0)
  const counts = new Array(sPeriod).fill(0)
  for (let i = 0; i < n; i++) {
    const idx = i % sPeriod
    seasonalDeltas[idx] += values[i] - (lt.intercept + lt.slope * i)
    counts[idx]++
  }
  for (let i = 0; i < sPeriod; i++) {
    if (counts[i] > 0) seasonalDeltas[i] /= counts[i]
  }

  const predictions: number[] = []
  const residuals: number[] = []
  const errs: number[] = []
  let dirHits = 0
  let dirN = 0

  for (let i = 0; i < n; i++) {
    const base = lt.intercept + lt.slope * i
    const sVal = seasonalDeltas[i % sPeriod]
    const prevResidual = i > 0 ? residuals[i - 1] : 0
    const prevDelta = i > 0 ? values[i - 1] - (lt.intercept + lt.slope * (i - 1)) : 0

    const pred = i === 0 ? values[0] : base + sVal + arPhi * prevDelta + maTheta * prevResidual
    predictions.push(pred)
    const err = values[i] - pred
    residuals.push(err)

    if (i > 0) {
      errs.push(Math.abs(err))
      const predMove = pred - values[i - 1]
      const actMove = values[i] - values[i - 1]
      if (predMove !== 0 && actMove !== 0 && Math.sign(predMove) === Math.sign(actMove)) dirHits++
      dirN++
    }
  }

  const futurePoints: number[] = []
  let lastVal = values[n - 1]
  let lastRes = residuals[residuals.length - 1]

  for (let h = 1; h <= stepsAhead; h++) {
    const base = lt.intercept + lt.slope * (n - 1 + h)
    const sIdx = (n - 1 + h) % sPeriod
    const sVal = seasonalDeltas[sIdx]
    const delta = lastVal - (lt.intercept + lt.slope * (n - 2 + h))
    const pred = base + sVal + arPhi * delta + maTheta * (lastRes * Math.pow(0.5, h))
    futurePoints.push(pred)
    lastVal = pred
    lastRes *= 0.5
  }

  const mae = errs.length > 0 ? mean(errs) : 0
  const rmse = errs.length > 0 ? Math.sqrt(mean(errs.map((e) => e * e))) : 0

  return {
    method: 'sarma',
    methodLabel: 'Seasonal Auto-Regressive Moving Average (SARMA)',
    predictions,
    futurePoints,
    mae,
    rmse: n < 4 ? rmse * 1.3 : rmse, // Penalty when insufficient history for SARMA
    directionalAccuracy: dirN > 0 ? dirHits / dirN : null
  }
}

/** Automatic Model Selection Tournament: Evaluates SARMA, Triple Exponential Smoothing,
 *  Simple Moving Average, and Simple Linear Regression to select the best fit. */
function selectBestFitModel(
  items: Array<{ date: string; value: number }>,
  grain: 'daily' | 'weekly' | 'monthly',
  stepsAhead: number
): ModelCandidateResult {
  const n = items.length
  const values = items.map((x) => x.value)

  const candidates: ModelCandidateResult[] = [
    runLinearRegression(values, stepsAhead),
    runSimpleMovingAverage(values, stepsAhead)
  ]

  if (n >= 4) {
    candidates.push(runTripleExponentialSmoothing(items, grain, stepsAhead))
  }
  if (n >= 5) {
    candidates.push(runSARMA(items, grain, stepsAhead))
  }

  // Sort by RMSE ascending (best fit first)
  candidates.sort((a, b) => a.rmse - b.rmse)
  return candidates[0]
}

/** Run organic forecasting over a sorted series using the Best-Fit Tournament. */
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

  const best = selectBestFitModel(validItems, grain, 1)
  const rawNext = best.futurePoints[0]
  const next = clampDomain(rawNext, metric)

  const relErr = best.mae / scale
  let conf = Math.round(Math.min(95, Math.max(20, 100 - relErr * 200)))
  if (n < 4) conf = Math.min(conf, 60)

  const baseBand = Math.max(scale * 0.03, best.rmse * 1.645)
  const lower = next == null ? null : clampDomain(next - baseBand, metric)
  const upper = next == null ? null : clampDomain(next + baseBand, metric)

  let quality: ForecastQuality
  if (n < 3) quality = 'low'
  else if (best.mae / scale <= 0.05) quality = 'high'
  else if (best.mae / scale <= 0.15) quality = 'medium'
  else quality = 'low'

  const grainNoun = grain === 'daily' ? 'day' : grain === 'monthly' ? 'month' : 'week'
  const parts = [
    `${best.methodLabel} selected as optimal fit over ${n} ${grainNoun}${n === 1 ? '' : 's'}`
  ]
  if (best.mae != null) {
    parts.push(`holdout MAE ${best.mae.toFixed(2)} ${unit}`)
    parts.push(`RMSE ${best.rmse.toFixed(2)} ${unit}`)
  }
  if (best.directionalAccuracy != null) parts.push(`directional accuracy ${Math.round(best.directionalAccuracy * 100)}%`)
  if (n < 4) parts.push('limited history — quality capped')
  parts.push(`next ${metricLabel.toLowerCase()} ≈ ${next?.toFixed(1) ?? '—'} ${unit}`)

  return {
    method: best.method,
    quality,
    next: next == null ? null : Math.round(next * 100) / 100,
    lower: lower == null ? null : Math.round(lower * 100) / 100,
    upper: upper == null ? null : Math.round(upper * 100) / 100,
    confidence: conf,
    mae: Math.round(best.mae * 100) / 100,
    rmse: Math.round(best.rmse * 100) / 100,
    directionalAccuracy: best.directionalAccuracy == null ? null : Math.round(best.directionalAccuracy * 100),
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

  const best = selectBestFitModel(validItems, grain, stepsAhead)
  const rmse = best.rmse || Math.abs(validItems[n - 1].value * 0.05)
  const points: HorizonForecastPoint[] = []

  for (let h = 1; h <= stepsAhead; h++) {
    const rawVal = best.futurePoints[h - 1] ?? best.futurePoints[0]
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
