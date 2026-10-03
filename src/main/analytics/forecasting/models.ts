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

const HOLT_COMBOS: Array<[number, number, number]> = []
for (const a of ALPHAS) for (const b of BETAS) for (const p of PHIS) HOLT_COMBOS.push([a, b, p])
const HW_COMBOS: Array<[number, number, number, number]> = []
for (const a of ALPHAS) for (const b of BETAS) for (const p of PHIS) for (const g of GAMMAS) HW_COMBOS.push([a, b, p, g])

/** slot[end] = index into the recorded states, or -1 when `end` is not read. */
function slotsFor(n: number, ends: number[] | undefined): { slot: Int32Array; count: number } {
  const slot = new Int32Array(n + 1).fill(-1)
  let count = 0
  for (const e of ends ?? Array.from({ length: n + 1 }, (_, i) => i)) {
    if (e >= 0 && e <= n && slot[e] < 0) slot[e] = count++
  }
  return { slot, count }
}

/** Damped-trend Holt over every (α, β, φ); the returned function gives the
 *  best fit on y[0..end) (lowest one-step squared error). Needs end ≥ 8.
 *  `ends` limits which fits are kept (the backtest origins and n); asking for
 *  another end throws. */
export function holtGrid(y: number[], ends?: number[]): (end: number) => HoltState {
  const n = y.length
  const C = HOLT_COMBOS.length
  const { slot, count } = slotsFor(n, ends)
  const sse = new Float64Array(C * count)
  const lv = new Float64Array(C * count)
  const tr = new Float64Array(C * count)
  for (let c = 0; c < C; c++) {
    const [a, b, p] = HOLT_COMBOS[c]
    const o = c * count
    let l = y[0]
    let t = y[1] - y[0]
    let s = 0
    if (slot[1] >= 0) {
      lv[o + slot[1]] = l
      tr[o + slot[1]] = t
    }
    for (let i = 1; i < n; i++) {
      const e = y[i] - (l + p * t)
      s += e * e
      const nl = a * y[i] + (1 - a) * (l + p * t)
      t = b * (nl - l) + (1 - b) * p * t
      l = nl
      const k = slot[i + 1]
      if (k >= 0) {
        sse[o + k] = s
        lv[o + k] = l
        tr[o + k] = t
      }
    }
  }
  const chosen: Array<HoltState | undefined> = new Array(count)
  return (end: number): HoltState => {
    const k = slot[end]
    if (k == null || k < 0) throw new Error(`holtGrid: end ${end} was not requested`)
    const cached = chosen[k]
    if (cached) return cached
    let best = 0
    for (let c = 1; c < C; c++) if (sse[c * count + k] < sse[best * count + k]) best = c
    return (chosen[k] = { level: lv[best * count + k], trend: tr[best * count + k], phi: HOLT_COMBOS[best][2] })
  }
}

export function holtForecast(s: HoltState, h: number): number {
  return s.level + dampSum(s.phi, h) * s.trend
}

/** Additive Holt-Winters with a damped trend and a 7-period season over every
 *  (α, β, φ, γ). Initial level and trend come from the first two seasons, the
 *  initial seasonals from both seasons' deviations from their means; the error
 *  is counted from index 14 (after that window). Needs end ≥ 21. */
export function holtWintersGrid(y: number[], ends?: number[]): (end: number) => HoltWintersState {
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
  const combos = HW_COMBOS
  const { slot, count: w } = slotsFor(n, ends)
  const sse = new Float64Array(combos.length * w)
  const lv = new Float64Array(combos.length * w)
  const tr = new Float64Array(combos.length * w)
  // the season vector is kept only at the requested ends
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
      const k = slot[i + 1]
      if (k >= 0) {
        sse[o + k] = acc
        lv[o + k] = l
        tr[o + k] = t
        const so = (o + k) * m
        for (let j = 0; j < m; j++) se[so + j] = s[j]
      }
    }
  }
  const chosen: Array<HoltWintersState | undefined> = new Array(w)
  return (end: number): HoltWintersState => {
    const k = slot[end]
    if (k == null || k < 0) throw new Error(`holtWintersGrid: end ${end} was not requested`)
    const cached = chosen[k]
    if (cached) return cached
    let best = 0
    for (let c = 1; c < combos.length; c++) if (sse[c * w + k] < sse[best * w + k]) best = c
    const so = (best * w + k) * m
    return (chosen[k] = {
      level: lv[best * w + k],
      trend: tr[best * w + k],
      phi: combos[best][2],
      seasonal: Array.from(se.subarray(so, so + m)),
      end
    })
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
