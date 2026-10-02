import { describe, it, expect } from 'vitest'
import { latestComplete } from '../../shared/periods'
import { bannerSummary } from '../../src/renderer/lib/overviewData'
import { getAvailableTelemetryMetrics } from '../../src/renderer/lib/investigationCharts'
import type { InvestigationResult, InvestigationWeek } from '../../shared/api'

const week = (weekStart: string, prbAvg: number, complete: boolean): InvestigationWeek => ({
  weekStart, prbAvg, throughputKbps: 20000, users: 10, volumeMb: 100, availability: 99.9,
  isNc: false, lifecycle: null, complete, daysWithData: complete ? 7 : 3
})

describe('current values come from the latest complete period (spec §3.1)', () => {
  it('the Overview banner reads the latest complete movement row', () => {
    const base = { recurring: 0, intermittent: 0, persistent: 0, chronic: 0, recovering: 0, ncCells: 0, totalCells: 10, ncRate: 0 }
    const movement = [
      { ...base, weekStart: '2026-07-13', newNc: 5, complete: true, daysWithData: 7 },
      { ...base, weekStart: '2026-07-20', newNc: 1, complete: false, daysWithData: 3 }
    ]
    expect(bannerSummary(undefined, latestComplete(movement)).newNc).toBe(5)
  })

  it('investigation tiles show the latest complete week, not the partial one', () => {
    const res = { weeks: [week('2026-07-13', 70, true), week('2026-07-20', 95, false)] } as unknown as InvestigationResult
    const prb = getAvailableTelemetryMetrics(res, '4G', 80).find((m) => m.id === 'prb')!
    expect(prb.currentValue).toBe(70)
  })
})
