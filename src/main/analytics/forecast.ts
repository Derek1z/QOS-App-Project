import type {
  ForecastMethod, ForecastQuality, ForecastRisk
} from '../../../shared/api'

/** Simple-first forecasting (spec §46): moving average, then linear trend,
 *  chosen by holdout error when history allows. Every forecast exposes
 *  trajectory, confidence, model quality, historical error and explanation;
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

function holdoutError(xs: number[], predict: (i: number) => number): { mae: number; rmse: number; dir: number | null } {
  const n = xs.length
  if (n < 2) return { mae: 0, rmse: 0, dir: null }
  const errs: number[] = []
  let dirHits = 0
  let dirN = 0
  for (let i = 1; i < n; i++) {
    const pred = predict(i)
    const actual = xs[i]
    errs.push(Math.abs(pred - actual))
    if (i > 0 && pred !== actual) {
      // directional accuracy: did the predicted move go the right way?
      const predMove = pred - xs[i - 1]
      const actMove = actual - xs[i - 1]
      if (predMove !== 0 && actMove !== 0 && Math.sign(predMove) === Math.sign(actMove)) dirHits++
      dirN++
    }
  }
  return {
    mae: errs.reduce((a, b) => a + b, 0) / errs.length,
    rmse: Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / errs.length),
    dir: dirN > 0 ? dirHits / dirN : null
  }
}

/** Run the simple-first forecast over a sorted-by-week series. */
export function forecastSeries(
  weeks: WeeklyValue[],
  metricLabel: string,
  unit: string
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
  const values = weeks
    .map((w) => w.value)
    .filter((v): v is number => v != null && Number.isFinite(v))
  const n = values.length
  const scale = Math.max(1e-6, Math.abs(mean(values)))

  if (n < 2) {
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
      explanation: `Insufficient history (${n} week${n === 1 ? '' : 's'}) for ${metricLabel.toLowerCase()} — forecast suppressed (spec §46).`
    }
  }

  let method: ForecastMethod = 'moving-average'
  let mae: number | null = null
  let rmse: number | null = null
  let dir: number | null = null
  let next: number | null = null
  let conf: number | null = null

  if (n >= 3) {
    // holdout: fit on all but the last point, evaluate on the last
    const maErr = holdoutError(values, (i) => (i === n - 1 ? mean(values.slice(0, n - 1)) : mean(values.slice(0, i + 1))))
    const lt = linearTrend(values.slice(0, n - 1))
    const ltErr = holdoutError(values, (i) => (i === n - 1 ? lt.intercept + lt.slope * i : values[i]))
    if (ltErr.mae <= maErr.mae) {
      method = 'linear-trend'
      mae = ltErr.mae
      rmse = ltErr.rmse
      dir = ltErr.dir
    } else {
      method = 'moving-average'
      mae = maErr.mae
      rmse = maErr.rmse
      dir = maErr.dir
    }
    next = method === 'linear-trend'
      ? Math.max(0, (() => { const t = linearTrend(values); return t.intercept + t.slope * n })())
      : mean(values)
    const relErr = mae / scale
    conf = Math.round(Math.min(92, Math.max(15, 100 - relErr * 220)))
    if (n < 4) conf = Math.min(conf, 55)
  } else {
    // n === 2: flat moving average, no holdout to validate against
    method = 'moving-average'
    next = mean(values)
    mae = Math.abs(values[1] - values[0])
    rmse = mae
    dir = null
    conf = 40
  }

  const band = Math.max(scale * 0.08, Math.abs(mean(values) - (next ?? mean(values))) * 1.2, mae * 1.5)
  const lower = next == null ? null : Math.max(0, next - band)
  const upper = next == null ? null : next + band

  let quality: ForecastQuality
  if (n < 3) quality = 'low'
  else if (mae / scale <= 0.05) quality = 'high'
  else if (mae / scale <= 0.15) quality = 'medium'
  else quality = 'low'

  const methodTxt = method === 'linear-trend' ? 'linear trend' : 'moving average'
  const parts = [
    `${methodTxt} over ${n} week${n === 1 ? '' : 's'} of ${metricLabel.toLowerCase()}`
  ]
  if (mae != null) {
    parts.push(`holdout MAE ${mae.toFixed(2)} ${unit}`)
    parts.push(`RMSE ${rmse?.toFixed(2) ?? '—'} ${unit}`)
  }
  if (dir != null) parts.push(`directional accuracy ${Math.round(dir * 100)}%`)
  if (n < 4) parts.push('limited history — quality capped')
  parts.push(`next ${metricLabel.toLowerCase()} ≈ ${next?.toFixed(1) ?? '—'} ${unit}`)

  return {
    method,
    quality,
    next,
    lower,
    upper,
    confidence: conf,
    mae,
    rmse,
    directionalAccuracy: dir == null ? null : Math.round(dir * 100),
    explanation: parts.join('; ') + '.'
  }
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
