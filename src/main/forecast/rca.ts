import type { Technology } from '../../../shared/api'
import type { RiskState } from '../analytics/forecasting/risk'
import type { ForecastKpi } from './series'

/** Rule-of-thumb hints for the Forecasting risk table (honest-forecasting
 *  spec §7). Every rule reads only imported values; a rule whose inputs are
 *  missing does not fire. First match wins. */

export type RcaCategory =
  | 'Capacity Exhaustion'
  | 'RF Overshoot & Interference'
  | 'Hardware & VSWR'
  | 'Parameter & Handover'
  | 'Traffic Surge'
  | 'Normal / Stable'

export interface RcaInput {
  tech: Technology
  selected: ForecastKpi
  risk: RiskState | null
  /** kpi key → latest complete value for this cell */
  latest: Record<string, number | null>
  /** kpi key → mean of the 4 complete periods before the latest */
  priorMean: Record<string, number | null>
  /** kpi key → definition (label, target, direction) */
  kpis: Record<string, ForecastKpi>
}

export interface RcaResult { hint: { category: RcaCategory; action: string } | null; hintNote: string }

export const RULE_OF_THUMB = 'rule of thumb'

const AVAILABILITY_KEY: Record<Technology, string> = { '4G': 'availability', '3G': 'availability_3g', '2G': 'tch_availability' }
const CAPACITY_ACTION: Record<Technology, string> = {
  '4G': 'Activate 64T64R Massive MIMO beamforming or deploy secondary LTE carrier expansion (+10MHz).',
  '3G': 'License +64 Channel Elements (CE) and enable Dual-Cell HSDPA feature.',
  '2G': 'Enable Half-Rate (HR) AMR codec and dynamic SDCCH allocation to double timeslot capacity.'
}
const CONGESTION_KEYS = ['tch_congestion', 'sdcch_congestion']
const DROP_KEYS = ['call_drop_rate_2g', 'call_drop_rate_3g', 'call_drop_rate_4g', 'data_service_failure_4g']
const CSSR_KEYS = ['call_setup_success_2g', 'call_setup_success_3g', 'call_setup_success_4g']
const SURGE_KEYS = ['data_volume', 'connected_users']

export function diagnoseRca(i: RcaInput): RcaResult {
  const val = (key: string): number | null => {
    const v = i.latest[key]
    return v == null || !Number.isFinite(v) ? null : v
  }
  const pastTarget = (key: string): boolean | null => {
    const v = val(key)
    const def = key === i.selected.key ? i.selected : i.kpis[key]
    if (v == null || def?.target == null) return null
    return def.worseIsHigher ? v > def.target : v < def.target
  }
  const hint = (category: RcaCategory, action: string): RcaResult => ({ hint: { category, action }, hintNote: RULE_OF_THUMB })
  const sel = i.selected.key

  if (i.risk === 'Stable') return hint('Normal / Stable', 'Continue standard performance monitoring.')

  const avail = val(AVAILABILITY_KEY[i.tech])
  if (avail != null && avail < 95) {
    return hint('Hardware & VSWR', 'Inspect transmission link, check RRU feeder return loss/VSWR, and replace faulty SFP optical module.')
  }
  if (pastTarget('prb_utilization') === true || (CONGESTION_KEYS.includes(sel) && pastTarget(sel) === true)) {
    return hint('Capacity Exhaustion', CAPACITY_ACTION[i.tech])
  }
  if (DROP_KEYS.includes(sel) && pastTarget(sel) === true) {
    return hint('RF Overshoot & Interference', 'Increase antenna electrical down-tilt by 2°–3° to eliminate co-channel overshoot and inter-cell interference.')
  }
  if (CSSR_KEYS.includes(sel) && pastTarget(sel) === true) {
    return hint('Parameter & Handover', 'Audit neighbor relations, re-tune handover hysteresis & time-to-trigger (TTT) to eliminate ping-pong drops.')
  }
  for (const key of SURGE_KEYS) {
    const v = val(key)
    const prior = i.priorMean[key]
    if (v != null && prior != null && prior > 0 && v >= 1.2 * prior) {
      return hint('Traffic Surge', 'Schedule inter-frequency traffic steering or offload 20% traffic to adjacent microcells.')
    }
  }

  // nothing fired: say what could not be judged
  const label = (key: string): string => (key === sel ? i.selected.label : i.kpis[key]?.label ?? key)
  const missing =
    val(sel) == null
      ? [label(sel)]
      : [AVAILABILITY_KEY[i.tech], 'prb_utilization', ...SURGE_KEYS].filter((k) => i.kpis[k] && val(k) == null).map(label)
  return { hint: null, hintNote: missing.length > 0 ? `No hint — ${missing.join(', ')} not imported` : 'No rule matched' }
}
