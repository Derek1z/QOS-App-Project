# Complete Periods Design

**Date**: 2026-10-01
**Status**: Implemented (2026-10-02)
**Scope**: weekly and monthly analytics use complete periods for "latest" and for comparisons; partial periods stay visible and marked

---

## 1. Goal

A week or month that is still in progress (the import ends on a Wednesday, or the month is 10 days old), or a period the data only partly covers (a dataset that starts mid-week), must never be treated as "the current period" or compared like-for-like with full periods. It stays visible, clearly marked.

### What happens today

| Behaviour | Effect |
|---|---|
| "Latest week" = `max(week_start)` in ~31 SQL sites (`queryService` 26, `investigationService` 4, `priority` 1), plus `max(period_start)` on `cell_nc_lifecycle` | If data ends on Wednesday, Mon–Wed is "this week" everywhere |
| ~70 places in services and screens take the last element of a period series as "current" (`slice(-1)`, `[length - 1]`) | Same, in banners, KPI cards, investigation charts, reports |
| Partial periods are labelled like full ones | Traffic and users look ~40% low; trend reads "Improving"; a chronic cell with two clean days so far flips to Recovering in weekly |

---

## 2. Definitions (decided 2026-10-01)

| Term | Definition |
|---|---|
| Day with data | A date that has a row in `coverage_daily` (some cell was imported for it) |
| Complete week | All 7 days Mon–Sun are days with data |
| Complete month | Every calendar day of the month is a day with data |
| Partial period | A week or month that is not complete. This includes the period in progress, the first period of a dataset that starts mid-period, and a past period with a missing import day |
| Latest period | The newest complete period. If no period of that grain is complete, the newest partial period, marked as partial |

A cell missing a day inside a complete week is a data gap for that cell, not a partial week (consistent with NC spec §2: a day with no data neither breaks nor extends a run).

Daily views are unaffected: a day is complete when it is imported.

---

## 3. Behaviour

### 3.1 Latest and comparisons
Every "latest", "current", "this week/month" or "as of" value uses the latest period (§2). This covers cards, banners, rankings, priority, health, the region map, investigation, reports and exports. Week-on-week and month-on-month comparisons pair complete periods only.

### 3.2 Partial periods in series
Charts and tables that list periods still show partial periods, labelled with their coverage:
- weekly: `W40 · 3 of 7 days`
- monthly: `Oct · 10 of 31 days`

Partial points are drawn distinguishably (hollow marker or lighter bar) so they read as provisional.

### 3.3 NC labels (amends NC spec §2)
- A partial period that is NC under the normal rule (bad days ≥ `weekly_breach_days` / `monthly_breach_days`) is NC, and counts in runs, roll-ups and labels like any period.
- A partial period that is **not** NC is skipped, like a period with no data: it neither breaks nor extends a run. Its label is the label the cell had at its last labelled period of that grain, shown with the partial marker. A run is unaffected by days that haven't arrived yet.

This is the one place a row's label can be an NC label while its own `is_nc` is false: it reads as "Chronic, and no bad day yet this partial week". It is never the latest period (§3.1), so no summary counts it as current. It is the only exception to NC spec §4's "`is_nc` and the label never contradict".

Example: a cell Chronic through W39, W40 has data for Mon–Tue and both are clean. W40 is skipped, so the cell stays Chronic. If Wednesday is bad, W40 becomes NC and continues the run.

### 3.4 Trend
Trend (Improving / Stable / Worsening) compares a complete period with the previous complete period. A partial period has no trend: it is stored as NULL and shown as "—". Severity treats a NULL trend like Stable.

### 3.5 Edge cases
| Case | Behaviour |
|---|---|
| Fewer than 7 days imported in total | No complete week: "latest week" is the newest partial week, marked |
| Dataset starts on a Wednesday | First week is partial forever; shown marked; never latest unless it is the only week |
| A past week with one day missing from every export | Partial; shown marked; skipped by "latest" and by comparisons |
| An import fills the missing days later | The period becomes complete on that import; recompute follows the normal import path |

---

## 4. Architecture

### 4.1 One record of period completeness
New table `period_coverage` with columns `grain` (weekly / monthly), `period_start DATE`, `days_with_data`, `days_in_period` and `is_complete`, keyed by `(grain, period_start)`.
- Refreshed from `coverage_daily` for every period an import touches (in `updateCoverage`), and fully on rebuild.
- Old workspaces build it once on first writable open, using the existing once-on-open marker mechanism (bump the `nc_periods` marker, which also relabels for §3.3/§3.4).

### 4.2 One way to ask for "latest"
Helpers in `src/main/analytics/periods.ts`, the only place that decides what latest means:
- `latestPeriodSql(grain)`: a scalar subquery giving the latest period's start date (§2).
- `isCompleteSql(grain, periodColumn)`: a boolean expression for joins and filters.

All ~31 `max(week_start)` / `max(month_start)` / `max(period_start)` "latest" sites switch to `latestPeriodSql`.

### 4.3 Periods carry their completeness
Every period row sent to the renderer (`NcMovementRow`, investigation weeks, health series, KPI series, report tables) gains `complete: boolean` and `daysWithData: number`. A shared helper `latestComplete(rows)` in `shared/periods.ts` replaces "take the last element" at the ~70 series sites. It returns the last complete row, or the last row when none is complete.

### 4.4 NC engine
`analytics/nc.ts` reads `period_coverage`:
- Partial non-NC rows are left out of run, streak and window computation (so they neither break nor extend), then written with the carried-forward label and `partial` marker.
- Trend is computed only between complete rows.

---

## 5. Consumers

| Where | Change |
|---|---|
| `workspace/schema.ts`, `workspace/manager.ts` | `period_coverage` table; once-on-open build (marker bump) |
| `import/aggregates.ts` (`updateCoverage`) | Refresh `period_coverage` for touched periods |
| `analytics/periods.ts` (new) | `latestPeriodSql`, `isCompleteSql` |
| `shared/periods.ts` (new) | `latestComplete`, `periodLabel` ("W40 · 3 of 7 days") |
| `analytics/nc.ts` | §3.3, §3.4 |
| `analytics/priority.ts`, `analytics/health.ts` | Latest = latest complete period |
| `services/queryService.ts`, `investigationService.ts`, `reportingService.ts` | Latest sites → helpers; period rows carry `complete`, `daysWithData` |
| `shared/api.ts` | `complete`, `daysWithData` on period row types |
| Renderer (Overview, NC Intelligence, Network Explorer, Investigation, Performance, charts libs, `previewApi`) | Partial label and styling; latest via `latestComplete` |
| `smoke.ts` | Expectations where the smoke data's last week is partial |

---

## 6. Testing

Real DuckDB tests (`tests/helpers/realWorkspace.ts`), written before the code:

1. **Ends on Wednesday:** a dataset ending Wed. Latest week is the previous full week in the NC lifecycle summary, priority, region map and network health. The partial week appears in movement with `complete: false, daysWithData: 3`.
2. **Starts mid-week:** the first week is partial and is never latest once a complete week exists.
3. **Too little data:** only 3 days imported in total. Latest week is that partial week, marked.
4. **Chronic stays Chronic:** a cell Chronic through W39 with two clean days in W40 is Chronic in W40. A bad Wednesday makes W40 NC and the run continues.
5. **Partial NC counts:** a partial week with a bad day is NC and extends the run.
6. **Trend:** a partial week's trend is NULL; complete weeks' trend is unchanged.
7. **Months:** a month with 10 of 31 days is partial; latest month is the previous full month.
8. **Late fill:** importing the missing days later makes the period complete.
9. **Old workspace:** a workspace without `period_coverage` builds it on first open.
10. **Renderer helpers:** `latestComplete` and `periodLabel` (unit).

Gate: `typecheck && vitest && smoke` for every commit, with `app_state.json` restored from `.superpowers/app_state.original.json` afterwards.

---

## 7. Out of scope

- Per-cell completeness (decided: completeness is per date, §2).
- Scaling partial totals to a 7-day equivalent (rejected: estimated numbers).
- Daily grain (a day is complete when imported).
- Forecasting changes (next roadmap item; it will consume `latestComplete`).
