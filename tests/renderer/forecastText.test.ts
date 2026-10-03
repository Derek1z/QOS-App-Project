import { describe, it, expect } from 'vitest'
import { modelLine, updatingLine, METHOD_LABEL } from '../../src/renderer/lib/forecastText'
import type { ForecastSummary } from '../../shared/api'

const base: ForecastSummary = {
  method: 'damped-holt', quality: 'Good', maeH1: 0.31, maeH: 0.84, mase: 0.68, betterThanNaivePct: 32,
  backtestOrigins: 18, withheldReason: null, bandNote: null, growthPct: null
}

describe('forecast page text (spec §9.2)', () => {
  it('Good: model, backtest MAE at the horizon, gain over naive, backtest points, quality', () => {
    expect(modelLine(base, '%', 4, 'weeks')).toBe('Damped Holt · backtest MAE 0.8 pp at 4 weeks · 32% better than naive · 18 backtest points · Good')
  })

  it('Fair, singular horizon, non-% unit', () => {
    expect(modelLine({ ...base, method: 'drift', quality: 'Fair', maeH: 12.4, betterThanNaivePct: 9, backtestOrigins: 11 }, 'MB', 1, 'weeks'))
      .toBe('Drift · backtest MAE 12.4 MB at 1 week · 9% better than naive · 11 backtest points · Fair')
  })

  it('Naive only says no model beats naive', () => {
    expect(modelLine({ ...base, method: 'naive', quality: 'Naive only', mase: 1, betterThanNaivePct: 0, backtestOrigins: 20 }, '%', 4, 'weeks'))
      .toBe("Naive · no model beats 'same as last period' · 20 backtest points")
  })

  it('Withheld shows the reason', () => {
    expect(modelLine({ ...base, method: null, quality: 'Withheld', withheldReason: 'needs ≥ 4 complete weeks, has 2' }, '%', 4, 'weeks'))
      .toBe('needs ≥ 4 complete weeks, has 2')
  })

  it('falls back to the h = 1 error when the horizon has no backtest error', () => {
    expect(modelLine({ ...base, maeH: null }, '%', 12, 'weeks')).toContain('backtest MAE 0.3 pp at 1 week')
  })

  it('updating line with thousands separators, null when idle', () => {
    expect(updatingLine({ running: true, done: 12500, total: 60000, asOf: { weekly: null, monthly: null } }))
      .toBe('Forecasts updating — 12,500 of 60,000 cells')
    expect(updatingLine({ running: false, done: 0, total: 0, asOf: { weekly: null, monthly: null } })).toBeNull()
  })

  it('every method has a label', () => {
    expect(Object.keys(METHOD_LABEL).sort()).toEqual(['damped-holt', 'drift', 'holt-winters', 'naive', 'seasonal-naive'])
  })
})
