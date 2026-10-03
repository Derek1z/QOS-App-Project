import { describe, it, expect } from 'vitest'
import { diagnoseRca, type RcaInput } from '../../src/main/forecast/rca'
import type { ForecastKpi } from '../../src/main/forecast/series'

const kpi = (key: string, label: string, target: number | null, worseIsHigher: boolean, unit = '%'): ForecastKpi => ({
  key, label, unit, worseIsHigher, target, agg: 'avg', decimals: 1, capacity: false, isCore: true,
  source: { kind: 'kpi', kpiId: 1 }
})
const CSSR = kpi('call_setup_success_4g', '4G Call Connection Success Rate', 98.5, false)
const DROP = kpi('call_drop_rate_4g', '4G Call Drop Rate', 1.5, true)
const PRB = kpi('prb_utilization', '4G Peak Hour PRB Utilization', 90, true)
const AVAIL = kpi('availability', '4G Cell Availability', null, false)
const VOL = { ...kpi('data_volume', 'Data Volume', null, false, 'MB'), agg: 'sum' as const, capacity: true }
const ALL = { [CSSR.key]: CSSR, [DROP.key]: DROP, [PRB.key]: PRB, [AVAIL.key]: AVAIL, [VOL.key]: VOL }

function input(p: Partial<RcaInput>): RcaInput {
  return { tech: '4G', selected: CSSR, risk: 'Likely Breach', latest: {}, priorMean: {}, kpis: ALL, ...p }
}

describe('rule-of-thumb hints from imported values (spec §7)', () => {
  it('stable rows get Normal / Stable', () => {
    const r = diagnoseRca(input({ risk: 'Stable', latest: { call_setup_success_4g: 99.2 } }))
    expect(r.hint).toEqual({ category: 'Normal / Stable', action: 'Continue standard performance monitoring.' })
    expect(r.hintNote).toBe('rule of thumb')
  })

  it('capacity from real PRB past its target', () => {
    const r = diagnoseRca(input({ latest: { prb_utilization: 92, call_setup_success_4g: 98.0, availability: 99.9 } }))
    expect(r.hint?.category).toBe('Capacity Exhaustion')
    expect(r.hint?.action).toContain('Massive MIMO')
    expect(r.hintNote).toBe('rule of thumb')
  })

  it('hardware from availability below 95', () => {
    const r = diagnoseRca(input({ latest: { availability: 91, prb_utilization: 95 } }))
    expect(r.hint?.category).toBe('Hardware & VSWR')
  })

  it('a drop KPI past target points at RF', () => {
    const r = diagnoseRca(input({ selected: DROP, latest: { call_drop_rate_4g: 2.1, prb_utilization: 60, availability: 99.9 } }))
    expect(r.hint?.category).toBe('RF Overshoot & Interference')
  })

  it('a CSSR past target points at parameters', () => {
    const r = diagnoseRca(input({ latest: { call_setup_success_4g: 97.9, prb_utilization: 60, availability: 99.9 } }))
    expect(r.hint?.category).toBe('Parameter & Handover')
  })

  it('traffic surge from volume growth against the prior mean', () => {
    const r = diagnoseRca(input({
      latest: { call_setup_success_4g: 98.9, prb_utilization: 60, availability: 99.9, data_volume: 1300 },
      priorMean: { data_volume: 1000 }
    }))
    expect(r.hint?.category).toBe('Traffic Surge')
  })

  it('nothing imported to judge by: no hint, and the note names what is missing (spec test 18)', () => {
    const r = diagnoseRca(input({ latest: {} }))
    expect(r.hint).toBeNull()
    expect(r.hintNote).toBe('No hint — 4G Call Connection Success Rate not imported')
  })

  it('inputs present but no rule matches', () => {
    const r = diagnoseRca(input({ latest: { call_setup_success_4g: 98.9, prb_utilization: 60, availability: 99.9, data_volume: 1000 }, priorMean: { data_volume: 1000 } }))
    expect(r.hint).toBeNull()
    expect(r.hintNote).toBe('No rule matched')
  })
})
