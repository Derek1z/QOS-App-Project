# Fixed Workspace Technology Design

**Date**: 2026-10-08
**Status**: Implemented (2026-10-08)
**Scope**: a workspace's technology is set at creation and never rewritten; the 2G/3G/4G buttons move between workspaces; imports check that a file's technology matches the workspace

---

## 1. Goal

Each workspace holds one technology (decided 2026-10-08: the user keeps one `.qosdb` per technology). The technology of a workspace must always agree with the data in it, so NC flags, aggregates and every screen stay consistent.

## 2. What happens today

| Behaviour | Where | Effect |
|---|---|---|
| The 2G/3G/4G buttons rewrite `workspace_meta.technology` | `setWorkspaceTechnology` (`workspace/manager.ts`), IPC `workspace:setTechnology`, `store.setTechnologyId` / `setSelectedTech`, `CommandBar`, `CommandPalette`, per-screen technology tabs | The same data is reinterpreted as another technology |
| NC depends on the workspace technology | `analytics/ncRule.ts` (`WORKSPACE_TECH_SQL`: the PRB column counts only in a 4G workspace) and 12 `workspaceTechnology()` call sites | `is_nc` and aggregates are computed at import time, so after a switch they disagree with the new setting until the next full recompute |
| Imports do not compare technologies | `importer.analyzeFiles` reports `detectedTechnology`; nothing acts on it | A 3G file can be imported into a 4G workspace |
| Recent workspaces have no technology | `RecentWorkspace { path, name, lastOpened }` | The app cannot find "your 3G workspace" |

## 3. Decisions (2026-10-08)

| Topic | Decision |
|---|---|
| Workspaces | One technology per workspace; mixed workspaces are out of scope |
| 2G/3G/4G buttons | Jump to the most recent workspace of that technology, or offer to create one |
| Import of another technology's file | Stopped, with "open/create the right workspace" or "Import anyway" |

## 4. Behaviour

### 4.1 Technology is fixed
- Set when the workspace is created (the existing create dialog's technology field).
- Nothing writes `workspace_meta.technology` afterwards except the one-time correction in §4.4. `setWorkspaceTechnology`, the `workspace:setTechnology` IPC channel and preload method, and the store's write-through are removed.

### 4.2 The 2G/3G/4G buttons
Everywhere they appear (top bar, command palette, and the screens with their own technology tabs: Overview, NC & Breach Analytics, Smart Priority Queue, Forecasting, Cell Investigation, Cell Intelligence, Network Explorer, Health Matrix, Performance Analysis, Comparison Lab). KPI Definitions and Targets are the exception: their tabs choose which technology's catalogue to edit and stay local (ruling 2026-10-08):
1. The open workspace's technology: nothing happens.
2. Another technology: open the most recently used workspace of that technology whose file still exists.
3. None: "No 3G workspace yet — create one?" → the create dialog with 3G preselected; cancelling stays put.

A screen's technology tabs show the open workspace's technology as selected; they never change what the current workspace is.

### 4.3 Recent workspaces remember their technology
`RecentWorkspace` gains `technology?: Technology`, written whenever a workspace is opened or created. Entries without it (written before this change) are skipped by §4.2 until they are opened once.

### 4.4 One-time correction of older workspaces
On the first writable open after this change (once-on-open marker, `workspace_meta` key `tech_checked`):
- Count imported KPI rows (`fact_extra_metrics`) by the technology of their KPI (`kpi_defs.technology`).
- If one technology holds ≥ 90% of those rows and it differs from `workspace_meta.technology`: set it, then recompute aggregates and intelligence once (the existing `recomputeAllAggregates` + `refreshAllIntelligence` path).
- No KPI rows, or no technology at ≥ 90%: keep the stored technology.
- Read-only opens never correct; they show the stored technology.

### 4.5 Import technology check
In the Data Manager, after a file is analysed:
- `detectedTechnology` present and different from the workspace's → the file's import is blocked with: **"This file looks like 3G; this is a 4G workspace."** and two buttons:
  - **Open the 3G workspace** (or **Create a 3G workspace** when none exists): switches as in §4.2, then analyses the same file there.
  - **Import anyway**: lifts the block for that file only.
- `detectedTechnology` absent (detection unsure) → no block.

## 5. Consumers

| Where | Change |
|---|---|
| `workspace/manager.ts` | remove `setWorkspaceTechnology`; `tech_checked` correction in the writable-open path; `touchRecent` with technology |
| `services/appState.ts`, `shared/api.ts` | `RecentWorkspace.technology?` |
| `ipc.ts`, `preload/index.ts`, `shared/api.ts` (`Api.workspace`) | remove `setTechnology` |
| `renderer/store.ts` | `setTechnologyId` / `setSelectedTech` no longer call the backend; the selected technology always equals the open workspace's |
| `renderer/lib/flows.ts` | `switchTechnologyFlow(tech)`: §4.2 |
| `CommandBar`, `CommandPalette`, the screens listed in §4.2 | call `switchTechnologyFlow` |
| `CreateWorkspaceModal` | accept a preselected technology |
| `DataManager` | §4.5 block and actions |
| `renderer/lib/previewApi.ts` | three demo workspaces (2G, 3G, 4G) so the browser preview can still show each technology |
| `smoke.ts` | the 2G section runs in its own 2G workspace instead of switching the 4G one; `kpiTechSwitch` becomes "open the other technology's workspace" |

## 6. Testing
Written before the code.

1. Real DuckDB: after creation, no service or IPC path changes `workspace_meta.technology` (the setter no longer exists; opening, importing and saving targets leave it unchanged).
2. Correction: a workspace stored as 4G whose KPI rows are 95% 3G is corrected to 3G on first writable open, its aggregates are recomputed, and the marker is set; opening again does nothing.
3. Correction does nothing for: no KPI rows; a 60/40 split; a read-only open.
4. `touchRecent` records the technology; entries without it are skipped by the chooser.
5. Chooser (renderer helper): picks the most recent existing workspace of the technology; skips missing files and the current workspace; returns none when there is no match.
6. Import mismatch decision (renderer helper): blocks only when detected and different; "Import anyway" lifts it for that file.
7. Smoke: the 2G section passes in its own workspace; switching technology opens the other workspace.

Gate: `typecheck && vitest && smoke` for every commit, with `app_state.json` restored from `.superpowers/app_state.original.json` afterwards.

## 7. Out of scope
- Mixed-technology workspaces and per-cell technology.
- Changing a workspace's technology after creation (create a new workspace instead).
