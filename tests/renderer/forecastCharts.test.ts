import { describe, it, expect } from 'vitest'
import { forecastChartOption } from '../../src/renderer/lib/forecastCharts'
import type { ForecastSeries, ForecastPoint } from '../../shared/api'

const pt = (weekStart: string, value: number, kind: 'actual' | 'forecast', o: Partial<ForecastPoint> = {}): ForecastPoint => ({
  weekStart, label: weekStart.slice(5), value, kind, lower: null, upper: null, complete: true, daysWithData: 7, ...o
})

function series(points: ForecastPoint[], threshold: number | null = 80): ForecastSeries {
  return {
    metric: 'prb_utilization', label: 'PRB', unit: '%', worseIsHigher: true, threshold, points,
    forecast: { method: 'drift', quality: 'Good', maeH1: 1, maeH: 1, mase: 0.7, betterThanNaivePct: 30, backtestOrigins: 10, withheldReason: null, bandNote: null, growthPct: null }
  }
}

type S = { name?: string; data?: unknown[]; markLine?: unknown }
const seriesOf = (o: ReturnType<typeof forecastChartOption>): S[] => o.series as S[]

describe('forecast chart (spec §3.2 partial periods, §5.4 band)', () => {
  const pts = [
    pt('2026-06-29', 60, 'actual'), pt('2026-07-06', 62, 'actual'), pt('2026-07-13', 64, 'actual'),
    pt('2026-07-20', 65, 'actual', { complete: false, daysWithData: 3 }),
    pt('2026-07-20', 66, 'forecast', { lower: 63, upper: 69 }), pt('2026-07-27', 68, 'forecast', { lower: 64, upper: 72 })
  ]

  it('draws the partial actual point hollow and dimmed', () => {
    const actual = seriesOf(forecastChartOption(series(pts))).find((s) => s.name === 'Actual')!
    const partial = actual.data![3] as { symbol: string; itemStyle: { opacity: number } }
    const full = actual.data![2] as { symbol: string; itemStyle: { opacity: number } }
    expect(partial.symbol).toBe('emptyCircle')
    expect(partial.itemStyle.opacity).toBe(0.45)
    expect(full.symbol).toBe('circle')
    expect(full.itemStyle.opacity).toBe(1)
  })

  it('the forecast line starts at the last complete point, not the partial one', () => {
    const fc = seriesOf(forecastChartOption(series(pts))).find((s) => s.name === 'Forecast')!
    expect(fc.data![2]).toBe(64)
    expect(fc.data![3]).toBeNull()
  })

  it('draws a band only where the backtest gives one', () => {
    const withBand = seriesOf(forecastChartOption(series(pts)))
    expect(withBand.some((s) => s.name === 'Range (80%)')).toBe(true)
    const noBand = seriesOf(forecastChartOption(series(pts.map((p) => ({ ...p, lower: null, upper: null })))))
    expect(noBand.some((s) => s.name === 'Range (80%)')).toBe(false)
  })

  it('draws a target line only when the KPI has a target', () => {
    expect(seriesOf(forecastChartOption(series(pts, 80))).find((s) => s.name === 'Actual')!.markLine).toBeDefined()
    expect(seriesOf(forecastChartOption(series(pts, null))).find((s) => s.name === 'Actual')!.markLine).toBeUndefined()
  })
})
