import { describe, it, expect } from 'vitest'
import { classifyRisk, RISK_RANK } from '../../src/main/analytics/forecasting/risk'
import type { SeriesForecast, HorizonPoint } from '../../src/main/analytics/forecasting/engine'

function fc(points: Array<[number, number | null, number | null]>, mae1 = 0.1): SeriesForecast {
  const pts: HorizonPoint[] = points.map(([value, lower, upper], i) => ({ h: i + 1, value, lower, upper }))
  return {
    method: 'drift', quality: 'Good', points: pts, maeByH: pts.map(() => mae1),
    mase: 0.7, backtestOrigins: 10, withheldReason: null, bandNote: null
  }
}
const withheld: SeriesForecast = {
  method: null, quality: 'Withheld', points: [], maeByH: [], mase: null,
  backtestOrigins: 0, withheldReason: 'needs ≥ 4 complete weeks, has 2', bandNote: null
}
const base = { worseIsHigher: true, horizon: 4, label: '2G TCH Congestion', unit: '%' }

describe('risk states (spec §5.6, first match wins)', () => {
  it('already breached: latest past target, even with a withheld forecast', () => {
    const r = classifyRisk({ ...base, latest: 2.4, target: 2, forecast: withheld })
    expect(r.risk).toBe('Already Breached')
    expect(r.explanation).toContain('2G TCH Congestion')
  })

  it('likely breach: a point forecast within the horizon is past target', () => {
    const r = classifyRisk({ ...base, latest: 1.5, target: 2, forecast: fc([[1.7, 1.5, 1.9], [2.1, 1.8, 2.4], [2.2, 1.9, 2.5], [2.3, 2, 2.6]]) })
    expect(r.risk).toBe('Likely Breach')
    expect(r.explanation).toContain('2G TCH Congestion')
  })

  it('only points within the horizon count', () => {
    const r = classifyRisk({ ...base, horizon: 1, latest: 1.5, target: 2, forecast: fc([[1.6, 1.5, 1.7], [2.5, 2.4, 2.6]]) })
    expect(r.risk).not.toBe('Likely Breach')
  })

  it('at risk: only the band\'s worse edge crosses target', () => {
    const r = classifyRisk({ ...base, latest: 1.5, target: 2, forecast: fc([[1.6, 1.4, 1.8], [1.8, 1.55, 2.05], [1.8, 1.5, 1.9], [1.8, 1.5, 1.9]]) })
    expect(r.risk).toBe('At Risk')
  })

  it('watch: worsens by more than the h = 1 backtest MAE, no crossing', () => {
    const r = classifyRisk({ ...base, latest: 1.0, target: 2, forecast: fc([[1.1, 1.0, 1.2], [1.2, 1.1, 1.3], [1.3, 1.2, 1.4], [1.4, 1.3, 1.5]], 0.2) })
    expect(r.risk).toBe('Watch')
  })

  it('stable otherwise', () => {
    const r = classifyRisk({ ...base, latest: 1.0, target: 2, forecast: fc([[1.0, 0.9, 1.1], [1.05, 0.9, 1.2], [1.0, 0.9, 1.1], [1.1, 0.9, 1.2]], 0.2) })
    expect(r.risk).toBe('Stable')
  })

  it('higher-is-better KPIs breach downwards', () => {
    const r = classifyRisk({ worseIsHigher: false, horizon: 4, label: '4G CSSR', unit: '%', latest: 99.0, target: 98.5,
      forecast: fc([[98.9, 98.7, 99.1], [98.2, 98.0, 98.4], [98.1, 97.9, 98.3], [98.0, 97.8, 98.2]]) })
    expect(r.risk).toBe('Likely Breach')
  })

  it('withheld forecast inside target is Withheld', () => {
    const r = classifyRisk({ ...base, latest: 1.0, target: 2, forecast: withheld })
    expect(r.risk).toBe('Withheld')
    expect(r.explanation).toContain('needs ≥ 4 complete weeks, has 2')
  })

  it('no target: no risk state, growth over the horizon instead', () => {
    const r = classifyRisk({ ...base, label: 'Data Volume', unit: 'MB', latest: 100, target: null,
      forecast: fc([[105, null, null], [110, null, null], [118, null, null], [125, null, null]]) })
    expect(r.risk).toBeNull()
    expect(r.growthPct).toBe(25)
  })

  it('risk rank orders the worst first', () => {
    expect(RISK_RANK['Already Breached']).toBeLessThan(RISK_RANK['Likely Breach'])
    expect(RISK_RANK.Stable).toBeLessThan(RISK_RANK.Withheld)
  })
})
