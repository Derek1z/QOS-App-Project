import type { ForecastMethod, ForecastStatus, ForecastSummary } from '../../../shared/api'

/** Forecasting page text (honest-forecasting spec §9.2): what model was
 *  chosen and how well it did on data it did not see. */

export const METHOD_LABEL: Record<ForecastMethod, string> = {
  naive: 'Naive',
  drift: 'Drift',
  'seasonal-naive': 'Seasonal naive',
  'damped-holt': 'Damped Holt',
  'holt-winters': 'Holt-Winters'
}

function fmtError(v: number, unit: string): string {
  if (unit === '%') return `${v.toFixed(1)} pp`
  return unit ? `${v.toFixed(1)} ${unit}` : v.toFixed(1)
}

const periods = (n: number, plural: string): string => `${n} ${n === 1 ? plural.replace(/s$/, '') : plural}`

export function modelLine(f: ForecastSummary, unit: string, horizon: number, periodNoun: string): string {
  if (f.quality === 'Withheld' || f.method == null) return f.withheldReason ?? 'Withheld'
  if (f.method === 'naive') return `Naive · no model beats 'same as last period' · ${f.backtestOrigins} backtest points`
  const err = f.maeH != null
    ? `backtest MAE ${fmtError(f.maeH, unit)} at ${periods(horizon, periodNoun)}`
    : f.maeH1 != null ? `backtest MAE ${fmtError(f.maeH1, unit)} at ${periods(1, periodNoun)}` : 'no backtest error'
  return `${METHOD_LABEL[f.method]} · ${err} · ${f.betterThanNaivePct ?? 0}% better than naive · ${f.backtestOrigins} backtest points · ${f.quality}`
}

export function updatingLine(s: ForecastStatus): string | null {
  if (!s.running) return null
  return `Forecasts updating — ${s.done.toLocaleString('en-US')} of ${s.total.toLocaleString('en-US')} cells`
}
