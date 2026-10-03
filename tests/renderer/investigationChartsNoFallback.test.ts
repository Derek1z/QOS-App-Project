import { describe, it, expect } from 'vitest'
import { getAvailableTelemetryMetrics } from '../../src/renderer/lib/investigationCharts'
import type { InvestigationResult, InvestigationWeek } from '../../shared/api'

/** Honest-forecasting spec §8: a KPI that was not imported is a gap in the
 *  investigation charts — never a constant or a formula of another KPI. */
function week(i: number, over: Partial<InvestigationWeek> = {}): InvestigationWeek {
  return {
    weekStart: `2026-06-${String(1 + i * 7).padStart(2, '0')}`, prbAvg: 60, throughputKbps: 4096, users: 100,
    volumeMb: 1000, availability: 99.9, isNc: true, lifecycle: 'Persistent NC', complete: true, daysWithData: 7, ...over
  }
}
const res = (weeks: InvestigationWeek[]): InvestigationResult => ({ weeks } as unknown as InvestigationResult)
const series = (metrics: ReturnType<typeof getAvailableTelemetryMetrics>, id: string) => metrics.find((m) => m.id === id)!

describe('investigation charts draw only imported values', () => {
  it('2G: missing congestion, CSSR, drop and voice are gaps on an NC cell with PRB', () => {
    const m = getAvailableTelemetryMetrics(res([week(0), week(1), week(2)]), '2G', 80)
    for (const id of ['tch_cong', 'sdcch_cong', 'cssr_2g', 'call_drop_2g', 'voice_traffic']) {
      expect(series(m, id).data.every((v) => v == null), id).toBe(true)
      expect(series(m, id).formattedCurrent, id).toBe('—')
    }
    // an imported value is drawn as is
    const withCssr = getAvailableTelemetryMetrics(res([week(0, { cssr: 98.7 })]), '2G', 80)
    expect(withCssr.some((x) => x.data.includes(98.7))).toBe(true)
  })

  it('3G: missing CSSR, drop, data access and congestion are gaps', () => {
    const m = getAvailableTelemetryMetrics(res([week(0), week(1)]), '3G', 80)
    for (const id of ['cssr_3g', 'call_drop_3g', 'dasr_3g']) {
      expect(series(m, id).data.every((v) => v == null), id).toBe(true)
    }
    // no invented "congestion" from PRB ÷ 5 (60 → 12)
    expect(m.some((x) => x.data.includes(12))).toBe(false)
    const da = getAvailableTelemetryMetrics(res([week(0, { dataAccess: 99.1 })]), '3G', 80)
    expect(series(da, 'dasr_3g').data[0]).toBe(99.1)
  })
})
