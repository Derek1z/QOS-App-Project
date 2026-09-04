import { describe, it, expect } from 'vitest'
import {
  evaluateDerivedKpi,
  DL_POWER_CONGESTION_CONFIG,
  UL_CE_CONGESTION_CONFIG,
  PHYCH_FAILURES_CONFIG,
  detectCandidateDerivedKpis
} from '../../src/main/kpi/derivedKpiEngine'

describe('Derived KPI Engine', () => {
  it('calculates 3G DL Power Congestion row-by-row when all counters are present', () => {
    const row = {
      'VS.RRC.Rej.DLPower.Cong': 4,
      'VS.RAB.FailEstabPS.DLPower.Cong': 7,
      'VS.RAB.FailEstabCS.DLPower.Cong': 3
    }
    const result = evaluateDerivedKpi(row, DL_POWER_CONGESTION_CONFIG)
    expect(result).toBe(14)
  })

  it('calculates 3G UL CE Congestion row-by-row', () => {
    const row = {
      'VS.RRC.Rej.ULCE.Cong': 2,
      'VS.RAB.FailEstabPS.ULCE.Cong': 5,
      'VS.RAB.FailEstabCS.ULCE.Cong': 1
    }
    const result = evaluateDerivedKpi(row, UL_CE_CONGESTION_CONFIG)
    expect(result).toBe(8)
  })

  it('calculates 3G PhyCh Failures row-by-row', () => {
    const row = {
      'VS.RAB.FailEstabPS.PhyChFail': 6,
      'VS.FailRBRecfg.PhyChFail': 3,
      'VS.FailRBSetup.PhyChFail': 4
    }
    const result = evaluateDerivedKpi(row, PHYCH_FAILURES_CONFIG)
    expect(result).toBe(13)
  })

  it('returns null if any required counter is null (strict null safety)', () => {
    const row = {
      'VS.RRC.Rej.DLPower.Cong': 4,
      'VS.RAB.FailEstabPS.DLPower.Cong': null,
      'VS.RAB.FailEstabCS.DLPower.Cong': 3
    }
    const result = evaluateDerivedKpi(row, DL_POWER_CONGESTION_CONFIG)
    expect(result).toBeNull()
  })

  it('detects candidate derived KPIs from incoming counter headers using smart pattern intelligence', () => {
    const headers = [
      'Date',
      'Cell',
      'VS.RRC.Rej.DLPower.Cong',
      'VS.RAB.FailEstabPS.DLPower.Cong',
      'VS.RAB.FailEstabCS.DLPower.Cong',
      'Unlinked_Failure_Counter_1',
      'Unlinked_Failure_Counter_2'
    ]
    const candidates = detectCandidateDerivedKpis(headers)
    expect(candidates.some(c => c.id === '3g_dl_power_congestion')).toBe(true)
  })
})
