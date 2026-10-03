import type { SeriesForecast } from './engine'

/** Risk states (spec §5.6). "Past target" follows the KPI's direction. A KPI
 *  without a target gets no risk state, only growth over the horizon. */

export type RiskState = 'Stable' | 'Watch' | 'At Risk' | 'Likely Breach' | 'Already Breached' | 'Withheld'

export interface RiskInput {
  latest: number | null
  target: number | null
  worseIsHigher: boolean
  forecast: SeriesForecast
  horizon: number
  label: string
  unit: string
}

export interface RiskResult { risk: RiskState | null; explanation: string; growthPct: number | null }

export const RISK_RANK: Record<RiskState, number> = {
  'Already Breached': 0,
  'Likely Breach': 1,
  'At Risk': 2,
  Watch: 3,
  Stable: 4,
  Withheld: 5
}

function fmt(v: number, unit: string): string {
  const n = Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2)
  return unit === '%' ? `${n}%` : unit ? `${n} ${unit}` : n
}

export function classifyRisk(i: RiskInput): RiskResult {
  const { latest, target, worseIsHigher, forecast, label, unit } = i
  const pts = forecast.points.filter((p) => p.h <= i.horizon)
  const atH = pts.length > 0 ? pts[pts.length - 1] : null

  if (target == null) {
    const growthPct =
      latest != null && latest !== 0 && atH != null
        ? Math.round(((atH.value - latest) / Math.abs(latest)) * 1000) / 10
        : null
    const explanation =
      forecast.quality === 'Withheld'
        ? `${label}: ${forecast.withheldReason}.`
        : growthPct == null
          ? `${label}: no target set.`
          : `${label}: no target set; forecast ${growthPct >= 0 ? 'grows' : 'falls'} ${Math.abs(growthPct)}% over the horizon.`
    return { risk: null, explanation, growthPct }
  }

  const past = (v: number): boolean => (worseIsHigher ? v > target : v < target)
  const worseEdge = (p: { lower: number | null; upper: number | null }): number | null =>
    worseIsHigher ? p.upper : p.lower
  const t = fmt(target, unit)

  if (latest != null && past(latest)) {
    return { risk: 'Already Breached', explanation: `${label} is ${fmt(latest, unit)}, past the ${t} target.`, growthPct: null }
  }
  if (forecast.quality === 'Withheld') {
    return { risk: 'Withheld', explanation: `${label}: ${forecast.withheldReason}.`, growthPct: null }
  }
  const crossing = pts.find((p) => past(p.value))
  if (crossing) {
    return {
      risk: 'Likely Breach',
      explanation: `${label} is forecast at ${fmt(crossing.value, unit)} in ${crossing.h} period${crossing.h === 1 ? '' : 's'}, past the ${t} target.`,
      growthPct: null
    }
  }
  const edge = pts.find((p) => {
    const e = worseEdge(p)
    return e != null && past(e)
  })
  if (edge) {
    return {
      risk: 'At Risk',
      explanation: `${label}: the forecast range reaches ${fmt(worseEdge(edge)!, unit)} in ${edge.h} period${edge.h === 1 ? '' : 's'}, past the ${t} target.`,
      growthPct: null
    }
  }
  const noise = forecast.maeByH[0]
  if (latest != null && atH != null && noise != null) {
    const worsening = worseIsHigher ? atH.value - latest : latest - atH.value
    if (worsening > noise) {
      return {
        risk: 'Watch',
        explanation: `${label} is forecast to worsen from ${fmt(latest, unit)} to ${fmt(atH.value, unit)}, more than its usual error of ${fmt(noise, unit === '%' ? 'pp' : unit)}.`,
        growthPct: null
      }
    }
  }
  return { risk: 'Stable', explanation: `${label} stays inside the ${t} target over the horizon.`, growthPct: null }
}
