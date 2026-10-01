# NC Periods (Lifecycle) Design

**Date**: 2026-09-29
**Status**: Implemented (2026-09-30)
**Scope**: how a cell's non-compliance (NC) period is labelled in the daily, weekly and monthly views, and one owner for every input behind it (§8)

---

## 1. Goal

A cell that is chronic in the daily view must be findable as chronic in its week, and a chronic week must be chronic in its month. Every label means the same thing in every view, and the numbers behind the labels can be edited without being able to break the logic.

### Problems with the current labels

| Problem | Effect |
|---|---|
| Each grain has its own clock (chronic = 21 days / 7 weeks / 3 months) | Chronic in daily, only Persistent in weekly |
| "New NC" = first period of any run | A cell that relapses after a clean week shows New again |
| "Recurring NC" = second consecutive period | The name says "came back"; the code means "continuing" |
| "Recovering" lasts one period | A chronic cell with one clean day shows Healthy the next day |
| No label for on/off cells | A cell failing every Tuesday never reads as a pattern |
| `queryService` `LIFECYCLES` omits Chronic NC | Dead constant that disagrees with the real label list |
| Targets modal "Consecutive Breach Days for NC" starts at 3 and writes `weeklyBreachDays` | Saving targets silently changes the weekly rule from 1 to 3, and the label says "consecutive" when the rule is a count |

---

## 2. When a period is NC (unchanged)

| Period | NC when |
|---|---|
| Day | A core NCA KPI of the cell misses its target that day (`analytics/ncRule.ts`) |
| Week (ISO, Monday start) | Bad days ≥ `weekly_breach_days` (default 1) |
| Month (calendar) | Bad days ≥ `monthly_breach_days` (default 3) |

A **run** is consecutive NC periods of one cell, in date order. A period with no data for the cell neither breaks a run nor extends it (current behaviour).

---

## 3. Labels

Evaluated top to bottom; the first match wins. Lengths are the defaults; §5 makes them editable. Daily values are always the weekly values × 7.

| # | Label | Rule | Daily | Weekly | Monthly |
|---|---|---|---|---|---|
| 1 | Chronic NC | NC, and the current run has ≥ chronic periods | 49 days | 7 weeks | 3 months |
| 2 | Persistent NC | NC, and the current run has ≥ persistent periods | 21 days | 3 weeks | 2 months |
| 3 | Intermittent NC | NC, and ≥ `intermittent_runs` separate runs (the current one included) have an NC period inside the intermittent window ending at this period | 3 runs in 49 days | 3 runs in 7 weeks | 3 runs in 6 months |
| 4 | Recurring NC | NC, and the previous run's last NC period is within the look-back window before this run's first period | 21 days | 3 weeks | 2 months |
| 5 | New NC | NC, and none of the above | | | |
| 6 | Recovering | Not NC, and the last NC period is within the recovery window | ≤ 21 days ago | ≤ 3 weeks ago | ≤ 2 months ago |
| 7 | Healthy | Not NC, and no NC period within the recovery window (or never NC) | | | |

Window rules use calendar distance between period starts: days for daily, weeks for weekly, months for monthly. Example: last bad day 1 March → Recovering 2–22 March → Healthy from 23 March.

**Severity order** (used by the roll-up and by sorting): Chronic > Persistent > Intermittent > Recurring > New > Recovering > Healthy.

---

## 4. Roll-up (the tracing guarantee)

After each grain is labelled on its own:

- **Week** label = the more severe of its own label and the most severe label of its days.
- **Month** label = the more severe of its own label, the most severe label of its days, and the most severe label of every week that has a bad day in that month. A week that straddles two months counts for the month(s) its bad days fall in (decided 2026-10-01: a week starting 29 Jan whose bad days are all in February raises February, not January; a chronic week is always visible in the month that holds its bad days).

The roll-up only raises a period that is itself NC, so the `is_nc` flag and the label never contradict each other.

**What is guaranteed.** With the default week rule (≥ 1 bad day) every week that contains an NC day is NC, so daily → weekly tracing always holds. A month is NC with ≥ 3 bad days. A daily Chronic run is 49+ bad days, so the month it ends in has ≥ 3 of them unless the run ends on the 1st or 2nd. In that edge case the month is not NC by definition and shows Recovering. The same applies if a user raises `weekly_breach_days` above 1.

---

## 5. Editable settings

Stored in `ruleset` (one new version per save, as today). A new **NC Periods** tab in the Targets window (`modules/TargetsModal.tsx`) edits them. The Overview copy of the Targets window, with its "Consecutive Breach Days for NC" input, is deleted (§8, A1).

| Setting | Column | Default | Range | Status |
|---|---|---|---|---|
| Bad days for an NC week | `weekly_breach_days` | 1 | 1–7 | existing |
| Bad days for an NC month | `monthly_breach_days` | 3 | 1–31 | existing |
| Persistent after (weeks) | `persistent_weeks` | 3 | 1–26 | existing |
| Chronic after (weeks) | `chronic_weeks` | 7 | 2–52 | existing |
| Persistent after (months) | `persistent_months` | 2 | 1–12 | existing |
| Chronic after (months) | `chronic_months` | 3 | 2–24 | existing |
| Look-back window (weeks) | `lookback_weeks` | 3 | 1–26 | new |
| Look-back window (months) | `lookback_months` | 2 | 1–12 | new |
| Intermittent runs | `intermittent_runs` | 3 | 3–10 | new |
| Intermittent window (weeks) | `intermittent_window_weeks` | 7 | 2–52 | new |
| Intermittent window (months) | `intermittent_window_months` | 6 | 2–24 | new |
| Recovering lasts (weeks) | `recovery_weeks` | 3 | 1–26 | new |
| Recovering lasts (months) | `recovery_months` | 2 | 1–12 | new |

**Validation** (rejected with a message; nothing saved):
- persistent < chronic, for weeks and for months
- intermittent window ≥ 2 periods

**Retired**: `persistent_days`, `chronic_days` (now weeks × 7) and `daily_min_kpi_breaches` (unused). The columns stay in the table so existing workspaces keep opening. They are no longer read, written or shown.

**Fixed, not editable**: label names, their order, the rule order in §3, the roll-up. Priority, health, reports and investigation depend on them.

Every save already creates a new ruleset version, recomputes aggregates and intelligence, and writes an audit note. The note is extended to list the NC-period settings.

---

## 6. Consumers to update

| Where | Change |
|---|---|
| `shared/api.ts` `Lifecycle`, `Rules`, `RulesPatch` | Add `'Intermittent NC'`; add the new settings; drop the retired ones |
| `analytics/nc.ts` `recomputeNcLifecycle` | Implement §3 and §4; lifecycle severity base: New 40, Recurring 60, Intermittent 70, Persistent 80, Chronic 90 |
| `analytics/rules.ts` | Read, validate and save the new columns |
| `workspace/schema.ts`, `workspace/manager.ts` | New columns with defaults; `ADD COLUMN IF NOT EXISTS` for existing workspaces |
| `analytics/priority.ts` | Intermittent = 80 |
| `analytics/health.ts` | Intermittent = 20 |
| `services/queryService.ts` | `LIFECYCLES` gains Chronic NC and Intermittent NC; `byLifecycle` and movement counts include both |
| `services/investigationService.ts` | Sort order follows §3 |
| `investigation/rules/congestionRules.ts`, `investigation/types.ts` | Unchanged (they use `persistentWeeks`) |
| Renderer: `NcIntelligence`, `NetworkExplorer`, `Overview`, `overviewCharts`, `comparisonCharts`, `modules/TargetsModal`, `previewApi` | Intermittent colour and filter entry; NC Periods tab; mock data uses the new labels |
| `smoke.ts` | ACC-001-A (2nd consecutive NC week, no earlier run) becomes New NC; add the Recurring and Intermittent cases |

After upgrading, an existing workspace relabels its history once, automatically, on its first writable open (`workspace_meta` key `nc_periods`; the value is bumped whenever the labelling rules change).

---

## 7. Testing

Real DuckDB tests (`tests/helpers/realWorkspace.ts`), written before the code. They build breach days directly through a core KPI below target.

1. **Each label, daily grain**: one cell per label, with the boundary on both sides (20 vs 21 days, 48 vs 49 days, day 21 vs 22 after recovery).
2. **Recurring vs New**: a relapse inside the look-back window is Recurring, one outside it is New.
3. **Intermittent**: a Tuesdays-only cell is New, then Recurring, then Intermittent from the 3rd Tuesday. Weekly it is Chronic in week 7.
4. **Tracing**: a cell bad for 56 days in a row is Chronic on day 49, in that day's week, and in that week's month.
5. **Month-edge case**: a run ending on the 2nd of a month leaves that month not NC.
6. **Data gaps**: a missing day inside a run does not break it.
7. **Settings**: changing `recovery_weeks` to 1 moves Healthy to 8 days; invalid combinations are rejected.
8. **Retired columns**: an old workspace with `persistent_days` / `chronic_days` still opens and computes.

Gate: `typecheck && vitest && smoke`, as for every commit on this branch.

---

## 8. Single source of truth

The NC periods only make sense if the inputs behind them have one owner each. Today they do not.

### 8.1 Owners

| Fact | Owner | Edited in |
|---|---|---|
| Every KPI target, including 4G Peak Hour Traffic Utilization (PRB), per technology, with warning, critical and direction | `kpi_defs` | Targets window (`modules/TargetsModal.tsx`) |
| Which KPIs count toward NC | `kpi_defs.is_core` | Fixed to the NCA list (`f79899b`) |
| NC-period settings (§5) | `ruleset` | Targets → NC Periods |
| District NC % | `ruleset` | Settings |
| Priority weights | `ruleset` | Settings |
| Default values | `DEFAULT_RULES` (ruleset) and the KPI seed list (targets) | — |
| Label order, scores, colours | `shared/lifecycle.ts` | Fixed |

`kpi_defs` answers "is this a bad day?". `ruleset` answers "how do bad days become NC periods, priorities and district flags?".

### 8.2 Conflicts removed (these change results today)

| # | Conflict | Fix |
|---|---|---|
| A1 | Two Targets windows. The Overview one (`components/TargetsModal.tsx`) shows hard-coded targets that are not the real ones and discards edits | Delete it; Overview opens the real window |
| A2 | The Overview window saves the PRB *warning* value (85) as the PRB threshold and writes 3 into bad days per week | Removed with A1 |
| A3 | Targets are stored three times: `kpi_defs.target`, six `ruleset` columns (one CSSR for all technologies) and `kpi_thresholds` JSON (never read). Every ruleset save copies the six columns over `kpi_defs`, so a 3G CSSR target of 97 resets to 95 | `kpi_defs` only; the copy step is deleted |
| A4 | PRB threshold lives in `ruleset.prb_threshold_pct`, apart from the other core KPI targets | Read the 4G `prb_utilization` target from `kpi_defs` |
| A5 | Investigation checks all technologies against one `ruleset` value, with fallbacks that disagree in the same file (CSSR 98.5 vs 95, TCH 2.0 vs 1.0) | Per-technology targets from `kpi_defs`. 3G has no utilization KPI in the registry, so 3G utilization keeps using the capacity threshold (the 4G PRB target) |
| A6 | Saving a target does not recompute NC; cells stay judged against the old target until Rebuild Intelligence | A target save recomputes aggregates and intelligence, like a ruleset save |
| A7 | `LIFECYCLES` in `queryService` omits Chronic NC (unused constant) | Delete it; every label list comes from `shared/lifecycle.ts` |
| A8 | Core NCA KPIs can be deleted or saved without a target, which silently switches that part of the NC rule off | Core KPIs cannot be removed, and a core KPI target cannot be cleared |

### 8.3 Duplicates removed

| # | Duplicate | Copies today | Replaced by |
|---|---|---|---|
| B1 | Score per label | `priority.ts` TS map (unused) + SQL CASE; `health.ts` TS map (unused) + SQL CASE | Tables in `shared/lifecycle.ts`; SQL CASE generated from them |
| B2 | Severity and trend formulas | Each written twice inside `nc.ts` | Computed once per row, then compared |
| B3 | Rule defaults (80, 1, 3, 7, 21 …) | `schema.ts`, `manager.ts`, `rules.ts` (×2), `nc.ts`, `aggregates.ts`, `investigationService.ts`, `previewApi.ts` | `DEFAULT_RULES` |
| B4 | Label colours and order in the UI | `NcIntelligence`, `NetworkExplorer` (×3), `Overview`, `overviewCharts`, `comparisonCharts` | `shared/lifecycle.ts` |
| B5 | "Target of KPI X for technology T" | Every PRB-threshold reader: `ncRule`, `nc`, `priority`, `queryService` (×4), `investigationService` (×4), `reportingService`, `InvestigationWorkspace`, `NetworkExplorer` | One helper: `kpiTargetSql(tech, key)` in the main process; renderer reads targets from `kpis.list` |

### 8.4 Dead code removed

| # | Dead | Why |
|---|---|---|
| C1 | `src/main/kpi/schemaV2.ts` and its test | A second schema the app never creates; every import calls its retention step, which fails on the missing table, and the error is swallowed |
| C2 | Ruleset columns `prb_threshold_pct`, `tch_congestion_threshold_pct`, `sdcch_congestion_threshold_pct`, `cssr_threshold_pct`, `call_drop_threshold_pct`, `data_access_threshold_pct`, `data_service_failure_threshold_pct`, `kpi_thresholds`, `daily_min_kpi_breaches`, `persistent_days`, `chronic_days` | Superseded by `kpi_defs` or §5. Columns stay so old workspaces open; nothing reads or writes them |

### 8.5 Traceability and upgrade

- Saving targets creates a new ruleset version. The audit note lists each change ("4G PRB 80 → 85"), so NC results and reports stay tied to the version that produced them.
- One-time migration on open: if a workspace's latest ruleset holds a PRB or KPI threshold that differs from the seed, copy it into the matching `kpi_defs` target (per technology) before the columns are retired. A workspace where someone set PRB to 85 keeps 85.

### 8.6 Tests (added to §7)

9. A 3G CSSR target edit survives a ruleset save (A3).
10. Changing the 4G PRB target in `kpi_defs` changes NC without touching `ruleset` (A4).
11. A target save recomputes NC with no manual rebuild (A6).
12. Migration: a workspace with `prb_threshold_pct = 85` opens with the 4G PRB target at 85 (8.5).
13. Every label in `shared/lifecycle.ts` has a score in priority and health, and appears in the filter list (A7, B1).

---

## 9. Out of scope

- Which KPIs count as a bad day (settled in `3cc05ee`)
- Partial-week handling for weekly analytics (separate Phase 1 item)
- Scaling the recovery window by how severe the cell was (rejected: harder to explain)
- Redundancy outside NC periods and targets (the 3,000-line `queryService`, forecasting, the preview mock beyond label names). A separate sweep after this lands.
