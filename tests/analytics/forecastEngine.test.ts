import { describe, it, expect } from 'vitest'
import {
  forecastSeries, backtestForecastAt, maxBacktestableHorizon,
  type ForecastOptions, type ModelId
} from '../../src/main/analytics/forecasting/engine'

/** Seeded PRNG so every run sees the same series. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function dates(n: number, stepDays: number, start = '2026-01-05'): string[] {
  const out: string[] = []
  const d0 = new Date(start + 'T00:00:00Z').getTime()
  for (let i = 0; i < n; i++) out.push(new Date(d0 + i * stepDays * 86400000).toISOString().slice(0, 10))
  return out
}

const weekly = (horizon: number, domain: ForecastOptions['domain'] = 'none'): ForecastOptions =>
  ({ grain: 'weekly', horizon, domain, periodNoun: 'weeks' })

function linearSeries(n: number, seed = 1): number[] {
  const r = mulberry32(seed)
  return Array.from({ length: n }, (_, i) => 40 + 0.5 * i + (r() - 0.5) * 0.4)
}

/** Origins the engine uses for a model: the last ≤ 20 t with t ≥ the model's minimum. */
function originsFor(n: number, min: number): number[] {
  const out: number[] = []
  for (let t = n - 1; t >= Math.max(1, min) && out.length < 20; t--) out.push(t)
  return out
}
const MIN: Record<ModelId, number> = { naive: 1, drift: 3, 'damped-holt': 8, 'seasonal-naive': 14, 'holt-winters': 21 }

describe('forecast engine (spec §5)', () => {
  it('constant series chooses naive, with no NaN anywhere', () => {
    const v = Array(20).fill(50)
    const f = forecastSeries(v, dates(20, 7), weekly(4))
    expect(f.method).toBe('naive')
    expect(f.quality).toBe('Naive only')
    expect(f.points.map((p) => p.value)).toEqual([50, 50, 50, 50])
    expect(Number.isFinite(f.mase ?? 0)).toBe(true)
    expect(JSON.stringify(f)).not.toMatch(/NaN|Infinity/)
  })

  it('linear growth beats naive and lands near the true continuation', () => {
    const v = linearSeries(30)
    const f = forecastSeries(v, dates(30, 7), weekly(4))
    expect(['drift', 'damped-holt']).toContain(f.method)
    expect(f.mase!).toBeLessThan(1)
    const truth = 40 + 0.5 * 33
    expect(Math.abs(f.points[3].value - truth) / truth).toBeLessThan(0.02)
  })

  it('random walks rarely claim a Good forecast (no model can beat naive on them)', () => {
    let good = 0
    for (let s = 1; s <= 50; s++) {
      const r = mulberry32(1000 + s)
      const v: number[] = [50]
      for (let i = 1; i < 30; i++) v.push(v[i - 1] + (r() - 0.5) * 4)
      const f = forecastSeries(v, dates(30, 7), weekly(4))
      if (f.quality === 'Good') good++
    }
    expect(good).toBeLessThanOrEqual(5)
  })

  it('white noise around a level: smoothing beats naive', () => {
    const r = mulberry32(7)
    const v = Array.from({ length: 40 }, () => 45 + r() * 10)
    const f = forecastSeries(v, dates(40, 7), weekly(1))
    expect(f.method).not.toBe('naive')
    expect(f.mase!).toBeLessThan(1)
  })

  it('weekday pattern on daily data picks a seasonal model', () => {
    const r = mulberry32(3)
    const d = dates(56, 1) // starts Monday 2026-01-05
    const v = d.map((_, i) => (i % 7 >= 5 ? 30 : 60) + (r() - 0.5) * 2)
    const f = forecastSeries(v, d, { grain: 'daily', horizon: 7, domain: 'none', periodNoun: 'days' })
    expect(['seasonal-naive', 'holt-winters']).toContain(f.method)
    expect(f.mase!).toBeLessThan(1)
  })

  it('a daily series with a gap skips the seasonal models', () => {
    const r = mulberry32(3)
    const d = dates(57, 1)
    const v = d.map((_, i) => (i % 7 >= 5 ? 30 : 60) + (r() - 0.5) * 2)
    d.splice(30, 1)
    v.splice(30, 1)
    const f = forecastSeries(v, d, { grain: 'daily', horizon: 7, domain: 'none', periodNoun: 'days' })
    expect(['seasonal-naive', 'holt-winters']).not.toContain(f.method)
  })

  it('no look-ahead: later values do not change an earlier origin forecast', () => {
    const v = linearSeries(30, 5)
    const d = dates(30, 7)
    const before = backtestForecastAt(v, d, weekly(4), 'damped-holt', 20, 1)
    const changed = v.map((x, i) => (i >= 25 ? x * 3 : x))
    expect(backtestForecastAt(changed, d, weekly(4), 'damped-holt', 20, 1)).toBe(before)
  })

  it('band at h = 1 is the 80th percentile of the chosen model\'s past |errors|', () => {
    const v = linearSeries(30)
    const d = dates(30, 7)
    const f = forecastSeries(v, d, weekly(4))
    const m = f.method!
    const errs = originsFor(30, MIN[m]).map((t) => Math.abs(v[t] - backtestForecastAt(v, d, weekly(4), m, t, 1)))
    errs.sort((a, b) => a - b)
    const q = errs[Math.floor(0.8 * (errs.length - 1))]
    expect(f.points[0].upper! - f.points[0].value).toBeCloseTo(q, 9)
    expect(f.points[0].value - f.points[0].lower!).toBeCloseTo(q, 9)
  })

  it('no band where fewer than 5 backtest errors exist', () => {
    const v = linearSeries(8)
    const f = forecastSeries(v, dates(8, 7), weekly(4))
    expect(f.points[3].lower).toBeNull()
    expect(f.points[3].upper).toBeNull()
    expect(f.bandNote).toBe('too little history to estimate a range')
  })

  it('withheld below 4 complete periods, with the reason', () => {
    const f = forecastSeries([1, 2, 3], dates(3, 7), weekly(4))
    expect(f.quality).toBe('Withheld')
    expect(f.method).toBeNull()
    expect(f.points).toEqual([])
    expect(f.withheldReason).toBe('needs ≥ 4 complete weeks, has 3')
  })

  it('percent values are clamped to 0–100', () => {
    const v = Array.from({ length: 20 }, (_, i) => 80 + i)
    const f = forecastSeries(v, dates(20, 7), weekly(12, 'percent'))
    for (const p of f.points) {
      for (const x of [p.value, p.lower, p.upper]) {
        if (x != null) {
          expect(x).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThanOrEqual(100)
        }
      }
    }
  })

  it('maxBacktestableHorizon is n − 3', () => {
    expect(maxBacktestableHorizon(15)).toBe(12)
    expect(maxBacktestableHorizon(2)).toBe(0)
  })
})

// --- one-pass fitting equals refitting at every origin (spec test 19) -------

const ALPHAS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
const BETAS = [0.05, 0.1, 0.2, 0.3]
const PHIS = [0.8, 0.9, 0.98]
const GAMMAS = [0.05, 0.1, 0.2, 0.3]

/** Reference damped Holt: grid-fit from scratch on y (the training window only). */
function refHolt(y: number[]): (h: number) => number {
  let best: { sse: number; l: number; b: number; p: number } | null = null
  for (const a of ALPHAS) for (const bt of BETAS) for (const p of PHIS) {
    let l = y[0], b = y[1] - y[0], sse = 0
    for (let i = 1; i < y.length; i++) {
      const e = y[i] - (l + p * b)
      sse += e * e
      const nl = a * y[i] + (1 - a) * (l + p * b)
      b = bt * (nl - l) + (1 - bt) * p * b
      l = nl
    }
    if (best === null || sse < best.sse) best = { sse, l, b, p }
  }
  const f = best!
  return (h) => {
    let damp = 0
    for (let k = 1; k <= h; k++) damp += Math.pow(f.p, k)
    return f.l + damp * f.b
  }
}

/** Reference additive Holt-Winters (season 7, damped): fit from scratch on y. */
function refHw(y: number[]): (h: number) => number {
  const m = 7
  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length
  const m1 = mean(y.slice(0, 7)), m2 = mean(y.slice(7, 14))
  let best: { sse: number; l: number; b: number; p: number; s: number[] } | null = null
  for (const a of ALPHAS) for (const bt of BETAS) for (const p of PHIS) for (const g of GAMMAS) {
    let l = m1, b = (m2 - m1) / m
    const s = Array.from({ length: m }, (_, j) => ((y[j] - m1) + (y[j + 7] - m2)) / 2)
    let sse = 0
    for (let i = 0; i < y.length; i++) {
      const si = s[i % m]
      const e = y[i] - (l + p * b + si)
      if (i >= 14) sse += e * e
      const nl = a * (y[i] - si) + (1 - a) * (l + p * b)
      b = bt * (nl - l) + (1 - bt) * p * b
      s[i % m] = g * (y[i] - nl) + (1 - g) * si
      l = nl
    }
    if (best === null || sse < best.sse) best = { sse, l, b, p, s: [...s] }
  }
  const f = best!
  return (h) => {
    let damp = 0
    for (let k = 1; k <= h; k++) damp += Math.pow(f.p, k)
    return f.l + damp * f.b + f.s[(y.length - 1 + h) % m]
  }
}

describe('one-pass fitting equals refitting at every origin (spec test 19)', () => {
  it('damped Holt: 200 seeded series, every origin, h = 1..4', { timeout: 60000 }, () => {
    for (let s = 1; s <= 200; s++) {
      const r = mulberry32(s)
      const n = 10 + (s % 51)
      const v: number[] = [50]
      for (let i = 1; i < n; i++) v.push(v[i - 1] + (r() - 0.45) * 3)
      const d = dates(n, 7)
      for (let t = 8; t <= n - 1; t++) {
        const ref = refHolt(v.slice(0, t))
        for (let h = 1; h <= 4; h++) {
          expect(backtestForecastAt(v, d, weekly(4), 'damped-holt', t, h)).toBeCloseTo(ref(h), 9)
        }
      }
    }
  })

  it('Holt-Winters: 20 seeded daily series, every origin, h = 1..7', { timeout: 60000 }, () => {
    for (let s = 1; s <= 20; s++) {
      const r = mulberry32(500 + s)
      const n = 28 + s
      const d = dates(n, 1)
      const v = d.map((_, i) => (i % 7 >= 5 ? 30 : 60) + i * 0.1 + (r() - 0.5) * 3)
      const opts: ForecastOptions = { grain: 'daily', horizon: 7, domain: 'none', periodNoun: 'days' }
      for (let t = 21; t <= n - 1; t++) {
        const ref = refHw(v.slice(0, t))
        for (let h = 1; h <= 7; h++) {
          expect(backtestForecastAt(v, d, opts, 'holt-winters', t, h)).toBeCloseTo(ref(h), 9)
        }
      }
    }
  })
})
