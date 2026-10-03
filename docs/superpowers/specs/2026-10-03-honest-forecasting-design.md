# Honest Forecasting Design

**Date**: 2026-10-03
**Status**: Implemented (2026-10-03)
**Scope**: the Forecasting page (and its report section) forecasts real imported KPI series with standard models chosen by an out-of-sample backtest; Investigation stops inventing KPI values

---

## 1. Goal

Every number on the Forecasting and Investigation screens is either an imported value, a forecast computed from imported values, or an accuracy figure measured on data the model did not see. When the data cannot support a number, the screen says so instead of showing one.

Uses the forecast must serve (decided 2026-10-03): early warning per cell, capacity planning, and management trend reporting.

---

## 2. What happens today

### 2.1 Forecasting (`services/queryService.getForecast`, `analytics/forecast.ts`)

| Problem | Where | Effect |
|---|---|---|
| 9 of 18 forecast KPIs are formulas of PRB, not imported values | `pick()` in `getForecast` | Every CSSR, call drop, TCH/SDCCH congestion, data access/failure. E.g. 4G CSSR = 99.2 − 0.15 × (PRB − 75). The imported values in `agg_cell_kpi_weekly/monthly` are never read |
| Missing data filled with constants | `pick()`, risk rows | PRB 45, speed 15 Mbps, volume 12 GB, availability 99.7, PRB 50 / availability 99.5 for RCA |
| "Holdout" accuracy is in-sample fit error | every `run*` model | Models are fitted on the whole series and scored on it; selection favours overfitting |
| Hand-picked parameters and fudges | `forecast.ts` | Fixed α/β/γ/φ, a "SARMA" that is not one, RMSE × 1.05 / × 1.3 penalties, confidence = 100 − relErr × 200 |
| Partial current period is the last data point | `getForecast` | Contradicts the complete-periods spec |
| Targets hard-coded | `ALL_FORECAST_METRICS`, `forecastThreshold` | CSSR 98.5, availability 99.5 etc. bypass `kpi_defs` |
| Cells after the first 150 marked Stable unanalysed | risk-row fast pass | "stable within target threshold" is never checked |
| RCA hints from invented values; UI default action text | `diagnoseRca`, `Forecasting.tsx` | Advice not tied to any measured value |
| `cell_forecasts` table never written | `workspace/schema.ts` | Dead table |

### 2.2 Investigation (`services/investigationService.ts`, `valueOf`)

When a KPI was not imported, a value is invented: CSSR 96.4 if the cell is NC else 99.2; call drop 2.3 / 0.5; data access 95.5 / 99.0; data failure 2.5 / 0.4; TCH congestion PRB ÷ 5; SDCCH PRB ÷ 6; voice traffic users × 0.45; 3G HSDPA speed from 4G DL throughput. These values feed the charts and the diagnosis findings, so an NC flag produces a number that is then cited as evidence for the NC.

---

## 3. Decisions (2026-10-03)

| Topic | Decision |
|---|---|
| Purpose | Early warning per cell, capacity planning, management trend reporting |
| RCA hints | Keep the rule table, fed only by imported values, labelled "rule of thumb"; no hint when inputs are missing |
| Aggregate series | Rate KPIs: plain mean of cell values; `sum` KPIs: total. Plus a second series: number of cells over target |
| Engine | Standard models (naive, drift, damped Holt, seasonal naive, Holt-Winters), rolling-origin backtest, MASE against naive, empirical bands |
| Where it runs | Per-cell weekly and monthly forecasts computed in the background after import and stored, only when a period completes or past data changes; daily per-cell on demand at cell/site scope |
| Stored per cell | KPIs with a target (all NC KPIs plus any KPI given a target in Targets) and the capacity fields. Every other KPI is forecast on demand (cell/site scope, aggregate charts) |

---

## 4. Inputs

### 4.1 What is forecast
- KPIs come from `kpi_defs` for the workspace technology: every active KPI that has imported values for the selected scope (the NC KPIs, including `prb_utilization`, and any other active KPI). Label, unit, direction (`worse_is_higher`), target, decimal precision and time aggregation (`agg`) all come from `kpi_defs`.
- Capacity fields from `agg_cell_*`: connected users, data volume, DL throughput, availability. These have no `kpi_defs` target unless one exists for them.
- A KPI with no imported values in scope is not offered; it is listed as "not imported".
- A KPI without a target is forecast but has no risk state (§5.6).
- Every KPI above is forecastable on the page. Which ones are also stored for every cell is set in §6.1.

### 4.2 Series
- **Cell series**: the KPI's value per period using its `agg` rule (`avg_value`, `sum_value`, `max_value` or `min_value` from `agg_cell_kpi_*`; the matching column of `agg_cell_*` for capacity fields).
- **Aggregate series** (network, region, district, site), each forecast on its own:
  1. Value: mean of cell values for rate KPIs; total for `agg = 'sum'` KPIs and for users and volume.
  2. Cells over target: per period, the number of cells whose value is past the KPI's target. Only for KPIs with a target.
- **Fitting uses complete periods only** (`period_coverage.is_complete`, via the helpers in `analytics/periods.ts`). A partial period is drawn, marked as partial (`periodLabel`, hollow point), and never fitted.
- A period with no value is a gap. Gaps are never filled; models fit the observed points in order.
- "As of" = the latest complete period (`latestPeriodSql`).

### 4.3 Horizons
Counted in periods of the selected grain (replaces `ForecastHorizon = '1w' | '2w' | '4w' | '6w'`):

| Grain | Horizons |
|---|---|
| Weekly | 1, 2, 4, 8, 12 weeks |
| Monthly | 1, 3, 6 months |
| Daily | 7, 14, 28 days |

A horizon the series cannot backtest (§5.2) is disabled with the reason. A horizon of H periods needs at least H + 3 complete periods (three backtest origins), e.g. 12 weeks needs ≥ 15 complete weeks.

---

## 5. Engine (`analytics/forecast.ts`, rewritten; pure functions, no I/O)

### 5.1 Models

| Model | Grains | Minimum complete periods to fit | Fitting |
|---|---|---|---|
| Naive | all | 1 | next = last value |
| Drift | all | 3 | last value + h × (last − first) ÷ (n − 1) |
| Damped-trend Holt (ETS A,Ad,N) | all | 8 | α ∈ {0.1, 0.2, …, 0.9}, β ∈ {0.05, 0.1, 0.2, 0.3}, φ ∈ {0.8, 0.9, 0.98}; the combination with the lowest one-step squared error on the training data |
| Seasonal naive | daily | 14 | value 7 days earlier |
| Holt-Winters, additive weekly season, damped trend | daily | 21 | α, β, φ grids as above, γ ∈ {0.05, 0.1, 0.2, 0.3}; same criterion |

Parameters are fitted only from the data before the forecast origin, at every origin (no look-ahead).

**One-pass fitting.** For a fixed parameter set the smoothing recursion is the same whatever the end point, so one pass over the whole series records, at every t, the one-step squared error so far and the state after y[0..t). Fitting on [0, t) then reads those values at t, which depend only on data before t. This is exact, not an approximation: on 2,000 test series it chose the same model with identical forecasts as refitting at every origin, and was 4–9× faster (benchmark 2026-10-03).

### 5.2 Backtest
Rolling origin, expanding window. For each model, the origins are the last ≤ 20 points t at which that model can fit (t ≥ its minimum, §5.1): fit on points [0, t), forecast h = 1…H, record the error (actual − forecast) at each h. Naive is also run on each model's origins, so every model is compared with naive on exactly the same points. A model is a candidate only if it has at least 3 origins with an actual at h = 1. A horizon h is backtestable when naive has at least 3 origins with an actual at t + h − 1.

### 5.3 Selection
- A model's score = mean absolute backtest error over h = 1…H on its origins.
- MASE = the model's score ÷ naive's score on the same origins.
- The candidate with the lowest MASE is used if that MASE < 1; otherwise naive is used and labelled "no model beats 'same as last period'". Ties go to the simpler model (order: naive, drift, seasonal naive, damped Holt, Holt-Winters).
- The chosen model is refitted on all complete periods to produce the forecast.

### 5.4 Range
- 80% band at horizon h: forecast ± the 80th percentile of |backtest errors| at h for the chosen model.
- Fewer than 5 backtest errors at h: no band, labelled "too little history to estimate a range".
- Values are clamped to the unit's domain: unit `%` → 0–100; counts, volumes and speeds → ≥ 0.

### 5.5 Withheld and quality
- Fewer than 4 complete periods: no forecast; "needs ≥ 4 complete <periods>, has N".
- Quality label (replaces the confidence %):

| Label | Rule |
|---|---|
| Good | MASE ≤ 0.8 |
| Fair | 0.8 < MASE < 1 |
| Naive only | no model beats naive |
| Withheld | too little history |

- Accuracy shown with each forecast: model name, backtest MAE at h = 1 and at the selected horizon (in the KPI's unit), "X% better than naive" (= (1 − MASE) × 100), number of backtest origins.

### 5.6 Risk states (KPIs with a target)
"Past target" uses the KPI's direction: above for `worse_is_higher`, below otherwise.

| State | Rule (first match wins) |
|---|---|
| Already Breached | the latest complete value is past target |
| Likely Breach | a point forecast within the horizon is past target |
| At Risk | only the band's worse edge within the horizon is past target |
| Watch | the forecast at the horizon is worse than the latest value by more than the h = 1 backtest MAE |
| Stable | none of the above |

A withheld forecast has no risk state ("Withheld"), except Already Breached, which needs no forecast. KPIs without a target show growth over the horizon, (forecast at H − latest) ÷ latest in %, instead of a risk state.

Risk is computed when read, from the stored forecast and the current `kpi_defs` target, so a target change takes effect without recomputing forecasts.

---

## 6. Where it runs

### 6.1 Per-cell forecasts, stored
**Which KPIs** (decided 2026-10-03): every KPI with a target — the NC KPIs plus any KPI given a target in Targets — and the capacity fields (users, data volume, DL throughput, availability). For each cell × stored KPI × {weekly, monthly}, the forecast runs to the longest horizon of the grain (12 weeks, 6 months). KPIs without a target (mostly raw counters) are not stored; they are forecast on demand (§6.2).

**When**: after an import, per grain, only if
1. the latest complete period moved (a week or month completed): every cell, or
2. the import wrote data into an already-complete period (a backfill or correction): only the cells it touched, or
3. a KPI gained a target: that KPI, every cell.

A target change on a KPI that already has one triggers nothing: risk is read at query time (§5.6). With daily imports, weekly forecasts are recomputed about once a week and monthly about once a month.

**How**: in the background, after the import has finished and the main process has reopened the workspace, so the app stays usable.
- Series are read through the app's workspace connection in batches of 5,000 cells (values as doubles plus series lengths; no per-row objects), so memory stays bounded at any network size.
- The forecasts run in a pool of Electron utility processes (cores − 1), the mechanism the import already uses (2026-10-02), so a Windows test of the import also covers the forecast pool. Pool processes receive plain arrays and import no DuckDB module (the Windows import failure of 2026-10-02 came from a worker that resolved DuckDB).
- Results are written per batch with the DuckDB appender.
- A new import cancels a running job; the job restarts after that import. An unfinished job (app closed) is redone on next writable open.
- Progress is published to the renderer; the Forecasting page shows "Forecasts updating — 12,500 of 60,000 cells" and keeps showing the previous stored forecasts, marked with their as-of date, until the new ones are written.

`cell_forecasts` is dropped and recreated (it has never been written):

| Column | Type |
|---|---|
| cell_id | BIGINT |
| kpi_key | VARCHAR |
| grain | VARCHAR (weekly / monthly) |
| as_of | DATE (latest complete period) |
| method | VARCHAR |
| points | JSON `[{h, value, lower, upper}]` |
| mae_h1 | DOUBLE |
| mase | DOUBLE |
| backtest_origins | INTEGER |
| quality | VARCHAR |

Primary key (cell_id, kpi_key, grain). `workspace_meta` keys `forecasts_weekly_as_of` and `forecasts_monthly_as_of` record what is stored. Rebuild aggregates and snapshot restore mark both stale. `dimRepair` merges the table like the other cell tables.

### 6.2 On demand
- Aggregate series (two per KPI) are computed when the page asks for them.
- KPIs without a target, per cell: computed on demand at cell and site scope.
- Daily per-cell forecasts are computed on demand at cell and site scope. At district, region and network scope on the daily grain, the aggregate charts forecast and the risk table says "Per-cell daily risk is available for a site or cell — or switch to weekly". No cell is marked Stable without a forecast.

### 6.3 Old and read-only workspaces
- Writable: the once-on-open marker (`workspace_meta` key `forecasts`) starts the background build of `cell_forecasts`.
- Read-only without the new table: aggregate charts forecast; the risk table says "Per-cell forecasts not built — open the workspace writable once".

### 6.4 Cost (benchmark 2026-10-03)
Measured on this development laptop (8 threads, 4 cores) with a generated 25,000-cell table (52 weeks weekly + 12 months monthly, 8 stored series per cell), using one-pass fitting, batched reads and 7 worker threads: **15 s per full recompute at 25,000 cells** (weekly: read 2.1 s, forecast 8.9 s, write 0.8 s; monthly: 0.5 s, 2.1 s, 0.8 s). Time grows in proportion to cells × stored series:

| Cells | Full recompute, 8 series/cell |
|---|---|
| 3,000 | ~2 s |
| 25,000 | ~15 s (measured) |
| 60,000 | ~36 s (projected) |
| 150,000 | ~1.5 min (projected) |

Each extra KPI given a target adds about 1/8 of these times. Two years of weekly history makes the weekly part about 1.7× slower. Reads from a real on-disk workspace may be slower than the in-memory benchmark.

Budget: a full recompute at 25,000 cells with 8 stored series finishes in ≤ 20 s on 4 cores. The plan measures it on a real workspace; if it is over, the backtest origin cap (§5.2) is lowered and the new value recorded here. The recompute never blocks the import or the app (§6.1).

**Measured 2026-10-03** (`npm run bench:forecast`: a throwaway on-disk 4G workspace, 25,000 cells, 52 weeks, 8 stored series per cell, utility-process pool of 7 on an Intel i7-6820HQ, 4 cores / 8 threads, load average 3–5 from other work):

| Run | Weekly (read / compute / write) | Monthly | Total |
|---|---|---|---|
| First implementation | 69 s | 19 s | 87.6 s |
| After optimisation, cap 20 | 22.5 s (4.2 / 12.5 / 5.3) | 8.2 s | **30.7 s** |
| Same, cap 10 | 17.6 s (4.1 / 7.9 / 5.1) | 8.0 s | 25.7 s |

Optimisations that kept results identical (tests): dates carried for daily series only; packed typed-array messages to the pool; Holt fits kept only at the ends that are read, with the fit selection cached per end; compact stored JSON. Single-threaded, the engine costs 0.115 ms per 52-week series.

**Ruling (2026-10-03): the cap stays at 20 and the budget is missed (30.7 s).** Lowering it to 10 saves 5 s but leaves 11- and 12-week horizons with no backtest errors on 52 weeks of history (an origin needs an actual 12 weeks later), so the 12-week capacity view would lose its range and accuracy figure. Projected on this laptop: ~74 s at 60,000 cells, ~3 min at 150,000 cells — in the background, only when a period completes.

---

## 7. RCA hints (Forecasting risk table)
- The existing rule table (`diagnoseRca`) runs on the cell's latest complete imported values (PRB, availability, the selected KPI) from `agg_cell_*` and `agg_cell_kpi_*`, with targets from `kpi_defs`.
- A rule fires only when every input it reads was imported. When the inputs for every rule are missing: "No hint — <KPI> not imported".
- Hints are labelled "rule of thumb".
- "Normal / Stable" is shown only for rows whose risk is Stable.
- The renderer's default action text is removed; a row without a hint shows none.

---

## 8. Investigation
- Every invented fallback in `valueOf` is removed. A substitute stays only when it is the same quantity in another unit (e.g. kbps → Mbps of the same counter). Whether 3G "traffic utilisation" is the value stored in the PRB column for 3G workspaces is verified in the plan; the `traffic_util_3g ← prbAvg` mapping stays only if it is.
- A missing KPI gives `null`: a gap in charts and a "not imported" KPI card.
- Diagnosis findings never use a missing KPI. Each rule that cannot run adds "Not assessed: <KPI> not imported".

---

## 9. API and UI

### 9.1 `shared/api.ts`
- `ForecastHorizon` becomes a number of periods of the selected grain (§4.3).
- `ForecastMetric` becomes a KPI key string (from `kpi_defs` or a capacity field).
- Forecast summaries carry `method`, `quality`, `maeH1`, `maeH`, `mase`, `backtestOrigins`, `withheldReason`; `confidence`, `rmse`, `directionalAccuracy` are removed.
- `ForecastSeries` gains `complete` on actual points; aggregate results gain the cells-over-target series.
- Risk rows gain `hint: { category, action } | null`, `hintNote` ("rule of thumb" / "No hint — … not imported") and `withheld`; `explanation` stays.
- The list of KPIs not imported is returned with the result.

### 9.2 Forecasting page
- The model line replaces "Model Confidence": e.g. *Damped Holt · backtest MAE 0.8 pp at 4 weeks · 32% better than naive · 18 backtest points · Good*.
- Withheld and naive-only states are stated in words.
- Horizon choices follow the grain; disabled choices show why.
- Partial periods drawn hollow and labelled with their coverage.
- At aggregate scope, a second chart: cells over target, with its forecast.
- KPIs without a target show growth % over the horizon.
- "Not imported" KPIs listed under the KPI picker.
- While a background recompute runs: "Forecasts updating — N of M cells", with the stored forecasts shown and their as-of date.

### 9.3 Other consumers
- Report section "Forecast Risk" (`reportingService`) uses the new risk rows and states the model and quality.
- `previewApi` mock moves to the new shapes.
- `smoke.ts` expectations updated.

---

## 10. Testing
Written before the code.

**Engine (unit, `tests/analytics/forecast.test.ts`)**
1. Constant series → naive chosen.
2. Linear growth → drift or damped Holt chosen, MASE < 1, forecast within 2% of the true continuation.
3. Pure noise (seeded) → "Naive only".
4. Daily series with a weekday pattern → seasonal naive or Holt-Winters chosen, MASE < 1.
5. No look-ahead: changing values after an origin leaves that origin's backtest forecast unchanged.
6. Band at h = the 80th percentile of |errors| at h; no band with fewer than 5 errors.
7. Withheld below 4 points, with the reason.
8. `%` forecasts clamped to 0–100.
9. Risk states: one case per row of §5.6, including no-target growth.

**Real DuckDB (`tests/helpers/realWorkspace.ts`)**
10. Imported CSSR values are what is forecast (a cell with a falling CSSR and flat PRB forecasts a falling CSSR).
11. A KPI with no imported values is listed as not imported and has no series.
12. A partial last week is excluded from fitting and present in the chart, marked.
13. The threshold comes from `kpi_defs`; changing the target changes risk without recomputing `cell_forecasts`.
14. With more than 150 cells, every risk row comes from a stored forecast.
15. Aggregate series: mean for rate KPIs, total for sum KPIs, correct cells-over-target counts.
16. Old workspace builds `cell_forecasts` on first writable open; read-only shows the not-built message.
17. Investigation with CSSR not imported: `null` values, no CSSR finding, a "Not assessed" line.
18. RCA hint: fires from real PRB ≥ target; "No hint — … not imported" when inputs are missing.
19. One-pass fitting equals refitting at every origin (same model, same values) on a set of seeded series.
20. Recompute triggers: an import that completes no period and touches no complete period leaves `cell_forecasts` unchanged; a backfill into a complete week recomputes only the touched cells; giving a KPI a target adds its forecasts.
21. Stored set: KPIs with a target and the capacity fields are stored; a counter without a target is not stored but forecasts on demand at cell scope.
22. Background job: a second import cancels and restarts it; the page reports progress and shows the previous forecasts meanwhile.
23. Packaged build (`npm run verify:packaged`): the forecast process pool runs inside app.asar.

**Gate**: `typecheck && vitest && smoke` for every commit, with `app_state.json` restored from `.superpowers/app_state.original.json` afterwards. Recompute cost (§6.4) measured on a real workspace and recorded.

---

## 11. Out of scope
- Counter-based network KPIs (counters are not imported).
- ARIMA or other library models.
- Anomaly detection.
- Forecasts outside the Forecasting page and its report section.
