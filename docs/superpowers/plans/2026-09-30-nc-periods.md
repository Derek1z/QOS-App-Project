# NC Periods & Single Source of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Label every cell's NC period the same way in the daily, weekly and monthly views (seven labels, one clock, roll-up), make every number behind them editable in one place, and give every KPI target and NC setting exactly one owner.

**Architecture:** Two new shared modules own the vocabulary: `shared/lifecycle.ts` (labels, order, scores, colours) and `shared/ruleDefaults.ts` (NC-period settings: defaults, limits, columns, validation, per-grain periods). `kpi_defs` becomes the only owner of KPI targets (including PRB); `ruleset` keeps NC-period settings, district % and priority weights, and every change to either creates a new ruleset version and recomputes. `analytics/nc.ts` labels each grain with window functions, rolls weeks and months up to the worst label inside them, then scores trend and severity once.

**Tech Stack:** Electron 43, React 19, TypeScript, DuckDB (`@duckdb/node-api` 1.5.5), vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-29-nc-lifecycle-design.md`

## Global Constraints

- Label names, their order and the rule order are fixed: Healthy < Recovering < New NC < Recurring NC < Intermittent NC < Persistent NC < Chronic NC (spec §3).
- Daily thresholds are always the weekly values × 7 (spec §3).
- Defaults: weekly bad days 1, monthly bad days 3, persistent 3 weeks / 2 months, chronic 7 weeks / 3 months, look-back 3 weeks / 2 months, intermittent 3 runs in 7 weeks / 6 months, recovery 3 weeks / 2 months (spec §5).
- Scores: priority Intermittent = 80; health Intermittent = 20; severity base New 40, Recurring 60, Intermittent 70, Persistent 80, Chronic 90 (spec §6).
- A day with no data neither breaks nor extends a run (spec §2).
- Old workspaces must keep opening: retired columns stay in their tables; nothing reads or writes them (spec §5, §8.4).
- Commit locally only. Never push, never open a PR.
- Never commit `.preview/vite.config.ts`, the two `*_Huawei_KPIs_and_Counters_Specification.txt` files, or `.claude/`.
- Every commit is gated by the command in "Gate" below. A red gate means no commit.

## Gate

Run from the repo root before every commit. It restores `app_state.json` and cleans smoke temp folders even when smoke fails:

```bash
SCRATCH=/tmp/claude-1000/-home-derrickbaalaboore-Documents-QOS-Folder-QOS-App-Project-v2/5e48a865-509f-492a-8968-d1a5d8a3d0d0/scratchpad
npm run typecheck && npx vitest run && npm run smoke > "$SCRATCH/smoke.log" 2>&1; s=$?; cp "$SCRATCH/app_state.original.json" app_state.json; rm -rf /tmp/qos-smoke-* /tmp/qos-userdata-*; tail -5 "$SCRATCH/smoke.log"; exit $s
```

Expected: typecheck prints nothing, vitest ends `Test Files  N passed`, smoke log ends with `[SMOKE] ALL CHECKS PASSED` (or the existing final success line) and the command exits 0.

## Review Focus

1. **Partial first/last periods.** A run that starts mid-week or a month with 2 days of data. Expected: labels follow the same rules; nothing crashes; a partial month with < 3 bad days is simply not NC. Pinned by Task 7 test "month edge".
2. **Workspace opened by an older build.** New ruleset columns missing, legacy target columns present. Expected: opens, gets defaults, carries custom targets across. Pinned by Task 4 "old workspace" and Task 6 tests.
3. **Clearing or deleting a core KPI target.** Expected: refused with a message, because the NC rule would silently lose that KPI. Pinned by Task 5 "core KPIs keep a target".
4. **Saving the Targets window without changing anything.** Expected: no new ruleset version, no recompute. Pinned by Task 5 "unchanged save".
5. **2G/3G workspaces and PRB.** The wide PRB column holds other utilizations there. Expected: PRB never makes a 2G/3G cell NC and never adds PRB severity points there. Pinned by the existing `ncRule.test.ts` 3G case and Task 7 "severity ignores PRB outside 4G".

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `shared/lifecycle.ts` | Create | The seven labels, order, score tables, colours, SQL helpers |
| `shared/ruleDefaults.ts` | Create | NC-period settings: fields (column, label, unit, limits, default), validation, per-grain periods; district and priority defaults |
| `src/main/analytics/targets.ts` | Create | Read KPI targets from `kpi_defs` (SQL and TS) |
| `src/main/services/targetService.ts` | Create | Save KPI definitions; version + recompute when an NC-relevant field changes |
| `src/main/workspace/migrateTargets.ts` | Create | One-time copy of legacy ruleset targets into `kpi_defs` |
| `src/renderer/lib/ncPeriodsForm.ts` | Create | Pure form model for the NC Periods tab |
| `src/renderer/components/NcPeriodsPanel.tsx` | Create | NC Periods tab UI |
| `src/main/analytics/nc.ts` | Rewrite | Label, roll up, score, insert |
| `src/main/analytics/rules.ts` | Modify | `getRules`, `updateRules`, `newRulesetVersion` |
| `src/main/analytics/ncRule.ts`, `priority.ts`, `health.ts` | Modify | Use shared vocabulary and `targets.ts` |
| `src/main/services/queryService.ts`, `investigationService.ts`, `reportingService.ts`, `kpiService.ts` | Modify | Same |
| `src/main/workspace/schema.ts`, `manager.ts` | Modify | Columns generated from `shared/ruleDefaults.ts`; call migration |
| `src/main/ipc.ts`, `src/preload/index.ts`, `shared/api.ts` | Modify | `kpis.saveTargets`; types |
| `src/main/smoke.ts` | Modify | New expectations |
| Renderer: `Overview.tsx`, `NcIntelligence.tsx`, `NetworkExplorer.tsx`, `overviewCharts.ts`, `overviewData.ts`, `modules/TargetsModal.tsx`, `previewApi.ts` | Modify | Shared vocabulary; NC Periods tab |
| `src/main/kpi/schemaV2.ts`, `tests/workspace/schemaV2.test.ts`, `src/renderer/components/TargetsModal.tsx` | Delete | Dead or duplicate |

Test files are listed per task. All database tests use a real DuckDB workspace through `tests/helpers/realWorkspace.ts`.

---

### Task 1: Remove dead code

Deleting unreachable code changes no behaviour, so there is no failing test to write. The evidence is a green gate before and after.

**Files:**
- Delete: `src/main/kpi/schemaV2.ts`, `tests/workspace/schemaV2.test.ts`
- Modify: `src/main/import/importCore.ts:15` and `:649-653`
- Modify: `src/main/analytics/nc.ts:1-101`
- Modify: `src/main/services/queryService.ts:37-39`

**Interfaces:** Produces nothing new.

- [ ] **Step 1: Confirm each item is unreferenced**

```bash
grep -rn "schemaV2\|ensureSchemaV020\|enforce90DateRetention\|fact_cell_day\b\|fact_kpi_daily" src tests shared
grep -n "classifyTrend\|classifySeverity\|WeekRow\|pctChange\|perDay\|\bTOL\b" src/main/analytics/nc.ts
grep -n "\bLIFECYCLES\b\|\bTRENDS\b\|\bSEVERITIES\b" src/main/services/queryService.ts
```

Expected: `schemaV2` only in the files being deleted and `importCore.ts`; the nc.ts names only at their definitions (lines 10-101); in `queryService.ts` each constant appears only on its own `const` line. Any constant with a second use stays.

- [ ] **Step 2: Delete the parallel schema and its call**

```bash
git rm src/main/kpi/schemaV2.ts tests/workspace/schemaV2.test.ts
```

In `src/main/import/importCore.ts` delete line 15 (`import { enforce90DateRetention } from '../kpi/schemaV2'`) and delete this block after `await conn.run('COMMIT')`:

```ts
    try {
      await enforce90DateRetention(conn)
    } catch {
      /* non-fatal if retention table structure differs */
    }
```

- [ ] **Step 3: Delete the unused TypeScript classifiers in `nc.ts`**

Delete everything from `interface WeekRow {` down to the closing `}` of `classifySeverity` (the block before the `/** Recompute lifecycle/trend/severity ...` comment). Change the imports at the top to what is still used:

```ts
import type { DuckDBConnection } from '@duckdb/node-api'
import { getRules } from './rules'
import { coreBreachDaysSql } from './ncRule'
```

- [ ] **Step 4: Delete the unused constants in `queryService.ts`**

Delete `const LIFECYCLES = [...]`, and `TRENDS` / `SEVERITIES` if Step 1 showed no other use.

- [ ] **Step 5: Gate and commit**

Run the Gate. Then:

```bash
git add -A src/main/import/importCore.ts src/main/analytics/nc.ts src/main/services/queryService.ts
git commit -m "chore: remove dead parallel schema and unused NC classifiers

schemaV2's retention step ran after every import, always failed on a
table the app never creates, and the error was swallowed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One lifecycle vocabulary

**Files:**
- Create: `shared/lifecycle.ts`
- Test: `tests/shared/lifecycle.test.ts`
- Modify: `shared/api.ts:658` (the `Lifecycle` type)
- Modify: `src/main/analytics/priority.ts:42-55`, `:139-145`
- Modify: `src/main/analytics/health.ts:21-28`, `:140-148`
- Modify: `src/main/services/investigationService.ts:149`
- Modify: `src/main/services/queryService.ts:292`, `:328`
- Modify: `src/renderer/lib/previewApi.ts:645`

**Interfaces:**
- Produces (used by Tasks 7, 8):
  - `LIFECYCLES: readonly ['Healthy','Recovering','New NC','Recurring NC','Intermittent NC','Persistent NC','Chronic NC']`
  - `type Lifecycle = (typeof LIFECYCLES)[number]`
  - `NC_LIFECYCLES: readonly Lifecycle[]` (the five NC labels)
  - `LIFECYCLE_RANK, PRIORITY_PERSISTENCE, NC_HEALTH, SEVERITY_BASE: Record<Lifecycle, number>`
  - `LIFECYCLE_STYLE: Record<Lifecycle, { color: string; bg: string; border: string; short: string }>`
  - `lifecycleCaseSql(column: string, table: Record<Lifecycle, number>, otherwise: number): string`
  - `lifecycleFromRankSql(rankExpr: string): string`
  - `rankTableSql(table: Record<Lifecycle, number>, rankExpr: string): string`
  - `emptyLifecycleCounts(): Record<Lifecycle, number>`

- [ ] **Step 1: Write the failing test**

`tests/shared/lifecycle.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DuckDBInstance } from '@duckdb/node-api'
import {
  LIFECYCLES, NC_LIFECYCLES, LIFECYCLE_RANK, PRIORITY_PERSISTENCE, NC_HEALTH, SEVERITY_BASE,
  LIFECYCLE_STYLE, lifecycleCaseSql, lifecycleFromRankSql, rankTableSql, emptyLifecycleCounts
} from '../../shared/lifecycle'

async function scalar(sql: string): Promise<unknown> {
  const db = await DuckDBInstance.create(':memory:')
  const c = await db.connect()
  return (await c.runAndReadAll(`SELECT ${sql} AS v`)).getRowObjects()[0].v
}

describe('NC period vocabulary (spec §3)', () => {
  it('orders the seven labels from mildest to most severe', () => {
    expect(LIFECYCLES).toEqual([
      'Healthy', 'Recovering', 'New NC', 'Recurring NC', 'Intermittent NC', 'Persistent NC', 'Chronic NC'
    ])
    expect(NC_LIFECYCLES).toEqual(['New NC', 'Recurring NC', 'Intermittent NC', 'Persistent NC', 'Chronic NC'])
    expect(LIFECYCLES.map((l) => LIFECYCLE_RANK[l])).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('never scores a worse label better than a milder one', () => {
    for (const table of [PRIORITY_PERSISTENCE, SEVERITY_BASE]) {
      const v = LIFECYCLES.map((l) => table[l])
      expect(v).toEqual([...v].sort((a, b) => a - b))
    }
    const h = LIFECYCLES.map((l) => NC_HEALTH[l])
    expect(h).toEqual([...h].sort((a, b) => b - a))
    expect(PRIORITY_PERSISTENCE['Intermittent NC']).toBe(80)
    expect(NC_HEALTH['Intermittent NC']).toBe(20)
    expect(SEVERITY_BASE['Intermittent NC']).toBe(70)
  })

  it('gives every label its own colour and letter', () => {
    const colors = LIFECYCLES.map((l) => LIFECYCLE_STYLE[l].color)
    const shorts = LIFECYCLES.map((l) => LIFECYCLE_STYLE[l].short)
    expect(new Set(colors).size).toBe(7)
    expect(new Set(shorts).size).toBe(7)
  })

  it('builds SQL that maps labels to scores and ranks to labels', async () => {
    expect(await scalar(lifecycleCaseSql(`'Intermittent NC'`, NC_HEALTH, 100))).toBe(20)
    expect(await scalar(lifecycleCaseSql(`'Unknown'`, NC_HEALTH, 100))).toBe(100)
    expect(await scalar(lifecycleFromRankSql('6'))).toBe('Chronic NC')
    expect(await scalar(lifecycleFromRankSql('0'))).toBe('Healthy')
    expect(await scalar(rankTableSql(SEVERITY_BASE, '5'))).toBe(80)
  })

  it('starts every count at zero for every label', () => {
    expect(emptyLifecycleCounts()).toEqual(Object.fromEntries(LIFECYCLES.map((l) => [l, 0])))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/shared/lifecycle.test.ts`
Expected: FAIL, `Failed to resolve import "../../shared/lifecycle"`.

- [ ] **Step 3: Write `shared/lifecycle.ts`**

```ts
/** The NC-period vocabulary (spec docs/superpowers/specs/2026-09-29-nc-lifecycle-design.md §3).
 *  Ordered mildest → most severe; the index is the severity rank used by the
 *  roll-up, by sorting and by every score table below. Nothing else in the app
 *  may list these labels or their scores. */

export const LIFECYCLES = [
  'Healthy',
  'Recovering',
  'New NC',
  'Recurring NC',
  'Intermittent NC',
  'Persistent NC',
  'Chronic NC'
] as const

export type Lifecycle = (typeof LIFECYCLES)[number]

export const NC_LIFECYCLES: readonly Lifecycle[] = LIFECYCLES.slice(2)

export const LIFECYCLE_RANK = Object.fromEntries(LIFECYCLES.map((l, i) => [l, i])) as Record<Lifecycle, number>

/** Priority "persistence" component, 0–100. */
export const PRIORITY_PERSISTENCE: Record<Lifecycle, number> = {
  'Healthy': 0,
  'Recovering': 0,
  'New NC': 35,
  'Recurring NC': 70,
  'Intermittent NC': 80,
  'Persistent NC': 90,
  'Chronic NC': 100
}

/** Cell health NC component, 0–100 (higher is healthier). */
export const NC_HEALTH: Record<Lifecycle, number> = {
  'Healthy': 100,
  'Recovering': 90,
  'New NC': 40,
  'Recurring NC': 25,
  'Intermittent NC': 20,
  'Persistent NC': 10,
  'Chronic NC': 0
}

/** Starting points of the severity score of an NC period. */
export const SEVERITY_BASE: Record<Lifecycle, number> = {
  'Healthy': 0,
  'Recovering': 0,
  'New NC': 40,
  'Recurring NC': 60,
  'Intermittent NC': 70,
  'Persistent NC': 80,
  'Chronic NC': 90
}

export const LIFECYCLE_STYLE: Record<Lifecycle, { color: string; bg: string; border: string; short: string }> = {
  'Healthy': { color: '#34d399', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.3)', short: '·' },
  'Recovering': { color: '#38bdf8', bg: 'rgba(6, 182, 212, 0.15)', border: 'rgba(6, 182, 212, 0.3)', short: '↺' },
  'New NC': { color: '#facc15', bg: 'rgba(234, 179, 8, 0.15)', border: 'rgba(234, 179, 8, 0.3)', short: 'N' },
  'Recurring NC': { color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.3)', short: 'R' },
  'Intermittent NC': { color: '#fb923c', bg: 'rgba(249, 115, 22, 0.15)', border: 'rgba(249, 115, 22, 0.3)', short: 'I' },
  'Persistent NC': { color: '#f87171', bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.3)', short: 'P' },
  'Chronic NC': { color: '#e879f9', bg: 'rgba(192, 38, 211, 0.18)', border: 'rgba(192, 38, 211, 0.35)', short: 'C' }
}

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`

/** `CASE <column> WHEN 'Healthy' THEN .. END` from a score table. */
export function lifecycleCaseSql(column: string, table: Record<Lifecycle, number>, otherwise: number): string {
  return `CASE ${column} ${LIFECYCLES.map((l) => `WHEN ${q(l)} THEN ${table[l]}`).join(' ')} ELSE ${otherwise} END`
}

/** The label for a 0-based rank expression. */
export function lifecycleFromRankSql(rankExpr: string): string {
  return `([${LIFECYCLES.map(q).join(', ')}])[(${rankExpr}) + 1]`
}

/** The score of a 0-based rank expression in `table`. */
export function rankTableSql(table: Record<Lifecycle, number>, rankExpr: string): string {
  return `([${LIFECYCLES.map((l) => table[l]).join(', ')}])[(${rankExpr}) + 1]`
}

export function emptyLifecycleCounts(): Record<Lifecycle, number> {
  return Object.fromEntries(LIFECYCLES.map((l) => [l, 0])) as Record<Lifecycle, number>
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/shared/lifecycle.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Point `shared/api.ts` at it**

Replace line 658 (`export type Lifecycle = 'Healthy' | ...`) with:

```ts
import type { Lifecycle } from './lifecycle'
export type { Lifecycle }
```

Move the `import type` line to the top of `shared/api.ts` with the other imports if the file has any; otherwise keep both lines together at 658.

- [ ] **Step 6: Replace the copies in the main process**

`src/main/analytics/priority.ts`: delete `PERSISTENCE_BY_LIFECYCLE` and `TREND_COMPONENT` (lines 42-55; neither is read). Add `import { PRIORITY_PERSISTENCE, lifecycleCaseSql } from '../../../shared/lifecycle'`. Replace

```sql
        CASE b.lifecycle
          WHEN 'Chronic NC' THEN 100.0
          WHEN 'Persistent NC' THEN 90.0
          WHEN 'Recurring NC' THEN 70.0
          WHEN 'New NC' THEN 35.0
          ELSE 0.0
        END AS persistence,
```

with

```ts
        CAST(${lifecycleCaseSql('b.lifecycle', PRIORITY_PERSISTENCE, 0)} AS DOUBLE) AS persistence,
```

`src/main/analytics/health.ts`: delete the exported `NC_HEALTH` map (lines 21-28; unused). Add `import { NC_HEALTH, lifecycleCaseSql } from '../../../shared/lifecycle'`. Replace the `CASE COALESCE(l.lifecycle, 'Healthy') WHEN 'Healthy' THEN 100.0 ... ELSE 100.0 END AS nc_health,` block with

```ts
          CAST(${lifecycleCaseSql(`COALESCE(l.lifecycle, 'Healthy')`, NC_HEALTH, 100)} AS DOUBLE) AS nc_health,
```

`src/main/services/investigationService.ts:149`: add `import { LIFECYCLES, LIFECYCLE_RANK, lifecycleCaseSql } from '../../../shared/lifecycle'` and replace

```sql
         CASE l.lifecycle WHEN 'Chronic NC' THEN 1 WHEN 'Persistent NC' THEN 2 WHEN 'Recurring NC' THEN 3 WHEN 'New NC' THEN 4 ELSE 5 END,
```

with

```ts
         ${lifecycleCaseSql('l.lifecycle', LIFECYCLE_RANK, 0)} DESC,
```

`src/main/services/queryService.ts:292` and `:328`: replace both `{ Healthy: 0, 'New NC': 0, 'Recurring NC': 0, 'Persistent NC': 0, 'Chronic NC': 0, Recovering: 0 }` with `emptyLifecycleCounts()` and import it from `../../../shared/lifecycle`.

`src/renderer/lib/previewApi.ts:645`: same replacement, importing from `../../../shared/lifecycle`.

- [ ] **Step 7: Check that no copy is left**

```bash
grep -rn "'Recurring NC' THEN\|'Chronic NC' THEN\|'New NC': 0" src shared
```

Expected: no output.

- [ ] **Step 8: Gate and commit**

```bash
git add shared/lifecycle.ts shared/api.ts tests/shared/lifecycle.test.ts src/main/analytics/priority.ts src/main/analytics/health.ts src/main/services/investigationService.ts src/main/services/queryService.ts src/renderer/lib/previewApi.ts
git commit -m "refactor(nc): one lifecycle vocabulary with Intermittent NC

Labels, order, priority/health/severity scores and colours now live only
in shared/lifecycle.ts; SQL CASEs are generated from it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Delete the duplicate Targets window

This deletes a component. The behaviour it had was wrong (it discarded edits and wrote the PRB warning as the threshold), so there is nothing to preserve and no test to write. The evidence is a green gate and a manual check.

**Files:**
- Delete: `src/renderer/components/TargetsModal.tsx`
- Modify: `src/renderer/modules/Overview.tsx:4`, `:32`, `:580`

- [ ] **Step 1: Point Overview at the real window**

`src/renderer/modules/Overview.tsx` line 4:

```ts
import TargetsModal from './TargetsModal'
```

In the store selector near line 32, also read the open flag (next to `setTargetsModalOpen`):

```ts
    targetsModalOpen,
```

Line 580:

```tsx
      <TargetsModal isOpen={targetsModalOpen} onClose={() => setTargetsModalOpen(false)} />
```

If the selector at line 32 is a destructure of `useAppStore()`, add `targetsModalOpen` to it; if it is individual `useAppStore((s) => ...)` calls, add `const targetsModalOpen = useAppStore((s) => s.targetsModalOpen)`.

- [ ] **Step 2: Delete the old component**

```bash
git rm src/renderer/components/TargetsModal.tsx
grep -rn "components/TargetsModal" src
```

Expected: no output from grep.

- [ ] **Step 3: Gate**

Run the Gate. Expected: green.

- [ ] **Step 4: Manual check**

With the user's `electron-vite dev` server running (port 5173), open Overview and click **Targets**. Expected: the "Technology Targets & Threshold Governance" window with the workspace's real targets (4G CSSR shows 95, not 98.5).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/Overview.tsx
git commit -m "fix(targets): Overview opens the real Targets window

The Overview copy showed hard-coded targets, discarded edits, saved the
PRB warning value (85) as the PRB threshold and set bad days per week to 3.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: NC-period settings have one source

**Files:**
- Create: `shared/ruleDefaults.ts`
- Test: `tests/shared/ruleDefaults.test.ts`, `tests/analytics/ncPeriodSettings.test.ts`
- Modify: `shared/api.ts` (`Rules`, `RulesPatch`, around line 1437)
- Modify: `src/main/analytics/rules.ts` (whole file except `clampInt` is replaced piecewise below)
- Modify: `src/main/workspace/schema.ts:122-147`
- Modify: `src/main/workspace/manager.ts:140-145`
- Modify: `src/main/import/aggregates.ts:147`
- Modify: `src/main/analytics/nc.ts:108-115`, grain table thresholds
- Modify: `src/main/services/investigationService.ts:569-570`
- Modify: `src/renderer/lib/previewApi.ts:3170-3185` (mock `Rules`)

**Interfaces:**
- Produces:
  - `interface NcPeriodSettings { weeklyBreachDays; monthlyBreachDays; persistentWeeks; chronicWeeks; persistentMonths; chronicMonths; lookbackWeeks; lookbackMonths; intermittentRuns; intermittentWindowWeeks; intermittentWindowMonths; recoveryWeeks; recoveryMonths: number }`
  - `type NcPeriodKey = keyof NcPeriodSettings`
  - `NC_PERIOD_FIELDS: Record<NcPeriodKey, { column: string; label: string; unit: 'bad days' | 'weeks' | 'months' | 'runs'; min: number; max: number; default: number }>`
  - `NC_PERIOD_KEYS: NcPeriodKey[]`, `DEFAULT_NC_PERIODS: NcPeriodSettings`
  - `DEFAULT_DISTRICT_NC_PCT = 10`, `DEFAULT_PRIORITY_WEIGHTS = [25, 20, 15, 15, 15, 10]`
  - `ncPeriodProblem(s: NcPeriodSettings): string | null`
  - `type NcGrain = 'daily' | 'weekly' | 'monthly'`
  - `periodsFor(grain: NcGrain, s: NcPeriodSettings): { persistent; chronic; lookback; intermittentRuns; intermittentWindow; recovery: number }`
  - `newRulesetVersion(conn, columns: Record<string, number | string>, note: string, apply?: () => Promise<void>): Promise<Rules>` in `rules.ts` (Task 5 reuses it)
  - `Rules extends NcPeriodSettings`; `dailyMinKpiBreaches`, `persistentDays`, `chronicDays` removed

- [ ] **Step 1: Write the failing unit test**

`tests/shared/ruleDefaults.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  NC_PERIOD_FIELDS, NC_PERIOD_KEYS, DEFAULT_NC_PERIODS, ncPeriodProblem, periodsFor
} from '../../shared/ruleDefaults'

describe('NC-period settings (spec §5)', () => {
  it('has the agreed defaults', () => {
    expect(DEFAULT_NC_PERIODS).toEqual({
      weeklyBreachDays: 1, monthlyBreachDays: 3,
      persistentWeeks: 3, chronicWeeks: 7, persistentMonths: 2, chronicMonths: 3,
      lookbackWeeks: 3, lookbackMonths: 2,
      intermittentRuns: 3, intermittentWindowWeeks: 7, intermittentWindowMonths: 6,
      recoveryWeeks: 3, recoveryMonths: 2
    })
  })

  it('maps every setting to its own ruleset column', () => {
    const cols = NC_PERIOD_KEYS.map((k) => NC_PERIOD_FIELDS[k].column)
    expect(new Set(cols).size).toBe(NC_PERIOD_KEYS.length)
    expect(NC_PERIOD_FIELDS.recoveryWeeks.column).toBe('recovery_weeks')
  })

  it('accepts the defaults and rejects contradictions', () => {
    expect(ncPeriodProblem(DEFAULT_NC_PERIODS)).toBeNull()
    expect(ncPeriodProblem({ ...DEFAULT_NC_PERIODS, persistentWeeks: 7 })).toMatch(/Persistent must be shorter than Chronic \(weeks\)/)
    expect(ncPeriodProblem({ ...DEFAULT_NC_PERIODS, persistentMonths: 3 })).toMatch(/\(months\)/)
    expect(ncPeriodProblem({ ...DEFAULT_NC_PERIODS, intermittentRuns: 2 })).toMatch(/from 3 to 10/)
    expect(ncPeriodProblem({ ...DEFAULT_NC_PERIODS, recoveryWeeks: 1.5 })).toMatch(/whole number/)
  })

  it('expresses daily thresholds as weeks × 7', () => {
    expect(periodsFor('daily', DEFAULT_NC_PERIODS)).toEqual({
      persistent: 21, chronic: 49, lookback: 21, intermittentRuns: 3, intermittentWindow: 49, recovery: 21
    })
    expect(periodsFor('weekly', DEFAULT_NC_PERIODS)).toEqual({
      persistent: 3, chronic: 7, lookback: 3, intermittentRuns: 3, intermittentWindow: 7, recovery: 3
    })
    expect(periodsFor('monthly', DEFAULT_NC_PERIODS)).toEqual({
      persistent: 2, chronic: 3, lookback: 2, intermittentRuns: 3, intermittentWindow: 6, recovery: 2
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/shared/ruleDefaults.test.ts`
Expected: FAIL, `Failed to resolve import "../../shared/ruleDefaults"`.

- [ ] **Step 3: Write `shared/ruleDefaults.ts`**

```ts
/** NC-period settings (spec docs/superpowers/specs/2026-09-29-nc-lifecycle-design.md §5):
 *  the only place their defaults, limits, labels and ruleset columns exist.
 *  Schema DEFAULTs, upgrade ALTERs, getRules, updateRules, validation, the
 *  preview mock and the NC Periods tab are all generated from this table. */

export interface NcPeriodSettings {
  weeklyBreachDays: number
  monthlyBreachDays: number
  persistentWeeks: number
  chronicWeeks: number
  persistentMonths: number
  chronicMonths: number
  lookbackWeeks: number
  lookbackMonths: number
  intermittentRuns: number
  intermittentWindowWeeks: number
  intermittentWindowMonths: number
  recoveryWeeks: number
  recoveryMonths: number
}

export type NcPeriodKey = keyof NcPeriodSettings

export interface NcPeriodField {
  column: string
  label: string
  unit: 'bad days' | 'weeks' | 'months' | 'runs'
  min: number
  max: number
  default: number
}

const f = (column: string, label: string, unit: NcPeriodField['unit'], min: number, max: number, def: number): NcPeriodField =>
  ({ column, label, unit, min, max, default: def })

export const NC_PERIOD_FIELDS: Record<NcPeriodKey, NcPeriodField> = {
  weeklyBreachDays: f('weekly_breach_days', 'NC week needs', 'bad days', 1, 7, 1),
  monthlyBreachDays: f('monthly_breach_days', 'NC month needs', 'bad days', 1, 31, 3),
  persistentWeeks: f('persistent_weeks', 'Persistent after', 'weeks', 1, 26, 3),
  chronicWeeks: f('chronic_weeks', 'Chronic after', 'weeks', 2, 52, 7),
  persistentMonths: f('persistent_months', 'Persistent after', 'months', 1, 12, 2),
  chronicMonths: f('chronic_months', 'Chronic after', 'months', 2, 24, 3),
  lookbackWeeks: f('lookback_weeks', 'Recurring if NC again within', 'weeks', 1, 26, 3),
  lookbackMonths: f('lookback_months', 'Recurring if NC again within', 'months', 1, 12, 2),
  intermittentRuns: f('intermittent_runs', 'Intermittent after', 'runs', 3, 10, 3),
  intermittentWindowWeeks: f('intermittent_window_weeks', 'Intermittent window', 'weeks', 2, 52, 7),
  intermittentWindowMonths: f('intermittent_window_months', 'Intermittent window', 'months', 2, 24, 6),
  recoveryWeeks: f('recovery_weeks', 'Recovering lasts', 'weeks', 1, 26, 3),
  recoveryMonths: f('recovery_months', 'Recovering lasts', 'months', 1, 12, 2)
}

export const NC_PERIOD_KEYS = Object.keys(NC_PERIOD_FIELDS) as NcPeriodKey[]

export const DEFAULT_NC_PERIODS = Object.fromEntries(
  NC_PERIOD_KEYS.map((k) => [k, NC_PERIOD_FIELDS[k].default])
) as unknown as NcPeriodSettings

export const DEFAULT_DISTRICT_NC_PCT = 10
export const DEFAULT_PRIORITY_WEIGHTS = [25, 20, 15, 15, 15, 10]

/** The first problem with a complete set of settings, or null when valid. */
export function ncPeriodProblem(s: NcPeriodSettings): string | null {
  for (const k of NC_PERIOD_KEYS) {
    const fld = NC_PERIOD_FIELDS[k]
    const v = s[k]
    if (!Number.isInteger(v) || v < fld.min || v > fld.max) {
      return `${fld.label} (${fld.unit}) must be a whole number from ${fld.min} to ${fld.max}`
    }
  }
  if (s.persistentWeeks >= s.chronicWeeks) return 'Persistent must be shorter than Chronic (weeks)'
  if (s.persistentMonths >= s.chronicMonths) return 'Persistent must be shorter than Chronic (months)'
  return null
}

export type NcGrain = 'daily' | 'weekly' | 'monthly'

export interface GrainPeriods {
  persistent: number
  chronic: number
  lookback: number
  intermittentRuns: number
  intermittentWindow: number
  recovery: number
}

/** Thresholds counted in periods of `grain`; daily is always weeks × 7. */
export function periodsFor(grain: NcGrain, s: NcPeriodSettings): GrainPeriods {
  if (grain === 'monthly') {
    return {
      persistent: s.persistentMonths,
      chronic: s.chronicMonths,
      lookback: s.lookbackMonths,
      intermittentRuns: s.intermittentRuns,
      intermittentWindow: s.intermittentWindowMonths,
      recovery: s.recoveryMonths
    }
  }
  const x = grain === 'daily' ? 7 : 1
  return {
    persistent: s.persistentWeeks * x,
    chronic: s.chronicWeeks * x,
    lookback: s.lookbackWeeks * x,
    intermittentRuns: s.intermittentRuns,
    intermittentWindow: s.intermittentWindowWeeks * x,
    recovery: s.recoveryWeeks * x
  }
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run tests/shared/ruleDefaults.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing workspace test**

`tests/analytics/ncPeriodSettings.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { openRealWorkspace, type RealWorkspace } from '../helpers/realWorkspace'
import { getRules, updateRules } from '../../src/main/analytics/rules'
import { DEFAULT_NC_PERIODS, NC_PERIOD_KEYS } from '../../shared/ruleDefaults'

describe('NC-period settings are stored once, versioned and validated', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('a new workspace starts with the defaults', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    const rules = (await getRules(ws.conn))!
    for (const k of NC_PERIOD_KEYS) expect(rules[k]).toBe(DEFAULT_NC_PERIODS[k])
  })

  it('a save creates a version and an audit note naming the change', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    const next = await updateRules(ws.conn, { recoveryWeeks: 4 })
    expect(next.version).toBe(2)
    expect(next.recoveryWeeks).toBe(4)
    const note = (await ws.conn.runAndReadAll(
      `SELECT note FROM notes_events WHERE kind = 'ruleset_change' ORDER BY created_at DESC LIMIT 1`
    )).getRowObjects()[0].note
    expect(String(note)).toContain('Recovering lasts 3→4 weeks')
  })

  it('rejects contradictions and saves nothing', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await expect(updateRules(ws.conn, { persistentWeeks: 7 })).rejects.toThrow(/Persistent must be shorter than Chronic/)
    await expect(updateRules(ws.conn, { intermittentRuns: 2 })).rejects.toThrow(/from 3 to 10/)
    expect((await getRules(ws.conn))!.version).toBe(1)
  })

  it('an older workspace without the new columns opens with the defaults', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await ws.conn.run(`ALTER TABLE ruleset DROP COLUMN lookback_weeks`)
    await ws.conn.run(`ALTER TABLE ruleset DROP COLUMN recovery_months`)
    const manager = await import('../../src/main/workspace/manager')
    await manager.closeWorkspace()
    await manager.openWorkspace(join(ws.dir, 'test.qosdb'))
    ws.conn = manager.getCurrent()!.connection
    const rules = (await getRules(ws.conn))!
    expect(rules.lookbackWeeks).toBe(3)
    expect(rules.recoveryMonths).toBe(2)
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/analytics/ncPeriodSettings.test.ts`
Expected: FAIL. The first test fails on `rules.lookbackWeeks` being `undefined`, the save test on `recoveryWeeks`, the old-workspace test on `DROP COLUMN` (column does not exist).

- [ ] **Step 7: Update the `Rules` types in `shared/api.ts`**

Add `import type { NcPeriodSettings } from './ruleDefaults'` at the top. Replace the `Rules` interface and `RulesPatch`:

```ts
export interface Rules extends NcPeriodSettings {
  version: number
  createdAt: string
  prbThresholdPct: number
  tchCongestionThresholdPct: number
  sdcchCongestionThresholdPct: number
  cssrThresholdPct: number
  callDropThresholdPct: number
  dataAccessThresholdPct: number
  dataServiceFailureThresholdPct: number
  districtNcThresholdPct: number
  priorityWeights: number[]
  kpiThresholds?: Record<string, number>
  notes: string | null
}

export type RulesPatch = Partial<Omit<Rules, 'version' | 'createdAt'>>
```

(The seven target fields are removed in Task 5.)

- [ ] **Step 8: Generate the ruleset columns in `schema.ts`**

Add `import { NC_PERIOD_FIELDS, NC_PERIOD_KEYS, DEFAULT_DISTRICT_NC_PCT } from '../../../shared/ruleDefaults'`. In the `CREATE TABLE IF NOT EXISTS ruleset` statement, delete the lines for `daily_min_kpi_breaches`, `weekly_breach_days`, `monthly_breach_days`, `persistent_weeks`, `chronic_weeks`, `persistent_days`, `chronic_days`, `persistent_months`, `chronic_months`, and put in their place:

```ts
     ${NC_PERIOD_KEYS.map((k) => `${NC_PERIOD_FIELDS[k].column} INTEGER NOT NULL DEFAULT ${NC_PERIOD_FIELDS[k].default},`).join('\n     ')}
```

Change `district_nc_threshold_pct DOUBLE NOT NULL DEFAULT 10,` to `district_nc_threshold_pct DOUBLE NOT NULL DEFAULT ${DEFAULT_DISTRICT_NC_PCT},`.

- [ ] **Step 9: Generate the upgrade ALTERs in `manager.ts`**

Add the same import. Replace lines 140-145 (the six `ALTER TABLE ruleset ADD COLUMN IF NOT EXISTS ...` lines) with:

```ts
  for (const k of NC_PERIOD_KEYS) {
    const fld = NC_PERIOD_FIELDS[k]
    await connection.run(`ALTER TABLE ruleset ADD COLUMN IF NOT EXISTS ${fld.column} INTEGER DEFAULT ${fld.default}`)
  }
```

- [ ] **Step 10: Rewrite reading, validating and saving in `rules.ts`**

Replace `DEFAULT_PRIORITY_WEIGHTS` (line 11) with a re-export so existing imports keep working, and add the new imports:

```ts
import {
  NC_PERIOD_FIELDS, NC_PERIOD_KEYS, DEFAULT_PRIORITY_WEIGHTS, ncPeriodProblem, type NcPeriodSettings
} from '../../../shared/ruleDefaults'
export { DEFAULT_PRIORITY_WEIGHTS }
```

In `getRules`, change the query to `SELECT * FROM ruleset ORDER BY version DESC LIMIT 1` (so columns missing from very old rows cannot break it) and build the object with the NC settings from the field table. Keep the existing priority-weights and kpi-thresholds parsing unchanged:

```ts
  const nc = Object.fromEntries(
    NC_PERIOD_KEYS.map((k) => [k, Number(row[NC_PERIOD_FIELDS[k].column] ?? NC_PERIOD_FIELDS[k].default)])
  ) as unknown as NcPeriodSettings

  return {
    ...nc,
    version: Number(row.version),
    createdAt: String(row.created_at ?? ''),
    prbThresholdPct: Number(row.prb_threshold_pct),
    tchCongestionThresholdPct: Number(row.tch_congestion_threshold_pct ?? 1.0),
    sdcchCongestionThresholdPct: Number(row.sdcch_congestion_threshold_pct ?? 1.0),
    cssrThresholdPct: Number(row.cssr_threshold_pct ?? 95.0),
    callDropThresholdPct: Number(row.call_drop_threshold_pct ?? 1.0),
    dataAccessThresholdPct: Number(row.data_access_threshold_pct ?? 95.0),
    dataServiceFailureThresholdPct: Number(row.data_service_failure_threshold_pct ?? 1.0),
    districtNcThresholdPct: Number(row.district_nc_threshold_pct),
    priorityWeights: weights,
    kpiThresholds,
    notes: row.notes ? String(row.notes) : null
  }
```

(The `?? 1.0` / `?? 95.0` lines disappear with the fields in Task 5.)

Add `newRulesetVersion` above `updateRules`:

```ts
/** Ruleset version N+1 = the latest row with `columns` replaced. Applies
 *  `apply` (e.g. KPI target writes), recomputes every derived table and writes
 *  one audit note — all in one transaction (spec §63, §8.5). */
export async function newRulesetVersion(
  conn: DuckDBConnection,
  columns: Record<string, number | string>,
  note: string,
  apply?: () => Promise<void>
): Promise<Rules> {
  const current = await getRules(conn)
  if (!current) throw new Error('No ruleset exists in this workspace')
  const lit = (v: number | string): string => (typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`)
  const replace = Object.entries(columns).map(([col, v]) => `, ${lit(v)} AS ${col}`).join('')
  const version = current.version + 1
  await conn.run('BEGIN TRANSACTION')
  try {
    await conn.run(
      `INSERT INTO ruleset BY NAME
       SELECT * REPLACE (version + 1 AS version, now() AS created_at${replace})
       FROM ruleset ORDER BY version DESC LIMIT 1`
    )
    if (apply) await apply()
    await recomputeAllAggregates(conn)
    await refreshAllIntelligence(conn)
    await conn.run(
      `INSERT INTO notes_events (entity_type, entity_id, kind, note, author)
       VALUES ('ruleset', ?, 'ruleset_change', ?, 'app')`,
      [version, `Ruleset v${current.version} → v${version}: ${note}`]
    )
    await conn.run('COMMIT')
  } catch (e) {
    try {
      await conn.run('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw new Error(`Ruleset update failed and was rolled back: ${e instanceof Error ? e.message : String(e)}`)
  }
  const fresh = await getRules(conn)
  if (!fresh) throw new Error('Ruleset disappeared after update')
  return fresh
}
```

Replace `validateRules` and `updateRules` with:

```ts
/** Throws the first problem with `patch` applied on top of `current`. */
export function validateRules(patch: RulesPatch, current: Rules): void {
  const pct = (v: unknown, name: string): void => {
    if (v == null) return
    const p = Number(v)
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error(`${name} must be between 0 and 100`)
  }
  pct(patch.prbThresholdPct, 'PRB threshold')
  pct(patch.tchCongestionThresholdPct, 'TCH Congestion threshold')
  pct(patch.sdcchCongestionThresholdPct, 'SDCCH Congestion threshold')
  pct(patch.cssrThresholdPct, 'CSSR target')
  pct(patch.callDropThresholdPct, 'Call Drop threshold')
  pct(patch.dataAccessThresholdPct, 'Data Access target')
  pct(patch.dataServiceFailureThresholdPct, 'Data Service Failure threshold')
  pct(patch.districtNcThresholdPct, 'District NC threshold')
  const merged = Object.fromEntries(NC_PERIOD_KEYS.map((k) => [k, patch[k] ?? current[k]])) as unknown as NcPeriodSettings
  const problem = ncPeriodProblem(merged)
  if (problem) throw new Error(problem)
  if (patch.priorityWeights != null) {
    const w = patch.priorityWeights
    if (!Array.isArray(w) || w.length !== 6 || w.some((n) => typeof n !== 'number' || n < 0)) {
      throw new Error('Priority weights must be 6 non-negative numbers')
    }
    if (w.reduce((a, b) => a + b, 0) <= 0) throw new Error('Priority weights must sum to more than 0')
  }
}

/** Create a new ruleset version from `patch` (spec §63). */
export async function updateRules(conn: DuckDBConnection, patch: RulesPatch): Promise<Rules> {
  const current = await getRules(conn)
  if (!current) throw new Error('No ruleset exists in this workspace')
  validateRules(patch, current)

  const columns: Record<string, number | string> = {}
  const changes: string[] = []
  for (const k of NC_PERIOD_KEYS) {
    const v = patch[k]
    if (v == null) continue
    const fld = NC_PERIOD_FIELDS[k]
    columns[fld.column] = v
    if (v !== current[k]) changes.push(`${fld.label} ${current[k]}→${v} ${fld.unit}`)
  }
  const scalar: Array<[keyof RulesPatch, string, string]> = [
    ['prbThresholdPct', 'prb_threshold_pct', 'PRB'],
    ['tchCongestionThresholdPct', 'tch_congestion_threshold_pct', 'TCH'],
    ['sdcchCongestionThresholdPct', 'sdcch_congestion_threshold_pct', 'SDCCH'],
    ['cssrThresholdPct', 'cssr_threshold_pct', 'CSSR'],
    ['callDropThresholdPct', 'call_drop_threshold_pct', 'CDR'],
    ['dataAccessThresholdPct', 'data_access_threshold_pct', 'data access'],
    ['dataServiceFailureThresholdPct', 'data_service_failure_threshold_pct', 'data failure'],
    ['districtNcThresholdPct', 'district_nc_threshold_pct', 'district NC %']
  ]
  for (const [key, col, label] of scalar) {
    const v = patch[key] as number | undefined
    if (v == null) continue
    columns[col] = Number(v)
    if (Number(v) !== current[key]) changes.push(`${label} ${current[key]}→${v}`)
  }
  if (patch.priorityWeights != null) {
    const total = patch.priorityWeights.reduce((a, b) => a + b, 0)
    const weights = patch.priorityWeights.map((n) => Math.round((n / total) * 1000) / 10)
    const diff = 100 - weights.reduce((a, b) => a + b, 0)
    weights[0] = Math.round((weights[0] + diff) * 10) / 10
    columns.priority_weights = JSON.stringify(weights)
    changes.push(`priority weights ${current.priorityWeights.join('/')}→${weights.join('/')}`)
  }
  if (patch.notes != null) columns.notes = patch.notes

  const prb = patch.prbThresholdPct
  return newRulesetVersion(conn, columns, changes.join(', ') || 'no setting changed', async () => {
    // Removed in Task 5, when kpi_defs becomes the only owner of targets.
    if (prb != null) {
      await conn.run(`UPDATE kpi_defs SET target = ? WHERE kpi_key = 'prb_utilization' AND is_core`, [prb])
    }
  })
}
```

This intentionally narrows the old target sync to PRB only (the smoke test changes PRB through `updateRules` until Task 5). Remove the now-unused `clampInt` if nothing else uses it, the `void PRIORITY_MODES` line and its import.

- [ ] **Step 11: Drop the remaining default copies**

`src/main/import/aggregates.ts:147`: `max(COALESCE(r.monthly_breach_days, 3))` → `max(r.monthly_breach_days)`.

`src/main/analytics/nc.ts:108-115`: replace the eight `const … = rules.… ?? …` lines with:

```ts
  const byGrain = {
    daily: periodsFor('daily', rules),
    weekly: periodsFor('weekly', rules),
    monthly: periodsFor('monthly', rules)
  }
  const prbThresh = rules.prbThresholdPct
```

import `periodsFor` from `../../../shared/ruleDefaults`, and in the three grain entries set `chronicThresh: byGrain.<grain>.chronic, persistentThresh: byGrain.<grain>.persistent`. (Task 7 replaces this function; this step only removes the default copies.)

`src/main/services/investigationService.ts:569-570`:

```ts
      persistentWeeks: rules?.persistentWeeks ?? DEFAULT_NC_PERIODS.persistentWeeks,
      chronicWeeks: rules?.chronicWeeks ?? DEFAULT_NC_PERIODS.chronicWeeks
```

with `import { DEFAULT_NC_PERIODS } from '../../../shared/ruleDefaults'`.

`src/renderer/lib/previewApi.ts` mock rules (around line 3170): replace the listed NC fields (`dailyMinKpiBreaches` … `chronicMonths`) with `...DEFAULT_NC_PERIODS,`, `districtNcThresholdPct: DEFAULT_DISTRICT_NC_PCT`, `priorityWeights: DEFAULT_PRIORITY_WEIGHTS`, importing all three from `../../../shared/ruleDefaults`.

Find any other caller of `validateRules`:

```bash
grep -rn "validateRules(" src tests
```

Expected: only `rules.ts`. If another caller exists, pass it the current rules as the second argument.

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npx vitest run tests/shared/ruleDefaults.test.ts tests/analytics/ncPeriodSettings.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 13: Check that no default copy is left**

```bash
grep -rn "?? 7\b\|?? 21\b\|monthly_breach_days, 3\|persistent_days\|chronic_days\|daily_min_kpi_breaches\|dailyMinKpiBreaches\|persistentDays\|chronicDays" src shared
```

Expected: no output.

- [ ] **Step 14: Gate and commit**

```bash
git add shared/ruleDefaults.ts shared/api.ts tests/shared/ruleDefaults.test.ts tests/analytics/ncPeriodSettings.test.ts src/main/analytics/rules.ts src/main/workspace/schema.ts src/main/workspace/manager.ts src/main/import/aggregates.ts src/main/analytics/nc.ts src/main/services/investigationService.ts src/renderer/lib/previewApi.ts
git commit -m "feat(rules): NC-period settings defined once, with look-back, intermittent and recovery

Defaults, limits, columns and validation come from shared/ruleDefaults.ts.
Retires persistent/chronic days (now weeks x 7) and the unused daily
minimum. Every ruleset change goes through newRulesetVersion.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: KPI targets have one owner, and saving them recomputes NC

**Files:**
- Create: `src/main/analytics/targets.ts`, `src/main/services/targetService.ts`
- Test: `tests/analytics/targetOwnership.test.ts`
- Modify: `shared/api.ts` (`Rules`, `RulesPatch`, `kpis` bridge ~line 1699)
- Modify: `src/main/analytics/rules.ts` (`getRules`, `validateRules`, `updateRules`)
- Modify: `src/main/workspace/schema.ts` (ruleset CREATE)
- Modify: `src/main/analytics/ncRule.ts:9-10`, `:30`
- Modify: `src/main/analytics/priority.ts:63`, `src/main/analytics/nc.ts` (`prbThresh`)
- Modify: `src/main/services/queryService.ts:827`, `:1185`, `:1725`, `:1737`, `:1899`, `:1911`, `:2506`
- Modify: `src/main/services/investigationService.ts:205`, `:395-480`, `:560-570`
- Modify: `src/main/services/reportingService.ts:1014`
- Modify: `src/main/services/kpiService.ts:1858` (`removeKpiDef`)
- Modify: `src/main/ipc.ts:113`, `src/preload/index.ts:86-93`
- Modify: `src/renderer/modules/TargetsModal.tsx:78-104`
- Modify: `src/renderer/lib/previewApi.ts` (mock `rules`, mock `kpis`)
- Modify: `src/main/smoke.ts:325-350`, `:795`

**Interfaces:**
- Consumes: `newRulesetVersion` (Task 4)
- Produces:
  - `kpiTargetSql(technology: Technology, key: string): string`
  - `PRB_TARGET_SQL: string`
  - `getKpiTarget(conn, technology, key): Promise<number | null>`
  - `getPrbTarget(conn): Promise<number>` (throws if the 4G PRB KPI has no target)
  - `interface CoreTargets { prb; tchCongestion; sdcchCongestion; cssr; callDrop; dataAccess; dataFailure: number }` (`NaN` when the KPI has no target: every comparison with `NaN` is false, so no finding fires)
  - `getCoreTargets(conn, technology): Promise<CoreTargets>`
  - `saveKpiTargets(conn, patches: KpiDefPatch[]): Promise<KpiDefinition[]>`, `resetKpiTargets(conn, technology?): Promise<KpiDefinition[]>`
  - `saveKpiTargetsCurrent(patches)`, `resetKpiTargetsCurrent(technology?)`
  - Bridge: `window.api.kpis.saveTargets(patches: KpiDefPatch[]): Promise<KpiDefinition[]>`
  - `Rules.prbThresholdPct` is read-only (from `kpi_defs`); `RulesPatch` no longer has any target field

- [ ] **Step 1: Write the failing tests**

`tests/analytics/targetOwnership.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'
import { getRules, updateRules } from '../../src/main/analytics/rules'
import { getCoreTargets } from '../../src/main/analytics/targets'
import { saveKpiTargets } from '../../src/main/services/targetService'
import { listKpiDefs, removeKpiDef } from '../../src/main/services/kpiService'

const WEEK = [20260720, 20260721, 20260722, 20260723, 20260724, 20260725, 20260726]

async function addWeek(ws: RealWorkspace, cellId: number, prb: number, tech: string, key: string, value: number): Promise<void> {
  for (const d of WEEK) {
    await ws.conn.run(
      `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
         dl_throughput_kbps, availability_pct, source_import_id) VALUES (?, ?, ?, 100, 10, 20000, 99.9, 1)`,
      [d, cellId, prb]
    )
  }
  await ws.conn.run(
    `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
     SELECT d.date_id, ?, k.kpi_id, ? FROM (SELECT unnest([${WEEK.join(', ')}]) AS date_id) d
     JOIN kpi_defs k ON k.technology = ? AND k.kpi_key = ?`,
    [cellId, value, tech, key]
  )
  await recomputeAllAggregates(ws.conn)
  await refreshAllIntelligence(ws.conn)
}

async function weeklyNc(ws: RealWorkspace): Promise<boolean> {
  return Boolean((await ws.conn.runAndReadAll(`SELECT bool_or(is_nc) AS nc FROM agg_cell_weekly`)).getRowObjects()[0].nc)
}

async function target(ws: RealWorkspace, tech: string, key: string): Promise<number | null> {
  const d = (await listKpiDefs(ws.conn, tech as '2G' | '3G' | '4G')).find((k) => k.key === key)
  return d?.target ?? null
}

describe('kpi_defs is the only owner of KPI targets (spec §8)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('saving a target recomputes NC and versions the change (A6)', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['CSSR-96'])
    await addWeek(ws, 1, 50, '3G', 'call_setup_success_3g', 96) // target 95: compliant
    expect(await weeklyNc(ws)).toBe(false)
    await saveKpiTargets(ws.conn, [{ technology: '3G', key: 'call_setup_success_3g', target: 97 }])
    expect(await weeklyNc(ws)).toBe(true)
    expect((await getRules(ws.conn))!.version).toBe(2)
    const note = (await ws.conn.runAndReadAll(
      `SELECT note FROM notes_events WHERE kind = 'ruleset_change' ORDER BY created_at DESC LIMIT 1`
    )).getRowObjects()[0].note
    expect(String(note)).toContain('3G call_setup_success_3g target 95→97')
  })

  it('a save that changes no NC field creates no version', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await saveKpiTargets(ws.conn, [{ technology: '3G', key: 'call_setup_success_3g', target: 95, warningThreshold: 93 }])
    expect((await getRules(ws.conn))!.version).toBe(1)
    expect(await target(ws, '3G', 'call_setup_success_3g')).toBe(95)
  })

  it('a target edit survives a ruleset save (A3)', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await saveKpiTargets(ws.conn, [{ technology: '3G', key: 'call_setup_success_3g', target: 97 }])
    await updateRules(ws.conn, { districtNcThresholdPct: 12 })
    expect(await target(ws, '3G', 'call_setup_success_3g')).toBe(97)
    expect(await target(ws, '2G', 'call_setup_success_2g')).toBe(95)
  })

  it('the 4G PRB target in kpi_defs decides PRB NC (A4)', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['PRB-85'])
    await addWeek(ws, 1, 85, '4G', 'call_setup_success_4g', 99)
    expect(await weeklyNc(ws)).toBe(true)
    await saveKpiTargets(ws.conn, [{ technology: '4G', key: 'prb_utilization', target: 90 }])
    expect(await weeklyNc(ws)).toBe(false)
    expect((await getRules(ws.conn))!.prbThresholdPct).toBe(90)
  })

  it('investigation reads each technology its own targets (A5)', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('2G')
    await saveKpiTargets(ws.conn, [{ technology: '2G', key: 'call_setup_success_2g', target: 96 }])
    expect((await getCoreTargets(ws.conn, '2G')).cssr).toBe(96)
    expect((await getCoreTargets(ws.conn, '4G')).cssr).toBe(95)
    expect((await getCoreTargets(ws.conn, '2G')).tchCongestion).toBe(1)
    expect(Number.isNaN((await getCoreTargets(ws.conn, '4G')).tchCongestion)).toBe(true)
  })

  it('core KPIs keep a target and cannot be removed (A8)', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('4G')
    await expect(
      saveKpiTargets(ws.conn, [{ technology: '4G', key: 'call_drop_rate_4g', target: null }])
    ).rejects.toThrow(/needs a target/)
    const core = (await listKpiDefs(ws.conn, '4G')).find((k) => k.key === 'call_drop_rate_4g')!
    await expect(removeKpiDef(ws.conn, core.kpiId)).rejects.toThrow(/cannot be removed/)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/analytics/targetOwnership.test.ts`
Expected: FAIL, `Failed to resolve import "../../src/main/analytics/targets"`.

- [ ] **Step 3: Write `src/main/analytics/targets.ts`**

```ts
import type { DuckDBConnection } from '@duckdb/node-api'
import type { Technology } from '../../../shared/api'

/** KPI targets have one owner: kpi_defs (spec 2026-09-29 §8). Every reader
 *  goes through here; nothing else stores or defaults a target. */

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`

export function kpiTargetSql(technology: Technology, key: string): string {
  return `(SELECT max(target) FROM kpi_defs WHERE technology = ${q(technology)} AND kpi_key = ${q(key)})`
}

/** 4G Peak Hour Traffic Utilization — a core NCA KPI like the others. */
export const PRB_TARGET_SQL = kpiTargetSql('4G', 'prb_utilization')

export async function getKpiTarget(conn: DuckDBConnection, technology: Technology, key: string): Promise<number | null> {
  const v = (await conn.runAndReadAll(`SELECT ${kpiTargetSql(technology, key)} AS t`)).getRowObjects()[0]?.t
  return v == null ? null : Number(v)
}

export async function getPrbTarget(conn: DuckDBConnection): Promise<number> {
  const t = await getKpiTarget(conn, '4G', 'prb_utilization')
  if (t == null) throw new Error('4G Peak Hour Traffic Utilization has no target in the KPI registry')
  return t
}

export interface CoreTargets {
  prb: number
  tchCongestion: number
  sdcchCongestion: number
  cssr: number
  callDrop: number
  dataAccess: number
  dataFailure: number
}

/** Targets of the core KPIs of `technology`. NaN when the technology has no
 *  such KPI: every comparison with NaN is false, so no finding fires. 3G has
 *  no utilization KPI, so every technology's capacity threshold is the 4G PRB
 *  target (spec §8.2 A5). */
export async function getCoreTargets(conn: DuckDBConnection, technology: Technology): Promise<CoreTargets> {
  const t = technology.toLowerCase()
  const keys: Record<keyof CoreTargets, [Technology, string]> = {
    prb: ['4G', 'prb_utilization'],
    tchCongestion: [technology, technology === '2G' ? 'tch_congestion' : ''],
    sdcchCongestion: [technology, technology === '2G' ? 'sdcch_congestion' : ''],
    cssr: [technology, `call_setup_success_${t}`],
    callDrop: [technology, `call_drop_rate_${t}`],
    dataAccess: [technology, technology === '3G' ? 'data_access_success_3g' : ''],
    dataFailure: [technology, technology === '4G' ? 'data_service_failure_4g' : '']
  }
  const out = {} as CoreTargets
  for (const [name, [tech, key]] of Object.entries(keys) as Array<[keyof CoreTargets, [Technology, string]]>) {
    const v = key ? await getKpiTarget(conn, tech, key) : null
    out[name] = v ?? Number.NaN
  }
  return out
}
```

- [ ] **Step 4: Write `src/main/services/targetService.ts`**

```ts
import type { DuckDBConnection } from '@duckdb/node-api'
import type { KpiDefinition, KpiDefPatch, Technology } from '../../../shared/api'
import { listKpiDefs, saveKpiDef, resetKpiDefsToDefaults, workspaceTechnology } from './kpiService'
import { newRulesetVersion } from '../analytics/rules'
import { getCurrent } from '../workspace/manager'

/** Saving KPI definitions (spec §8.2 A6, A8). A change to a field the NC rule
 *  reads — target, direction, core flag, active — creates a new ruleset
 *  version and recomputes, in one transaction; other edits save directly. */

const NC_FIELDS = ['target', 'worseIsHigher', 'isCore', 'active'] as const

export async function saveKpiTargets(conn: DuckDBConnection, patches: KpiDefPatch[]): Promise<KpiDefinition[]> {
  const fallbackTech = await workspaceTechnology(conn)
  const changes: string[] = []
  for (const p of patches) {
    const tech = (p.technology ?? fallbackTech) as Technology
    const existing = (await listKpiDefs(conn, tech)).find((k) => (p.kpiId != null ? k.kpiId === p.kpiId : k.key === p.key))
    const isCore = p.isCore ?? existing?.isCore ?? false
    const target = p.target !== undefined ? p.target : existing?.target
    if (isCore && (target == null || !Number.isFinite(Number(target)))) {
      throw new Error(`${existing?.label ?? p.key} is a core NCA KPI and needs a target`)
    }
    if (!existing) continue
    for (const f of NC_FIELDS) {
      const before = existing[f]
      const after = p[f]
      if (after !== undefined && after !== before) changes.push(`${tech} ${existing.key} ${f} ${before}→${after}`)
    }
  }

  const saved: KpiDefinition[] = []
  const apply = async (): Promise<void> => {
    for (const p of patches) saved.push(await saveKpiDef(conn, p))
  }
  if (changes.length === 0) {
    await apply()
    return saved
  }
  await newRulesetVersion(conn, {}, `targets: ${changes.join('; ')}`, apply)
  return saved
}

export async function resetKpiTargets(conn: DuckDBConnection, technology?: Technology): Promise<KpiDefinition[]> {
  let reset: KpiDefinition[] = []
  await newRulesetVersion(conn, {}, `targets reset to defaults${technology ? ` (${technology})` : ''}`, async () => {
    reset = await resetKpiDefsToDefaults(conn, technology)
  })
  return reset
}

function conn(): DuckDBConnection {
  const w = getCurrent()
  if (!w) throw new Error('No workspace is open')
  return w.connection
}

export function saveKpiTargetsCurrent(patches: KpiDefPatch[]): Promise<KpiDefinition[]> {
  return saveKpiTargets(conn(), patches)
}

export function resetKpiTargetsCurrent(technology?: Technology): Promise<KpiDefinition[]> {
  return resetKpiTargets(conn(), technology)
}
```

The change note format is `${tech} ${key} target ${before}→${after}`, which the test expects. Check that `resetKpiDefsToDefaults` and `listKpiDefs` are exported from `kpiService.ts` (`grep -n "export async function resetKpiDefsToDefaults\|export async function listKpiDefs" src/main/services/kpiService.ts`); if one is not exported, add `export`.

- [ ] **Step 5: Guard core KPIs in `removeKpiDef`**

At the top of `removeKpiDef` in `src/main/services/kpiService.ts`:

```ts
  const core = (await conn.runAndReadAll(`SELECT is_core, label FROM kpi_defs WHERE kpi_id = ${numKpiId}`)).getRowObjects()[0]
  if (core && Boolean(core.is_core)) {
    throw new Error(`${String(core.label)} is a core NCA KPI and cannot be removed`)
  }
```

(Move the `const numKpiId = Number(kpiId)` line above it.)

- [ ] **Step 6: Make `kpi_defs` the only owner in `rules.ts` and `shared/api.ts`**

`shared/api.ts`: in `Rules` delete `tchCongestionThresholdPct`, `sdcchCongestionThresholdPct`, `cssrThresholdPct`, `callDropThresholdPct`, `dataAccessThresholdPct`, `dataServiceFailureThresholdPct`, `kpiThresholds`, and document PRB:

```ts
  /** 4G Peak Hour Traffic Utilization target, read from kpi_defs. Change it
   *  with kpis.saveTargets; the ruleset never stores it. */
  prbThresholdPct: number
```

Replace `RulesPatch`:

```ts
export type RulesPatch = Partial<NcPeriodSettings> & {
  districtNcThresholdPct?: number
  priorityWeights?: number[]
  notes?: string
}
```

Add to the `kpis` bridge interface (after `save`):

```ts
    /** save several definitions at once; a change to a target, direction,
     *  core flag or active flag creates one ruleset version and recomputes NC */
    saveTargets(patches: KpiDefPatch[]): Promise<KpiDefinition[]>
```

`src/main/analytics/rules.ts`:
- `getRules`: import `getPrbTarget` from `./targets`; set `prbThresholdPct: await getPrbTarget(conn)`; delete the six threshold lines and the `kpiThresholds` parsing.
- `validateRules`: delete the seven target `pct(...)` calls (keep `districtNcThresholdPct`).
- `updateRules`: delete the seven target rows from `scalar` (keep `districtNcThresholdPct`), and call `newRulesetVersion(conn, columns, note)` with no `apply` (the PRB sync goes away).

`src/main/workspace/schema.ts` ruleset CREATE: delete `prb_threshold_pct`, `tch_congestion_threshold_pct`, `sdcch_congestion_threshold_pct`, `cssr_threshold_pct`, `call_drop_threshold_pct`, `data_access_threshold_pct`, `data_service_failure_threshold_pct`, `kpi_thresholds`. Old workspaces keep theirs (spec §8.4).

- [ ] **Step 7: Switch every PRB-threshold reader to `targets.ts`**

`src/main/analytics/ncRule.ts`: delete `LATEST_PRB_THRESHOLD_SQL`; `import { PRB_TARGET_SQL } from './targets'`; line 30 becomes `AND f.prb_utilization >= ${PRB_TARGET_SQL}`. Update the file comment's last sentence to "against the 4G Peak Hour Traffic Utilization target in kpi_defs".

`src/main/analytics/priority.ts:63`: `const prbThresh = await getPrbTarget(conn)` (import from `./targets`).

`src/main/analytics/nc.ts`: `const prbThresh = await getPrbTarget(conn)`.

`src/main/services/queryService.ts`: at lines 827, 1725, 1899, 2506 replace the right-hand side with `await getPrbTarget(conn)` (use the local connection variable in scope at each site; import from `../analytics/targets`). Lines 1737 and 1911 keep `${prbThreshold}` (now always a number).

`src/main/services/reportingService.ts:1014`: `prb: rules?.prbThresholdPct ?? null,`.

`src/main/services/investigationService.ts`:
- line 205: `const threshold = await getPrbTarget(conn)`.
- After `const threshold` add `const targets = await getCoreTargets(conn, technology)`. If `technology` is not yet resolved at line 205, place the line right after it is (search for the first `technology ===` use).
- In the finding block (lines 395-480) replace each `rules?.<x>ThresholdPct ?? <n>` with the matching `targets.<x>`: `tchCongestionThresholdPct → targets.tchCongestion`, `sdcchCongestionThresholdPct → targets.sdcchCongestion`, `cssrThresholdPct → targets.cssr`, `callDropThresholdPct → targets.callDrop`, `dataAccessThresholdPct → targets.dataAccess`, `dataServiceFailureThresholdPct → targets.dataFailure`, `prbThresholdPct → targets.prb`. Replace the texts "ruleset threshold" / "quality target" with "target".
- In `thresholds` (lines 562-568) use the same `targets.*` values.

- [ ] **Step 8: Wire IPC, preload, the Targets window and the preview mock**

`src/main/ipc.ts:113`:

```ts
  ipcMain.handle('kpis:save', async (_e, patch: KpiDefPatch) => (await saveKpiTargetsCurrent([patch]))[0])
  ipcMain.handle('kpis:saveTargets', (_e, patches: KpiDefPatch[]) => saveKpiTargetsCurrent(patches))
```

and change the `kpis:resetDefaults` handler to call `resetKpiTargetsCurrent(technology)`. Import both from `./services/targetService`; remove the now-unused `saveCurrent`/`resetCurrent` imports.

`src/preload/index.ts` in `kpis`: add `saveTargets: call('kpis:saveTargets'),`.

`src/renderer/modules/TargetsModal.tsx` `handleSave`: send only changed rows, in one call, and tell the app NC changed:

```ts
      const patches = defs.flatMap((d) => {
        const edited = editedTargets[d.kpiId]
        if (!edited) return []
        const num = (s: string): number | null => (s.trim() === '' ? null : Number(s))
        const next = {
          target: num(edited.target),
          warningThreshold: num(edited.warningThreshold),
          criticalThreshold: num(edited.criticalThreshold),
          betterDirection: edited.betterDirection
        }
        const same = next.target === d.target && next.warningThreshold === d.warningThreshold &&
          next.criticalThreshold === d.criticalThreshold && next.betterDirection === d.betterDirection
        return same ? [] : [{ kpiId: d.kpiId, technology: d.technology, ...next }]
      })
      if (patches.length > 0) await window.api.kpis.saveTargets(patches)
      setSuccess(patches.length > 0 ? `Saved ${patches.length} target${patches.length === 1 ? '' : 's'} for ${activeTech}` : 'Nothing changed')
      emit('RULESET_CHANGED')
      emit('WORKSPACE_CHANGED')
      await load(activeTech)
```

(replacing the `for (const d of defs) { … await window.api.kpis.save(...) }` loop and the old `setSuccess`/`emit` lines).

`src/renderer/lib/previewApi.ts`: delete the six threshold fields and `kpiThresholds` from the mock rules; add `saveTargets: async (patches) => Promise.all(patches.map((p) => <the mock's existing save function>(p)))` next to the mock `kpis.save`.

- [ ] **Step 9: Update the smoke test**

`src/main/smoke.ts` step 15 (lines 327-350): import `saveKpiTargetsCurrent` from `./services/targetService` and replace

```ts
  const rules2 = await updateRulesCurrent({ prbThresholdPct: 90, notes: 'smoke bump' })
  if (rules2.version !== 2 || rules2.prbThresholdPct !== 90) throw new Error('ruleset v2 missing')
```

with

```ts
  await saveKpiTargetsCurrent([{ technology: '4G', key: 'prb_utilization', target: 90 }])
  const rules2 = await getRulesCurrent()
  if (!rules2 || rules2.version !== 2 || rules2.prbThresholdPct !== 90) throw new Error('ruleset v2 missing')
```

and replace the invalid-ruleset probe `await updateRulesCurrent({ prbThresholdPct: 150 })` with `await updateRulesCurrent({ persistentWeeks: 9 })` (9 ≥ chronic 7, rejected). Line 795: `const rules3 = await updateRulesCurrent({ recoveryWeeks: 4 })`.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run tests/analytics/targetOwnership.test.ts tests/analytics/ncRule.test.ts tests/analytics/regionMap.test.ts tests/analytics/ncPeriodSettings.test.ts`
Expected: PASS.

- [ ] **Step 11: Check that no target copy is left**

```bash
grep -rn "ThresholdPct ?? \|prbThresholdPct ?? 80\|LATEST_PRB_THRESHOLD_SQL\|kpiThresholds\|cssrThresholdPct\|callDropThresholdPct" src shared
```

Expected: only `reportingService.ts` (`rules?.prbThresholdPct ?? null`).

- [ ] **Step 12: Gate and commit**

```bash
git add src/main/analytics/targets.ts src/main/services/targetService.ts tests/analytics/targetOwnership.test.ts shared/api.ts src/main/analytics/rules.ts src/main/workspace/schema.ts src/main/analytics/ncRule.ts src/main/analytics/priority.ts src/main/analytics/nc.ts src/main/services/queryService.ts src/main/services/investigationService.ts src/main/services/reportingService.ts src/main/services/kpiService.ts src/main/ipc.ts src/preload/index.ts src/renderer/modules/TargetsModal.tsx src/renderer/lib/previewApi.ts src/main/smoke.ts
git commit -m "fix(targets): kpi_defs is the only owner of KPI targets, including PRB

A ruleset save no longer overwrites per-technology targets with one
shared value; investigation checks each technology against its own
targets; saving a target recomputes NC as a new ruleset version; core
NCA KPIs cannot lose their target or be removed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Carry legacy ruleset targets into `kpi_defs` on upgrade

**Files:**
- Create: `src/main/workspace/migrateTargets.ts`
- Test: `tests/workspace/migrateTargets.test.ts`
- Modify: `src/main/workspace/manager.ts` (end of `ensureUpgradeSchema`)

**Interfaces:**
- Produces: `migrateLegacyTargets(conn: DuckDBConnection): Promise<void>`

- [ ] **Step 1: Write the failing test**

`tests/workspace/migrateTargets.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { openRealWorkspace, type RealWorkspace } from '../helpers/realWorkspace'
import { getKpiTarget } from '../../src/main/analytics/targets'

/** Make the open workspace look like one written before kpi_defs owned
 *  targets, with `prb` in the ruleset, then close and reopen it. */
async function reopenAsLegacy(ws: RealWorkspace, prb: number, cssr: number): Promise<void> {
  await ws.conn.run(`ALTER TABLE ruleset ADD COLUMN IF NOT EXISTS prb_threshold_pct DOUBLE DEFAULT 80`)
  await ws.conn.run(`ALTER TABLE ruleset ADD COLUMN IF NOT EXISTS cssr_threshold_pct DOUBLE DEFAULT 95`)
  await ws.conn.run(`UPDATE ruleset SET prb_threshold_pct = ?, cssr_threshold_pct = ?`, [prb, cssr])
  await ws.conn.run(`DELETE FROM workspace_meta WHERE key = 'targets_owner'`)
  const manager = await import('../../src/main/workspace/manager')
  await manager.closeWorkspace()
  await manager.openWorkspace(join(ws.dir, 'test.qosdb'))
  ws.conn = manager.getCurrent()!.connection
}

describe('upgrade carries custom ruleset targets into kpi_defs (spec §8.5)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('a workspace with PRB 85 in the ruleset opens with the 4G PRB target at 85', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('4G')
    await reopenAsLegacy(ws, 85, 96)
    expect(await getKpiTarget(ws.conn, '4G', 'prb_utilization')).toBe(85)
    expect(await getKpiTarget(ws.conn, '2G', 'call_setup_success_2g')).toBe(96)
    expect(await getKpiTarget(ws.conn, '3G', 'call_setup_success_3g')).toBe(96)
  })

  it('a target already edited in kpi_defs wins over the ruleset copy', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('4G')
    await ws.conn.run(`UPDATE kpi_defs SET target = 82 WHERE technology = '4G' AND kpi_key = 'prb_utilization'`)
    await reopenAsLegacy(ws, 85, 95)
    expect(await getKpiTarget(ws.conn, '4G', 'prb_utilization')).toBe(82)
  })

  it('runs once', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('4G')
    await reopenAsLegacy(ws, 85, 95)
    await ws.conn.run(`UPDATE kpi_defs SET target = 80 WHERE technology = '4G' AND kpi_key = 'prb_utilization'`)
    const manager = await import('../../src/main/workspace/manager')
    await manager.closeWorkspace()
    await manager.openWorkspace(join(ws.dir, 'test.qosdb'))
    ws.conn = manager.getCurrent()!.connection
    expect(await getKpiTarget(ws.conn, '4G', 'prb_utilization')).toBe(80)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/workspace/migrateTargets.test.ts`
Expected: FAIL. The first test gets `80`, not `85`.

- [ ] **Step 3: Write `src/main/workspace/migrateTargets.ts`**

```ts
import type { DuckDBConnection } from '@duckdb/node-api'
import type { Technology } from '../../../shared/api'

/** One-time upgrade (spec §8.5). Before kpi_defs owned KPI targets, the
 *  ruleset kept its own copies. Carry a copy someone changed from its old
 *  default into kpi_defs — unless kpi_defs was edited too (kpi_defs wins).
 *  The numbers below are the old schema's column defaults, not live defaults. */
const LEGACY: Array<{ column: string; oldDefault: number; keys: Array<[Technology, string]> }> = [
  { column: 'prb_threshold_pct', oldDefault: 80, keys: [['4G', 'prb_utilization']] },
  { column: 'tch_congestion_threshold_pct', oldDefault: 1, keys: [['2G', 'tch_congestion']] },
  { column: 'sdcch_congestion_threshold_pct', oldDefault: 1, keys: [['2G', 'sdcch_congestion']] },
  {
    column: 'cssr_threshold_pct', oldDefault: 95,
    keys: [['2G', 'call_setup_success_2g'], ['3G', 'call_setup_success_3g'], ['4G', 'call_setup_success_4g']]
  },
  {
    column: 'call_drop_threshold_pct', oldDefault: 1,
    keys: [['2G', 'call_drop_rate_2g'], ['3G', 'call_drop_rate_3g'], ['4G', 'call_drop_rate_4g']]
  },
  { column: 'data_access_threshold_pct', oldDefault: 95, keys: [['3G', 'data_access_success_3g']] },
  { column: 'data_service_failure_threshold_pct', oldDefault: 1, keys: [['4G', 'data_service_failure_4g']] }
]

export async function migrateLegacyTargets(conn: DuckDBConnection): Promise<void> {
  const done = (await conn.runAndReadAll(
    `SELECT value FROM workspace_meta WHERE key = 'targets_owner'`
  )).getRowObjects()[0]
  if (done) return
  const row = (await conn.runAndReadAll(`SELECT * FROM ruleset ORDER BY version DESC LIMIT 1`)).getRowObjects()[0] ?? {}
  for (const { column, oldDefault, keys } of LEGACY) {
    const v = row[column]
    if (v == null || Number(v) === oldDefault) continue
    for (const [tech, key] of keys) {
      await conn.run(
        `UPDATE kpi_defs SET target = ?, updated_at = now()
         WHERE technology = ? AND kpi_key = ? AND target = ?`,
        [Number(v), tech, key, oldDefault]
      )
    }
  }
  await conn.run(`INSERT OR REPLACE INTO workspace_meta (key, value) VALUES ('targets_owner', 'kpi_defs')`)
}
```

- [ ] **Step 4: Call it on open**

At the end of `ensureUpgradeSchema` in `src/main/workspace/manager.ts`:

```ts
  await migrateLegacyTargets(connection)
```

with `import { migrateLegacyTargets } from './migrateTargets'`. If the KPI seeding for an old workspace happens after `ensureUpgradeSchema` in `openWorkspace` (check around line 351), call `migrateLegacyTargets(connection)` right after the seeding instead, so the `kpi_defs` rows exist.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/workspace/migrateTargets.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Gate and commit**

```bash
git add src/main/workspace/migrateTargets.ts tests/workspace/migrateTargets.test.ts src/main/workspace/manager.ts
git commit -m "feat(upgrade): carry custom ruleset targets into kpi_defs once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The NC periods engine

**Files:**
- Rewrite: `src/main/analytics/nc.ts` (`recomputeNcLifecycle`)
- Test: `tests/analytics/ncPeriods.test.ts`
- Modify: `src/main/smoke.ts:272-283`

**Interfaces:**
- Consumes: `periodsFor`, `NcGrain` (Task 4); `LIFECYCLE_RANK`, `SEVERITY_BASE`, `lifecycleFromRankSql`, `rankTableSql` (Task 2); `getPrbTarget` (Task 5); `coreBreachDaysSql`, `WORKSPACE_TECH_SQL` (`ncRule.ts`)
- Produces: unchanged signature `recomputeNcLifecycle(conn: DuckDBConnection, cellIds: number[]): Promise<void>`; rows in `cell_nc_lifecycle` now follow spec §3/§4.

- [ ] **Step 1: Write the failing tests**

`tests/analytics/ncPeriods.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'
import { updateRules } from '../../src/main/analytics/rules'

/** One row per day from `from` to `to` where `present` holds; CSSR 90 (target
 *  95, a bad day) where `bad` holds, else 99. Both are SQL predicates on `d`. */
async function days(ws: RealWorkspace, cellId: number, from: string, to: string, bad: string, present = 'true'): Promise<void> {
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
}

async function build(ws: RealWorkspace): Promise<void> {
  await recomputeAllAggregates(ws.conn)
  await refreshAllIntelligence(ws.conn)
}

/** period_start → lifecycle for one cell and grain. */
async function labels(ws: RealWorkspace, cell: string, grain: string): Promise<Record<string, string>> {
  const r = await ws.conn.runAndReadAll(
    `SELECT CAST(l.period_start AS VARCHAR) AS p, l.lifecycle FROM cell_nc_lifecycle l
     JOIN dim_cell c USING (cell_id) WHERE c.name = ? AND l.grain = ?`,
    [cell, grain]
  )
  return Object.fromEntries(r.getRowObjects().map((x) => [String(x.p), String(x.lifecycle)]))
}

describe('NC periods (spec §3, §4)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('daily: New → Persistent at day 21 → Chronic at day 49; Recovering for 21 days, then Healthy',
    { timeout: 60000 }, async () => {
      ws = await openRealWorkspace('3G')
      await insertCells(ws.conn, ['RUN-56', 'ONE-DAY'])
      await days(ws, 1, '2026-07-01', '2026-09-10', `d <= DATE '2026-08-25'`)
      await days(ws, 2, '2026-03-01', '2026-04-10', `d = DATE '2026-03-01'`)
      await build(ws)
      const a = await labels(ws, 'RUN-56', 'daily')
      expect([a['2026-07-01'], a['2026-07-20'], a['2026-07-21']]).toEqual(['New NC', 'New NC', 'Persistent NC'])
      expect([a['2026-08-17'], a['2026-08-18']]).toEqual(['Persistent NC', 'Chronic NC'])
      expect(a['2026-08-26']).toBe('Recovering')
      const b = await labels(ws, 'ONE-DAY', 'daily')
      expect([b['2026-03-01'], b['2026-03-02'], b['2026-03-22'], b['2026-03-23']])
        .toEqual(['New NC', 'Recovering', 'Recovering', 'Healthy'])
    })

  it('a relapse inside the look-back window is Recurring, outside it New', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['BACK-17D', 'BACK-27D'])
    await days(ws, 1, '2026-07-01', '2026-08-10', `d <= DATE '2026-07-03' OR d = DATE '2026-07-20'`)
    await days(ws, 2, '2026-07-01', '2026-08-10', `d <= DATE '2026-07-03' OR d = DATE '2026-07-30'`)
    await build(ws)
    expect((await labels(ws, 'BACK-17D', 'daily'))['2026-07-20']).toBe('Recurring NC')
    expect((await labels(ws, 'BACK-27D', 'daily'))['2026-07-30']).toBe('New NC')
  })

  it('a Tuesdays-only cell is Intermittent daily and Chronic weekly and monthly', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['TUESDAYS'])
    await days(ws, 1, '2026-07-06', '2026-08-30', `dayofweek(d) = 2`)
    await build(ws)
    const d = await labels(ws, 'TUESDAYS', 'daily')
    expect([d['2026-07-07'], d['2026-07-14'], d['2026-07-21']]).toEqual(['New NC', 'Recurring NC', 'Intermittent NC'])
    expect(d['2026-07-22']).toBe('Recovering')
    const w = await labels(ws, 'TUESDAYS', 'weekly')
    expect([w['2026-08-10'], w['2026-08-17']]).toEqual(['Persistent NC', 'Chronic NC'])
    expect((await labels(ws, 'TUESDAYS', 'monthly'))['2026-08-01']).toBe('Chronic NC')
  })

  it('chronic in a day is chronic in its week and its month (tracing)', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['RUN-56'])
    await days(ws, 1, '2026-07-01', '2026-08-31', `d <= DATE '2026-08-25'`)
    await build(ws)
    expect((await labels(ws, 'RUN-56', 'daily'))['2026-08-18']).toBe('Chronic NC')
    expect((await labels(ws, 'RUN-56', 'weekly'))['2026-08-17']).toBe('Chronic NC')
    expect((await labels(ws, 'RUN-56', 'monthly'))['2026-08-01']).toBe('Chronic NC')
  })

  it('month edge: a run ending on the 2nd leaves that month not NC', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['ENDS-2ND'])
    await days(ws, 1, '2026-06-14', '2026-08-20', `d <= DATE '2026-08-02'`)
    await build(ws)
    expect((await labels(ws, 'ENDS-2ND', 'daily'))['2026-08-01']).toBe('Chronic NC')
    const m = (await ws.conn.runAndReadAll(
      `SELECT is_nc, lifecycle FROM cell_nc_lifecycle WHERE grain = 'monthly' AND period_start = DATE '2026-08-01'`
    )).getRowObjects()[0]
    expect(Boolean(m.is_nc)).toBe(false)
    expect(String(m.lifecycle)).toBe('Recovering')
  })

  it('a missing day inside a run neither breaks nor extends it', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['GAP'])
    await days(ws, 1, '2026-07-01', '2026-07-31', `d <= DATE '2026-07-25'`, `d <> DATE '2026-07-10'`)
    await build(ws)
    const g = await labels(ws, 'GAP', 'daily')
    expect(g['2026-07-21']).toBe('New NC') // 20th bad day with data
    expect(g['2026-07-22']).toBe('Persistent NC') // 21st
  })

  it('a shorter recovery setting brings Healthy forward', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['ONE-DAY'])
    await days(ws, 1, '2026-03-01', '2026-03-31', `d = DATE '2026-03-01'`)
    await updateRules(ws.conn, { recoveryWeeks: 1 })
    const b = await labels(ws, 'ONE-DAY', 'daily')
    expect([b['2026-03-08'], b['2026-03-09']]).toEqual(['Recovering', 'Healthy'])
  })

  it('severity ignores PRB outside 4G', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['HOT-3G'])
    await days(ws, 1, '2026-07-06', '2026-07-12', `true`)
    await ws.conn.run(`UPDATE fact_cell_daily SET prb_utilization = 120`)
    await build(ws)
    const s = (await ws.conn.runAndReadAll(
      `SELECT severity FROM cell_nc_lifecycle WHERE grain = 'daily' AND period_start = DATE '2026-07-06'`
    )).getRowObjects()[0].severity
    // New NC 40 + breach 2 + availability 0 = 42 → Watch; with the PRB term (+25) it would be High
    expect(String(s)).toBe('Watch')
  })
})
```

Expected labels were checked against a DuckDB prototype of the same SQL (2026-09-30): 56-day run → New on day 20, Persistent on day 21 (2026-07-21), Chronic on day 49 (2026-08-18); one bad day on 1 March → Recovering 2–22 March, Healthy 23 March; Tuesdays → New 07-07, Recurring 07-14, Intermittent 07-21.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/analytics/ncPeriods.test.ts`
Expected: FAIL. For example the first test sees `'Chronic NC'` on 2026-07-21 (old daily chronic = 21 days) and `'Healthy'` on 2026-03-03 (old Recovering lasts one period); the Tuesdays test has no `'Intermittent NC'`.

- [ ] **Step 3: Rewrite `recomputeNcLifecycle` in `src/main/analytics/nc.ts`**

Replace the whole file with:

```ts
import type { DuckDBConnection } from '@duckdb/node-api'
import { getRules } from './rules'
import { coreBreachDaysSql, WORKSPACE_TECH_SQL } from './ncRule'
import { getPrbTarget } from './targets'
import { periodsFor, type NcGrain, type GrainPeriods } from '../../../shared/ruleDefaults'
import { LIFECYCLE_RANK as R, SEVERITY_BASE, lifecycleFromRankSql, rankTableSql } from '../../../shared/lifecycle'

/** NC periods (spec docs/superpowers/specs/2026-09-29-nc-lifecycle-design.md).
 *  1. Label each grain on its own (§3): runs of NC periods (a period with no
 *     data neither breaks nor extends a run), look-back, intermittent window,
 *     recovery window — all counted in periods of that grain.
 *  2. Roll up (§4): an NC week takes the worst label of its days; an NC month
 *     the worst of its days and of the weeks starting in it.
 *  3. Score trend and severity once per row and write cell_nc_lifecycle.
 *  Raw facts are never touched. */

/** Period number: consecutive periods differ by exactly 1 (2000-01-03 is a Monday). */
const PIDX: Record<NcGrain, string> = {
  daily: `date_diff('day', DATE '2000-01-03', period_date)`,
  weekly: `date_diff('day', DATE '2000-01-03', period_date) // 7`,
  monthly: `year(period_date) * 12 + month(period_date)`
}

function sourceSql(grain: NcGrain, idList: string): string {
  if (grain === 'daily') {
    return `
      SELECT f.cell_id, d.date AS period_date, (ex.cell_id IS NOT NULL) AS is_nc,
             CAST(CASE WHEN ex.cell_id IS NOT NULL THEN 1 ELSE 0 END AS DOUBLE) AS breach_days,
             1.0 AS observed_days, f.prb_utilization AS prb_avg,
             f.data_volume_mb AS vol, f.connected_users AS usr,
             f.dl_throughput_kbps AS thr, f.availability_pct AS avail
      FROM fact_cell_daily f
      JOIN dim_date d USING (date_id)
      LEFT JOIN (${coreBreachDaysSql()}) ex ON ex.cell_id = f.cell_id AND ex.date_id = f.date_id
      WHERE f.cell_id IN (${idList})`
  }
  const [table, col] = grain === 'weekly' ? ['agg_cell_weekly', 'week_start'] : ['agg_cell_monthly', 'month_start']
  return `
      SELECT w.cell_id, w.${col} AS period_date, w.is_nc,
             CAST(coalesce(w.breach_days, 0) AS DOUBLE) AS breach_days,
             CAST(greatest(coalesce(w.observed_days, 1), 1) AS DOUBLE) AS observed_days,
             w.prb_avg, w.data_volume_mb_sum AS vol, w.connected_users_sum AS usr,
             w.dl_throughput_kbps_avg AS thr, w.availability_pct_avg AS avail
      FROM ${table} w
      WHERE w.cell_id IN (${idList})`
}

/** Label rank per spec §3, first match wins. */
function rankSql(p: GrainPeriods): string {
  return `CASE
      WHEN is_nc THEN CASE
        WHEN streak >= ${p.chronic} THEN ${R['Chronic NC']}
        WHEN streak >= ${p.persistent} THEN ${R['Persistent NC']}
        WHEN runs_in_window >= ${p.intermittentRuns} THEN ${R['Intermittent NC']}
        WHEN run_start - prev_run_end <= ${p.lookback} THEN ${R['Recurring NC']}
        ELSE ${R['New NC']} END
      WHEN prev_nc_pidx IS NOT NULL AND pidx - prev_nc_pidx <= ${p.recovery} THEN ${R['Recovering']}
      ELSE ${R['Healthy']} END`
}

/** Improving/Worsening from five period-over-period signals (spec §38). */
const TREND_SQL = `CASE
    WHEN prev_is_nc IS NULL AND prev_prb IS NULL THEN 'Stable'
    WHEN improving - worsening >= 2 THEN 'Improving'
    WHEN improving - worsening <= -2 THEN 'Worsening'
    ELSE 'Stable' END`

function stageGrainSql(grain: NcGrain, idList: string, p: GrainPeriods): string {
  const byCell = 'PARTITION BY cell_id ORDER BY pidx'
  return `
    INSERT INTO stg_nc_lifecycle
    WITH src AS (
      SELECT *, ${PIDX[grain]} AS pidx FROM (${sourceSql(grain, idList)})
    ),
    runs AS (
      SELECT *,
        sum(CASE WHEN is_nc THEN 0 ELSE 1 END) OVER (${byCell}) AS grp,
        max(CASE WHEN is_nc THEN pidx END) OVER (${byCell} ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_nc_pidx,
        lag(is_nc) OVER (${byCell}) AS prev_is_nc,
        lag(prb_avg) OVER (${byCell}) AS prev_prb,
        lag(breach_days) OVER (${byCell}) AS prev_breach,
        lag(thr) OVER (${byCell}) AS prev_thr,
        lag(vol / observed_days) OVER (${byCell}) AS prev_vol_pd,
        lag(usr / observed_days) OVER (${byCell}) AS prev_usr_pd
      FROM src
    ),
    streaks AS (
      SELECT *,
        CASE WHEN is_nc THEN sum(CASE WHEN is_nc THEN 1 ELSE 0 END) OVER (PARTITION BY cell_id, grp ORDER BY pidx) ELSE 0 END AS streak,
        min(CASE WHEN is_nc THEN pidx END) OVER (PARTITION BY cell_id, grp) AS run_start,
        count(DISTINCT CASE WHEN is_nc THEN grp END)
          OVER (${byCell} RANGE BETWEEN ${p.intermittentWindow - 1} PRECEDING AND CURRENT ROW) AS runs_in_window
      FROM runs
    ),
    labelled AS (
      SELECT *, max(CASE WHEN pidx = run_start THEN prev_nc_pidx END) OVER (PARTITION BY cell_id, grp) AS prev_run_end,
        coalesce(prb_avg, 0) - coalesce(prev_prb, 0) AS d_prb,
        breach_days - coalesce(prev_breach, 0) AS d_breach,
        CASE WHEN prev_thr > 0 THEN (thr - prev_thr) / prev_thr * 100 END AS p_thr,
        CASE WHEN prev_vol_pd > 0 THEN (vol / observed_days - prev_vol_pd) / prev_vol_pd * 100 END AS p_vol,
        CASE WHEN prev_usr_pd > 0 THEN (usr / observed_days - prev_usr_pd) / prev_usr_pd * 100 END AS p_usr
      FROM streaks
    ),
    scored AS (
      SELECT *,
        (CASE WHEN d_prb <= -3 THEN 1 ELSE 0 END) + (CASE WHEN d_breach <= -1 THEN 1 ELSE 0 END)
          + (CASE WHEN p_thr >= 10 THEN 1 ELSE 0 END) + (CASE WHEN p_vol <= -10 THEN 1 ELSE 0 END)
          + (CASE WHEN p_usr <= -10 THEN 1 ELSE 0 END) AS improving,
        (CASE WHEN d_prb >= 3 THEN 1 ELSE 0 END) + (CASE WHEN d_breach >= 1 THEN 1 ELSE 0 END)
          + (CASE WHEN p_thr <= -10 THEN 1 ELSE 0 END) + (CASE WHEN p_vol >= 10 THEN 1 ELSE 0 END)
          + (CASE WHEN p_usr >= 10 THEN 1 ELSE 0 END) AS worsening
      FROM labelled
    )
    SELECT cell_id, '${grain}', period_date, is_nc, ${rankSql(p)}, ${TREND_SQL}, breach_days, prb_avg, avail
    FROM scored`
}

/** Raise NC weeks and months to the worst label inside them (spec §4). */
const ROLL_UP_SQL = [
  `UPDATE stg_nc_lifecycle AS w SET lc_rank = x.worst
   FROM (
     SELECT wk.cell_id, wk.period_date, max(d.lc_rank) AS worst
     FROM stg_nc_lifecycle wk
     JOIN stg_nc_lifecycle d ON d.cell_id = wk.cell_id AND d.grain = 'daily'
       AND d.period_date BETWEEN wk.period_date AND wk.period_date + 6
     WHERE wk.grain = 'weekly' AND wk.is_nc
     GROUP BY wk.cell_id, wk.period_date
   ) x
   WHERE w.grain = 'weekly' AND w.cell_id = x.cell_id AND w.period_date = x.period_date AND x.worst > w.lc_rank`,
  `UPDATE stg_nc_lifecycle AS m SET lc_rank = x.worst
   FROM (
     SELECT mo.cell_id, mo.period_date, max(f.lc_rank) AS worst
     FROM stg_nc_lifecycle mo
     JOIN stg_nc_lifecycle f ON f.cell_id = mo.cell_id AND f.grain IN ('daily', 'weekly')
       AND CAST(date_trunc('month', f.period_date) AS DATE) = mo.period_date
     WHERE mo.grain = 'monthly' AND mo.is_nc
     GROUP BY mo.cell_id, mo.period_date
   ) x
   WHERE m.grain = 'monthly' AND m.cell_id = x.cell_id AND m.period_date = x.period_date AND x.worst > m.lc_rank`
]

/** Recompute lifecycle, trend and severity for the given cells across their
 *  full daily, weekly and monthly history. */
export async function recomputeNcLifecycle(conn: DuckDBConnection, cellIds: number[]): Promise<void> {
  if (cellIds.length === 0) return
  const rules = await getRules(conn)
  if (!rules) return
  const tech = String((await conn.runAndReadAll(`SELECT ${WORKSPACE_TECH_SQL} AS t`)).getRowObjects()[0].t)
  // PRB is 4G's Peak Hour Traffic Utilization; 2G/3G put other utilizations in that column (ncRule.ts)
  const prb = tech === '4G' ? await getPrbTarget(conn) : null
  const prbPoints = prb == null
    ? '0'
    : `CASE WHEN coalesce(prb_avg, ${prb}) - ${prb} >= 20 THEN 25
            WHEN coalesce(prb_avg, ${prb}) - ${prb} >= 10 THEN 15
            WHEN coalesce(prb_avg, ${prb}) - ${prb} >= 5 THEN 10
            WHEN coalesce(prb_avg, ${prb}) - ${prb} >= 0 THEN 5 ELSE 0 END`
  const grains: NcGrain[] = ['daily', 'weekly', 'monthly']

  const BATCH_SIZE = 2500
  for (let b = 0; b < cellIds.length; b += BATCH_SIZE) {
    const idList = cellIds.slice(b, b + BATCH_SIZE).join(',')
    await conn.run(`CREATE OR REPLACE TEMP TABLE stg_nc_lifecycle (
      cell_id BIGINT, grain VARCHAR, period_date DATE, is_nc BOOLEAN, lc_rank INTEGER,
      trend VARCHAR, breach_days DOUBLE, prb_avg DOUBLE, avail DOUBLE)`)
    for (const g of grains) await conn.run(stageGrainSql(g, idList, periodsFor(g, rules)))
    for (const sql of ROLL_UP_SQL) await conn.run(sql)

    await conn.run(`DELETE FROM cell_nc_lifecycle WHERE cell_id IN (${idList})`)
    await conn.run(`
      INSERT INTO cell_nc_lifecycle
        (cell_id, period_start, grain, ruleset_version, is_nc, lifecycle, trend, severity, breach_days, prb_avg, computed_at)
      SELECT cell_id, period_date, grain, ${rules.version}, is_nc, ${lifecycleFromRankSql('lc_rank')}, trend,
        CASE WHEN NOT is_nc THEN 'Normal' WHEN score >= 75 THEN 'Critical' WHEN score >= 45 THEN 'High' ELSE 'Watch' END,
        breach_days, prb_avg, now()
      FROM (
        SELECT *,
          ${rankTableSql(SEVERITY_BASE, 'lc_rank')} + (${prbPoints}) + least(15, breach_days * 2)
            + (CASE WHEN trend = 'Worsening' THEN 10 ELSE 0 END)
            + (CASE WHEN avail IS NOT NULL AND avail < 99 THEN 5 ELSE 0 END) AS score
        FROM stg_nc_lifecycle
      )`)
  }
  await conn.run(`DROP TABLE IF EXISTS stg_nc_lifecycle`)
}
```

Notes for the implementer:
- `count(DISTINCT …) OVER (… RANGE …)`, `INSERT … BY NAME … REPLACE`, `INSERT INTO t WITH … SELECT`, both roll-up `UPDATE … FROM` statements, list indexing by rank and `INSERT OR REPLACE` were verified on DuckDB 1.5.5 on 2026-09-30.
- The old code capped the severity score at 100 before banding; the bands only compare `>= 75` and `>= 45`, so the cap changed nothing and is dropped.
- The old daily source clamped nothing; weekly/monthly `observed_days` default 1/30 were used only as per-day divisors. `greatest(coalesce(observed_days, 1), 1)` keeps the divisor positive for both.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/analytics/ncPeriods.test.ts tests/analytics/ncRule.test.ts tests/analytics/priorityKpiBreach.test.ts`
Expected: PASS.

If the severity test fails on the exact band, compute the score by hand from the row (base 40 for New NC, `least(15, breach_days*2)`, +10 if trend Worsening, +5 if availability < 99) and fix the code, not the expectation: the assertion's purpose is that PRB adds nothing in a 3G workspace.

- [ ] **Step 5: Update the smoke expectations**

`src/main/smoke.ts:272-276`. ACC-001-A is NC for its 2nd consecutive week with no earlier run, which spec §6 defines as New NC:

```ts
  if (byName['ACC-001-A'] !== 'New NC') {
    throw new Error('ACC-001-A should be New NC (2nd week of its first run): ' + JSON.stringify(byName))
  }
```

Run the Gate once and read the `[SMOKE] 11. byName: … bySev: …` line in `$SCRATCH/smoke.log`. The old severity assertion (`Critical`, from Recurring 60) is now base 40 + the same other points. Replace `'Critical'` with the band the log shows only if it equals your hand calculation (40 + PRB points + `min(15, 2 × breach days)` + 10 if Worsening + 5 if availability < 99; ≥ 75 Critical, ≥ 45 High), and update the message to say `New NC`. Keep the `KUM-002-A` and "at least 2 New NC weeks" checks.

- [ ] **Step 6: Gate and commit**

```bash
git add src/main/analytics/nc.ts tests/analytics/ncPeriods.test.ts src/main/smoke.ts
git commit -m "feat(nc): NC periods with one clock, Intermittent, recovery window and roll-up

Chronic in a day is Chronic in its week and month; Recurring means the
problem came back; Recovering lasts the recovery window. Trend and
severity are scored once per row; PRB adds severity only in 4G.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Screens use the shared vocabulary

**Files:**
- Modify: `shared/api.ts` (`NcMovementRow`, ~line 692)
- Modify: `src/main/services/queryService.ts:202-205`, `:268-272`
- Modify: `src/renderer/lib/overviewData.ts` (`movementSeries`, `bannerSummary`)
- Test: `tests/renderer/overviewData.test.ts`
- Modify: `src/renderer/modules/Overview.tsx:498-502`, `src/renderer/lib/overviewCharts.ts:146`, `:168-172`
- Modify: `src/renderer/modules/NcIntelligence.tsx:75-135`, `:285-289`
- Modify: `src/renderer/modules/NetworkExplorer.tsx:955-975`, `:1325-1340`, `:1455-1466`
- Modify: `src/renderer/lib/previewApi.ts` (movement mock around line 717)

**Interfaces:**
- Consumes: `LIFECYCLE_STYLE`, `NC_LIFECYCLES`, `Lifecycle` (Task 2)
- Produces: `NcMovementRow` gains `intermittent: number` and `chronic: number`; `movementSeries` and `bannerSummary` return them too.

- [ ] **Step 1: Extend the failing renderer test**

In `tests/renderer/overviewData.test.ts`, add `intermittent` and `chronic` to both movement fixtures (lines 39 and 46):

```ts
    weekStart: '2026-07-20', newNc: 3, recurring: 1, intermittent: 2, persistent: 2, chronic: 1, recovering: 4, ncCells: 6, totalCells: 100, ncRate: 6,
```

```ts
    weekStart: '2026-07-27', newNc: 1, recurring: 2, intermittent: 0, persistent: 3, chronic: 2, recovering: 1, ncCells: 6, totalCells: 100, ncRate: 6,
```

and the expectations:

```ts
      { label: 'W30', newNc: 3, recurring: 1, intermittent: 2, persistent: 2, chronic: 1, recovering: 4 },
      { label: 'W31', newNc: 1, recurring: 2, intermittent: 0, persistent: 3, chronic: 2, recovering: 1 }
```

```ts
    expect(summary).toEqual({ healthPct: 87.5, cells: 100, ncCells: 6, newNc: 1, recurring: 2, intermittent: 0, persistent: 3, chronic: 2, recovering: 1 })
```

```ts
      healthPct: null, cells: 0, ncCells: 0, newNc: 0, recurring: 0, intermittent: 0, persistent: 0, chronic: 0, recovering: 0
```

(`healthPct`, `cells` and `ncCells` come from the technology card, so only the lifecycle fields change.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/renderer/overviewData.test.ts`
Expected: FAIL, the received objects have no `intermittent` / `chronic`.

- [ ] **Step 3: Carry the two counts end to end**

`shared/api.ts` `NcMovementRow`: after `recurring: number` add `intermittent: number`; after `persistent: number` add `chronic: number`.

`src/main/services/queryService.ts` movement SQL (after line 203 and 204):

```sql
      count(*) FILTER (WHERE lifecycle = 'Intermittent NC') AS intermittent,
      count(*) FILTER (WHERE lifecycle = 'Chronic NC') AS chronic,
```

and in the row mapping (after `recurring` and `persistent`):

```ts
      intermittent: Number(x.intermittent ?? 0),
      chronic: Number(x.chronic ?? 0),
```

`src/renderer/lib/overviewData.ts`: add `intermittent` and `chronic` to the return type and body of `movementSeries`, and to `bannerSummary` wherever it copies `newNc`/`recurring`/`persistent`/`recovering` (both the data and the empty branch).

`src/renderer/lib/previewApi.ts` (movement mock near line 717): add `intermittent: 0, chronic: 0,` next to `recovering: recov[j],`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/overviewData.test.ts`
Expected: PASS.

- [ ] **Step 5: Draw every label with the shared colours**

`src/renderer/modules/Overview.tsx` lines 498-502, replacing the four `<Bar>` elements:

```tsx
                  {([
                    ['newNc', 'New NC'], ['recurring', 'Recurring NC'], ['intermittent', 'Intermittent NC'],
                    ['persistent', 'Persistent NC'], ['chronic', 'Chronic NC'], ['recovering', 'Recovering']
                  ] as const).map(([key, label], i, all) => (
                    <Bar key={key} dataKey={key} name={label} stackId="a" fill={LIFECYCLE_STYLE[label].color}
                      radius={i === all.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                  ))}
```

`src/renderer/lib/overviewCharts.ts`: legend data becomes `['New NC', 'Recurring', 'Intermittent', 'Persistent', 'Chronic', 'Recovering', 'NC rate']`, and the four line series become:

```ts
      ...([
        ['New NC', 'newNc', 'New NC'], ['Recurring', 'recurring', 'Recurring NC'],
        ['Intermittent', 'intermittent', 'Intermittent NC'], ['Persistent', 'persistent', 'Persistent NC'],
        ['Chronic', 'chronic', 'Chronic NC'], ['Recovering', 'recovering', 'Recovering']
      ] as const).map(([name, key, label]) => ({
        ...base, name, data: movement.map((m) => m[key]),
        lineStyle: { color: LIFECYCLE_STYLE[label].color }, itemStyle: { color: LIFECYCLE_STYLE[label].color }
      })),
```

`src/renderer/modules/NcIntelligence.tsx` `renderLifecycleBadge`: delete the `bg`/`color`/`border` if-chain and the invented `streakStr` texts ("≥ 3w streak", "Intermittent" for Recurring):

```tsx
function renderLifecycleBadge(lifecycle?: string, breachDays?: number): React.JSX.Element {
  const lc = (LIFECYCLES as readonly string[]).includes(lifecycle ?? '') ? (lifecycle as Lifecycle) : 'Healthy'
  const { bg, color, border } = LIFECYCLE_STYLE[lc]
  const streakStr = breachDays != null && breachDays > 0 ? `${breachDays} bad day${breachDays === 1 ? '' : 's'}` : null
```

and render `{streakStr && (<span …>⏱ {streakStr}</span>)}` instead of the unconditional span. Lines 285-289: replace the invented fallbacks (`?? 8`, `?? 4`, `?? 6`, `?? 5`) with real counts:

```ts
  const count = (l: Lifecycle): number => nc?.byLifecycle[l] ?? 0
  const persistentCount = count('Persistent NC') + count('Chronic NC')
  const newCount = count('New NC')
  const recurringCount = count('Recurring NC') + count('Intermittent NC')
  const recoveringCount = count('Recovering')
  const totalBreaches = NC_LIFECYCLES.reduce((s, l) => s + count(l), 0)
```

If those four tiles have labels ("Persistent", "Recurring"), rename them to "Persistent / Chronic" and "Recurring / Intermittent".

`src/renderer/modules/NetworkExplorer.tsx`: at the three sites, replace the ternary chains with the style table:

```tsx
                          background: LIFECYCLE_STYLE[(n.lifecycle as Lifecycle) ?? 'Healthy']?.bg ?? LIFECYCLE_STYLE.Healthy.bg,
                          color: LIFECYCLE_STYLE[(n.lifecycle as Lifecycle) ?? 'Healthy']?.color ?? LIFECYCLE_STYLE.Healthy.color
```

(same with `detail.current.lifecycle`), and for the week strip:

```tsx
                      {LIFECYCLE_STYLE[w.lifecycle as Lifecycle]?.short ?? '·'}
```

Import `LIFECYCLES, NC_LIFECYCLES, LIFECYCLE_STYLE, type Lifecycle` from `../../../shared/lifecycle` where used.

- [ ] **Step 6: Check that no copy is left**

```bash
grep -rn "=== 'Persistent NC'\|=== 'Recurring NC'\|=== 'New NC'\|?? 8$\|byLifecycle\['Persistent NC'\] ?? 8" src/renderer
```

Expected: no output.

- [ ] **Step 7: Gate, visual check, commit**

Run the Gate. Then open the dev server (`http://localhost:5173`) and check Overview, NC Intelligence and Network Explorer: Chronic cells are magenta, not green; the movement chart shows six series.

```bash
git add shared/api.ts src/main/services/queryService.ts src/renderer/lib/overviewData.ts tests/renderer/overviewData.test.ts src/renderer/modules/Overview.tsx src/renderer/lib/overviewCharts.ts src/renderer/modules/NcIntelligence.tsx src/renderer/modules/NetworkExplorer.tsx src/renderer/lib/previewApi.ts
git commit -m "fix(ui): every NC screen uses the shared labels and colours

Chronic NC was drawn green like Healthy in Network Explorer; NC
Intelligence showed invented counts when data was missing and called
Recurring cells 'Intermittent'. Movement charts gain Intermittent and
Chronic.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: NC Periods tab in the Targets window

**Files:**
- Create: `src/renderer/lib/ncPeriodsForm.ts`, `src/renderer/components/NcPeriodsPanel.tsx`
- Test: `tests/renderer/ncPeriodsForm.test.ts`
- Modify: `src/renderer/modules/TargetsModal.tsx` (tabs)

**Interfaces:**
- Consumes: `NC_PERIOD_FIELDS`, `NC_PERIOD_KEYS`, `ncPeriodProblem`, `NcPeriodSettings`, `NcPeriodKey` (Task 4); `window.api.rules.get/update`
- Produces:
  - `NC_PERIOD_GROUPS: Array<{ title: string; help: string; keys: NcPeriodKey[] }>`
  - `dailyEquivalent(key: NcPeriodKey, value: number): string | null`
  - `formToSettings(form: Record<NcPeriodKey, string>): { settings: NcPeriodSettings | null; problem: string | null }`
  - `settingsToForm(s: NcPeriodSettings): Record<NcPeriodKey, string>`

- [ ] **Step 1: Write the failing test**

`tests/renderer/ncPeriodsForm.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { NC_PERIOD_GROUPS, dailyEquivalent, formToSettings, settingsToForm } from '../../src/renderer/lib/ncPeriodsForm'
import { NC_PERIOD_KEYS, DEFAULT_NC_PERIODS } from '../../shared/ruleDefaults'

describe('NC Periods form', () => {
  it('shows every setting exactly once', () => {
    const shown = NC_PERIOD_GROUPS.flatMap((g) => g.keys)
    expect([...shown].sort()).toEqual([...NC_PERIOD_KEYS].sort())
  })

  it('states the daily equivalent of week settings', () => {
    expect(dailyEquivalent('chronicWeeks', 7)).toBe('49 days in the daily view')
    expect(dailyEquivalent('chronicMonths', 3)).toBeNull()
    expect(dailyEquivalent('weeklyBreachDays', 1)).toBeNull()
  })

  it('round-trips valid settings and reports the first problem', () => {
    const form = settingsToForm(DEFAULT_NC_PERIODS)
    expect(formToSettings(form)).toEqual({ settings: DEFAULT_NC_PERIODS, problem: null })
    expect(formToSettings({ ...form, persistentWeeks: '7' }).problem).toBe('Persistent must be shorter than Chronic (weeks)')
    expect(formToSettings({ ...form, recoveryWeeks: 'abc' }).problem).toMatch(/Recovering lasts \(weeks\) must be a whole number/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/renderer/ncPeriodsForm.test.ts`
Expected: FAIL, `Failed to resolve import "../../src/renderer/lib/ncPeriodsForm"`.

- [ ] **Step 3: Write `src/renderer/lib/ncPeriodsForm.ts`**

```ts
import {
  NC_PERIOD_FIELDS, NC_PERIOD_KEYS, ncPeriodProblem, type NcPeriodKey, type NcPeriodSettings
} from '../../../shared/ruleDefaults'

/** Form model for the NC Periods tab (spec §5). Validation is the shared
 *  ncPeriodProblem, the same check the main process runs on save. */

export const NC_PERIOD_GROUPS: Array<{ title: string; help: string; keys: NcPeriodKey[] }> = [
  { title: 'When a period is NC', help: 'A day is NC when a core NCA KPI misses its target.', keys: ['weeklyBreachDays', 'monthlyBreachDays'] },
  { title: 'Persistent and Chronic', help: 'NC without a break for this long.', keys: ['persistentWeeks', 'chronicWeeks', 'persistentMonths', 'chronicMonths'] },
  { title: 'Recurring or New', help: 'NC again within this window after a clean spell = Recurring; otherwise New.', keys: ['lookbackWeeks', 'lookbackMonths'] },
  { title: 'Intermittent', help: 'This many separate NC runs inside the window = on and off, never long.', keys: ['intermittentRuns', 'intermittentWindowWeeks', 'intermittentWindowMonths'] },
  { title: 'Recovering, then Healthy', help: 'Clean for this long after the last NC period before it counts as Healthy.', keys: ['recoveryWeeks', 'recoveryMonths'] }
]

export function dailyEquivalent(key: NcPeriodKey, value: number): string | null {
  return NC_PERIOD_FIELDS[key].unit === 'weeks' ? `${value * 7} days in the daily view` : null
}

export function settingsToForm(s: NcPeriodSettings): Record<NcPeriodKey, string> {
  return Object.fromEntries(NC_PERIOD_KEYS.map((k) => [k, String(s[k])])) as Record<NcPeriodKey, string>
}

export function formToSettings(form: Record<NcPeriodKey, string>): { settings: NcPeriodSettings | null; problem: string | null } {
  const settings = Object.fromEntries(
    NC_PERIOD_KEYS.map((k) => [k, form[k].trim() === '' ? Number.NaN : Number(form[k])])
  ) as unknown as NcPeriodSettings
  const problem = ncPeriodProblem(settings)
  return problem ? { settings: null, problem } : { settings, problem: null }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/renderer/ncPeriodsForm.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write `src/renderer/components/NcPeriodsPanel.tsx`**

```tsx
import React, { useEffect, useState } from 'react'
import { emit } from '../store'
import { errMsg } from '../lib/flows'
import { NC_PERIOD_FIELDS, NC_PERIOD_KEYS, type NcPeriodKey } from '../../../shared/ruleDefaults'
import { NC_PERIOD_GROUPS, dailyEquivalent, formToSettings, settingsToForm } from '../lib/ncPeriodsForm'

const input: React.CSSProperties = {
  width: '64px', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: '6px', padding: '6px 8px', fontSize: '12px'
}

export default function NcPeriodsPanel(): React.JSX.Element {
  const [form, setForm] = useState<Record<NcPeriodKey, string> | null>(null)
  const [version, setVersion] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void window.api.rules.get().then((r) => {
      if (!r) return
      setForm(settingsToForm(r))
      setVersion(r.version)
    })
  }, [])

  if (!form) return <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-dim)' }}>Loading NC periods...</div>

  const { problem } = formToSettings(form)

  const save = async (): Promise<void> => {
    const { settings, problem: p } = formToSettings(form)
    if (!settings) {
      setMessage({ ok: false, text: p ?? 'Invalid settings' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const r = await window.api.rules.update(settings)
      setVersion(r.version)
      setForm(settingsToForm(r))
      setMessage({ ok: true, text: `Saved as ruleset v${r.version}. NC periods recalculated.` })
      emit('RULESET_CHANGED')
    } catch (e) {
      setMessage({ ok: false, text: errMsg(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
        Same rules for every technology. Daily values are the week values × 7. Ruleset v{version}.
      </div>
      {NC_PERIOD_GROUPS.map((g) => (
        <div key={g.title} style={{ background: 'var(--bg-3)', padding: '14px 16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text)' }}>{g.title}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', margin: '2px 0 10px' }}>{g.help}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
            {g.keys.map((k) => {
              const fld = NC_PERIOD_FIELDS[k]
              const daily = dailyEquivalent(k, Number(form[k]))
              return (
                <label key={k} style={{ fontSize: '12px', color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span>{fld.label}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="number" min={fld.min} max={fld.max} step={1} value={form[k]} style={input}
                      onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                    />
                    <span style={{ color: 'var(--text-dim)' }}>{fld.unit}</span>
                  </span>
                  {daily && Number.isFinite(Number(form[k])) && (
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>= {daily}</span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      ))}
      {(problem || message) && (
        <div style={{
          padding: '10px 12px', borderRadius: '8px', fontSize: '12px',
          color: problem || (message && !message.ok) ? '#f87171' : '#34d399',
          background: problem || (message && !message.ok) ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)'
        }}>
          {problem ?? message?.text}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => void save()} disabled={saving || problem != null}
          style={{ padding: '10px 24px', background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 800, cursor: problem ? 'not-allowed' : 'pointer', opacity: problem ? 0.5 : 1 }}
        >
          {saving ? 'Recalculating...' : 'Save NC Periods'}
        </button>
      </div>
    </div>
  )
}

void NC_PERIOD_KEYS
```

Remove the trailing `void NC_PERIOD_KEYS` line and the `NC_PERIOD_KEYS` import if the typecheck reports it unused. Check `errMsg` is exported from `../lib/flows` (the Targets window already imports it from there).

- [ ] **Step 6: Add the tabs to `src/renderer/modules/TargetsModal.tsx`**

Add `import NcPeriodsPanel from '../components/NcPeriodsPanel'` and `const [tab, setTab] = useState<'targets' | 'periods'>('targets')`. Directly under the header row (before `{/* Tech Pills */}`), insert:

```tsx
        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', background: 'var(--bg-3)', padding: '4px', borderRadius: '10px', width: 'fit-content' }}>
          {([['targets', 'KPI Targets'], ['periods', 'NC Periods']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: '6px 16px', fontSize: '12px', fontWeight: 800, borderRadius: '8px', border: 'none', cursor: 'pointer',
              background: tab === id ? 'linear-gradient(135deg, #0284c7, #38bdf8)' : 'transparent',
              color: tab === id ? '#ffffff' : 'var(--text-dim)'
            }}>{label}</button>
          ))}
        </div>
```

Wrap the existing tech pills, messages, form list and footer buttons in `{tab === 'targets' ? (<>…</>) : (<NcPeriodsPanel />)}`, keeping the Close button visible in both tabs (move it out of the wrapped footer into its own row if needed).

- [ ] **Step 7: Gate, visual check, commit**

Run the Gate. In the dev server open **Targets → NC Periods**: the five groups show; setting Persistent weeks to 7 shows "Persistent must be shorter than Chronic (weeks)" and disables Save; setting Recovering to 4 weeks and saving shows "Saved as ruleset vN".

```bash
git add src/renderer/lib/ncPeriodsForm.ts src/renderer/components/NcPeriodsPanel.tsx tests/renderer/ncPeriodsForm.test.ts src/renderer/modules/TargetsModal.tsx
git commit -m "feat(ui): NC Periods tab in the Targets window

Every NC-period number is editable with the same validation as the main
process; each save is a new ruleset version and recalculates.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Close-out

**Files:**
- Modify: `docs/superpowers/specs/2026-09-29-nc-lifecycle-design.md` (Status line)
- Modify: memory `qos-v2-remediation-plan.md`

- [ ] **Step 1: Spec coverage check**

For each spec item, name the commit that delivers it: §3 labels (Task 7), §4 roll-up (Task 7), §5 settings (Tasks 4, 9), §6 consumers (Tasks 2, 4, 5, 7, 8), §7 tests 1–8 (Tasks 4, 7), §8.2 A1–A2 (Task 3), A3–A6, A8 (Task 5), A7 (Task 1), §8.3 B1 (Task 2), B2 (Task 7), B3 (Task 4), B4 (Task 8), B5 (Task 5), §8.4 C1 (Task 1), C2 (Tasks 4, 5), §8.5 (Tasks 5, 6), §8.6 tests 9–13 (Tasks 2, 5, 6). Any gap is a new task, not a note.

- [ ] **Step 2: Final full gate on a clean tree**

```bash
git status --short
```

Expected: only `.preview/vite.config.ts`, the two Huawei `.txt` files and `.claude/` (all left uncommitted on purpose). Then run the Gate.

- [ ] **Step 3: Mark the spec implemented and update memory**

Change the spec's `**Status**: Draft, awaiting review` to `**Status**: Implemented (2026-09-30)`. In the memory file `qos-v2-remediation-plan.md`, record under Phase 1 that NC periods and the single source of truth for targets are done, and that existing workspaces need **Data Manager → Maintenance → Rebuild Intelligence** once to relabel history.

```bash
git add docs/superpowers/specs/2026-09-29-nc-lifecycle-design.md
git commit -m "docs(nc): NC periods spec implemented

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
