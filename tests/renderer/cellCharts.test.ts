import { describe, it, expect } from 'vitest'
import type { CellDetail, CellWeekPoint } from '../../shared/api'
import { cellDetailOption } from '../../src/renderer/lib/cellCharts'

function week(weekStart: string, complete: boolean, daysWithData: number): CellWeekPoint {
  return {
    weekStart,
    prbAvg: 50,
    throughputKbps: 20000,
    users: 100,
    volumeMb: 500,
    availability: 99.5,
    breachDays: 0,
    isNc: false,
    lifecycle: 'Healthy',
    severity: 'Normal',
    complete,
    daysWithData
  }
}

const DETAIL: CellDetail = {
  cellId: 1,
  cellName: 'CELL-1',
  site: 'Site 1',
  district: 'District 1',
  region: 'Region 1',
  current: null,
  weeks: [
    week('2026-07-06', true, 7),
    week('2026-07-13', true, 7),
    week('2026-07-20', false, 3)
  ],
  kpis: []
}

describe('cell detail chart marks partial periods (fix wave item 4)', () => {
  it('labels the partial week with its day coverage', () => {
    const opt = cellDetailOption(DETAIL, 80, 'weekly', '4G')
    const xAxis = Array.isArray(opt.xAxis) ? opt.xAxis : [opt.xAxis]
    const labels = (xAxis[0] as { data?: string[] }).data ?? []
    expect(labels[2]).toMatch(/· 3 of 7 days$/)
    expect(labels[0]).not.toMatch(/·/)
  })

  it('draws the partial point hollow and lighter', () => {
    const opt = cellDetailOption(DETAIL, 80, 'weekly', '4G')
    const series = Array.isArray(opt.series) ? opt.series : [opt.series]
    const prbSeries = series.find((s) => s && (s as { name?: string }).name === 'PRB utilization') as { data?: unknown[] }
    const points = prbSeries?.data ?? []
    const partialPoint = points[2] as { itemStyle?: { opacity?: number }; symbol?: string }
    const completePoint = points[0] as { itemStyle?: { opacity?: number }; symbol?: string }
    expect(partialPoint.symbol).toBe('emptyCircle')
    expect(partialPoint.itemStyle?.opacity).toBe(0.45)
    expect(completePoint.symbol).toBe('circle')
    expect(completePoint.itemStyle?.opacity).toBe(1)
  })
})
