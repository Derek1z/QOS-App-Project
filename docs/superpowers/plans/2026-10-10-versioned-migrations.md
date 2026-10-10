# Versioned Workspace Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One integer schema version per workspace and an ordered migration list: older workspaces upgrade once, in order, after a backup; a workspace saved by a newer app opens read-only.

**Architecture:** A small migration engine (`runMigrations`) takes the list, the starting version, a backup callback and a recompute callback, so it is tested with injected lists. The real list moves today's upgrade steps into seven numbered migrations. `manager.ts` reads the version on open and either migrates, shims (read-only), or downgrades to read-only for newer files.

**Tech Stack:** TypeScript, DuckDB (`@duckdb/node-api`), Electron main process, vitest with real DuckDB (`tests/helpers/realWorkspace.ts`).

**Spec:** `docs/superpowers/specs/2026-10-10-versioned-migrations-design.md` (approved 2026-10-10).

## Global Constraints

- Branch `v2`, local commits; push only when the user asks. Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never stage `.preview/vite.config.ts`, the Huawei `.txt` files, `.claude/`, `.superpowers/`.
- Gate per commit: `npm run typecheck`, `npx vitest run`, `npm run smoke`; then `cp .superpowers/app_state.original.json app_state.json` and delete `/tmp/qos-smoke-*`, `/tmp/qos-userdata-*`.
- `schema_version` is a decimal integer string; anything else (incl. `'1.0.0'`, missing) reads as `0`.
- Backup file name: `backups/<name>-before-v<LATEST>-<YYYYMMDD-HHmmss>.qosdb`.
- Failure message, verbatim: `Upgrading this workspace failed at step <version> (<name>). A copy from before the upgrade is in <backup path>.`
- Newer-version notice, verbatim: `Saved by a newer version of the app — opened read-only. Update the app to edit it.`
- Pending-recompute flag: `workspace_meta` key `recompute_pending` (written when a step asks for the recompute, deleted after the recompute succeeds).
- Migration names, verbatim, v1–v7: `Schema catch-up`, `Targets owned by kpi_defs`, `Derived-KPI tables`, `Merge duplicate dimensions`, `NC periods relabel`, `Technology correction`, `Extra-KPI technology clean-up`.

**Plan ruling (refines spec §4.1, to confirm at handoff):** a migration's `up` returns `true` when it changed data that needs the recompute, instead of a static `recompute` flag; the four recompute steps (v4–v7) keep reading their legacy marker (`nc_periods` current value, `tech_checked`, `extra_tech_cleaned`; `targets_owner` for v2) as "already done" and never write markers. A legacy workspace whose markers show every effect present then upgrades without a full recompute.

## Review Focus

1. **A newer workspace** must not be touched at all — no backup written into it, no meta row changed. Test in Task 3 (file bytes unchanged after a writable open).
2. **The backup cannot be written** (disk full, backups folder unwritable): no migration may run and the error must say the backup failed. Test in Task 1 (backup callback throws → no `up` called, error mentions the backup).
3. **A legacy workspace whose markers show every effect already done** must not pay for a full recompute. Test in Task 2.
4. **A legacy workspace opened read-only** (version 0, no `period_coverage`) must still show weekly/monthly screens. Test in Task 2 (adapted `readOnlyPeriodCoverage`).
5. **Restoring an older snapshot** must upgrade it on the next open. Test in Task 2 (adapted `snapshotLegacy`, version 0 snapshot).

---

### Task 1: Migration engine

**Files:**
- Create: `src/main/workspace/migrations.ts` (engine part)
- Test: `tests/workspace/migrationEngine.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Migration {
    version: number
    name: string
    up(conn: DuckDBConnection): Promise<boolean | void>      // true → needs the recompute
    readOnlyShim?(conn: DuckDBConnection): Promise<void>
  }
  export function parseSchemaVersion(value: unknown): number   // non-negative integer string → number; else 0
  export async function readSchemaVersion(conn: DuckDBConnection): Promise<number>
  export async function runMigrations(
    conn: DuckDBConnection, list: Migration[], from: number,
    opts: { backup(): Promise<string>; recompute(conn: DuckDBConnection): Promise<void> }
  ): Promise<{ ran: number[]; backupPath: string | null; recomputed: boolean }>
  export async function runReadOnlyShims(conn: DuckDBConnection, list: Migration[], from: number): Promise<void>
  ```

- [ ] **Step 1: Failing tests** (an in-memory DuckDB with a `workspace_meta (key VARCHAR PRIMARY KEY, value VARCHAR)` table; fake migrations that append to an array):
  - `parseSchemaVersion`: `'7'`→7, `'0'`→0, `'1.0.0'`→0, `null`→0, `'-1'`→0, `'abc'`→0.
  - Nothing pending (`from` = last version): no backup call, no `up`, `{ ran: [], backupPath: null, recomputed: false }`.
  - From 0 with steps 1–3 (none request recompute): backup called once before the first `up`; `ran` = [1,2,3]; `schema_version` = `'3'`.
  - Steps 1–4 where 2 and 3 return `true`: `recompute` called exactly once, after step 4; `schema_version` reads `'1'` while step 3 runs (versions held), `'4'` at the end.
  - Step 2 throws `boom`: the result rejects with ``Upgrading this workspace failed at step 2 (<name>). A copy from before the upgrade is in <path>.``, step 3 never runs, `schema_version` = `'1'`.
  - Backup throws (Review Focus 2): no `up` runs; the error message contains `backup`.
  - Interrupted recompute: steps 1–2 with step 2 returning `true` and `recompute` throwing once → rejects; `recompute_pending` is present and `schema_version` is `'1'`. A second run where step 2 now returns `false` (its effect is already in place) still calls `recompute` once, deletes `recompute_pending` and ends at `'2'`.
  - `recompute_pending` present with nothing pending (`from` = last version): `recompute` is called once (no backup), and the flag is deleted.
  - `runReadOnlyShims(conn, list, 1)` calls the shims of steps 2+ only and writes nothing.
- [ ] **Step 2: Run** `npx vitest run tests/workspace/migrationEngine.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement.** Each `schema_version` write is an upsert on `workspace_meta`.
  - When a step returns `true`, upsert `recompute_pending` (its version) before moving on.
  - While a recompute is outstanding (requested in this run, or `recompute_pending` found at the start), versions are not written.
  - After the last step, recompute; then delete `recompute_pending` and write the last version.
  - If `recompute` throws, rethrow with the same failure message, naming the last migration that asked for it. The flag stays, so the next run recomputes even when every step reports "no change".
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Gate and commit** — `feat(workspace): migration engine with one schema version`.

### Task 2: The migration list, wired into open and create

**Files:**
- Modify: `src/main/workspace/migrations.ts` (add `MIGRATIONS`, `LATEST`), `src/main/workspace/manager.ts`, `src/main/workspace/migrateTargets.ts` (no marker write), `src/main/services/maintenanceService.ts` (export `backupOpenDatabase(conn, dest): Promise<void>`, today's `backupTo`), `tests/helpers/realWorkspace.ts` (`setSchemaVersion(conn, v)`)
- Modify tests: `relabelOnOpen`, `techCorrection`, `techCorrectionInterrupted`, `extraTechCleanInterrupted`, `tests/import/extraMetricsTech`, `migrateTargets`, `readOnlyPeriodCoverage`, `snapshotLegacy`, `technologyNeverRewritten`
- Test: `tests/workspace/migrations.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `export const MIGRATIONS: Migration[]`, `export const LATEST: number` (= 7); `setSchemaVersion(conn: DuckDBConnection, v: number | string): Promise<void>` in the test helper.

- [ ] **Step 1: Failing tests** in `migrations.test.ts`:
  - `MIGRATIONS` versions are 1…7 contiguous, names equal the Global Constraints list, `LATEST === 7`.
  - A new workspace: `schema_version` is `'7'`, `backups/` has no file, and none of the old markers was written.
  - A legacy workspace: create one, then `setSchemaVersion(conn, '1.0.0')`, delete the four markers, and add a duplicate district (so v4 and v5 request the recompute). On the first writable reopen:
    - `schema_version` is `'7'`
    - exactly one file matches `backups/test-before-v7-*.qosdb`
    - the recompute ran once (spy on `recomputeAllAggregates` with `vi.mock`, counting calls)

    A second reopen makes no new backup and no recompute call.
  - Markers present (Review Focus 3): a legacy workspace with all four markers at their current values and no duplicates upgrades to `'7'` with zero recompute calls.
  - Schema parity: a new workspace's `information_schema.columns` (`table_name`, `column_name`, `data_type`) and `information_schema.tables` equal those of the same workspace after `setSchemaVersion(conn, '0')` and a writable reopen.
- [ ] **Step 2: Adapt the existing tests** to simulate old workspaces with `setSchemaVersion(conn, <step − 1>)` instead of deleting markers, and assert `schema_version` instead of marker values:

  | Test | Version to set |
  |---|---|
  | `relabelOnOpen` | 4 (the "earlier month rule" case also keeps the `nc_periods = '2026-09-30'` marker, which v5 must treat as not done) |
  | `techCorrection` | 5 |
  | `techCorrectionInterrupted` | 5 |
  | `extraTechCleanInterrupted` | 6 |
  | `extraMetricsTech` | 6 |
  | `migrateTargets` | 1 |
  | `readOnlyPeriodCoverage` | 0 (Review Focus 4) |
  | `snapshotLegacy` | 0 on the snapshot (Review Focus 5) |

  `technologyNeverRewritten`'s expected writers become `['workspace/manager.ts:createWorkspaceNow', 'workspace/migrations.ts:<v6 function name>']`.

  Run → the new tests and the adapted ones FAIL (no list yet; markers still drive the old path).
- [ ] **Step 3: Implement.**
  - `MIGRATIONS` v1–v7 per spec §4.1, moving the bodies of `ensureUpgradeSchema` (without the lifecycle backfill; `readOnlyShim` = the `period_coverage` temp view), `migrateLegacyTargets`, `ensureDerivedKpiSchema`, `repairDuplicateDimensions` (returns true when it merged anything), the lifecycle backfill plus the `nc_periods` check (true unless the marker equals today's `NC_PERIODS_MARKER`), and the bodies of `correctTechnologyOnce` and `cleanExtraMetricsTechOnce` (each true when it changed data; each skips when its legacy marker is present). No migration writes a marker.
  - `openWorkspaceNow` (writable):
    - read the version
    - if `v > LATEST`, hand over to Task 3's path (until Task 3 lands, treat it like `LATEST`)
    - call `runMigrations` with a backup into `backupsDir()` under the Global Constraints name, and recompute = `recomputeAllAggregates` + `refreshAllIntelligence`
    - then the KPI catalogue sync (`seedKpiDefs` ×3)
  - `openWorkspaceNow` (read-only): `runReadOnlyShims(conn, MIGRATIONS, v)`.
  - `createWorkspaceNow`: stamp `schema_version = String(LATEST)`; drop the `nc_periods` / `tech_checked` / `extra_tech_cleaned` rows from the creation insert.
  - Delete the now-unused `ensureUpgradeSchema`, `correctTechnologyOnce` and `cleanExtraMetricsTechOnce` from `manager.ts`.
- [ ] **Step 4: Run** `npx vitest run tests/workspace tests/import/extraMetricsTech.test.ts` → PASS; then `npm run smoke` → `Smoke test completed successfully`.
- [ ] **Step 5: Gate and commit** — `feat(workspace): upgrades run as numbered migrations, once, after a backup`.

### Task 3: Newer workspaces open read-only

**Files:**
- Modify: `src/main/workspace/manager.ts`, `shared/api.ts` (`WorkspaceInfo.readOnlyReason?: 'newerVersion'`), `src/renderer/shell/CommandBar.tsx` (badge title and the notice), `src/renderer/lib/previewApi.ts` (`schemaVersion: '7'`)
- Test: `tests/workspace/newerVersion.test.ts`

**Interfaces:**
- Consumes: `readSchemaVersion`, `LATEST` (Tasks 1–2).
- Produces: `WorkspaceInfo.readOnlyReason?: 'newerVersion'`.

- [ ] **Step 1: Failing tests.**
  - Create a workspace, `setSchemaVersion(conn, 8)`, close it, then record the file's SHA-256 and `backups/` listing.
  - `openWorkspace(path)` (writable) resolves with `readOnly: true` and `readOnlyReason: 'newerVersion'`.
  - After closing, the SHA-256 and the `backups/` listing are unchanged (Review Focus 1).
  - `openWorkspace(path, { readOnly: true })` also reports `readOnlyReason: 'newerVersion'`.
- [ ] **Step 2: Run** → FAIL (it opens writable and treats 8 as current).
- [ ] **Step 3: Implement.** In `openWorkspaceNow`, read the version before any write. If it is above `LATEST`, close the writable handle, release the lock, and reopen read-only through the existing read-only path, setting `readOnlyReason`. For the renderer, the READ ONLY badge gets `title` = the notice, and the notice shows as an info line in the top bar when `readOnlyReason === 'newerVersion'` (verbatim copy, Global Constraints).
- [ ] **Step 4: Run** → PASS. Then a browser-preview check: set the demo `info()` to return `readOnly: true, readOnlyReason: 'newerVersion'` from the console and confirm the badge tooltip and the notice show.
- [ ] **Step 5: Gate and commit** — `feat(workspace): a workspace saved by a newer app opens read-only`.

### Task 4: Docs

- [ ] README "Workspaces and data safety": upgrades run once per workspace after a backup; a workspace saved by a newer version opens read-only. Add the future-change rule (spec §4.7) as the header comment of `migrations.ts` if not already there. Set the spec's Status to Implemented. Gate, then commit `docs(workspace): versioned upgrades`.

---

## Spec coverage

| Spec | Task |
|---|---|
| §4.1 list, §4.7 rule | 2 (list), 4 (rule comment) |
| §4.2 version | 1 |
| §4.3 writable open, backup, failure | 1 (engine), 2 (wiring) |
| §4.4 read-only, shims | 1 (shims), 2 (wiring), 3 (newer) |
| §4.5 new workspaces | 2 |
| §4.6 user-visible | 3 |
| §6 tests 1–9 | 1 (4, 6 partly), 2 (1, 2, 5, 6, 7, 8, 9), 3 (3) |
