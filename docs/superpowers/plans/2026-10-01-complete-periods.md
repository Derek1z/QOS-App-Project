# Complete Periods Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Weekly and monthly views treat "latest" as the latest complete period (every day imported), keep partial periods visible and marked, skip partial non-NC periods in NC runs, and compare trends only between complete periods.

**Architecture:** A `period_coverage` table (one row per week/month: days with data, days in period, complete) is refreshed from `coverage_daily` wherever coverage is updated. `src/main/analytics/periods.ts` is the only place that decides "latest" (`latestPeriodSql`) and how a period row learns its completeness (`periodCoverageJoin`). Series rows sent to the renderer carry `complete` and `daysWithData`; `shared/periods.ts` gives `latestComplete()` and `periodLabel()` to every consumer.

**Tech Stack:** Electron 43, React 19, TypeScript, DuckDB (`@duckdb/node-api` 1.5.5), vitest 5, recharts + ECharts.

**Spec:** `docs/superpowers/specs/2026-10-01-complete-periods-design.md`

## Global Constraints

- Complete week: all 7 days Mon–Sun have a row in `coverage_daily`. Complete month: every calendar day has one. Completeness is per date, never per cell (spec §2).
- Latest period = newest complete period; if none of that grain is complete, the newest partial period, marked (spec §2).
- Partial labels: weekly `W40 · 3 of 7 days`, monthly `Oct · 10 of 31 days` (spec §3.2).
- A partial period that is NC counts like any period; a partial period that is not NC is skipped in runs (neither breaks nor extends) and carries the cell's last label of that grain with `is_nc = false` (spec §3.3).
- Trend only between complete periods; a partial period's trend is NULL, shown "—"; severity treats NULL like Stable (spec §3.4).
- Daily grain is unaffected (spec §2).
- Forecasting is out of scope (spec §7): leave `analytics/forecast.ts`, `getForecast`, `Forecasting.tsx`, `forecastCharts.ts` and `SimulationLab.tsx` untouched.
- Commit locally only. Never push, never open a PR.
- Never commit `.preview/vite.config.ts`, the two `*_Huawei_KPIs_and_Counters_Specification.txt` files, `.claude/` or `.superpowers/`.
- Every commit is gated by the command in "Gate". A red gate means no commit.
- Commit trailer, exactly: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Gate

Run from the repo root before every commit (smoke rewrites the git-ignored `app_state.json`; this restores it):

```bash
npm run typecheck && npx vitest run && npm run smoke > /tmp/qos-gate-smoke.log 2>&1; s=$?; cp .superpowers/app_state.original.json app_state.json; rm -rf /tmp/qos-smoke-* /tmp/qos-userdata-*; tail -3 /tmp/qos-gate-smoke.log; exit $s
```

Expected: typecheck silent, vitest `Test Files  N passed`, smoke log ends `[SMOKE] Smoke test completed successfully.`, exit 0.

## Review Focus

1. **Workspace with only one or two imported days.** Every weekly/monthly screen must still show that data (falls back to the newest partial period) — never an empty dashboard. Pinned in Task 1 ("too little data") and Task 4 ("too little data still shows").
2. **A past week with a missing import day in the middle of history.** It must not become "latest", and NC runs across it must not break. Pinned in Task 3 ("a hole week in history").
3. **Import that completes a week for cells that had no data on the imported day.** Their weekly label must be recomputed. Pinned in Task 3 ("completing a week relabels every cell in it").
4. **Old workspace opened by the new build.** `period_coverage` built on first open, labels follow §3.3. Pinned in Task 1 ("old workspace").
5. **Trend counts.** `byTrend` must not count a NULL trend under a key "null". Pinned in Task 3 ("NULL trend not counted").

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/main/analytics/periods.ts` | Create | `refreshPeriodCoverage`, `latestPeriodSql`, `latestWeekEndDateIdSql`, `periodCoverageJoin`, `completeSql`, `daysWithDataSql` |
| `shared/periods.ts` | Create | `PeriodCompleteness`, `latestComplete`, `previousComplete`, `daysInPeriod`, `periodLabel` |
| `src/main/workspace/schema.ts`, `manager.ts` | Modify | `period_coverage` table; marker bump |
| `src/main/import/aggregates.ts` | Modify | `updateCoverage` refreshes `period_coverage` |
| `src/main/analytics/engine.ts` | Modify | `refreshIntelligence` also covers touched months |
| `src/main/analytics/nc.ts` | Modify | Partial skip (§3.3), trend only between complete periods (§3.4) |
| `src/main/analytics/priority.ts` | Modify | Latest week per cell ≤ latest complete week |
| `src/main/services/queryService.ts`, `investigationService.ts`, `reportingService.ts`, `snapshotService.ts` | Modify | Latest sites → helpers; series carry completeness; last-element sites → `latestComplete` |
| `shared/api.ts` | Modify | `complete`, `daysWithData` on series rows; `Trend | null`; `periodComplete`; `weeksComplete` |
| Renderer: `Overview.tsx`, `HealthMatrix.tsx`, `NcIntelligence.tsx`, `NetworkExplorer.tsx`, `InvestigationWorkspace.tsx`, `lib/overviewData.ts`, `lib/overviewCharts.ts`, `lib/investigationCharts.ts`, `lib/previewApi.ts` | Modify | Partial labels/styling; `latestComplete`; "—" for NULL trend |
| `src/main/smoke.ts` | Modify | Expectations explained by spec §3 only |

---

### Task 1: Period coverage and the "latest" helpers

**Files:**
- Create: `src/main/analytics/periods.ts`
- Test: `tests/analytics/periodCoverage.test.ts`
- Modify: `src/main/workspace/schema.ts` (add table to `SCHEMA_SQL`)
- Modify: `src/main/workspace/manager.ts` (`ensureUpgradeSchema`; `NC_PERIODS_MARKER`)
- Modify: `src/main/import/aggregates.ts` (`updateCoverage`, ~line 271)

**Interfaces:**
- Produces:
  - `refreshPeriodCoverage(conn: DuckDBConnection, dateIds: number[]): Promise<void>`
  - `latestPeriodSql(grain: Grain): string` — scalar SQL subquery returning a DATE
  - `latestWeekEndDateIdSql(): string` — scalar SQL subquery returning the INTEGER date_id of the latest week's Sunday
  - `periodCoverageJoin(grain: Grain, periodExpr: string, alias?: string): string`
  - `completeSql(grain: Grain, alias?: string): string`, `daysWithDataSql(grain: Grain, alias?: string): string`

- [ ] **Step 1: Write the failing test**

`tests/analytics/periodCoverage.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates, recomputeAggregates, updateCoverage } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'
import { latestPeriodSql } from '../../src/main/analytics/periods'

/** One row per day from `from` to `to` for cell 1 (CSSR 99, compliant). */
async function days(ws: RealWorkspace, from: string, to: string): Promise<number[]> {
  const range = `range(DATE '${from}', DATE '${to}' + INTERVAL 1 DAY, INTERVAL 1 DAY) r(d)`
  await ws.conn.run(
    `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
       dl_throughput_kbps, availability_pct, source_import_id)
     SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), 1, 50, 100, 10, 20000, 99.9, 1 FROM ${range}`
  )
  const r = await ws.conn.runAndReadAll(`SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER) AS id FROM ${range}`)
  return r.getRowObjects().map((x) => Number(x.id))
}

async function coverage(ws: RealWorkspace): Promise<Record<string, string>> {
  const r = await ws.conn.runAndReadAll(
    `SELECT grain || ' ' || CAST(period_start AS VARCHAR) AS k,
            days_with_data || '/' || days_in_period || (CASE WHEN is_complete THEN ' complete' ELSE ' partial' END) AS v
     FROM period_coverage`
  )
  return Object.fromEntries(r.getRowObjects().map((x) => [String(x.k), String(x.v)]))
}

async function latest(ws: RealWorkspace, grain: 'daily' | 'weekly' | 'monthly'): Promise<string> {
  const r = await ws.conn.runAndReadAll(`SELECT CAST(${latestPeriodSql(grain)} AS VARCHAR) AS p`)
  return String(r.getRowObjects()[0].p)
}

describe('period coverage (spec §2, §4.1)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('records how many days each week and month has; latest is the newest complete period', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['C1'])
    await days(ws, '2026-06-29', '2026-07-22') // Mon 29 Jun .. Wed 22 Jul
    await recomputeAllAggregates(ws.conn)
    const c = await coverage(ws)
    expect(c['weekly 2026-07-13']).toBe('7/7 complete')
    expect(c['weekly 2026-07-20']).toBe('3/7 partial')
    expect(c['monthly 2026-06-01']).toBe('2/30 partial')
    expect(c['monthly 2026-07-01']).toBe('22/31 partial')
    expect(await latest(ws, 'weekly')).toBe('2026-07-13')
    expect(await latest(ws, 'monthly')).toBe('2026-07-01') // no complete month: newest partial
    expect(await latest(ws, 'daily')).toBe('2026-07-22')
  })

  it('a dataset that starts mid-week has a partial first week that is never latest', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['C1'])
    await days(ws, '2026-07-01', '2026-07-19') // Wed 1 Jul .. Sun 19 Jul
    await recomputeAllAggregates(ws.conn)
    expect((await coverage(ws))['weekly 2026-06-29']).toBe('5/7 partial')
    expect(await latest(ws, 'weekly')).toBe('2026-07-13')
  })

  it('latest month is the previous full month while the current one is partial', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['C1'])
    await days(ws, '2026-06-01', '2026-07-10')
    await recomputeAllAggregates(ws.conn)
    expect((await coverage(ws))['monthly 2026-06-01']).toBe('30/30 complete')
    expect((await coverage(ws))['monthly 2026-07-01']).toBe('10/31 partial')
    expect(await latest(ws, 'monthly')).toBe('2026-06-01')
  })

  it('with too little data the latest week is the partial one', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['C1'])
    await days(ws, '2026-07-20', '2026-07-22')
    await recomputeAllAggregates(ws.conn)
    expect(await latest(ws, 'weekly')).toBe('2026-07-20')
  })

  it('an import that fills the missing days completes the week', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['C1'])
    await days(ws, '2026-06-29', '2026-07-22')
    await recomputeAllAggregates(ws.conn)
    const ids = await days(ws, '2026-07-23', '2026-07-26')
    await recomputeAggregates(ws.conn, ids)
    await updateCoverage(ws.conn, ids)
    expect((await coverage(ws))['weekly 2026-07-20']).toBe('7/7 complete')
    expect(await latest(ws, 'weekly')).toBe('2026-07-20')
  })

  it('an old workspace without period_coverage builds it on first open', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['C1'])
    await days(ws, '2026-06-29', '2026-07-22')
    await recomputeAllAggregates(ws.conn)
    await refreshAllIntelligence(ws.conn)
    await ws.conn.run(`DROP TABLE period_coverage`)
    await ws.conn.run(`DELETE FROM workspace_meta WHERE key = 'nc_periods'`)
    const manager = await import('../../src/main/workspace/manager')
    await manager.closeWorkspace()
    await manager.openWorkspace(join(ws.dir, 'test.qosdb'))
    ws.conn = manager.getCurrent()!.connection
    expect((await coverage(ws))['weekly 2026-07-20']).toBe('3/7 partial')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/analytics/periodCoverage.test.ts`
Expected: FAIL, `Failed to resolve import "../../src/main/analytics/periods"`.

- [ ] **Step 3: Write `src/main/analytics/periods.ts`**

```ts
import type { DuckDBConnection } from '@duckdb/node-api'
import type { Grain } from '../../../shared/api'

/** Complete periods (spec docs/superpowers/specs/2026-10-01-complete-periods-design.md).
 *  A week or month is complete when every one of its days has data
 *  (a coverage_daily row). This file is the only place that decides what
 *  "latest" means and how a period row learns whether it is complete. */

type PeriodGrain = 'weekly' | 'monthly'

/** Rebuild period_coverage for every week and month that contains one of `dateIds`. */
export async function refreshPeriodCoverage(conn: DuckDBConnection, dateIds: number[]): Promise<void> {
  if (dateIds.length === 0) return
  const idList = dateIds.join(',')
  await conn.run(`
    INSERT OR REPLACE INTO period_coverage (grain, period_start, days_with_data, days_in_period, is_complete)
    SELECT 'weekly', d.week_start, count(c.date_id), 7, count(c.date_id) = 7
    FROM dim_date d LEFT JOIN coverage_daily c USING (date_id)
    WHERE d.week_start IN (SELECT week_start FROM dim_date WHERE date_id IN (${idList}))
    GROUP BY d.week_start`)
  await conn.run(`
    INSERT OR REPLACE INTO period_coverage (grain, period_start, days_with_data, days_in_period, is_complete)
    SELECT 'monthly', m.month_start, count(c.date_id), day(last_day(m.month_start)),
           count(c.date_id) = day(last_day(m.month_start))
    FROM (SELECT date_id, CAST(date_trunc('month', date) AS DATE) AS month_start FROM dim_date) m
    LEFT JOIN coverage_daily c USING (date_id)
    WHERE m.month_start IN (
      SELECT CAST(date_trunc('month', date) AS DATE) FROM dim_date WHERE date_id IN (${idList}))
    GROUP BY m.month_start`)
}

/** Latest period of `grain` (spec §2): newest complete, else newest partial. */
export function latestPeriodSql(grain: Grain): string {
  if (grain === 'daily') return `(SELECT max(d.date) FROM coverage_daily c JOIN dim_date d USING (date_id))`
  return `(SELECT coalesce(max(period_start) FILTER (WHERE is_complete), max(period_start))
           FROM period_coverage WHERE grain = '${grain}')`
}

/** date_id of the Sunday that ends the latest week (cell_health_history is keyed by week end). */
export function latestWeekEndDateIdSql(): string {
  return `(SELECT CAST(strftime(${latestPeriodSql('weekly')} + 6, '%Y%m%d') AS INTEGER))`
}

/** LEFT JOIN that attaches period_coverage to a row whose period starts at `periodExpr`. Empty for daily. */
export function periodCoverageJoin(grain: Grain, periodExpr: string, alias = 'pc'): string {
  if (grain === 'daily') return ''
  return `LEFT JOIN period_coverage ${alias} ON ${alias}.grain = '${grain as PeriodGrain}' AND ${alias}.period_start = ${periodExpr}`
}

/** Whether the joined period is complete. Rows with no coverage record (not yet backfilled) count as complete. */
export function completeSql(grain: Grain, alias = 'pc'): string {
  return grain === 'daily' ? 'true' : `coalesce(${alias}.is_complete, true)`
}

export function daysWithDataSql(grain: Grain, alias = 'pc'): string {
  return grain === 'daily' ? '1' : `coalesce(${alias}.days_with_data, ${alias}.days_in_period, 7)`
}
```

- [ ] **Step 4: Create the table, refresh it, build it on open**

`src/main/workspace/schema.ts` — add to `SCHEMA_SQL` right after the `coverage_daily` statement:

```ts
  `CREATE TABLE IF NOT EXISTS period_coverage (
     grain VARCHAR NOT NULL, period_start DATE NOT NULL,
     days_with_data INTEGER NOT NULL, days_in_period INTEGER NOT NULL, is_complete BOOLEAN NOT NULL,
     PRIMARY KEY (grain, period_start)
   )`,
```

`src/main/workspace/manager.ts` — in `ensureUpgradeSchema`, next to the other `CREATE TABLE IF NOT EXISTS` statements, run the same `CREATE TABLE IF NOT EXISTS period_coverage (...)` statement (copy it exactly). Change `NC_PERIODS_MARKER` to `'2026-10-01.2'` and extend its comment with `; 2026-10-01.2: complete periods — period_coverage backfill, partial non-NC periods skipped`. The existing once-on-open recompute (`recomputeAllAggregates` → `updateCoverage` for all dates) then fills `period_coverage`.

`src/main/import/aggregates.ts` — at the end of `updateCoverage`, after the `INSERT INTO coverage_daily ...`:

```ts
  await refreshPeriodCoverage(conn, dateIds)
```

with `import { refreshPeriodCoverage } from '../analytics/periods'`.

Update the two tests that pin the marker value (`tests/workspace/relabelOnOpen.test.ts`: every `'2026-10-01'` the test expects as the stored marker becomes `'2026-10-01.2'`; keep the stamped old value in "relabelled under the earlier month rule" as `'2026-09-30'`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/analytics/periodCoverage.test.ts tests/workspace/relabelOnOpen.test.ts`
Expected: PASS.

- [ ] **Step 6: Gate and commit**

```bash
git add src/main/analytics/periods.ts tests/analytics/periodCoverage.test.ts src/main/workspace/schema.ts src/main/workspace/manager.ts src/main/import/aggregates.ts tests/workspace/relabelOnOpen.test.ts
git commit -m "feat(periods): record period completeness; latest = latest complete period

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared period helpers

**Files:**
- Create: `shared/periods.ts`
- Test: `tests/shared/periods.test.ts`

**Interfaces:**
- Produces:
  - `interface PeriodCompleteness { complete: boolean; daysWithData: number }`
  - `latestComplete<T extends { complete?: boolean }>(rows: readonly T[]): T | undefined`
  - `previousComplete<T extends { complete?: boolean }>(rows: readonly T[], current: T | undefined): T | undefined`
  - `daysInPeriod(grain: Grain, periodStart: string): number`
  - `periodLabel(label: string, grain: Grain, periodStart: string, p: Partial<PeriodCompleteness>): string`

- [ ] **Step 1: Write the failing test**

`tests/shared/periods.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { latestComplete, previousComplete, daysInPeriod, periodLabel } from '../../shared/periods'

const rows = [
  { id: 'W38', complete: true },
  { id: 'W39', complete: true },
  { id: 'W40', complete: false }
]

describe('shared period helpers (spec §3.1, §3.2, §4.3)', () => {
  it('latest is the last complete row, else the last row, else nothing', () => {
    expect(latestComplete(rows)?.id).toBe('W39')
    expect(latestComplete([{ id: 'W40', complete: false }])?.id).toBe('W40')
    expect(latestComplete([])).toBeUndefined()
    expect(latestComplete([{ id: 'd1' }, { id: 'd2' }])?.id).toBe('d2') // rows without the flag (daily) are complete
  })

  it('previous is the complete row before the latest', () => {
    expect(previousComplete(rows, latestComplete(rows))?.id).toBe('W38')
    expect(previousComplete([{ id: 'W40', complete: false }], undefined)).toBeUndefined()
  })

  it('knows how many days a period has', () => {
    expect(daysInPeriod('weekly', '2026-09-28')).toBe(7)
    expect(daysInPeriod('monthly', '2026-10-01')).toBe(31)
    expect(daysInPeriod('monthly', '2026-02-01')).toBe(28)
    expect(daysInPeriod('daily', '2026-10-01')).toBe(1)
  })

  it('labels partial periods with their coverage', () => {
    expect(periodLabel('W40', 'weekly', '2026-09-28', { complete: false, daysWithData: 3 })).toBe('W40 · 3 of 7 days')
    expect(periodLabel('Oct', 'monthly', '2026-10-01', { complete: false, daysWithData: 10 })).toBe('Oct · 10 of 31 days')
    expect(periodLabel('W39', 'weekly', '2026-09-21', { complete: true, daysWithData: 7 })).toBe('W39')
    expect(periodLabel('W39', 'weekly', '2026-09-21', {})).toBe('W39')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/shared/periods.test.ts`
Expected: FAIL, `Failed to resolve import "../../shared/periods"`.

- [ ] **Step 3: Write `shared/periods.ts`**

```ts
import type { Grain } from './api'

/** Complete-period helpers shared by main and renderer (spec 2026-10-01 §3, §4.3).
 *  Every "take the latest period of a series" goes through latestComplete. */

export interface PeriodCompleteness {
  /** every day of the period has imported data */
  complete: boolean
  /** days of the period that have imported data */
  daysWithData: number
}

const isComplete = (r: { complete?: boolean }): boolean => r.complete !== false

/** The last complete row; the last row when none is complete; undefined when empty. */
export function latestComplete<T extends { complete?: boolean }>(rows: readonly T[]): T | undefined {
  for (let i = rows.length - 1; i >= 0; i--) if (isComplete(rows[i])) return rows[i]
  return rows[rows.length - 1]
}

/** The complete row before `current` (for period-on-period comparisons). */
export function previousComplete<T extends { complete?: boolean }>(rows: readonly T[], current: T | undefined): T | undefined {
  if (!current) return undefined
  const at = rows.indexOf(current)
  for (let i = at - 1; i >= 0; i--) if (isComplete(rows[i])) return rows[i]
  return undefined
}

export function daysInPeriod(grain: Grain, periodStart: string): number {
  if (grain === 'daily') return 1
  if (grain === 'weekly') return 7
  const [y, m] = periodStart.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** `W40 · 3 of 7 days` for a partial period, the plain label otherwise. */
export function periodLabel(label: string, grain: Grain, periodStart: string, p: Partial<PeriodCompleteness>): string {
  if (p.complete !== false) return label
  return `${label} · ${p.daysWithData ?? 0} of ${daysInPeriod(grain, periodStart)} days`
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/shared/periods.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Gate and commit**

```bash
git add shared/periods.ts tests/shared/periods.test.ts
git commit -m "feat(periods): shared latestComplete and partial-period labels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: NC engine — partial periods and trend

**Files:**
- Modify: `src/main/analytics/nc.ts` (`sourceSql`, `stageGrainSql`, `TREND_SQL`, `recomputeNcLifecycle`)
- Modify: `src/main/analytics/engine.ts` (`refreshIntelligence`)
- Modify: `shared/api.ts` (`NcLifecycleRow.trend`, `CellIntelligenceRow.trend`, `CellDetail.current.trend` → `Trend | null`)
- Modify: `src/main/services/queryService.ts:324`, `:571`, CellDetail `current.trend`, `byTrend` counting (~`:340`)
- Test: `tests/analytics/ncPartialPeriods.test.ts`

**Interfaces:**
- Consumes: `periodCoverageJoin`, `completeSql` (Task 1)
- Produces: `cell_nc_lifecycle.trend` is NULL for partial periods; partial non-NC rows carry the previous label with `is_nc = false`

- [ ] **Step 1: Write the failing test**

`tests/analytics/ncPartialPeriods.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates, recomputeAggregates, updateCoverage } from '../../src/main/import/aggregates'
import { refreshAllIntelligence, refreshIntelligence } from '../../src/main/analytics/engine'
import { getNcLifecycle } from '../../src/main/services/queryService'

/** Rows for `cellId` from `from` to `to` where `present`; CSSR 90 (bad, target 95) where `bad`, else 99. */
async function days(ws: RealWorkspace, cellId: number, from: string, to: string, bad: string, present = 'true'): Promise<number[]> {
  const range = `range(DATE '${from}', DATE '${to}' + INTERVAL 1 DAY, INTERVAL 1 DAY) r(d)`
  await ws.conn.run(
    `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
       dl_throughput_kbps, availability_pct, source_import_id)
     SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, 50, 100, 10, 20000, 99.9, 1
     FROM ${range} WHERE ${present}`
  )
  await ws.conn.run(
    `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
     SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, k.kpi_id, CASE WHEN ${bad} THEN 90 ELSE 99 END
     FROM ${range}, kpi_defs k
     WHERE ${present} AND k.technology = '3G' AND k.kpi_key = 'call_setup_success_3g'`
  )
  const r = await ws.conn.runAndReadAll(`SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER) AS id FROM ${range} WHERE ${present}`)
  return r.getRowObjects().map((x) => Number(x.id))
}

async function build(ws: RealWorkspace): Promise<void> {
  await recomputeAllAggregates(ws.conn)
  await refreshAllIntelligence(ws.conn)
}

async function weekly(ws: RealWorkspace, cell: string, week: string): Promise<{ lifecycle: string; isNc: boolean; trend: string | null }> {
  const x = (await ws.conn.runAndReadAll(
    `SELECT l.lifecycle, l.is_nc, l.trend FROM cell_nc_lifecycle l JOIN dim_cell c USING (cell_id)
     WHERE c.name = ? AND l.grain = 'weekly' AND l.period_start = DATE '${week}'`, [cell]
  )).getRowObjects()[0]
  return { lifecycle: String(x.lifecycle), isNc: Boolean(x.is_nc), trend: x.trend == null ? null : String(x.trend) }
}

describe('partial periods in NC labels (spec §3.3, §3.4)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('a chronic cell with two clean days in a partial week stays Chronic', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['CHRONIC'])
    // bad every day 1 Jun .. 19 Jul (weeks 1 Jun .. 13 Jul: the 7th is Chronic); Mon 20 + Tue 21 Jul clean; data ends Tue
    await days(ws, 1, '2026-06-01', '2026-07-21', `d <= DATE '2026-07-19'`)
    await build(ws)
    expect(await weekly(ws, 'CHRONIC', '2026-07-13')).toMatchObject({ lifecycle: 'Chronic NC', isNc: true })
    expect(await weekly(ws, 'CHRONIC', '2026-07-20')).toEqual({ lifecycle: 'Chronic NC', isNc: false, trend: null })
  })

  it('a bad day in the partial week makes it NC and the run continues', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['CHRONIC'])
    await days(ws, 1, '2026-06-01', '2026-07-22', `d <= DATE '2026-07-19' OR d = DATE '2026-07-22'`)
    await build(ws)
    expect(await weekly(ws, 'CHRONIC', '2026-07-20')).toEqual({ lifecycle: 'Chronic NC', isNc: true, trend: null })
  })

  it('trend is compared only between complete weeks', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['CHRONIC'])
    await days(ws, 1, '2026-06-01', '2026-07-22', `d <= DATE '2026-07-19' OR d = DATE '2026-07-22'`)
    await build(ws)
    expect((await weekly(ws, 'CHRONIC', '2026-07-13')).trend).not.toBeNull()
    expect((await weekly(ws, 'CHRONIC', '2026-07-20')).trend).toBeNull()
  })

  it('a hole week in history neither becomes latest nor breaks the run', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['HOLE'])
    // bad every day 1 Jun .. 26 Jul, but no import at all on Wed 8 Jul: week 6 Jul is partial (6/7)
    await days(ws, 1, '2026-06-01', '2026-07-26', 'true', `d <> DATE '2026-07-08'`)
    await build(ws)
    // week 6 Jul is partial but NC (bad days), so it counts: 6th week Persistent; 13 Jul 7th → Chronic
    expect((await weekly(ws, 'HOLE', '2026-07-13')).lifecycle).toBe('Chronic NC')
    expect((await getNcLifecycle('weekly')).weekStart).toBe('2026-07-20')
  })

  it('completing a week relabels every cell in it, including cells with no data on the imported day', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['CHRONIC', 'OTHER'])
    await days(ws, 1, '2026-06-01', '2026-07-21', `d <= DATE '2026-07-19'`)
    await days(ws, 2, '2026-06-01', '2026-07-21', 'false')
    await build(ws)
    expect((await weekly(ws, 'CHRONIC', '2026-07-20')).isNc).toBe(false)
    // only OTHER gets data for Wed..Sun; the week becomes complete; CHRONIC's clean week now counts and breaks its run
    const ids = await days(ws, 2, '2026-07-22', '2026-07-26', 'false')
    await recomputeAggregates(ws.conn, ids)
    await updateCoverage(ws.conn, ids)
    await refreshIntelligence(ws.conn, ids)
    expect(await weekly(ws, 'CHRONIC', '2026-07-20')).toMatchObject({ lifecycle: 'Recovering', isNc: false })
  })

  it('a NULL trend is not counted under a "null" key', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['ONLY'])
    await days(ws, 1, '2026-07-20', '2026-07-22', 'true') // one partial week: latest falls back to it
    await build(ws)
    const nc = await getNcLifecycle('weekly')
    expect(Object.keys(nc.byTrend).sort()).toEqual(['Improving', 'Stable', 'Worsening'])
    expect(nc.cells[0].trend).toBeNull()
  })
})
```

Expected values were derived from the spec rules: the week of 20 Jul with Mon–Tue data is partial (2 of 7 days); "Recovering" in the last test follows NC spec §3 rule 6 (not NC, last NC period 1 week ago ≤ recovery 3 weeks).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/analytics/ncPartialPeriods.test.ts`
Expected: FAIL — the first test gets `'Recovering'` for 2026-07-20; the trend test gets a non-null trend for 2026-07-20; the byTrend test sees a `null` key.

- [ ] **Step 3: Skip partial non-NC periods in `nc.ts`**

In `sourceSql`, add `true AS complete` to the daily SELECT list (after `f.availability_pct AS avail`). For weekly/monthly, add the coverage join and column:

```ts
  const [table, col] = grain === 'weekly' ? ['agg_cell_weekly', 'week_start'] : ['agg_cell_monthly', 'month_start']
  return `
      SELECT w.cell_id, w.${col} AS period_date, w.is_nc,
             CAST(coalesce(w.breach_days, 0) AS DOUBLE) AS breach_days,
             CAST(greatest(coalesce(w.observed_days, 1), 1) AS DOUBLE) AS observed_days,
             w.prb_avg, w.data_volume_mb_sum AS vol, w.connected_users_sum AS usr,
             w.dl_throughput_kbps_avg AS thr, w.availability_pct_avg AS avail,
             ${completeSql(grain)} AS complete
      FROM ${table} w
      ${periodCoverageJoin(grain, `w.${col}`)}
      WHERE w.cell_id IN (${idList})`
```

(import `periodCoverageJoin, completeSql` from `./periods`).

In `stageGrainSql`:
1. Change the `src` CTE to keep only rows that take part in runs:

```ts
    WITH src AS (
      SELECT *, ${PIDX[grain]} AS pidx FROM (${sourceSql(grain, idList)}) WHERE complete OR is_nc
    ),
```

2. In the `runs` CTE, compute the five trend lags over complete rows only — replace each `OVER (${byCell})` on `lag(is_nc)`, `lag(prb_avg)`, `lag(breach_days)`, `lag(thr)`, `lag(vol / observed_days)`, `lag(usr / observed_days)` with `OVER (PARTITION BY cell_id, complete ORDER BY pidx)`. Keep `grp` and `prev_nc_pidx` on `${byCell}`.

3. Change `TREND_SQL` so a partial period has no trend:

```ts
const TREND_SQL = `CASE
    WHEN NOT complete THEN NULL
    WHEN prev_is_nc IS NULL AND prev_prb IS NULL THEN 'Stable'
    WHEN improving - worsening >= 2 THEN 'Improving'
    WHEN improving - worsening <= -2 THEN 'Worsening'
    ELSE 'Stable' END`
```

4. Add a second statement that writes the skipped rows, carrying the cell's last label of that grain:

```ts
/** Partial periods that are not NC (spec 2026-10-01 §3.3): skipped by runs, so
 *  they carry the cell's last label of the grain, with is_nc false and no trend. */
function stageSkippedSql(grain: NcGrain, idList: string): string {
  return `
    INSERT INTO stg_nc_lifecycle
    SELECT s.cell_id, '${grain}', s.period_date, false, coalesce(k.lc_rank, ${R['Healthy']}), NULL,
           s.breach_days, s.prb_avg, s.avail
    FROM (SELECT * FROM (${sourceSql(grain, idList)}) WHERE NOT complete AND NOT is_nc) s
    ASOF LEFT JOIN (SELECT cell_id, period_date, lc_rank FROM stg_nc_lifecycle WHERE grain = '${grain}') k
      ON s.cell_id = k.cell_id AND s.period_date > k.period_date`
}
```

and in `recomputeNcLifecycle` run it right after each grain's stage insert:

```ts
    for (const g of grains) {
      await conn.run(stageGrainSql(g, idList, periodsFor(g, rules)))
      if (g !== 'daily') await conn.run(stageSkippedSql(g, idList))
    }
```

The roll-ups already act only on rows with `is_nc`, so skipped rows are never raised; the final severity CASE already maps `NOT is_nc` to `'Normal'` and only adds points for `trend = 'Worsening'`, so a NULL trend scores like Stable.

- [ ] **Step 4: Relabel touched months too**

`src/main/analytics/engine.ts` `refreshIntelligence` — widen the cell set to cells with data in any touched week **or month**:

```ts
  const r = await conn.runAndReadAll(`
    SELECT DISTINCT f.cell_id
    FROM fact_cell_daily f
    JOIN dim_date d ON d.date_id = f.date_id
    WHERE d.week_start IN (SELECT DISTINCT week_start FROM dim_date WHERE date_id IN (${idList}))
       OR date_trunc('month', d.date) IN (
            SELECT DISTINCT date_trunc('month', date) FROM dim_date WHERE date_id IN (${idList}))
  `)
```

- [ ] **Step 5: Readers accept a NULL trend**

`shared/api.ts`: `NcLifecycleRow.trend`, `CellIntelligenceRow.trend` and `CellDetail['current'].trend` become `Trend | null`.

`src/main/services/queryService.ts`:
- every `trend: String(x.trend) as …` / `String(life.trend) as Trend` becomes `trend: x.trend == null ? null : (String(x.trend) as Trend)` (same for `life.trend`);
- in `getNcLifecycle`'s counting loop replace `byTrend[c.trend]++` with `if (c.trend) byTrend[c.trend]++`.

Fix every TypeScript error this produces in the renderer by rendering `—` where a trend is NULL (search: `grep -rn "\.trend" src/renderer --include=*.tsx --include=*.ts`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/analytics/ncPartialPeriods.test.ts tests/analytics/ncPeriods.test.ts tests/workspace/relabelOnOpen.test.ts`
Expected: PASS. If an `ncPeriods.test.ts` case now fails because its data ends mid-week, check it against spec §3.3 before touching either side: a partial last week that is not NC now carries the previous label. Adjust only an expectation the spec explains, and list it in the commit message.

- [ ] **Step 7: Gate and commit**

```bash
git add src/main/analytics/nc.ts src/main/analytics/engine.ts shared/api.ts src/main/services/queryService.ts tests/analytics/ncPartialPeriods.test.ts
git add -u src/renderer tests
git commit -m "feat(nc): partial periods skip NC runs unless NC; trend only between complete periods

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Every "latest" query uses the latest complete period

**Files:**
- Modify: `src/main/services/queryService.ts` (sites below)
- Modify: `src/main/services/investigationService.ts:146`, `:333`, `:691`, `:693`, `:717`, `:719`
- Modify: `src/main/services/snapshotService.ts:195`
- Modify: `src/main/analytics/priority.ts:60-65`
- Modify: `shared/api.ts` (`NcLifecycleResult.periodComplete`, `ExecutiveOverviewResult.periodComplete`)
- Test: `tests/analytics/latestCompletePeriod.test.ts`

**Interfaces:**
- Consumes: `latestPeriodSql`, `latestWeekEndDateIdSql`, `periodCoverageJoin`, `completeSql` (Task 1)
- Produces: `NcLifecycleResult.periodComplete: boolean`, `ExecutiveOverviewResult.periodComplete: boolean`

- [ ] **Step 1: Write the failing test**

`tests/analytics/latestCompletePeriod.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'
import {
  getNcLifecycle, getKpiOverview, getCellIntelligence, getCellDetail, getPriorityQueue, getHealth, getExecutiveOverview
} from '../../src/main/services/queryService'

async function build(ws: RealWorkspace, from: string, to: string): Promise<void> {
  const range = `range(DATE '${from}', DATE '${to}' + INTERVAL 1 DAY, INTERVAL 1 DAY) r(d)`
  for (const cellId of [1, 2]) {
    await ws.conn.run(
      `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
         dl_throughput_kbps, availability_pct, source_import_id)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, 50, 100, 10, 20000, 99.9, 1 FROM ${range}`
    )
    await ws.conn.run(
      `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, k.kpi_id, CASE WHEN ${cellId} = 1 THEN 90 ELSE 99 END
       FROM ${range}, kpi_defs k WHERE k.technology = '3G' AND k.kpi_key = 'call_setup_success_3g'`
    )
  }
  await recomputeAllAggregates(ws.conn)
  await refreshAllIntelligence(ws.conn)
}

describe('"latest" is the latest complete week (spec §3.1)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('a dataset ending on a Wednesday reports the previous full week everywhere', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['BAD', 'GOOD'])
    await build(ws, '2026-06-29', '2026-07-22')
    const nc = await getNcLifecycle('weekly')
    expect(nc.weekStart).toBe('2026-07-13')
    expect(nc.periodComplete).toBe(true)
    expect((await getKpiOverview()).weekStart).toBe('2026-07-13')
    expect((await getCellIntelligence({})).rows.every((r) => r.weekStart === '2026-07-13')).toBe(true)
    expect((await getCellDetail(1, 'weekly'))?.current?.weekStart).toBe('2026-07-13')
    expect((await getPriorityQueue('balanced')).every((p) => p.asOf === '2026-07-13')).toBe(true)
    expect((await getHealth('weekly')).cells.every((c) => c.weekStart === '2026-07-13')).toBe(true)
    const exec = await getExecutiveOverview({ grain: 'weekly' })
    expect(exec?.asOf).toBe('2026-07-13')
    expect(exec?.periodComplete).toBe(true)
  })

  it('too little data still shows: the partial week is latest and marked', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['BAD', 'GOOD'])
    await build(ws, '2026-07-20', '2026-07-22')
    const nc = await getNcLifecycle('weekly')
    expect(nc.weekStart).toBe('2026-07-20')
    expect(nc.periodComplete).toBe(false)
    expect(nc.cells.length).toBe(2)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/analytics/latestCompletePeriod.test.ts`
Expected: FAIL — `nc.weekStart` is `'2026-07-20'` and `periodComplete` is undefined.

- [ ] **Step 3: Replace every "latest" site**

Import `latestPeriodSql, latestWeekEndDateIdSql, periodCoverageJoin, completeSql` from `../analytics/periods` where used. Line numbers are approximate; match by the quoted text.

| File | Site (current text) | Replace with |
|---|---|---|
| queryService `getKpiOverview` | `SELECT max(week_start) AS ws FROM agg_cell_kpi_weekly` | `SELECT CAST(${latestPeriodSql('weekly')} AS VARCHAR) AS ws` |
| queryService `getKpiOverview` trend | `>= (SELECT max(week_start) FROM agg_cell_kpi_weekly) - INTERVAL 11 WEEK` | `>= ${latestPeriodSql('weekly')} - INTERVAL 11 WEEK` (the partial week stays in the series; Task 5 marks it) |
| queryService `getNcLifecycle` | `(SELECT max(period_start) FROM cell_nc_lifecycle WHERE grain = '${safeGrain}')` | `${latestPeriodSql(safeGrain)}` |
| queryService `getCellIntelligence` | `(SELECT max(period_start) FROM cell_nc_lifecycle WHERE grain = '${g}')` | `${latestPeriodSql(g)}` |
| queryService `getCellDetail` | `period_start = (SELECT max(period_start) FROM cell_nc_lifecycle WHERE cell_id = … AND grain = '${g}')` | `period_start = (SELECT max(period_start) FROM cell_nc_lifecycle WHERE cell_id = ${numCellId} AND grain = '${g}' AND period_start <= ${latestPeriodSql(g)})` |
| queryService `getHealth` | `h.date_id = (SELECT max(date_id) FROM cell_health_history)` | `h.date_id = ${latestWeekEndDateIdSql()}` |
| queryService `getExplorer` (×2), `getRegionMap` (×3), `getRegionDistricts` (×3), `getPriorityCenter`, `getExecutiveOverview` (×4), `getSummary`-area site at ~3123 | `(SELECT max(week_start) FROM agg_cell_weekly)` and `(SELECT max(week_start) FROM agg_cell_kpi_weekly)` | `${latestPeriodSql('weekly')}` |
| queryService `getExplorer`, `getRegionMap`, `getRegionDistricts` | `h.date_id = (SELECT max(date_id) FROM cell_health_history)` | `h.date_id = ${latestWeekEndDateIdSql()}` |
| queryService `getExplorer`, `getExecutiveOverview` | `(SELECT max(period_start) FROM cell_nc_lifecycle WHERE grain = 'weekly')` | `${latestPeriodSql('weekly')}` |
| queryService `getExecutiveOverview` | `SELECT CAST(max(week_start) AS VARCHAR) AS max_wk FROM agg_cell_weekly` | `SELECT CAST(${latestPeriodSql('weekly')} AS VARCHAR) AS max_wk` |
| queryService ~3012 (per-KPI latest) | `(SELECT max(week_start) FROM agg_cell_kpi_weekly WHERE kpi_id = ${numKpiId})` | `(SELECT max(week_start) FROM agg_cell_kpi_weekly WHERE kpi_id = ${numKpiId} AND week_start <= ${latestPeriodSql('weekly')})` |
| investigationService ~146, ~333 | `(SELECT max(period_start) FROM cell_nc_lifecycle WHERE …grain…)` | `${latestPeriodSql('weekly')}` at 146; at 333 `(SELECT max(period_start) FROM cell_nc_lifecycle WHERE cell_id = ${numEntityId} AND grain = '${grain}' AND period_start <= ${latestPeriodSql(grain)})` |
| investigationService ~691, ~717 | `(SELECT max(week_start) FROM agg_cell_weekly)` | `${latestPeriodSql('weekly')}` |
| investigationService ~693, ~719; snapshotService ~195 | `(SELECT max(date_id) FROM cell_health_history)` | `${latestWeekEndDateIdSql()}` |

Leave unchanged (not "latest" choices): `ensureGrainLifecyclePopulated` (freshness check), `getNcMovement`'s `ORDER BY period_start DESC LIMIT` (a series), `ORDER BY period_start DESC LIMIT ${sparkLimit}` (a series), every `max(as_of) FROM cell_priority_history` (priority is now computed only for complete-or-latest weeks, see Step 4), every `f.date_id = (SELECT max(date_id) FROM fact_cell_daily)` (daily).

After the edits:

```bash
grep -n "max(week_start) FROM agg_cell\|max(month_start) FROM agg_cell\|max(period_start) FROM cell_nc_lifecycle WHERE grain\|max(date_id) FROM cell_health_history" src/main/services src/main/analytics
```

Expected: only the `ensureGrainLifecyclePopulated` lines.

- [ ] **Step 4: Priority ranks the latest complete week**

`src/main/analytics/priority.ts`, the `latest` CTE:

```ts
      WITH latest AS (
        SELECT cell_id, week_start,
          row_number() OVER (PARTITION BY cell_id ORDER BY week_start DESC) AS rn
        FROM agg_cell_weekly
        WHERE cell_id IN (${idList}) AND week_start <= ${latestPeriodSql('weekly')}
      ),
```

- [ ] **Step 5: Say whether the shown period is complete**

`shared/api.ts`: add `periodComplete: boolean` to `NcLifecycleResult` and `ExecutiveOverviewResult` (doc comment: "false when no complete period exists yet and the newest partial one is shown").

In `getNcLifecycle` and `getExecutiveOverview` read it with one query and return it (and `periodComplete: true` in the empty results):

```ts
  const pcR = await conn.runAndReadAll(
    `SELECT ${grain === 'daily' ? 'true' : `coalesce((SELECT is_complete FROM period_coverage WHERE grain = '${grain}' AND period_start = ${latestPeriodSql(grain)}), true)`} AS c`
  )
  const periodComplete = Boolean(pcR.getRowObjects()[0]?.c ?? true)
```

(use the grain variable in scope: `safeGrain` in `getNcLifecycle`; `'weekly'` or the `opts.grain` in `getExecutiveOverview`). Add `periodComplete` to the matching objects in `src/renderer/lib/previewApi.ts` (`true`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/analytics/latestCompletePeriod.test.ts tests/analytics/regionMap.test.ts tests/analytics/priorityKpiBreach.test.ts tests/analytics/priorityBands.test.ts`
Expected: PASS.

- [ ] **Step 7: Gate and commit**

```bash
git add -u src shared tests
git add tests/analytics/latestCompletePeriod.test.ts
git commit -m "fix(periods): every latest-week query uses the latest complete week

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Series rows carry their completeness

**Files:**
- Modify: `shared/api.ts` (`NcMovementRow`, `KpiTrendPoint`, `HealthComponentRow`, `CellWeekPoint`, `InvestigationWeek` gain `complete: boolean; daysWithData: number`; `HealthMatrixResult` gains `weeksComplete: boolean[]`)
- Modify: `src/main/services/queryService.ts` (`getNcMovement`, `getKpiOverview` trend, `getCellDetail` weeks, `getHealthMatrix`)
- Modify: `src/main/analytics/health.ts` (`computeNetworkHealth`)
- Modify: `src/main/services/investigationService.ts` (weeks series ~line 250)
- Modify: `src/renderer/lib/previewApi.ts` (mock rows get `complete: true, daysWithData: 7`)
- Test: `tests/analytics/seriesCompleteness.test.ts`

**Interfaces:**
- Consumes: `periodCoverageJoin`, `completeSql`, `daysWithDataSql` (Task 1); `PeriodCompleteness` (Task 2)
- Produces: the five row types extend `PeriodCompleteness`; `HealthMatrixResult.weeksComplete`

- [ ] **Step 1: Write the failing test**

`tests/analytics/seriesCompleteness.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'
import { getNcMovement, getCellDetail, getHealth, getHealthMatrix, getKpiOverview } from '../../src/main/services/queryService'
import { getInvestigation } from '../../src/main/services/investigationService'

describe('series rows say whether each period is complete (spec §3.2, §4.3)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('the Mon–Wed week is in every weekly series, marked partial with 3 days', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['C1'])
    const range = `range(DATE '2026-06-29', DATE '2026-07-23', INTERVAL 1 DAY) r(d)`
    await ws.conn.run(
      `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
         dl_throughput_kbps, availability_pct, source_import_id)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), 1, 50, 100, 10, 20000, 99.9, 1 FROM ${range}`
    )
    await ws.conn.run(
      `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), 1, k.kpi_id, 90
       FROM ${range}, kpi_defs k WHERE k.technology = '3G' AND k.kpi_key = 'call_setup_success_3g'`
    )
    await recomputeAllAggregates(ws.conn)
    await refreshAllIntelligence(ws.conn)

    const pick = <T extends { complete: boolean; daysWithData: number }>(rows: T[], key: (r: T) => string, p: string) => {
      const r = rows.find((x) => key(x) === p)!
      return { complete: r.complete, daysWithData: r.daysWithData }
    }
    const partial = { complete: false, daysWithData: 3 }
    const full = { complete: true, daysWithData: 7 }

    const mv = await getNcMovement(8, 'weekly')
    expect(pick(mv, (r) => r.weekStart, '2026-07-20')).toEqual(partial)
    expect(pick(mv, (r) => r.weekStart, '2026-07-13')).toEqual(full)

    const cd = (await getCellDetail(1, 'weekly'))!
    expect(pick(cd.weeks, (r) => r.weekStart, '2026-07-20')).toEqual(partial)

    const h = await getHealth('weekly')
    expect(pick(h.network, (r) => r.asOf, '2026-07-20')).toEqual(partial)

    const kpi = (await getKpiOverview()).kpis.find((k) => k.key === 'call_setup_success_3g')!
    expect(pick(kpi.trend, (r) => r.weekStart, '2026-07-20')).toEqual(partial)

    const inv = (await getInvestigation('cell', 1, { grain: 'weekly' }))!
    expect(pick(inv.weeks, (r) => r.weekStart, '2026-07-20')).toEqual(partial)

    const m = await getHealthMatrix('cell')
    expect(m.weeksComplete.length).toBe(m.weeks.length)
    expect(m.weeksComplete[m.weeksComplete.length - 1]).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/analytics/seriesCompleteness.test.ts`
Expected: FAIL — `complete` undefined on movement rows.

- [ ] **Step 3: Add the fields**

`shared/api.ts`: `import type { PeriodCompleteness } from './periods'` and make `NcMovementRow`, `KpiTrendPoint`, `HealthComponentRow`, `CellWeekPoint`, `InvestigationWeek` extend `PeriodCompleteness`. Add `weeksComplete: boolean[]` to `HealthMatrixResult`.

For each producer, join the coverage on the row's period column and select two columns, then map them:

```ts
// SQL: add to SELECT
       ${completeSql(grain)} AS complete, ${daysWithDataSql(grain)} AS days_with_data
// SQL: add to FROM (after the main table)
       ${periodCoverageJoin(grain, '<period column>')}
// mapping
      complete: Boolean(x.complete),
      daysWithData: Number(x.days_with_data ?? 0),
```

| Producer | Period column | Grain variable |
|---|---|---|
| `getNcMovement` (`FROM cell_nc_lifecycle`, grouped by `period_start`) | `period_start` (add `pc.is_complete, pc.days_with_data, pc.days_in_period` to `GROUP BY`) | `safeGrain` |
| `getKpiOverview` trend (`FROM agg_cell_kpi_weekly w`) | `w.week_start` (add the coverage columns to `GROUP BY`) | `'weekly'` |
| `getCellDetail` weeks (`FROM ${aggTable} w`) | `${dateCol}` | `g` |
| `computeNetworkHealth` (`FROM agg_network_${grain} n`) | `n.period_start` | `grain` |
| `getInvestigation` weeks — cell query (`FROM ${aggTable} w`) and roll-up query (`FROM ${aggTable} w ${join}`, add to `GROUP BY`) | `${dateCol}` | `grain` |

`getHealthMatrix`: weeks are week-end `date_id`s. After building `weekDates`, read completeness once:

```ts
  const wcR = weekDates.length > 0 ? await conn.runAndReadAll(
    `SELECT CAST(d.date_id AS DOUBLE) AS date_id, coalesce(pc.is_complete, true) AS complete
     FROM dim_date d
     LEFT JOIN period_coverage pc ON pc.grain = 'weekly' AND pc.period_start = CAST(d.date - 6 AS DATE)
     WHERE d.date_id IN (${weekDates.join(',')})`
  ) : null
  const completeByDate = new Map((wcR?.getRowObjects() ?? []).map((x) => [Number(x.date_id), Boolean(x.complete)]))
```

and return `weeksComplete: weekDates.map((d) => completeByDate.get(d) ?? true)`. In the `'worst'` sort, rank by the latest **complete** week: `const latestWeek = [...weekDates].reverse().find((d) => completeByDate.get(d) !== false) ?? weekDates[weekDates.length - 1]`.

`src/renderer/lib/previewApi.ts`: add `complete: true, daysWithData: 7` to the mock objects of these types and `weeksComplete` (all `true`) to the mock health matrix, so the typecheck passes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/analytics/seriesCompleteness.test.ts tests/renderer/overviewData.test.ts`
Expected: PASS (update `overviewData.test.ts` fixtures to include `complete: true, daysWithData: 7` on each `NcMovementRow` if the typecheck requires it).

- [ ] **Step 5: Gate and commit**

```bash
git add -u src shared tests
git add tests/analytics/seriesCompleteness.test.ts
git commit -m "feat(periods): series rows carry complete and daysWithData

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: "Current" values come from the latest complete row

**Files:**
- Modify: `src/main/services/investigationService.ts:319-320` (`last`, `prev`)
- Modify: `src/main/services/reportingService.ts:98`, `:226-230`, `:540`, `:554`, `:1007`
- Modify: `src/main/services/queryService.ts:461` (`getHealthMatrix` — done in Task 5), `:724` (`getCellDetail` latestWeek), `:2897` (`curHealth`), `:2977`, `:3003` (sparkline current value)
- Modify: `src/renderer/lib/investigationCharts.ts:26`, `:35-39`, `:117-121`
- Modify: `src/renderer/modules/HealthMatrix.tsx:201`, `:206`
- Modify: `src/renderer/modules/Overview.tsx:79`
- Test: `tests/renderer/latestCurrent.test.ts`

**Interfaces:**
- Consumes: `latestComplete`, `previousComplete` (Task 2); series `complete` flags (Task 5)

- [ ] **Step 1: Write the failing test**

`getAvailableTelemetryMetrics(res, tech, prbThreshold)` in `src/renderer/lib/investigationCharts.ts` builds the "latest" KPI tiles from `res.weeks` (line 26 takes the last week). Pin that it uses the latest complete week.

`tests/renderer/latestCurrent.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { latestComplete } from '../../shared/periods'
import { bannerSummary } from '../../src/renderer/lib/overviewData'
import { getAvailableTelemetryMetrics } from '../../src/renderer/lib/investigationCharts'
import type { InvestigationResult, InvestigationWeek } from '../../shared/api'

const week = (weekStart: string, prbAvg: number, complete: boolean): InvestigationWeek => ({
  weekStart, prbAvg, throughputKbps: 20000, users: 10, volumeMb: 100, availability: 99.9,
  isNc: false, lifecycle: null, complete, daysWithData: complete ? 7 : 3
})

describe('current values come from the latest complete period (spec §3.1)', () => {
  it('the Overview banner reads the latest complete movement row', () => {
    const base = { recurring: 0, intermittent: 0, persistent: 0, chronic: 0, recovering: 0, ncCells: 0, totalCells: 10, ncRate: 0 }
    const movement = [
      { ...base, weekStart: '2026-07-13', newNc: 5, complete: true, daysWithData: 7 },
      { ...base, weekStart: '2026-07-20', newNc: 1, complete: false, daysWithData: 3 }
    ]
    expect(bannerSummary(undefined, latestComplete(movement)).newNc).toBe(5)
  })

  it('investigation tiles show the latest complete week, not the partial one', () => {
    const res = { weeks: [week('2026-07-13', 70, true), week('2026-07-20', 95, false)] } as unknown as InvestigationResult
    const prb = getAvailableTelemetryMetrics(res, '4G', 80).find((m) => m.id === 'prb')!
    expect(prb.currentValue).toBe(70)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/renderer/latestCurrent.test.ts`
Expected: the banner test passes already (it exercises `latestComplete` from Task 2 and `bannerSummary`, which takes whatever row it is given — it pins the call shape Overview.tsx must use); the investigation test FAILS with `expected 95 to be 70`.

- [ ] **Step 3: Replace each last-element site**

| Site | Change |
|---|---|
| investigationService ~319-320 | `const last = latestComplete(weeks)` / `const prev = previousComplete(weeks, last)` |
| reportingService ~98, ~554, ~1007 | `latestComplete(h.network)` instead of the last element |
| reportingService ~226-230, ~540 (health matrix) | index of the latest complete week: `const i = m.weeksComplete.lastIndexOf(true); const at = i >= 0 ? i : m.weeks.length - 1`, then use `m.weeks[at]` and `r.scores[at]` |
| queryService ~724 `getCellDetail` | `const latestWeek = latestComplete(weeks)?.weekStart ?? (life ? String(life.week_start) : '')` |
| queryService ~2897 `curHealth` | `latestComplete(healthSeries)` |
| queryService ~2977, ~3003 sparkline `curVal` | add `complete` to the sparkline query rows (join `periodCoverageJoin('weekly', 'period_start')` on the `agg_network_weekly` query) and take `latestComplete(...)` |
| investigationCharts ~26 | `const latestWeek = latestComplete(res.weeks)`; the per-KPI arrays at ~35-39 and ~117-121 take the value at the index of `latestWeek` in `res.weeks` instead of their last element |
| HealthMatrix.tsx ~201, ~206 | header and "latest" column use the index from `matrix.weeksComplete.lastIndexOf(true)` (fall back to the last index) |
| Overview.tsx ~79 | `bannerSummary(techCard, latestComplete(movement))` |

Then:

```bash
grep -rn "slice(-1)\|\[[a-zA-Z_.]*\.length - 1\]" src/main/services src/renderer/lib src/renderer/modules --include=*.ts --include=*.tsx | grep -v "previewApi\|forecast\|Forecasting\|SimulationLab"
```

Expected: only lines that do not pick a "current period" (for example array building inside a loop). For each remaining hit, write one line in your report saying why it is not a current-period pick.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/renderer/latestCurrent.test.ts tests/renderer/overviewData.test.ts tests/kpi/investigationRcaTech.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

```bash
git add -u src shared tests
git add tests/renderer/latestCurrent.test.ts
git commit -m "fix(periods): current values come from the latest complete period

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Partial periods are labelled and drawn as provisional

**Files:**
- Modify: `src/renderer/lib/overviewData.ts` (`movementSeries`, `breachSeries` labels)
- Modify: `src/renderer/lib/overviewCharts.ts` (movement chart points)
- Modify: `src/renderer/modules/Overview.tsx` (recharts movement bars; banner shows when the period is partial)
- Modify: `src/renderer/lib/investigationCharts.ts` (time-axis labels)
- Modify: `src/renderer/modules/HealthMatrix.tsx` (column headers)
- Modify: `src/renderer/modules/NcIntelligence.tsx` ("as of" line uses `periodComplete`)
- Test: `tests/renderer/overviewData.test.ts`

**Interfaces:**
- Consumes: `periodLabel` (Task 2); `complete`, `daysWithData`, `periodComplete`, `weeksComplete` (Tasks 4–5)
- Produces: `movementSeries` rows gain `complete: boolean` (for styling)

- [ ] **Step 1: Write the failing test**

Add to `tests/renderer/overviewData.test.ts`:

```ts
  it('labels a partial week with its coverage', () => {
    const rows = movementSeries(
      [
        { ...MOVEMENT[0], weekStart: '2026-07-13', complete: true, daysWithData: 7 },
        { ...MOVEMENT[1], weekStart: '2026-07-20', complete: false, daysWithData: 3 }
      ],
      'weekly'
    )
    expect(rows[0].label).toBe(formatTimeLabel('2026-07-13', 'weekly'))
    expect(rows[1].label).toBe(`${formatTimeLabel('2026-07-20', 'weekly')} · 3 of 7 days`)
    expect(rows[1].complete).toBe(false)
  })
```

(import `formatTimeLabel` from wherever `overviewData.ts` imports it.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/renderer/overviewData.test.ts`
Expected: FAIL — the label has no "· 3 of 7 days".

- [ ] **Step 3: Label and style partial periods**

- `movementSeries`: `label: periodLabel(formatTimeLabel(r.weekStart, grain), grain, r.weekStart, r)` and `complete: r.complete`. Do the same in `breachSeries` if its rows carry `complete`.
- `Overview.tsx` recharts bars: give partial points a lighter fill — wrap each `<Bar>` children with `<Cell>` per point: `fillOpacity={row.complete ? 1 : 0.45}`.
- `overviewCharts.ts`: for each movement line series, set `data` to objects `{ value, itemStyle: { opacity: m.complete ? 1 : 0.45 }, symbol: m.complete ? 'circle' : 'emptyCircle' }` and use the `periodLabel` labels on the x axis.
- `investigationCharts.ts`: x-axis labels use `periodLabel(formatTimeLabel(w.weekStart, grain), grain, w.weekStart, w)`.
- `HealthMatrix.tsx`: header for a partial week appends ` · partial` (the matrix has no day counts) and uses lighter text.
- `Overview.tsx` banner and `NcIntelligence.tsx` "as of" line: when `periodComplete === false`, append `(partial week — no complete week yet)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/renderer/overviewData.test.ts tests/shared/periods.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate, visual check, commit**

Run the Gate. Visual check is done by the controller in the web preview (`npm run preview:web`).

```bash
git add -u src shared tests
git commit -m "feat(ui): partial weeks and months are labelled and drawn as provisional

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Smoke and close-out

**Files:**
- Modify: `src/main/smoke.ts` (only expectations explained by the spec)
- Modify: `docs/superpowers/specs/2026-10-01-complete-periods-design.md` (Status)

- [ ] **Step 1: Run the Gate and read every smoke failure**

The smoke workspace's weeks each have 2 days of data, so they are all partial: "latest" falls back to the newest partial week (spec §2), and a partial non-NC week now carries the previous label (§3.3) with no trend (§3.4). For each failing smoke assertion, write in your report which spec rule changes the value. Change only those assertions. ACC-001-A's severity stays `High`: its 2026-07-06 week is NC (PRB 89 ≥ 80) so it keeps its label; its trend becomes NULL (partial week), which removes the +10 Worsening points: 40 + 10 + 2 = 52 → still High.

- [ ] **Step 2: Spec coverage check**

Map each spec item to its commit: §2 (Task 1), §3.1 (Task 4, 6), §3.2 (Task 5, 7), §3.3 (Task 3), §3.4 (Task 3), §3.5 (Tasks 1, 3, 4), §4.1–4.4 (Tasks 1–5), §6 tests 1–10 (Tasks 1–7). A gap is a report item, not new code.

- [ ] **Step 3: Mark the spec implemented and commit**

Change the spec Status to `Implemented (<today's date>)`.

```bash
git add -u src/main/smoke.ts docs/superpowers/specs/2026-10-01-complete-periods-design.md
git commit -m "test(smoke): expectations under complete periods; spec implemented

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
