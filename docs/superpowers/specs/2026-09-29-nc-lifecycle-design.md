# NC Periods (Lifecycle) Design

**Date**: 2026-09-29
**Status**: Draft, awaiting review
**Scope**: how a cell's non-compliance (NC) period is labelled in the daily, weekly and monthly views

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
| `queryService` `LIFECYCLES` omits Chronic NC | Chronic cells cannot be filtered |
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
- **Month** label = the more severe of its own label, the most severe label of its days, and the most severe label of the weeks that *start* in that month.

The roll-up only raises a period that is itself NC, so the `is_nc` flag and the label never contradict each other.

**What is guaranteed.** With the default week rule (≥ 1 bad day) every week that contains an NC day is NC, so daily → weekly tracing always holds. A month is NC with ≥ 3 bad days. A daily Chronic run is 49+ bad days, so the month it ends in has ≥ 3 of them unless the run ends on the 1st or 2nd. In that edge case the month is not NC by definition and shows Recovering. The same applies if a user raises `weekly_breach_days` above 1.

---

## 5. Editable settings

Stored in `ruleset` (one new version per save, as today). A new **NC Periods** section in the Targets modal replaces the "Consecutive Breach Days for NC" input.

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
| Renderer: `NcIntelligence`, `NetworkExplorer`, `Overview`, `overviewCharts`, `comparisonCharts`, `TargetsModal`, `previewApi` | Intermittent colour and filter entry; NC Periods settings section; mock data uses the new labels |
| `smoke.ts` | ACC-001-A (2nd consecutive NC week, no earlier run) becomes New NC; add the Recurring and Intermittent cases |

After upgrading, existing workspaces need **Data Manager → Maintenance → Rebuild Intelligence** once to relabel history.

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

## 8. Out of scope

- Which KPIs count as a bad day (settled in `3cc05ee`)
- Partial-week handling for weekly analytics (separate Phase 1 item)
- Scaling the recovery window by how severe the cell was (rejected: harder to explain)
