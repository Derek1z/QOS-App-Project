# Fixed Workspace Technology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A workspace's technology is set at creation and never rewritten; the 2G/3G/4G buttons move between workspaces; imports of another technology's file are stopped with a way forward.

**Architecture:** The backend loses its technology setter and gains a finder for the most recent workspace of a technology plus a once-on-open correction for workspaces switched in the past. The renderer store's technology setters become a "switch workspace" flow. The Data Manager compares the analysed file's detected technology with the workspace's.

**Tech Stack:** Electron, React 19, TypeScript, DuckDB, vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-fixed-workspace-technology-design.md` (approved 2026-10-08).

## Global Constraints

- Branch `v2`, local commits only (the user pushes). Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never stage `.preview/vite.config.ts`, the Huawei `.txt` files, `.claude/`, `.superpowers/`.
- Gate per commit: `npm run typecheck`, `npx vitest run`, `npm run smoke`; then `cp .superpowers/app_state.original.json app_state.json` and delete `/tmp/qos-smoke-*`, `/tmp/qos-userdata-*`.
- Dates in UI DD/MM/YYYY.
- Correction threshold: one technology holds ≥ 90% of `fact_extra_metrics` rows. Marker key: `tech_checked`.
- Exact copy: `No <T> workspace yet — create one?`; `This file looks like <T>; this is a <W> workspace.`; buttons `Open the <T> workspace`, `Create a <T> workspace`, `Import anyway`.

## Review Focus

1. **Switch cancelled.** User clicks 3G, then cancels the create prompt. Expected: every screen still shows the open workspace's technology (no tab left on 3G). Test in Task 3.
2. **Recent entry whose file was deleted.** Expected: skipped; the next most recent existing one is opened, or the create prompt. Test in Task 1.
3. **Read-only workspace open.** Expected: no correction, no write, stored technology shown. Test in Task 2.
4. **Import detection unsure.** `detectedTechnology` null. Expected: no block. Test in Task 4.
5. **Switching while a background forecast job runs.** Expected: closing the workspace cancels it (existing hook), the other workspace opens. Covered by the existing scheduler tests; checked again in Task 3's preview run.

---

### Task 1: Backend — no setter; recent workspaces know their technology

**Files:**
- Modify: `src/main/workspace/manager.ts` (remove `setWorkspaceTechnology`; pass technology to `touchRecent` on open and create), `src/main/services/appState.ts` (`touchRecent(path, name, technology?)`, `findRecentWorkspace`), `shared/api.ts` (`RecentWorkspace.technology?`, `Api.workspace`: remove `setTechnology`, add `findRecent(technology: Technology, excludePath?: string): Promise<string | null>`), `src/main/ipc.ts` (remove `workspace:setTechnology`, add `workspace:findRecent`), `src/preload/index.ts`, `src/renderer/lib/previewApi.ts` (stub `findRecent`; `setTechnology` removed — see Task 3 for the demo workspaces), `tests/preload/ipcForwarding.test.ts` if it lists channels, `src/main/smoke.ts` (the 2G section, §5)
- Test: `tests/workspace/recentTechnology.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // appState.ts
  export function touchRecent(path: string, name: string, technology?: Technology): void
  export function findRecentWorkspace(technology: Technology, excludePath: string | undefined,
    recent: RecentWorkspace[], exists: (p: string) => boolean): string | null  // pure
  ```

- [ ] **Step 1: Failing tests** — `findRecentWorkspace`: picks the first (most recent) entry with the technology whose file exists; skips `excludePath`; skips entries without `technology`; skips missing files (Review Focus 2); returns null when none. `touchRecent` writes `technology` (real `appState` in a temp `PORTABLE_EXECUTABLE_DIR`). Real DuckDB: open and create record the workspace's technology in the recent list.
- [ ] **Step 2: Run, verify failure.**
- [ ] **Step 3: Implement**, remove the setter and its IPC/preload/API.
- [ ] **Step 4: Smoke.** The 2G section (27d2–27e) creates its own 2G workspace in the smoke temp folder, imports the 2G KPI file there, runs the same checks (TCH value and breach, tech-aware NC, KPI overview, profile memory, priority kpiBreach), then closes it and reopens the main 4G workspace by path; the later "back to 4G" step becomes that reopen. `kpiTechSwitch` asserts the 2G workspace's info reports 2G and the reopened one 4G.
- [ ] **Step 5: Gate and commit** — `feat(tech): a workspace's technology is fixed; recent workspaces remember theirs`.

### Task 2: One-time correction of older workspaces

**Files:**
- Modify: `src/main/workspace/manager.ts` (writable-open path, after the existing once-on-open markers)
- Test: `tests/workspace/techCorrection.test.ts`

**Interfaces:**
- Produces: `export async function inferWorkspaceTechnology(conn): Promise<Technology | null>` in `manager.ts` (≥ 90% rule; null otherwise).

- [ ] **Step 1: Failing tests** (real DuckDB): stored 4G with KPI rows 95% 3G → after reopen writable: stored 3G, `tech_checked` set, aggregates recomputed (an `is_nc` that depends on the technology changes accordingly — e.g. a PRB-only breach that counted under 4G no longer does); reopen again → no recompute (marker); no KPI rows → unchanged; 60/40 → unchanged; read-only open of the 95%-3G workspace → unchanged, nothing written (Review Focus 3).
- [ ] **Step 2: Run, verify failure.** **Step 3: Implement.** **Step 4: Run, pass.**
- [ ] **Step 5: Gate and commit** — `fix(tech): correct a workspace whose technology was switched in the past, once`.

### Task 3: Renderer — the buttons switch workspaces

**Files:**
- Modify: `src/renderer/store.ts` (`setSelectedTech` / `setTechnologyId`: no backend write; they call the switch flow, and reset to the workspace's technology when the switch does not happen), `src/renderer/lib/flows.ts` (`switchTechnologyFlow`, `createWorkspaceFlow(name?, preselectedTech?)`), `src/renderer/shell/CommandBar.tsx`, `src/renderer/shell/CommandPalette.tsx` (use the flow; palette labels `Open 2G workspace` etc.), `src/renderer/modules/KpiDefinitions.tsx`, `src/renderer/modules/TargetsModal.tsx` (their tabs choose which catalogue to edit: local state only, never the global setter), screens whose local technology state must follow `selectedTech` (GhanaMap, CellIntelligence, Forecasting, ComparisonLab, PriorityCenter, InvestigationWorkspace, NcIntelligence — each already syncs from `selectedTech`; verify, fix any that don't), `src/renderer/lib/previewApi.ts` (three demo workspaces, `workspace.open` switches the demo technology, `findRecent` finds them), `tests/renderer/storeContext.test.ts`, `tests/kpi/investigationRcaTech.test.ts` (use the demo workspaces instead of `setTechnology`)
- Create: `src/renderer/lib/techSwitch.ts`
- Test: `tests/renderer/techSwitch.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // techSwitch.ts (pure decision, flows.ts performs it)
  export type SwitchPlan = { kind: 'none' } | { kind: 'open'; path: string } | { kind: 'offerCreate'; technology: Technology }
  export function planTechSwitch(target: Technology, current: { technology: Technology; path: string } | null, found: string | null): SwitchPlan
  // flows.ts
  export async function switchTechnologyFlow(target: Technology): Promise<boolean> // true when the workspace changed
  ```

- [ ] **Step 1: Failing tests** — `planTechSwitch`: same technology → none; found → open; not found → offerCreate. Store: `setSelectedTech('3G')` with a 4G workspace and a cancelled switch leaves `selectedTech === '4G'` (Review Focus 1; flow stubbed through `window.api`).
- [ ] **Step 2: Run, verify failure.** **Step 3: Implement.** The offer is a confirm (`No 3G workspace yet — create one?`) then `createWorkspaceFlow(undefined, '3G')`.
- [ ] **Step 4: Browser preview check** — from the 4G demo, click 3G on Overview → the 3G demo workspace opens; click 3G again → nothing; KPI Definitions tabs change the catalogue only; no console errors.
- [ ] **Step 5: Gate and commit** — `feat(ui): 2G/3G/4G buttons open that technology's workspace`.

### Task 4: Import technology check

**Files:**
- Modify: `src/renderer/modules/DataManager.tsx`
- Create: `src/renderer/lib/importTech.ts`
- Test: `tests/renderer/importTech.test.ts`

**Interfaces:**
- Produces: `export function importTechBlock(detected: Technology | null | undefined, workspaceTech: Technology, overridden: boolean): { blocked: boolean; message: string | null }`

- [ ] **Step 1: Failing tests** — blocked with the exact message when detected ≠ workspace; not blocked when equal, when null (Review Focus 4), or when overridden.
- [ ] **Step 2: Run, verify failure.** **Step 3: Implement** — in the analysed-file card: the message, `Open the <T> workspace` / `Create a <T> workspace` (via `switchTechnologyFlow`, then re-analyse the same paths), `Import anyway` (per-file override); preview/import buttons disabled while blocked.
- [ ] **Step 4: Run, pass; browser preview check** of the blocked card.
- [ ] **Step 5: Gate and commit** — `feat(import): stop a file of another technology, with a way to the right workspace`.

### Task 5: Docs

- [ ] README: technology section (one workspace per technology; the buttons open the other workspace; import check); spec Status → Implemented. Gate, commit `docs(tech): one workspace per technology`.

---

## Spec coverage

| Spec | Task |
|---|---|
| §4.1 fixed technology, setter removed | 1 |
| §4.2 buttons | 3 |
| §4.3 recent technology | 1 |
| §4.4 correction | 2 |
| §4.5 import check | 4 |
| §5 smoke, preview | 1, 3 |
| §6 tests 1–7 | 1 (1, 4, 7), 2 (2, 3), 3 (5), 4 (6) |
