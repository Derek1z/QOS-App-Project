/** Forecast models (spec §5.1). Pure functions, no I/O.
 *
 *  Damped Holt and Holt-Winters use one-pass fitting: for a fixed parameter
 *  set the smoothing recursion does not depend on where training stops, so one
 *  pass over the whole series records, at every t, the one-step squared error
 *  so far and the state after y[0..t). Fitting on [0, t) then reads those values
 *  at t — they depend only on data before t, so this is exact, not an
 *  approximation, and it gives every backtest origin its own fit. */

const ALPHAS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
const BETAS = [0.05, 0.1, 0.2, 0.3]
const PHIS = [0.8, 0.9, 0.98]
const GAMMAS = [0.05, 0.1, 0.2, 0.3]
export const SEASON = 7

export interface HoltState { level: number; trend: number; phi: number }
export interface HoltWintersState extends HoltState { seasonal: number[]; end: number }

/** φ + φ² + … + φ^h */
function dampSum(phi: number, h: number): number {
  let s = 0
  let p = 1
  for (let k = 1; k <= h; k++) {
    p *= phi
    s += p
  }
  return s
}

/** Damped-trend Holt over every (α, β, φ); the returned function gives the
 *  best fit on y[0..end) (lowest one-step squared error). Needs end ≥ 8. */
export function holtGrid(y: number[]): (end: number) => HoltState {
  const n = y.length
  const combos: Array<[number, number, number]> = []
  for (const a of ALPHAS) for (const b of BETAS) for (const p of PHIS) combos.push([a, b, p])
  const w = n + 1
  const sse = new Float64Array(combos.length * w)
  const lv = new Float64Array(combos.length * w)
  const tr = new Float64Array(combos.length * w)
  for (let c = 0; c < combos.length; c++) {
    const [a, b, p] = combos[c]
    const o = c * w
    let l = y[0]
    let t = y[1] - y[0]
    let s = 0
    lv[o + 1] = l
    tr[o + 1] = t
    for (let i = 1; i < n; i++) {
      const e = y[i] - (l + p * t)
      s += e * e
      const nl = a * y[i] + (1 - a) * (l + p * t)
      t = b * (nl - l) + (1 - b) * p * t
      l = nl
      sse[o + i + 1] = s
      lv[o + i + 1] = l
      tr[o + i + 1] = t
    }
  }
  return (end: number): HoltState => {
    let best = 0
    for (let c = 1; c < combos.length; c++) if (sse[c * w + end] < sse[best * w + end]) best = c
    return { level: lv[best * w + end], trend: tr[best * w + end], phi: combos[best][2] }
  }
}

export function holtForecast(s: HoltState, h: number): number {
  return s.level + dampSum(s.phi, h) * s.trend
}

/** Additive Holt-Winters with a damped trend and a 7-period season over every
 *  (α, β, φ, γ). Initial level and trend come from the first two seasons, the
 *  initial seasonals from both seasons' deviations from their means; the error
 *  is counted from index 14 (after that window). Needs end ≥ 21. */
export function holtWintersGrid(y: number[]): (end: number) => HoltWintersState {
  const n = y.length
  const m = SEASON
  const mean = (from: number): number => {
    let s = 0
    for (let i = from; i < from + m; i++) s += y[i]
    return s / m
  }
  const m1 = mean(0)
  const m2 = mean(m)
  const init = Array.from({ length: m }, (_, j) => ((y[j] - m1) + (y[j + m] - m2)) / 2)
  const combos: Array<[number, number, number, number]> = []
  for (const a of ALPHAS) for (const b of BETAS) for (const p of PHIS) for (const g of GAMMAS) combos.push([a, b, p, g])
  const w = n + 1
  const sse = new Float64Array(combos.length * w)
  const lv = new Float64Array(combos.length * w)
  const tr = new Float64Array(combos.length * w)
  // seasonal state after y[0..t): s[(t * m + j)] per combo would be large; store
  // the season vector only where it is read (every t), as a flat array per combo
  const se = new Float64Array(combos.length * w * m)
  for (let c = 0; c < combos.length; c++) {
    const [a, b, p, g] = combos[c]
    const o = c * w
    let l = m1
    let t = (m2 - m1) / m
    const s = init.slice()
    let acc = 0
    for (let i = 0; i < n; i++) {
      const si = s[i % m]
      const e = y[i] - (l + p * t + si)
      if (i >= 2 * m) acc += e * e
      const nl = a * (y[i] - si) + (1 - a) * (l + p * t)
      t = b * (nl - l) + (1 - b) * p * t
      s[i % m] = g * (y[i] - nl) + (1 - g) * si
      l = nl
      sse[o + i + 1] = acc
      lv[o + i + 1] = l
      tr[o + i + 1] = t
      const so = (o + i + 1) * m
      for (let j = 0; j < m; j++) se[so + j] = s[j]
    }
  }
  return (end: number): HoltWintersState => {
    let best = 0
    for (let c = 1; c < combos.length; c++) if (sse[c * w + end] < sse[best * w + end]) best = c
    const so = (best * w + end) * m
    return {
      level: lv[best * w + end],
      trend: tr[best * w + end],
      phi: combos[best][2],
      seasonal: Array.from(se.subarray(so, so + m)),
      end
    }
  }
}

export function holtWintersForecast(s: HoltWintersState, h: number): number {
  return s.level + dampSum(s.phi, h) * s.trend + s.seasonal[(s.end - 1 + h) % SEASON]
}

export function naiveForecast(y: number[], end: number): number {
  return y[end - 1]
}

/** Needs end ≥ 3. */
export function driftForecast(y: number[], end: number, h: number): number {
  return y[end - 1] + (h * (y[end - 1] - y[0])) / (end - 1)
}

/** Needs end ≥ 14. */
export function seasonalNaiveForecast(y: number[], end: number, h: number): number {
  return y[end - SEASON + ((h - 1) % SEASON)]
}
