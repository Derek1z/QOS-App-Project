import type { Grain } from './api'

/** Forecast horizons, in periods of the grain (honest-forecasting spec §4.3). */
export const FORECAST_HORIZONS: Record<Grain, number[]> = {
  weekly: [1, 2, 4, 8, 12],
  monthly: [1, 3, 6],
  daily: [7, 14, 28]
}

export const DEFAULT_HORIZON: Record<Grain, number> = { weekly: 4, monthly: 3, daily: 14 }

export const PERIOD_NOUN: Record<Grain, { one: string; many: string }> = {
  daily: { one: 'day', many: 'days' },
  weekly: { one: 'week', many: 'weeks' },
  monthly: { one: 'month', many: 'months' }
}

/** The ISO period start `steps` periods after `iso`. */
export function addPeriods(iso: string, steps: number, grain: Grain): string {
  const d = new Date(iso + 'T00:00:00Z')
  if (grain === 'daily') d.setUTCDate(d.getUTCDate() + steps)
  else if (grain === 'monthly') d.setUTCMonth(d.getUTCMonth() + steps)
  else d.setUTCDate(d.getUTCDate() + steps * 7)
  return d.toISOString().slice(0, 10)
}

/** ISO week number label (W31) for a week start. */
function isoWeekLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)
  return 'W' + week
}

/** Axis label for a period start: DD/MM (daily), MM/YYYY (monthly), W31 (weekly). */
export function forecastPeriodLabel(iso: string, grain: Grain): string {
  if (!iso) return ''
  if (grain === 'daily') return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
  if (grain === 'monthly') return `${iso.slice(5, 7)}/${iso.slice(0, 4)}`
  return isoWeekLabel(iso)
}
