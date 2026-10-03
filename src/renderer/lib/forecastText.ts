import type { ForecastMethod, ForecastRisk, ForecastStatus, ForecastSummary } from '../../../shared/api'

/** Forecasting page text (honest-forecasting spec §9.2): what model was
 *  chosen and how well it did on data it did not see. */

export const METHOD_LABEL: Record<ForecastMethod, string> = {
  naive: 'Naive',
  drift: 'Drift',
  'seasonal-naive': 'Seasonal naive',
  'damped-holt': 'Damped Holt',
  'holt-winters': 'Holt-Winters'
}

function fmtError(v: number, unit: string, decimals: number): string {
  const d = Math.max(1, decimals)
  if (unit === '%') return `${v.toFixed(d)} pp`
  return unit ? `${v.toFixed(d)} ${unit}` : v.toFixed(d)
}

const periods = (n: number, plural: string): string => `${n} ${n === 1 ? plural.replace(/s$/, '') : plural}`

/** `decimals`: the KPI's decimal precision from kpi_defs (errors never shown with fewer than 1). */
export function modelLine(f: ForecastSummary, unit: string, horizon: number, periodNoun: string, decimals = 1): string {
  if (f.quality === 'Withheld' || f.method == null) return f.withheldReason ?? 'Withheld'
  if (f.method === 'naive') return `Naive · no model beats 'same as last period' · ${f.backtestOrigins} backtest points`
  const err = f.maeH != null
    ? `backtest MAE ${fmtError(f.maeH, unit, decimals)} at ${periods(horizon, periodNoun)}`
    : f.maeH1 != null ? `backtest MAE ${fmtError(f.maeH1, unit, decimals)} at ${periods(1, periodNoun)}` : 'no backtest error'
  return `${METHOD_LABEL[f.method]} · ${err} · ${f.betterThanNaivePct ?? 0}% better than naive · ${f.backtestOrigins} backtest points · ${f.quality}`
}

export function updatingLine(s: ForecastStatus): string | null {
  if (!s.running) return null
  return `Forecasts updating — ${s.done.toLocaleString('en-US')} of ${s.total.toLocaleString('en-US')} cells`
}

/** Risk column: the risk state, or growth over the horizon for a KPI without a target. */
export function riskCellText(r: { risk: ForecastRisk | null; growthPct: number | null }): string {
  if (r.risk) return r.risk
  if (r.growthPct == null) return '—'
  return `${r.growthPct >= 0 ? '+' : ''}${r.growthPct}% growth`
}
