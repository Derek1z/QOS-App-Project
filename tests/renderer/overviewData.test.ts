import { describe, it, expect } from 'vitest'
import type { DynamicKpiCardData, NcMovementRow } from '../../shared/api'
import {
  trendArrow, targetLabel, toKpiCardProps, movementSeries, breachSeries, kpiFilterOptions, bannerSummary
} from '../../src/renderer/lib/overviewData'
import { formatTimeLabel } from '../../src/renderer/lib/overviewCharts'

const CSSR_3G: DynamicKpiCardData = {
  kpiId: 7,
  key: 'call_setup_success_3g',
  label: '3G CSSR',
  technology: '3G',
  unit: '%',
  category: 'Accessibility',
  isCore: true,
  isDerived: false,
  currentValue: 98.2,
  previousValue: 97.9,
  formattedValue: '98.2 %',
  target: 95,
  warningThreshold: null,
  criticalThreshold: null,
  betterDirection: 'higher_is_better',
  worseIsHigher: false,
  complianceStatus: 'non_compliant',
  trend: 'unknown',
  delta: 0.3,
  deltaPct: 0.3,
  nonCompliantCellCount: 4,
  nonCompliantCellPct: 1.6,
  persistentNcCount: 1,
  sparkline: [97.9, 98.2],
  sparklineDates: ['2026-07-20', '2026-07-27'],
  missingSources: [],
  isBreached: false
}

const MOVEMENT: NcMovementRow[] = [
  {
    weekStart: '2026-07-20', newNc: 3, recurring: 1, intermittent: 2, persistent: 2, chronic: 1, recovering: 4, ncCells: 6, totalCells: 100, ncRate: 6,
    coreKpiNcRates: {
      call_setup_success_3g: { key: 'call_setup_success_3g', label: '3G CSSR', unit: '%', ncRate: 3, breachedCells: 3, totalCells: 100, worseIsHigher: false },
      call_drop_rate_3g: { key: 'call_drop_rate_3g', label: '3G Call Drop Rate', unit: '%', ncRate: 5, breachedCells: 5, totalCells: 100, worseIsHigher: true }
    }
  },
  {
    weekStart: '2026-07-27', newNc: 1, recurring: 2, intermittent: 0, persistent: 3, chronic: 2, recovering: 1, ncCells: 6, totalCells: 100, ncRate: 6,
    coreKpiNcRates: {
      call_drop_rate_3g: { key: 'call_drop_rate_3g', label: '3G Call Drop Rate', unit: '%', ncRate: 7, breachedCells: 7, totalCells: 100, worseIsHigher: true }
    }
  }
]

describe('KPI card trend arrow', () => {
  it('points the arrow the way the value moved, given the KPI direction', () => {
    expect([
      trendArrow('improving', false), // CSSR rose
      trendArrow('improving', true), // drop rate fell
      trendArrow('worsening', false), // CSSR fell
      trendArrow('worsening', true), // drop rate rose
      trendArrow('stable', true)
    ]).toEqual(['↑', '↓', '↓', '↑', '→'])
  })
})

describe('KPI target label', () => {
  it('uses >= for higher-is-better and <= for lower-is-better KPIs', () => {
    expect([
      targetLabel(95, false, '%'),
      targetLabel(1, true, '%'),
      targetLabel(10000, false, 'kbps'),
      targetLabel(null, true, '%')
    ]).toEqual(['≥ 95%', '≤ 1%', '≥ 10000 kbps', undefined])
  })
})

describe('KPI card props from executive overview data', () => {
  it('maps value, target, NC counts, direction and statuses onto the card', () => {
    expect(toKpiCardProps(CSSR_3G)).toEqual({
      key: 'call_setup_success_3g',
      name: '3G CSSR',
      isDerived: false,
      value: 98.2,
      displayUnit: '%',
      targetStr: '≥ 95%',
      status: 'breach',
      trend: 'stable',
      worseIsHigher: false,
      ncCount: 4,
      ncPct: 1.6
    })
  })
})

describe('Overview chart series', () => {
  it('labels NC lifecycle movement by ISO week', () => {
    expect(movementSeries(MOVEMENT, 'weekly')).toEqual([
      { label: 'W30', complete: true, newNc: 3, recurring: 1, intermittent: 2, persistent: 2, chronic: 1, recovering: 4 },
      { label: 'W31', complete: true, newNc: 1, recurring: 2, intermittent: 0, persistent: 3, chronic: 2, recovering: 1 }
    ])
  })

  it('sums breached cells over all core KPIs, or takes one KPI', () => {
    expect(breachSeries(MOVEMENT, 'totality', 'weekly')).toEqual([
      { label: 'W30', complete: true, totalBreaches: 8 },
      { label: 'W31', complete: true, totalBreaches: 7 }
    ])
    expect(breachSeries(MOVEMENT, 'call_setup_success_3g', 'weekly')).toEqual([
      { label: 'W30', complete: true, totalBreaches: 3 },
      { label: 'W31', complete: true, totalBreaches: 0 }
    ])
  })

  it('labels a partial week with its coverage', () => {
    const rows = movementSeries(
      [
        { ...MOVEMENT[0], weekStart: '2026-07-13', complete: true, daysWithData: 7 },
        { ...MOVEMENT[1], weekStart: '2026-07-20', complete: false, daysWithData: 3 }
      ],
      'weekly'
    )
    expect(rows[0].label).toBe(formatTimeLabel('2026-07-13', 'weekly'))
    expect(rows[1].label).toBe(`${formatTimeLabel('2026-07-20', 'weekly')} · 3 of 7 days`)
    expect(rows[1].complete).toBe(false)
  })

  it('marks a partial week in the breach series too', () => {
    const rows = breachSeries(
      [
        { ...MOVEMENT[0], weekStart: '2026-07-13', complete: true, daysWithData: 7 },
        { ...MOVEMENT[1], weekStart: '2026-07-20', complete: false, daysWithData: 3 }
      ],
      'totality',
      'weekly'
    )
    expect(rows[0].complete).toBe(true)
    expect(rows[1].complete).toBe(false)
    expect(rows[1].label).toBe(`${formatTimeLabel('2026-07-20', 'weekly')} · 3 of 7 days`)
  })

  it('offers totality plus every core KPI present in the movement data', () => {
    expect(kpiFilterOptions(MOVEMENT)).toEqual([
      { key: 'totality', label: '🌐 All Core KPIs (Totality)' },
      { key: 'call_setup_success_3g', label: '3G CSSR' },
      { key: 'call_drop_rate_3g', label: '3G Call Drop Rate' }
    ])
  })
})

describe('Overview banner summary', () => {
  it('reports health, cells and the latest lifecycle split of the active technology', () => {
    const summary = bannerSummary(
      { technology: '3G', healthScore: 87.5, cellCount: 100, ncCellCount: 6, compliancePct: 94, primaryKpis: [], availableKpiCards: [] },
      MOVEMENT[MOVEMENT.length - 1]
    )
    expect(summary).toEqual({ healthPct: 87.5, cells: 100, ncCells: 6, newNc: 1, recurring: 2, intermittent: 0, persistent: 3, chronic: 2, recovering: 1 })
  })

  it('reports no health and no cells when the technology has no data', () => {
    expect(bannerSummary(undefined, undefined)).toEqual({
      healthPct: null, cells: 0, ncCells: 0, newNc: 0, recurring: 0, intermittent: 0, persistent: 0, chronic: 0, recovering: 0
    })
  })
})
