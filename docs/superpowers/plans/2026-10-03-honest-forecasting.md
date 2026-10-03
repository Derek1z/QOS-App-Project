# Honest Forecasting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Forecasting page forecasts real imported KPI series with standard models chosen by an out-of-sample backtest, stores per-cell forecasts in the background, and Investigation stops inventing KPI values.

**Architecture:** A pure engine (`src/main/analytics/forecasting/`) fits naive / drift / damped Holt / seasonal naive / Holt-Winters with one-pass fitting and a rolling-origin backtest. A data layer (`src/main/forecast/series.ts`) reads real series from `agg_cell_kpi_*` and the core columns of `agg_cell_*`, complete periods only. A background job (`src/main/forecast/job.ts`, `scheduler.ts`) stores per-cell weekly and monthly forecasts in `cell_forecasts` using a pool of Electron utility processes. A new `services/forecastService.ts` replaces the forecasting code in `queryService.ts`.

**Tech Stack:** Electron 43 (utilityProcess, `?modulePath`), TypeScript, DuckDB `@duckdb/node-api`, React 19, ECharts, vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-honest-forecasting-design.md` (approved 2026-10-03). Read it before any task; section numbers below refer to it.

## Global Constraints

- Work on branch `v2` in place. Commit locally only; never push, never open a PR.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never stage `.preview/vite.config.ts`, `2G_Huawei_KPIs_and_Counters_Specification.txt`, `4G_Huawei_KPIs_and_Counters_Specification.txt`, `.claude/`, `.superpowers/`.
- Gate for every commit, in this order: `npm run typecheck`, `npx vitest run`, `npm run smoke`; then `cp .superpowers/app_state.original.json app_state.json` and delete `/tmp/qos-smoke-*` and `/tmp/qos-userdata-*`. Tasks 5 and 10 also run `npm run verify:packaged`. DuckDB tests can time out under full-suite load: re-run a timed-out file alone before calling it a failure, and report it.
- UI dates are DD/MM/YYYY.
- Targets, direction (`worse_is_higher`), unit, decimals and time aggregation (`agg`) come only from `kpi_defs`. No hard-coded KPI target anywhere in forecasting.
- Complete periods only for fitting and "as of", via `src/main/analytics/periods.ts` (`latestPeriodSql`, `period_coverage`) and `shared/periods.ts` (`periodLabel`, `latestComplete`).
- No invented values: a missing value is `null` and is shown as "not imported" or a gap. No constant fill-ins, no formula of another KPI.
- Forecast pool processes never import `@duckdb/node-api` or any module that does.
- Exact values (spec §5): α ∈ {0.1, 0.2, …, 0.9}; β ∈ {0.05, 0.1, 0.2, 0.3}; φ ∈ {0.8, 0.9, 0.98}; γ ∈ {0.05, 0.1, 0.2, 0.3}; season 7; ≤ 20 backtest origins; a candidate needs ≥ 3 origins with an actual at h = 1; a band needs ≥ 5 errors at h; band = 80th percentile of |errors|; Good MASE ≤ 0.8, Fair 0.8 < MASE < 1; withheld below 4 complete periods; horizon H needs ≥ H + 3 complete periods; model minimums naive 1, drift 3, damped Holt 8, seasonal naive 14, Holt-Winters 21; tie order naive, drift, seasonal naive, damped Holt, Holt-Winters.
- Horizons (spec §4.3): weekly 1, 2, 4, 8, 12; monthly 1, 3, 6; daily 7, 14, 28. Stored forecasts run to 12 (weekly) and 6 (monthly).
- Background job (spec §6.1): batches of 5,000 cells; pool size `max(1, os.cpus().length - 1)`.
- Exact copy (spec): `no model beats 'same as last period'`; `too little history to estimate a range`; `needs ≥ 4 complete <periods>, has N`; `Per-cell daily risk is available for a site or cell — or switch to weekly`; `Per-cell forecasts not built — open the workspace writable once`; `Forecasts updating — N of M cells`; `No hint — <KPI> not imported`; `rule of thumb`; `Not assessed: <KPI> not imported`.

## Review Focus

1. **Flat series (zero naive error).** A KPI that is exactly constant gives naive MAE 0; MASE must not become NaN or Infinity. Expected: naive is chosen, quality "Naive only", no NaN anywhere in the result. Test in Task 1.
2. **Cell that stopped reporting.** A cell with history but no value in the latest complete period must not be forecast from stale data. Expected: stored as Withheld with reason `no data since DD/MM/YYYY`. Test in Task 4.
3. **Workspace with no complete period** (fewer than 7 days imported). Expected: every series Withheld with its reason, risk table empty with a note, no exception. Test in Task 7.
4. **Cancelled job.** A job cancelled mid-batch (new import) must leave the workspace consistent and be redone. Expected: `forecasts_*_as_of` not advanced, the next run recomputes, rows already written keep their own `as_of`. Test in Task 5.
5. **Target removed.** Clearing a KPI's target removes it from the stored set. Expected: its `cell_forecasts` rows are deleted on the next job and it no longer appears in the risk table. Test in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/analytics/forecasting/models.ts` (new) | Model fitting: one-pass Holt and Holt-Winters grids, naive, drift, seasonal naive |
| `src/main/analytics/forecasting/engine.ts` (new) | Backtest, selection, bands, withheld, quality: `forecastSeries` |
| `src/main/analytics/forecasting/risk.ts` (new) | Risk states and growth (spec §5.6) |
| `src/main/forecast/series.ts` (new) | Forecastable KPIs, value sources, batch and display series reads, aggregate series |
| `src/main/forecast/runner.ts` (new) | `ForecastRunner` interface and the in-process runner |
| `src/main/forecast/utilityRunner.ts`, `forecastWorker.ts` (new) | Utility-process pool and its entry |
| `src/main/forecast/job.ts` (new) | Job planning, running, storage, dirty marking |
| `src/main/forecast/scheduler.ts` (new) | Background scheduling, cancel, progress, status |
| `src/main/forecast/rca.ts` (new) | Rule-of-thumb hints from real values |
| `src/main/services/forecastService.ts` (new) | `getForecast` (page and report API) |
| `src/main/analytics/forecast.ts` (deleted in Task 7) | Old engine |
| `src/main/services/queryService.ts` | Old forecasting block removed (Task 7) |
| `src/main/workspace/schema.ts`, `manager.ts` | New `cell_forecasts`, `forecast_dirty`, migration, `onBeforeClose` |
| `src/main/import/importCore.ts` | Calls `markForecastDirty` |
| `src/main/services/investigationService.ts` | Fallbacks removed, `notAssessed` |
| `shared/api.ts`, `shared/forecast.ts` (new) | Forecast types and horizon constants |
| `src/main/ipc.ts`, `src/preload/index.ts` | Forecast status and progress |
| `src/renderer/modules/Forecasting.tsx`, `src/renderer/lib/forecastCharts.ts`, `src/renderer/lib/previewApi.ts` | Page, charts, preview mock |
| `src/main/services/reportingService.ts`, `src/main/smoke.ts`, `src/main/services/dimRepair.ts` | Consumers |
| `src/main/bench.ts` (new), `package.json` | `--bench-forecast` measurement (Task 10) |

---

### Task 1: Forecast engine (models, backtest, selection, bands, quality)

**Files:**
- Create: `src/main/analytics/forecasting/models.ts`, `src/main/analytics/forecasting/engine.ts`
- Test: `tests/analytics/forecastEngine.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (in `engine.ts`):
  ```ts
  export type ModelId = 'naive' | 'drift' | 'seasonal-naive' | 'damped-holt' | 'holt-winters'
  export type EngineQuality = 'Good' | 'Fair' | 'Naive only' | 'Withheld'
  export type UnitDomain = 'percent' | 'nonNegative' | 'none'
  export interface HorizonPoint { h: number; value: number; lower: number | null; upper: number | null }
  export interface ForecastOptions {
    grain: 'daily' | 'weekly' | 'monthly'
    horizon: number            // H
    domain: UnitDomain
    periodNoun: string         // plural, e.g. 'weeks' — used in the withheld reason
  }
  export interface SeriesForecast {
    method: ModelId | null     // null when withheld
    quality: EngineQuality
    points: HorizonPoint[]     // h = 1..H; [] when withheld
    maeByH: Array<number | null> // chosen model's backtest MAE at each h (index h-1); null if not backtestable
    mase: number | null
    backtestOrigins: number
    withheldReason: string | null
    bandNote: string | null    // 'too little history to estimate a range' when any h has no band
  }
  export function forecastSeries(values: number[], dates: string[], opts: ForecastOptions): SeriesForecast
  export function maxBacktestableHorizon(n: number): number // n - 3, never below 0
  export function backtestForecastAt(values: number[], dates: string[], opts: ForecastOptions, model: ModelId, t: number, h: number): number // fit on [0, t), forecast h; for tests
  ```
  `values` are the complete-period values in order (gaps already removed); `dates` are their ISO period starts, same length.

- [ ] **Step 1: Write the failing tests** in `tests/analytics/forecastEngine.test.ts`. Use a seeded generator (e.g. mulberry32) so runs are deterministic. Tests and assertions:
  - `constant series chooses naive` — 20 × 50.0 weekly, H = 4 → `method === 'naive'`, `quality === 'Naive only'`, every `points[i].value === 50`, and `JSON.stringify(result)` contains no `NaN`/`null` in `mase` position (`Number.isFinite(result.mase ?? 0)`). (Review Focus 1)
  - `linear growth beats naive` — `y = 40 + 0.5 i + noise(±0.2)`, 30 points, H = 4 → `method` is `'drift'` or `'damped-holt'`, `mase < 1`, `points[3].value` within 2% of `40 + 0.5 × 33`.
  - `pure noise is naive only` — 30 seeded values uniform in [45, 55] → `quality === 'Naive only'`.
  - `weekday pattern on daily data` — 56 daily points, value 60 on weekdays and 30 on Sat/Sun plus noise(±1), dates consecutive → `method` is `'seasonal-naive'` or `'holt-winters'`, `mase < 1`.
  - `daily series with a gap skips seasonal models` — same as above with one date removed → `method` not in seasonal set.
  - `no look-ahead` — for a 30-point series, record the backtest forecast the engine made at origin t = 20 (export `backtestForecastAt(values, dates, opts, model, t, h)` from `engine.ts` for this test); changing `values[25..29]` leaves it unchanged.
  - `band equals the 80th percentile of past errors` — on the linear series, `points[0].upper - points[0].value` equals the 80th percentile (index `floor(0.8 × (k − 1))` of the sorted |errors|, k = number of errors) of the chosen model's h = 1 errors (compute independently from `backtestForecastAt`).
  - `no band with fewer than 5 errors` — 8 points, H = 4 → points with h whose error count < 5 have `lower === null && upper === null`, and `bandNote === 'too little history to estimate a range'`.
  - `withheld below 4 points` — 3 points, `periodNoun: 'weeks'` → `quality === 'Withheld'`, `points.length === 0`, `withheldReason === 'needs ≥ 4 complete weeks, has 3'`.
  - `percent domain clamps` — steeply rising series near 100 with `domain: 'percent'` → every value, lower and upper in [0, 100].
  - `one-pass fitting equals refitting at every origin` — on 200 seeded series of lengths 10–60, compare `forecastSeries` with a test-local reference that refits the damped Holt grid from scratch on `[0, t)` at every origin (write the reference in the test file, ≈ 30 lines): same `method`, values equal to 1e-9. (Spec test 19)

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npx vitest run tests/analytics/forecastEngine.test.ts`
  Expected: FAIL — cannot resolve `src/main/analytics/forecasting/engine`.

- [ ] **Step 3: Implement `models.ts`**
  - `holtGrid(y: number[]): (end: number) => HoltState` — one pass per (α, β, φ) over the whole series, storing cumulative one-step squared error and state after `y[0..t)` for every t (typed arrays); the returned function picks the combination with the lowest cumulative error at `end` (ties: first in grid order α, β, φ ascending). Initial level `y[0]`, initial trend `y[1] − y[0]`. Requires `end ≥ 8`.
  - `holtForecast(s: HoltState, h: number): number` — `l + (φ + φ² + … + φ^h) t`.
  - `holtWintersGrid(y: number[], season = 7)` and `holtWintersForecast` — same one-pass technique, additive season, damped trend; initial seasonals from the first two seasons' deviations from their mean. Requires `end ≥ 21`.
  - `naiveForecast(y, end, h) = y[end-1]`; `driftForecast(y, end, h) = y[end-1] + h (y[end-1] − y[0]) / (end − 1)`, requires end ≥ 3; `seasonalNaiveForecast(y, end, h) = y[end - 7 + ((h - 1) % 7)]`, requires end ≥ 14.

- [ ] **Step 4: Implement `engine.ts`** per spec §5.2–§5.5:
  - Seasonal candidates only for `grain === 'daily'` and only when every consecutive pair of `dates` is one day apart.
  - Per model: origins = the last ≤ 20 t with `t ≥ min(model)` and `t ≤ n − 1`; errors at h recorded only when `t + h − 1 ≤ n − 1`; naive run on the same origins. Candidate if ≥ 3 origins have an h = 1 actual.
  - `MASE = modelMAE / naiveMAE` over all recorded (origin, h) pairs; if `naiveMAE === 0`, the model is not a candidate (naive stays) — this is the Review Focus 1 rule.
  - Choose lowest MASE < 1 (ties by tie order); else naive. `quality`: Good ≤ 0.8, Fair < 1, else 'Naive only'. Naive's own `mase` is reported as `1`.
  - Refit the chosen model on all n points for `points`; band from the chosen model's |errors| at h (naive's errors when naive is chosen); clamp value, lower, upper by `domain` (percent → [0, 100]; nonNegative → ≥ 0).
  - `backtestOrigins` = number of origins of the chosen model (naive: its origins on the full series, last ≤ 20 t ≥ 1).

- [ ] **Step 5: Run the tests to verify they pass**

  Run: `npx vitest run tests/analytics/forecastEngine.test.ts`
  Expected: all pass.

- [ ] **Step 6: Gate and commit**

  ```bash
  git add src/main/analytics/forecasting tests/analytics/forecastEngine.test.ts
  git commit -m "feat(forecast): engine with one-pass fitting and rolling-origin backtest"
  ```

---

### Task 2: Risk states and growth

**Files:**
- Create: `src/main/analytics/forecasting/risk.ts`
- Test: `tests/analytics/forecastRisk.test.ts`

**Interfaces:**
- Consumes: `SeriesForecast` from Task 1.
- Produces:
  ```ts
  export type RiskState = 'Stable' | 'Watch' | 'At Risk' | 'Likely Breach' | 'Already Breached' | 'Withheld'
  export interface RiskInput { latest: number | null; target: number | null; worseIsHigher: boolean; forecast: SeriesForecast; horizon: number; label: string; unit: string }
  export interface RiskResult { risk: RiskState | null; explanation: string; growthPct: number | null }
  export function classifyRisk(i: RiskInput): RiskResult
  export const RISK_RANK: Record<RiskState, number> // Already Breached 0, Likely Breach 1, At Risk 2, Watch 3, Stable 4, Withheld 5
  ```

- [ ] **Step 1: Write the failing tests**, one per row of spec §5.6 (first match wins), with hand-built `SeriesForecast` objects:
  - `already breached` — worseIsHigher, target 2, latest 2.4 → 'Already Breached' even when forecast is Withheld.
  - `likely breach` — target 2, latest 1.5, a point at h ≤ horizon with value 2.1 → 'Likely Breach'.
  - `at risk` — no point past target, but an upper bound 2.05 → 'At Risk'.
  - `watch` — latest 1.0, value at h = horizon 1.4, `maeByH[0] = 0.2`, band clear of target → 'Watch'.
  - `stable` — none of the above → 'Stable'.
  - `higher is better` — `worseIsHigher: false`, target 98.5, a point 98.2 → 'Likely Breach'.
  - `withheld` — Withheld forecast, latest inside target → `risk === 'Withheld'`.
  - `no target gives growth` — target null, latest 100, value at horizon 125 → `risk === null`, `growthPct === 25`.
  - Explanations: each contains the label and the formatted values (assert `toContain(label)`).

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/analytics/forecastRisk.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `classifyRisk`** in `risk.ts`. Only points with `h ≤ horizon` count.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Gate and commit** — `git commit -m "feat(forecast): risk states from forecast, band and backtest noise"`.

---

### Task 3: Series data layer

**Files:**
- Create: `src/main/forecast/series.ts`
- Test: `tests/forecast/series.test.ts`

**Interfaces:**
- Consumes: `kpi_defs`, `agg_cell_kpi_weekly|monthly`, `agg_cell_kpi_daily` (view), `agg_cell_weekly|monthly|daily`, `period_coverage`, `latestPeriodSql` from `src/main/analytics/periods.ts`.
- Produces:
  ```ts
  export type CoreColumn = 'prb_avg' | 'connected_users_sum' | 'data_volume_mb_sum' | 'dl_throughput_kbps_avg' | 'availability_pct_avg'
  export type SeriesGrain = 'daily' | 'weekly' | 'monthly'
  export interface ForecastKpi {
    key: string; label: string; unit: string; worseIsHigher: boolean; target: number | null
    agg: 'avg' | 'sum' | 'max' | 'min'; decimals: number; capacity: boolean
    source: { kind: 'kpi'; kpiId: number } | { kind: 'core'; column: CoreColumn }
  }
  export const CAPACITY_KEYS: Record<Technology, string[]>
  // 4G: connected_users, data_volume, dl_throughput, availability
  // 3G: connected_users, data_volume, hsdpa_throughput, availability_3g
  // 2G: connected_users, gprs_throughput, tch_availability
  export const CORE_COLUMN_FALLBACK: Record<Technology, Record<string, CoreColumn>>
  // 4G: prb_utilization→prb_avg, connected_users→connected_users_sum, data_volume→data_volume_mb_sum,
  //     dl_throughput→dl_throughput_kbps_avg, availability→availability_pct_avg
  // 3G: connected_users, data_volume, hsdpa_throughput→dl_throughput_kbps_avg, availability_3g→availability_pct_avg
  // 2G: connected_users, gprs_throughput→dl_throughput_kbps_avg, tch_availability→availability_pct_avg
  export interface ScopeRef { scope: 'network' | 'region' | 'district' | 'site' | 'cell'; id: number | null }
  export interface PeriodValue { period: string; value: number | null; complete: boolean; daysWithData: number }
  export interface CellSeries { values: number[]; dates: string[]; lastComplete: string | null }
  export async function forecastableKpis(conn: DuckDBConnection, tech: Technology, scope: ScopeRef): Promise<{ available: ForecastKpi[]; notImported: Array<{ key: string; label: string }> }>
  export async function readCellSeriesBatch(conn: DuckDBConnection, grain: SeriesGrain, kpis: ForecastKpi[], cellIds: number[]): Promise<Map<number, Map<string, CellSeries>>>
  export async function readDisplaySeries(conn: DuckDBConnection, grain: SeriesGrain, kpi: ForecastKpi, scope: ScopeRef): Promise<PeriodValue[]>
  export async function readOverTargetSeries(conn: DuckDBConnection, grain: SeriesGrain, kpi: ForecastKpi, scope: ScopeRef): Promise<PeriodValue[] | null> // null when target is null
  export function domainOf(kpi: ForecastKpi): UnitDomain // '%' → 'percent'; otherwise 'nonNegative'
  ```

- [ ] **Step 1: Verify the 3G/2G core mappings before coding.** Read `src/main/import/mapping.ts` aliases for the canonical `throughput` and `availability` fields and the `prb` field. Keep a `CORE_COLUMN_FALLBACK` entry only if a 3G/2G source column for that KPI maps to that canonical field. Record what you found, kept and dropped in the task report; the 3G "traffic utilisation via `prb`" question (spec §8) is answered here and reused in Task 8.

- [ ] **Step 2: Write the failing tests** (real DuckDB via `openRealWorkspace`, `insertCells`; insert `fact_cell_daily` / `fact_extra_metrics` rows, then `recomputeAllAggregates` and `refreshAllIntelligence`, as `tests/services/comparisonCompletePeriod.test.ts` does):
  - `kpi source wins over core fallback` — 4G, CSSR values in `fact_extra_metrics` → `available` contains `call_setup_success_4g` with `source.kind === 'kpi'`; `prb_utilization` (only in `fact_cell_daily`) has `source.kind === 'core'`, `column 'prb_avg'`.
  - `not imported KPIs are listed` — a 4G core KPI with no values anywhere (e.g. `data_service_failure_4g`) is in `notImported`, not in `available`.
  - `capacity flag` — `connected_users` has `capacity === true`; `call_drop_rate_4g` has `false`.
  - `cell batch uses complete weeks only` — data from Mon 2026-06-29 to Wed 2026-07-22 → each cell's weekly `dates` end at `2026-07-13`, partial `2026-07-20` absent; `lastComplete === '2026-07-13'`.
  - `agg rule respected` — a KPI with `agg = 'sum'` reads `sum_value`, an `avg` KPI reads `avg_value` (two KPIs, distinguishable values).
  - `display series marks partial` — `readDisplaySeries` for the same data includes `2026-07-20` with `complete: false, daysWithData: 3`.
  - `aggregate value is mean for rates, total for sums` — two cells, CSSR 98 and 96 → network value 97; `data_volume` 100 and 300 → 400.
  - `over-target count` — target 98.5 (`worse_is_higher` false), cells at 98 and 99 → over-target series value 1 for that period; target null → `readOverTargetSeries` returns null.

- [ ] **Step 3: Run to verify failure** — `npx vitest run tests/forecast/series.test.ts` → FAIL.
- [ ] **Step 4: Implement `series.ts`.** `readCellSeriesBatch` issues per (grain, source kind) one query returning only the value column as DOUBLE ordered by (cell_id, kpi, period) plus one query for the series lengths, as in spec §6.1 (no per-row objects). Complete periods: join `period_coverage` with `is_complete`. Scope filters follow the existing `getForecast` scope joins (cell, site, district, region via `dim_cell` ids).
- [ ] **Step 5: Run to verify pass.**
- [ ] **Step 6: Gate and commit** — `git commit -m "feat(forecast): real KPI series from kpi_defs, complete periods only"`.

---

### Task 4: Storage, job planning and running (in-process runner)

**Files:**
- Create: `src/main/forecast/runner.ts`, `src/main/forecast/job.ts`
- Modify: `src/main/workspace/schema.ts` (`cell_forecasts`, `forecast_dirty`), `src/main/workspace/manager.ts` (`ensureUpgradeSchema` migration), `src/main/import/importCore.ts` (call `markForecastDirty` after `updateCoverage`), `src/main/services/dimRepair.ts` (rebuild `cell_forecasts` with the new columns, deduped by `(cell_id, kpi_key, grain)`)
- Test: `tests/forecast/job.test.ts`

**Interfaces:**
- Consumes: Task 1 `forecastSeries`, `ForecastOptions`, `SeriesForecast`; Task 3 `ForecastKpi`, `readCellSeriesBatch`, `CAPACITY_KEYS`, `domainOf`.
- Produces:
  ```ts
  // runner.ts
  export interface SeriesJob { id: number; values: number[]; dates: string[]; opts: ForecastOptions }
  export interface ForecastRunner { run(jobs: SeriesJob[]): Promise<SeriesForecast[]>; dispose(): void }
  export const inProcessRunner: ForecastRunner
  // job.ts
  export type StoredGrain = 'weekly' | 'monthly'
  export interface ForecastJobPlan { grain: StoredGrain; asOf: string; cellIds: number[] | 'all'; kpiKeys: string[]; deleteKpiKeys: string[] }
  export async function storedForecastKpis(conn: DuckDBConnection, tech: Technology): Promise<ForecastKpi[]> // target ∪ CAPACITY_KEYS, with imported values
  export async function planForecastJob(conn: DuckDBConnection): Promise<ForecastJobPlan[]>
  export async function runForecastJob(conn: DuckDBConnection, plans: ForecastJobPlan[], runner: ForecastRunner,
    opts?: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal }): Promise<{ cells: number; series: number; cancelled: boolean }>
  export async function markForecastDirty(conn: DuckDBConnection, dateIds: number[]): Promise<void>
  export async function readStoredForecasts(conn: DuckDBConnection, grain: StoredGrain, kpiKey: string, cellIds: number[] | 'all'): Promise<Map<number, StoredForecast>>
  export interface StoredForecast { asOf: string; forecast: SeriesForecast }
  ```
  Schema (spec §6.1): `cell_forecasts(cell_id BIGINT, kpi_key VARCHAR, grain VARCHAR, as_of DATE, method VARCHAR, points JSON, mae_h1 DOUBLE, mase DOUBLE, backtest_origins INTEGER, quality VARCHAR, PRIMARY KEY (cell_id, kpi_key, grain))` — `points` also carries `maeByH`, `withheldReason` and `bandNote` (store the whole `SeriesForecast` minus `method`/`quality` columns as JSON); `forecast_dirty(grain VARCHAR, cell_id BIGINT, PRIMARY KEY (grain, cell_id))`; `workspace_meta` keys `forecasts_weekly_as_of`, `forecasts_monthly_as_of`.

- [ ] **Step 1: Write the failing tests** (real DuckDB):
  - `first run stores every cell × stored KPI × grain` — 3 cells, 10 complete weeks of CSSR (target set) + PRB + users → after `runForecastJob(conn, await planForecastJob(conn), inProcessRunner)`, `cell_forecasts` holds rows for (3 cells × stored KPIs × weekly) and monthly where monthly has data; `forecasts_weekly_as_of` = latest complete week.
  - `stored set` — a counter KPI without a target (e.g. `l_erab_abnormrel`) with values is not stored; `connected_users` (no target, capacity) is stored. (Spec test 21)
  - `no-op import` — plan after a run with no data change → `[]` (or plans with empty `cellIds` and `kpiKeys`), and `cell_forecasts` unchanged. (Spec test 20)
  - `backfill recomputes touched cells only` — after a run, insert a corrected value for cell 2 in an already-complete week, call `markForecastDirty(conn, [thatDateId])`, plan → weekly plan `cellIds` equals `[2]`.
  - `new complete week recomputes all` — add 7 more days → weekly plan `cellIds === 'all'` with the new `asOf`.
  - `KPI gaining a target is added` — set a target on a stored-able KPI with values, plan → that key in `kpiKeys` with `cellIds === 'all'`. (Spec test 20)
  - `target removed deletes rows` — clear CSSR's target, plan → `deleteKpiKeys` contains it; after run, no CSSR rows. (Review Focus 5)
  - `stale cell is withheld` — cell 3 has no value in the latest complete week → its stored forecast has `quality 'Withheld'` and `withheldReason` `no data since 06/07/2026` (DD/MM/YYYY of its last complete period). (Review Focus 2)
  - `old cell_forecasts is migrated` — create the old table shape (`cell_id, metric, horizon, as_of, …`) in a workspace, reopen writable → the table has `kpi_key` and `grain` columns.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement schema and migration.** In `ensureUpgradeSchema`, if `cell_forecasts` lacks column `kpi_key` (information_schema), `DROP TABLE cell_forecasts` and create the new one; create `forecast_dirty` if missing.
- [ ] **Step 4: Implement `runner.ts`, `job.ts` and the `importCore` call.** `markForecastDirty` inserts (grain, cell_id) for cells with facts on `dateIds` whose week (month) start is ≤ the stored `forecasts_weekly_as_of` (`forecasts_monthly_as_of`). `runForecastJob` processes 5,000 cells per batch: read, build `SeriesJob`s (H = 12 weekly, 6 monthly; `periodNoun` 'weeks'/'months'; domain from `domainOf`), `runner.run`, write with the DuckDB appender after deleting that batch's existing rows; checks `signal.aborted` between batches; on completion writes `forecasts_<grain>_as_of`, clears that grain's `forecast_dirty` rows and deletes rows of `deleteKpiKeys`. A cell × KPI whose `lastComplete` ≠ plan `asOf` is stored Withheld with the stale reason instead of being forecast.
- [ ] **Step 5: Update `dimRepair.ts`** so the `cell_forecasts` rebuild uses the new columns and key.
- [ ] **Step 6: Run to verify pass**, then the full gate (the import path now calls `markForecastDirty`).
- [ ] **Step 7: Commit** — `git commit -m "feat(forecast): stored per-cell forecasts with incremental job planning"`.

---

### Task 5: Utility-process pool, background scheduler, progress

**Files:**
- Create: `src/main/forecast/forecastWorker.ts`, `src/main/forecast/utilityRunner.ts`, `src/main/forecast/scheduler.ts`
- Modify: `src/main/workspace/manager.ts` (`onBeforeClose`), `src/main/import/importer.ts` (schedule after reopen), `src/main/ipc.ts` (schedule after writable `workspace:open`/`workspace:create`, after `snapshot` restore, after `kpis:save`/`kpis:saveTargets`/target reset, after maintenance rebuild; `forecast:status` handler; push `forecast:progress`), `src/main/services/maintenanceService.ts` (rebuild deletes both `forecasts_*_as_of` keys), `src/main/services/snapshotService.ts` (restore: same), `src/preload/index.ts` (`forecastStatus`, `onForecastProgress`), `shared/api.ts` (`ForecastStatus`), `src/main/smoke.ts` (pool check)
- Test: `tests/forecast/scheduler.test.ts`

**Interfaces:**
- Consumes: Task 4 `planForecastJob`, `runForecastJob`, `ForecastRunner`, `inProcessRunner`.
- Produces:
  ```ts
  // shared/api.ts
  export interface ForecastStatus { running: boolean; done: number; total: number; asOf: { weekly: string | null; monthly: string | null } }
  // manager.ts
  export function onBeforeClose(fn: () => Promise<void>): void  // awaited at the start of closeWorkspace()
  // utilityRunner.ts
  export function createUtilityRunner(size?: number): ForecastRunner // default max(1, os.cpus().length - 1)
  // scheduler.ts
  export function scheduleForecastRefresh(runnerFactory?: () => ForecastRunner): void // no-op when no workspace or read-only
  export async function cancelForecastRefresh(): Promise<void>
  export function forecastStatus(): ForecastStatus
  export function onForecastProgress(fn: (s: ForecastStatus) => void): () => void
  export function setDefaultRunnerFactory(f: () => ForecastRunner): void // main process sets createUtilityRunner; tests use inProcessRunner
  ```
  `forecastWorker.ts` imports only `src/main/analytics/forecasting/*` and listens on `process.parentPort` for `{ jobs: SeriesJob[] }`, replying `{ results: SeriesForecast[] }` — the same shape as `src/main/import/importWorker.ts`. `utilityRunner.ts` forks it with `utilityProcess.fork(forecastWorkerPath)` where `import forecastWorkerPath from './forecastWorker?modulePath'`, splits each `run` call across the pool, and kills children on `dispose`.

- [ ] **Step 1: Write the failing tests** (`scheduler.test.ts`, real DuckDB, `setDefaultRunnerFactory(() => inProcessRunner)`):
  - `schedule runs a job and reports progress` — after scheduling on a workspace with 10 complete weeks, wait for `forecastStatus().running === false` (poll with a 30 s cap): `cell_forecasts` filled, a progress callback saw `done === total`.
  - `closing the workspace cancels the job` — use a runner that resolves batches only when released; schedule, then `closeWorkspace()` → resolves without waiting for the job, `forecasts_weekly_as_of` not written, `running === false`. (Review Focus 4)
  - `cancelled job is redone` — reopen the workspace and schedule → completes and writes `forecasts_weekly_as_of`; rows written before the cancel keep their own `as_of`. (Review Focus 4, spec test 22)
  - `a second schedule during a run restarts after it` — two `scheduleForecastRefresh()` calls in a row produce one final consistent state (one completed run after the last call).
  - `read-only workspace does nothing` — open read-only, schedule → `running` stays false, no error.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement `onBeforeClose`, scheduler, worker, pool and wiring.** `scheduler.ts` registers `cancelForecastRefresh` via `onBeforeClose`. In `src/main/index.ts` (app start) call `setDefaultRunnerFactory(() => createUtilityRunner())`. Progress is pushed on `forecast:progress` the way `import:progress` is (`ipc.ts:232`), throttled to at most one event per 250 ms.
- [ ] **Step 4: Add the smoke check** at the end of `src/main/smoke.ts` (after every other step): build a scratch workspace in the smoke temp folder with 3 cells × 10 complete weeks of PRB and CSSR (CSSR target from `kpi_defs`), run `runForecastJob(conn, await planForecastJob(conn), createUtilityRunner(2))`, assert `cell_forecasts` has ≥ 6 rows and no row has `quality` null; add `forecastPool: true` to the `SMOKE_OK` object.
- [ ] **Step 5: Run to verify pass**, the full gate, and `npm run verify:packaged` (the pool must run inside app.asar; spec test 23).
- [ ] **Step 6: Commit** — `git commit -m "feat(forecast): background recompute in a utility-process pool with progress"`.

---

### Task 6: Rule-of-thumb RCA hints from real values

**Files:**
- Create: `src/main/forecast/rca.ts`
- Test: `tests/forecast/rca.test.ts`

**Interfaces:**
- Consumes: `RiskState` (Task 2), `ForecastKpi` (Task 3).
- Produces:
  ```ts
  export type RcaCategory = 'Capacity Exhaustion' | 'RF Overshoot & Interference' | 'Hardware & VSWR' | 'Parameter & Handover' | 'Traffic Surge' | 'Normal / Stable'
  export interface RcaInput {
    tech: Technology; selected: ForecastKpi; risk: RiskState | null
    latest: Record<string, number | null>      // kpi key → latest complete value for this cell
    priorMean: Record<string, number | null>   // kpi key → mean of the 4 complete periods before the latest
    kpis: Record<string, ForecastKpi>          // key → definition (label, target, direction)
  }
  export interface RcaResult { hint: { category: RcaCategory; action: string } | null; hintNote: string }
  export function diagnoseRca(i: RcaInput): RcaResult
  ```
  Rules, first match wins; each fires only when every value it reads is non-null. Actions keep the existing strings from `diagnoseRca` in `queryService.ts` (per technology for Capacity):
  1. Stable risk → `Normal / Stable`, action `Continue standard performance monitoring.`
  2. Hardware & VSWR — the technology's availability key (`availability` / `availability_3g` / `tch_availability`) latest < 95.
  3. Capacity Exhaustion — `prb_utilization` (4G) past its target, or the selected KPI is a congestion KPI (`tch_congestion`, `sdcch_congestion`) past its target.
  4. RF Overshoot & Interference — the selected KPI is a call-drop KPI (`call_drop_rate_*`) or `data_service_failure_4g`, past its target.
  5. Parameter & Handover — the selected KPI is a CSSR KPI (`call_setup_success_*`) past its target.
  6. Traffic Surge — `data_volume` or `connected_users` latest ≥ 1.2 × its `priorMean`.
  `hintNote`: `rule of thumb` when a hint fires; `No hint — <labels> not imported` (labels joined with ', ') when no rule could be evaluated because its inputs are missing; `No rule matched` otherwise.

- [ ] **Step 1: Write the failing tests:** `capacity from real PRB` (PRB 92 vs target 90 → Capacity, note `rule of thumb`); `hardware from availability`; `drop KPI → RF`; `cssr → Parameter`; `traffic surge from volume growth`; `stable → Normal / Stable`; `missing inputs` (selected CSSR at risk, PRB/availability/volume/users all null, CSSR value null → hint null, `hintNote === 'No hint — 4G Call Connection Success Rate not imported'` using the label from `kpis`) (spec test 18).
- [ ] **Step 2: Run to verify failure.** **Step 3: Implement.** **Step 4: Run to verify pass.**
- [ ] **Step 5: Gate and commit** — `git commit -m "feat(forecast): rule-of-thumb hints only from imported values"`.

---

### Task 7: Forecast service and API (replaces the old forecasting code)

**Files:**
- Create: `src/main/services/forecastService.ts`, `shared/forecast.ts`
- Modify: `shared/api.ts` (forecast types), `src/main/ipc.ts`, `src/main/services/reportingService.ts` (`forecast-risk` section), `src/main/smoke.ts` (step 24), `src/renderer/modules/Forecasting.tsx` and `src/renderer/lib/previewApi.ts` (only what typecheck needs; the page is redone in Task 9)
- Delete: `src/main/analytics/forecast.ts`; the forecasting block in `src/main/services/queryService.ts` (`ALL_FORECAST_METRICS` through the end of `getForecast`, including `pick`, `forecastThreshold`, `diagnoseRca`, `horizonSteps`, `RISK_RANK`); `tests/analytics/forecastThroughput.test.ts` (superseded by the tests below)
- Test: `tests/services/forecastService.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces:
  ```ts
  // shared/forecast.ts
  export const FORECAST_HORIZONS: Record<Grain, number[]> = { weekly: [1, 2, 4, 8, 12], monthly: [1, 3, 6], daily: [7, 14, 28] }
  // shared/api.ts (replacing the current forecast types)
  export type ForecastMetric = string
  export type ForecastHorizon = number
  export type ForecastRisk = 'Stable' | 'Watch' | 'At Risk' | 'Likely Breach' | 'Already Breached' | 'Withheld'
  export type ForecastMethod = 'naive' | 'drift' | 'seasonal-naive' | 'damped-holt' | 'holt-winters'
  export type ForecastQuality = 'Good' | 'Fair' | 'Naive only' | 'Withheld'
  export interface ForecastPoint { weekStart: string; label: string; value: number | null; kind: 'actual' | 'forecast'; lower: number | null; upper: number | null; complete: boolean; daysWithData: number }
  export interface ForecastSummary { method: ForecastMethod | null; quality: ForecastQuality; maeH1: number | null; maeH: number | null; mase: number | null; betterThanNaivePct: number | null; backtestOrigins: number; withheldReason: string | null; bandNote: string | null; growthPct: number | null }
  export interface ForecastSeries { metric: ForecastMetric; label: string; unit: string; worseIsHigher: boolean; threshold: number | null; points: ForecastPoint[]; forecast: ForecastSummary }
  export interface ForecastRiskRow { id: number; name: string; path: string[]; current: number | null; forecast: number | null; threshold: number | null; risk: ForecastRisk; explanation: string; withheld: boolean; hint: { category: ForecastRcaCategory; action: string } | null; hintNote: string }
  export interface ForecastMetricOption { key: string; label: string; unit: string; hasTarget: boolean; stored: boolean }
  export interface ForecastResult {
    asOf: string | null; grain: Grain; horizon: ForecastHorizon; metric: ForecastMetric; technology: Technology
    entity: { scope: ForecastScope; id: number | null; name: string; path: string[] }
    metrics: ForecastMetricOption[]; notImported: Array<{ key: string; label: string }>
    series: ForecastSeries; overTarget: ForecastSeries | null
    horizons: Array<{ horizon: number; available: boolean; reason: string | null }>
    risk: ForecastRisk | null; riskExplanation: string
    riskCounts: Record<ForecastRisk, number>; rcaCounts: Record<string, number>
    riskRows: ForecastRiskRow[]; totalEntities: number; riskTableNote: string | null
    status: ForecastStatus
  }
  export interface ForecastOpts { scope?: ForecastScope; entityId?: number | null; metric?: ForecastMetric; horizon?: ForecastHorizon; grain?: Grain; technology?: Technology }
  // forecastService.ts
  export async function getForecast(opts?: ForecastOpts): Promise<ForecastResult>
  ```
  Behaviour (spec §5.6, §6.2, §6.3, §7, §9):
  - Metric defaults to the first `available` KPI with a target (NC KPIs first by `sort_order`), else the first available. Horizon defaults to 4 (weekly), 3 (monthly), 14 (daily), clamped to the largest available.
  - `series`: `readDisplaySeries` actual points (partial marked) + forecast points from `forecastSeries` on the complete values (H = horizon); `overTarget` the same for `readOverTargetSeries` at non-cell scope, else null.
  - `horizons`: each of `FORECAST_HORIZONS[grain]` with `available = n ≥ h + 3` and reason `needs ≥ <h+3> complete <periods>` (n = complete periods of the selected series).
  - Risk rows: weekly/monthly + KPI stored → `readStoredForecasts` for every cell in scope, `classifyRisk` with the current `kpi_defs` target, `diagnoseRca`; KPI not stored → computed on demand at cell and site scope, else `riskTableNote` = `Per-cell forecasts for <label> are available for a site or cell — it has no target`; daily → on demand at cell/site, else `riskTableNote` = `Per-cell daily risk is available for a site or cell — or switch to weekly`; read-only workspace without stored forecasts → `riskTableNote` = `Per-cell forecasts not built — open the workspace writable once`. Rows sorted by `RISK_RANK` then `current` descending; at most 100 returned; `totalEntities` counts all.
  - `rcaCounts` keys are the six `RcaCategory` values plus `No hint`.

- [ ] **Step 1: Write the failing tests** (real DuckDB; run the stored job with `inProcessRunner` where needed):
  - `forecasts imported CSSR, not a PRB formula` — one cell, 12 complete weeks, CSSR falling 99.0 → 97.9 linearly, PRB flat 50 → `series.forecast.method !== 'naive'`, forecast at h = 4 below 97.9. (Spec test 10)
  - `not imported KPI` — `data_service_failure_4g` with no values → in `notImported`, not in `metrics`; requesting it falls back to the default metric. (Spec test 11)
  - `partial week excluded from fit, shown marked` — data ending Wed → last actual point `complete: false`, `asOf` = previous Monday's week. (Spec test 12)
  - `threshold from kpi_defs, no recompute` — after the job, change CSSR target via `saveKpiTargets` → `series.threshold` and a row's `risk` change; `cell_forecasts` untouched (compare row count and a `points` value). (Spec test 13)
  - `every risk row comes from a stored forecast` — 160 cells × 8 complete weeks → `totalEntities === 160`, `riskCounts.Withheld === 0` (every cell has data in the latest complete week), `sum(riskCounts) === 160`, and no row explanation contains `stable within target`. (Spec test 14)
  - `aggregate series` — mean for rates, total for sums, over-target counts (end-to-end through `getForecast` at network scope). (Spec test 15)
  - `read-only without stored forecasts` — reopen read-only before any job → `riskTableNote === 'Per-cell forecasts not built — open the workspace writable once'`, `series` still forecast. (Spec test 16)
  - `daily at district scope` — `riskTableNote === 'Per-cell daily risk is available for a site or cell — or switch to weekly'`, `riskRows.length === 0`; at cell scope rows are present.
  - `no complete period` — 5 days of data → `series.forecast.quality === 'Withheld'`, reason mentions `has 0`, `riskRows` empty, no throw. (Review Focus 3)
  - `horizon availability` — 6 complete weeks → horizons 1, 2 available; 4 has reason `needs ≥ 7 complete weeks`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement `shared/forecast.ts`, the new types and `forecastService.ts`; delete the old engine and the queryService block; point `ipc.ts` and `reportingService.ts` at `forecastService`.** The report section's columns become `Cell, Path, Current, Forecast, Target, Risk, Hint`, and its note states the model and quality of the network series (`<method> · <quality>`) plus the horizon in periods.
- [ ] **Step 4: Make typecheck pass in the renderer** with the smallest changes to `Forecasting.tsx` and `previewApi.ts` (`demoForecast` returns the new shape with real-looking but clearly demo values and `quality` set honestly); no UI redesign yet.
- [ ] **Step 5: Rewrite smoke step 24** for the smoke data (2 complete weeks): network PRB series `forecast.quality === 'Withheld'` with reason matching `/^needs ≥ 4 complete weeks, has [0-3]$/`; `series.threshold === 90` (smoke sets the PRB target to 90 earlier); `riskCounts` sum equals `totalEntities`; cell 2002 Withheld; site 1 `entity.name === 'ACC-001'`; daily and monthly calls return without throwing.
- [ ] **Step 6: Run to verify pass**, then the full gate.
- [ ] **Step 7: Commit** — `git commit -m "feat(forecast): forecast service on real KPI series; old tournament engine removed"`.

---

### Task 8: Investigation without invented values

**Files:**
- Modify: `src/main/services/investigationService.ts` (`valueOf`, diagnosis), `shared/api.ts` (`InvestigationResult.notAssessed: string[]`), `src/renderer/modules/Investigation.tsx` (render `notAssessed` under the findings; KPI card shows `not imported` when `current === null`), `src/renderer/lib/previewApi.ts` (mock gains `notAssessed`)
- Test: `tests/services/investigationNoFallbacks.test.ts`

**Interfaces:**
- Consumes: Task 3's finding on 3G/2G mappings (task report).
- Produces: `InvestigationResult.notAssessed: string[]` — entries `Not assessed: <label> not imported`.

- [ ] **Step 1: Write the failing tests:**
  - `missing CSSR stays null` — 2G cell with TCH congestion imported, no CSSR → evidence `cssr_2g.current === null`, no finding with id `cssr_low`, `notAssessed` contains `Not assessed: 2G CSSR not imported`. (Spec test 17)
  - `NC cell gets no invented drop rate` — an NC cell without call-drop data → `call_drop_2g.current === null` (was 2.3).
  - `congestion is not derived from PRB` — PRB imported, TCH congestion not → `tch_cong.current === null`.
  - `kbps to Mbps conversion of the same counter stays` — if Task 3 kept `throughput_3g ← throughputKbps`, assert the converted value; otherwise assert null.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Remove every fallback in `valueOf`** listed in spec §2.2, keeping only same-quantity unit conversions confirmed in Task 3. Each diagnosis rule that is skipped because an input is null pushes its `Not assessed` line (once per KPI).
- [ ] **Step 4: Run to verify pass**; check `tests/kpi/investigationRcaTech.test.ts` still passes or update its fixtures to import the KPIs it asserts on (never re-add a fallback).
- [ ] **Step 5: Gate and commit** — `git commit -m "fix(investigation): no invented KPI values; say what was not assessed"`.

---

### Task 9: Forecasting page

**Files:**
- Modify: `src/renderer/modules/Forecasting.tsx`, `src/renderer/lib/forecastCharts.ts`, `src/renderer/lib/previewApi.ts`, `src/renderer/styles.css` (only new classes), `src/renderer/modules/DataManager.tsx` (the `4-Model Tournament Forecast` checklist label becomes `Forecast (backtested)`)
- Create: `src/renderer/lib/forecastText.ts`
- Test: `tests/renderer/forecastText.test.ts`, `tests/renderer/forecastCharts.test.ts`

**Interfaces:**
- Consumes: Task 7 `ForecastResult`; Task 5 `forecastStatus`, `onForecastProgress` (preload).
- Produces (`forecastText.ts`):
  ```ts
  export function modelLine(f: ForecastSummary, unit: string, horizon: number, periodNoun: string): string
  // e.g. 'Damped Holt · backtest MAE 0.8 pp at 4 weeks · 32% better than naive · 18 backtest points · Good'
  // Withheld → the withheldReason; Naive only → "Naive · no model beats 'same as last period' · <n> backtest points"
  export function updatingLine(s: ForecastStatus): string | null // 'Forecasts updating — 12,500 of 60,000 cells' or null
  export const METHOD_LABEL: Record<ForecastMethod, string> // 'Naive', 'Drift', 'Seasonal naive', 'Damped Holt', 'Holt-Winters'
  ```
  Unit `%` errors are shown in `pp`.

- [ ] **Step 1: Write the failing tests:** `modelLine` for Good, Fair, Naive only and Withheld (exact strings above, with numbers formatted to the KPI's decimals); `updatingLine` with thousands separators and null when not running; chart option builder: partial actual point is hollow (`symbol: 'emptyCircle'`, opacity 0.45 as in `src/renderer/lib/cellCharts.ts`), no band series when every `lower` is null, threshold line only when `threshold !== null`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement the page** (spec §9.2): KPI picker from `metrics` with `notImported` listed under it; horizon buttons from `horizons` (disabled ones show `reason` as a tooltip and inline text); model line replaces "Model Confidence"; the over-target chart at aggregate scope; growth % for KPIs without a target; risk table columns Cell, Path, Current, Forecast, Target, Risk, Hint (`hintNote` shown under the hint; no default action text); `riskTableNote` shown instead of rows when set; `updatingLine` banner driven by `onForecastProgress`, with stored forecasts' as-of date (DD/MM/YYYY). Remove all references to `confidence`, `rmse`, `directionalAccuracy`, the old method names and the `Conduct parameter optimization and physical tilt adjustment.` fallback.
- [ ] **Step 4: Update `previewApi.demoForecast`** to exercise every state: one Good series, one Withheld KPI in `notImported`, a disabled horizon, a partial point, a `riskTableNote` when daily at network scope.
- [ ] **Step 5: Run to verify pass**; open the preview (`.preview`) Forecasting page in the browser pane and check: model line, disabled horizon reason, partial point hollow, over-target chart, risk table hint notes.
- [ ] **Step 6: Gate and commit** — `git commit -m "feat(ui): forecasting page shows backtest accuracy, withheld states and real-data hints"`.

---

### Task 10: Measured cost and close-out

**Files:**
- Create: `src/main/bench.ts`
- Modify: `src/main/index.ts` (`--bench-forecast` flag, like `--smoke`), `package.json` (script `"bench:forecast": "electron-vite build && electron . --bench-forecast"`), `docs/superpowers/specs/2026-10-03-honest-forecasting-design.md` (§6.4 measured result; Status line)

**Interfaces:**
- Consumes: Tasks 4–5 (`planForecastJob`, `runForecastJob`, `createUtilityRunner`).
- Produces: `--bench-forecast` prints one line `BENCH_FORECAST {"cells":25000,"series":…,"weeklyMs":…,"monthlyMs":…,"totalMs":…}` and exits 0.

- [ ] **Step 1: Implement `bench.ts`.** Create a throwaway workspace in a temp folder (never the project folder), insert 25,000 cells × 52 weeks of daily `fact_cell_daily` rows (PRB, users, volume, throughput, availability) and `fact_extra_metrics` for the four 4G NC KPIs with targets, run `recomputeAllAggregates` and `refreshAllIntelligence`, then time `runForecastJob` with `createUtilityRunner()`; delete the folder afterwards.
- [ ] **Step 2: Run `npm run bench:forecast`** with the browser closed. Record the line.
- [ ] **Step 3: Update spec §6.4** with the measured numbers and the machine. If `totalMs > 20000`, lower the backtest origin cap in `engine.ts` (20 → the largest value that meets 20 s, re-run Task 1's tests), and record the new cap in spec §5.2 and §6.4.
- [ ] **Step 4: Set the spec Status to `Implemented (<date>)`.**
- [ ] **Step 5: Gate, `npm run verify:packaged`, and commit** — `git commit -m "docs(forecast): measured recompute cost; spec implemented"`.

---

## Spec coverage

| Spec | Task |
|---|---|
| §4.1 KPIs from `kpi_defs`, not imported listed | 3, 7 |
| §4.2 series, agg rule, aggregate mean/sum, over-target, complete periods, gaps | 3, 7 |
| §4.3 horizons and availability | 7, 9 |
| §5.1–5.5 models, one-pass fitting, backtest, selection, bands, withheld, quality | 1 |
| §5.6 risk states, growth, read-time targets | 2, 7 |
| §6.1 stored set, triggers, background, batches, pool, cancel, progress, schema | 4, 5 |
| §6.2 on demand (aggregates, no-target KPIs, daily) | 7 |
| §6.3 old and read-only workspaces | 4, 5, 7 |
| §6.4 cost | 10 |
| §7 RCA hints | 6, 7, 9 |
| §8 Investigation | 3 (mapping check), 8 |
| §9 API, page, report, preview, smoke | 5, 7, 9 |
| §10 tests 1–23 | 1 (1–8, 19), 2 (9), 7 (10–16), 8 (17), 6 (18), 4 (20–21), 5 (22–23) |
