# Versioned Workspace Migrations Design

**Date**: 2026-10-10
**Status**: Draft for review
**Scope**: one integer schema version per workspace and an ordered migration list, replacing the checks and once-on-open markers that run on every writable open; protection for workspaces saved by a newer app (Phase 2 of the remediation plan)

---

## 1. Goal

Workspace files are copied between colleagues who may run different versions of the exe (decided 2026-10-10). Every upgrade must run exactly once, in order, after a backup; and an older app must never write to a workspace a newer app has already upgraded.

## 2. What happens today

Every writable open (`openWorkspaceNow` in `src/main/workspace/manager.ts`) runs, in this order:

| Step | Where | Kind |
|---|---|---|
| `ensureUpgradeSchema`: ~20 `CREATE … IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, `cell_forecasts` dropped when old-shaped, views `agg_cell_daily` / `agg_cell_kpi_daily` rebuilt, daily/monthly NC lifecycle backfilled when empty | `manager.ts` | idempotent check, every open |
| `seedKpiDefs` 2G / 3G / 4G (`INSERT … ON CONFLICT DO UPDATE`) | `services/kpiService.ts` | catalogue sync, every open |
| `migrateLegacyTargets` | `workspace/migrateTargets.ts` | once, marker `targets_owner` |
| NC periods relabel → recompute | `manager.ts` | once, marker `nc_periods` |
| `correctTechnologyOnce` → recompute | `manager.ts` | once, marker `tech_checked` |
| `cleanExtraMetricsTechOnce` → recompute | `manager.ts` | once, marker `extra_tech_cleaned` |
| `ensureDerivedKpiSchema` | `services/derivedKpiService.ts` | idempotent check, every open |
| `repairDuplicateDimensions` (best-effort) | `services/dimRepair.ts` | check, every open |

Read-only opens write nothing; a temporary `period_coverage` view stands in when that table is missing.

`workspace_meta.schema_version` has held the string `'1.0.0'` since the first release; `describe()` only checks that it is present. No code compares versions, so nothing stops an older app from opening and writing a newer workspace.

## 3. Decisions (2026-10-10)

| Topic | Decision |
|---|---|
| How workspaces move | Copied between colleagues, possibly on different app versions |
| Approach | Numbered migrations with one integer schema version (approach A) |
| Newer workspace in an older app | Opened read-only, with a notice to update the app |

## 4. Behaviour

### 4.1 The migration list — `src/main/workspace/migrations.ts`
```ts
export interface Migration {
  version: number          // 1, 2, 3 … contiguous
  name: string             // unique, shown in errors
  recompute?: boolean      // needs one aggregates + intelligence recompute after it
  readOnlyShim?: (conn) => Promise<void>   // temp views a read-only open needs when the workspace is older than this step
  up: (conn) => Promise<void>
}
export const MIGRATIONS: Migration[]
export const LATEST: number   // MIGRATIONS.at(-1).version
```

Initial list (today's steps moved as they are; each is safe on a workspace that already has its effect):

| v | Name | `recompute` | Body |
|---|---|---|---|
| 1 | Schema catch-up | — | today's `ensureUpgradeSchema` without the lifecycle backfill; `readOnlyShim` = the `period_coverage` temp view |
| 2 | Targets owned by kpi_defs | — | `migrateLegacyTargets` |
| 3 | Derived-KPI tables | — | `ensureDerivedKpiSchema` |
| 4 | Merge duplicate dimensions | yes | `repairDuplicateDimensions` |
| 5 | NC periods relabel | yes | the lifecycle backfill (nothing else: the recompute relabels) |
| 6 | Technology correction | yes | `correctTechnologyOnce`'s body (infer, set technology) |
| 7 | Extra-KPI technology clean-up | yes | `cleanExtraMetricsTechOnce`'s body |

The old markers (`targets_owner`, `nc_periods`, `tech_checked`, `extra_tech_cleaned`) are no longer read or written; existing rows stay harmlessly.

### 4.2 Version
- Stored as `workspace_meta.schema_version`, a decimal integer string (`'7'`).
- Read: a value that parses as a non-negative integer is that version; anything else (including `'1.0.0'` and a missing row) is `0`.
- `describe()` keeps rejecting a file with no `workspace_meta` row at all (not a workspace).

### 4.3 Writable open
1. Read the version `v`.
2. `v > LATEST` → close and reopen the file read-only (§4.4) with `readOnlyReason: 'newerVersion'`. Nothing is written.
3. `v < LATEST` → back up the open database to `backups/<name>-before-v<LATEST>-<YYYYMMDD-HHmmss>.qosdb` (the existing `COPY FROM DATABASE` backup, shared from `maintenanceService.ts`), then run every migration with `version > v` in order:
   - a migration without `recompute`: run `up`, then set `schema_version` to its version;
   - a migration with `recompute`: run `up` and hold its version.
   After the last pending migration, if any held a version, run `recomputeAllAggregates` + `refreshAllIntelligence` once, then set `schema_version` to `LATEST`. So an interrupted run repeats the steps whose recompute did not finish.
4. Every open: the KPI catalogue sync (`seedKpiDefs` 2G/3G/4G), as today.
5. A migration that throws stops the open: the error says `Upgrading this workspace failed at step <version> (<name>). A copy from before the upgrade is in <backup path>.` Later steps do not run; `schema_version` stays at the last recorded step.

`runMigrations(conn, list, from, opts)` is exported with the list as a parameter so tests can inject a failing list.

### 4.4 Read-only open
- `v < LATEST`: no writes; run the `readOnlyShim` of every migration with `version > v`.
- `v > LATEST`: open normally read-only; `WorkspaceInfo.readOnlyReason = 'newerVersion'`.
- Otherwise as today.

### 4.5 New workspaces
`createWorkspace` builds the full schema (`SCHEMA_SQL`) and stamps `schema_version = String(LATEST)`. No migration runs and no backup is made. The old markers are no longer written at creation.

### 4.6 What the user sees
- Opening an older workspace: nothing new (a backup appears in `backups/`).
- Opening a newer workspace: it opens read-only; the top bar's READ ONLY badge carries the reason and a notice reads `Saved by a newer version of the app — opened read-only. Update the app to edit it.`
- A failed upgrade: the §4.3 error.

`WorkspaceInfo` gains `readOnlyReason?: 'newerVersion'`. `schemaVersion` stays a string (now the integer as text).

### 4.7 Rule for future schema changes
Stated at the top of `migrations.ts`:
- Change `SCHEMA_SQL` (new workspaces) **and** append migration `LATEST + 1` (existing workspaces).
- Never edit or reorder a migration that has shipped.
The parity test (§6 item 7) fails when only one side changes.

## 5. Consumers

| Where | Change |
|---|---|
| `src/main/workspace/migrations.ts` (new) | §4.1, `readSchemaVersion`, `runMigrations` |
| `src/main/workspace/manager.ts` | open/create per §4.3–§4.5; `ensureUpgradeSchema`, `correctTechnologyOnce`, `cleanExtraMetricsTechOnce` move into migrations |
| `src/main/services/maintenanceService.ts` | export the open-database backup |
| `shared/api.ts` | `WorkspaceInfo.readOnlyReason?` |
| `src/renderer/shell/CommandBar.tsx` (and the read-only badge) | the §4.6 notice |
| `src/renderer/lib/previewApi.ts` | `schemaVersion` as an integer string |
| tests that simulate old workspaces by deleting markers | set `schema_version` to just before their step instead |
| `README.md` | upgrades and the newer-version rule |

## 6. Testing
Real DuckDB, written before the code.

1. A new workspace has `schema_version = LATEST`; no backup file; no migration ran.
2. A legacy workspace (`schema_version '1.0.0'`): the first writable open ends at `LATEST`, writes exactly one backup, runs the recompute once although several steps request it; a second open writes no backup and runs nothing.
3. A newer workspace (`LATEST + 1`): a writable open returns `readOnly: true`, `readOnlyReason: 'newerVersion'`, and the file's bytes are unchanged.
4. A failing migration (injected list through `runMigrations`): the open rejects with the step's version and name and the backup path; `schema_version` stays at the last good step; the backup exists.
5. An interrupted recompute re-runs the recompute steps on the next open (the existing interrupted-correction tests, adapted).
6. `MIGRATIONS` versions are 1…N contiguous and names unique; `LATEST` equals the last version.
7. Schema parity: a new workspace, and the same workspace reset to version 0 and reopened writable, have identical tables, columns and views (`information_schema`).
8. Existing tests for the moved steps (`relabelOnOpen`, `techCorrection`, `techCorrectionInterrupted`, `extraMetricsTech`, `extraTechCleanInterrupted`, `migrateTargets`, `readOnlyPeriodCoverage`) pass after switching from deleting markers to setting `schema_version`.
   `technologyNeverRewritten`'s source scan names the allowed writers; the one-time correction's writer moves from `manager.ts:correctTechnologyOnce` to the v6 migration in `migrations.ts`, and the expected list changes accordingly (still exactly two writers: creation and the correction).
9. Smoke: the full suite passes; gate `typecheck && vitest && smoke`.

## 7. Out of scope
- Moving the remaining `previewApi` mock tests onto real databases (the next Phase 2 item).
- Downgrading a workspace to an older version.
