# 4G QoS Network Intelligence

Portable Windows desktop application for telecom QoS analytics, built on **Electron + DuckDB**.
One `.qosdb` DuckDB workspace per network; fully offline; no installation required —
ships as a **portable `4G_QoS.exe`** (electron-builder portable target) that keeps
workspaces, backups, snapshots and exports beside the executable via
`PORTABLE_EXECUTABLE_DIR`.

Read the full product spec in
[`4G_QoS_Network_Intelligence_Master_Design_Spec.md`](4G_QoS_Network_Intelligence_Master_Design_Spec.md)
and the build plan in [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

## Current status — Milestones 0–5 complete ✅

- Electron shell with the full module navigation (13 modules), command bar (Period/Grain),
  command palette (`Ctrl+K`), status bar, dark engineering theme.
- Workspace lifecycle: create / open / validate / close `.qosdb` workspaces, recent list,
  auto-reopen of last workspace on startup, **read-only mode**, per-workspace **write lock**
  (single writable instance).
- Full DuckDB schema: dimension tables, `fact_cell_daily`, weekly/monthly cell aggregates,
  site/district/region/network aggregates, ruleset versioning, import audit, mapping profiles,
  data quality, coverage, and derived-intelligence tables.
- Centralized analytics query service (`getSummary`) behind IPC — UI never embeds SQL.
- Portable folder model: `workspaces/`, `backups/`, `exports/`, `app_state.json` beside the app.

### Milestone 1 — import pipeline ✅

- CSV **drag-and-drop / file picker** with smart column mapping (canonical fields from the
  spec's schema, alias-based auto-detection, confidence scoring).
- **Remembered mapping profiles** per source fingerprint (header order + set) — known files
  auto-map; material changes require review.
- **Validation** with error/warning/info severities (required columns, date parse, numeric
  parseability, PRB/availability ranges, negatives, missing dims) and a live preview.
- **Atomic import**: staging → validation → backup → transactional merge. Any failure
  rolls back and leaves the workspace unchanged. **Dedupe on Date+Cell, oldest wins**.
- Dimension upserts, **incremental aggregate refresh** (cell weekly/monthly and
  site/district/region/network daily/weekly/monthly), coverage view, **data quality scores**,
  **import audit** log, pre-import **backups** (latest 7 kept), raw file **checksums**.
- Data Manager module with Import / Coverage / Audit / Quality tabs.

Verified headlessly via `npm run smoke`: mapping auto-detects all 10 columns, 6 rows insert,
re-import dedupes all 6, profile is remembered.

### Milestone 2 — analytics engine ✅

- **Weekly NC logic** per spec §20: a cell is Weekly NC when it breaches the PRB threshold on
  ≥ N distinct days in a completed ISO week (N configurable, default 1).
- **Lifecycle / trend / severity** classification for every cell-week (`cell_nc_lifecycle`):
  New / Recurring / Persistent / Recovering / Healthy; Improving / Stable / Worsening (five
  signals with noise tolerances, weekly sums normalized per observed day); Normal / Watch /
  High / Critical (urgency from persistence, PRB excess, breach days, trend, availability).
- **Priority Score** 0–100 (`cell_priority_history`): six transparent components with the
  spec's default weights (25/20/15/15/15/10), five modes (Balanced, Customer Impact,
  Congestion Severity, Persistence, Rapid Deterioration), Critical/High/Medium/Watch/Low bands.
- **Health scores**: network health series (computed from `agg_network_weekly`) and per-cell
  health (`cell_health_history`) — all components stored, never opaque.
- **Ruleset versioning** (§63): editing rules creates a new version, recomputes aggregates +
  derived intelligence, never touches raw facts, and writes an audit event.
- **Incremental processing** (§66): imports recompute only affected cells' intelligence;
  ruleset changes recompute everything.
- **NC Intelligence module**: distributions by lifecycle/trend/severity, filterable cell
  table, priority queue with mode switching. **Ruleset editor** in the Workspace module.

Verified by `npm run smoke`: classifications for imported cells (Recurring NC chain, Critical
severity), priority queue ordering, network health score, ruleset change with recompute
and audit, and weekly NC movement — all green alongside M0/M1 checks.

### Milestone 3 — charting pass + first modules ✅

- **ECharts** integrated via a shared `Chart` wrapper (`src/renderer/lib/Chart.tsx`,
  tree-shaken `echarts/core` registrations, dark palette, resize/dispose-safe).
- **Executive Overview**: Network Health Score line chart (with the Watch threshold marked
  and per-week component tooltips) and NC Movement stacked-area chart (lifecycle counts +
  NC-rate line with the 10% district threshold).
- **Health Matrix module**: entity × week heatmap (Cell / Site / District / Region scopes,
  4–26 week windows, worst-first or A–Z sort) backed by the new `healthMatrix` endpoint,
  which rolls all scopes up from `cell_health_history` so the methodology is identical.
- **Cell Intelligence module**: searchable/filterable all-cells table (lifecycle, trend,
  severity, PRB, breach days, priority) with DuckDB-side filtering + pagination (`getCellIntelligence`),
  and a per-cell **detail drawer** with an aligned multi-grid chart (PRB + threshold mark,
  throughput, users, volume on shared ISO-week axes with linked cursors) plus a weekly NC
  state strip (`getCellDetail`).

- **KPI strip** fed live from the analytics summary; **Top Priorities preview** fed directly
  by the Priority engine (balanced mode, top 8, score bars + bands). Ghana map placeholder
  remains until the map data pass.
- **Performance Analysis module**: per-metric **percentile curves** (p0–p100 with P50/P90
  threshold marks and stat strip), a **PRB-vs-throughput scatter** split into four
  engineering-band quadrants by the active ruleset PRB threshold and median speed
  (`getPerformance` — distributions via DuckDB `quantile_cont`, Pearson r via `corr`), and a
  color-coded **correlation matrix** with the spec's "descriptive, not causal" caveat.
- **Comparison Lab module**: **period-vs-period** (latest vs previous ISO week at
  Cell/Site/District/Region scope) and **region-vs-region** (regions vs network baseline)
  delta views via `getComparison`, with a **KPI comparison strip** (current vs baseline,
  ▲/▼ delta badges colored by whether the change helps or hurts each metric),
  **Actual/Indexed/Delta visualization modes**, and a **difference ranking** (worst change
  first — biggest rise for PRB/NC, biggest drop otherwise) as chart + table with NC
  transition chips (Still NC / New NC / Recovered).
- **Network Explorer module**: hierarchical **Region → District → Site → Cell** drill-down
  via `getExplorer`, with clickable breadcrumbs (jump back to any ancestor), live search
  per level, and node health that **rolls up from `cell_health_history`** (same methodology
  as the Health Matrix) shown as a colored score + bar, plus NC counts and latest-week KPI
  columns. Clicking a leaf cell opens its detail drawer (aligned multi-grid chart + weekly
  NC strip) — completing the M3 module set.

### Milestone 4 — Priority Center ✅ (workflow queue)

- **Cross-scope workflow queue**: every Cell / Site / District joined with its 0–100
  priority score (balanced mode, latest `cell_priority_history`) and its `entity_action_status`
  — status, owner, external ticket and target review date — all in DuckDB (§44).
- **Filters**: search (name / site / district / region), status (each of the seven workflow
  states or Unset), priority band (Critical → Low), **overdue-only** (past review date,
  excluding Resolved/Deferred), and sort by priority / due date / name, all server-side.
- **Status rollup strip**: clickable per-status counts that act as filters, plus an overdue
  count; **bulk actions** apply a status change to the selected rows (audited through the
  same `entity_action_status` path as the Investigation Workspace).
- **Cross-module navigation**: every row links into the Investigation Workspace, pre-selecting
  the entity (scope, id, path) via a store-level `investigationTarget` — the queue and the
  diagnosis share one source of truth.
- Pagination (100/page, Show more) and scope switching (240 cells → 240 sites → 16 districts
  in the demo) run against the same rollup queries, so the counts and the list always agree.

Verified by `npm run smoke` (`priorityCenter: true`): KUM-002-A leads the queue under the
active ruleset, status/band/search filters, site + district rollups (KUM-002 → 1 NC cell),
and the status rollup reflecting the status set earlier in the investigation test.

### Milestone 4 — Forecasting & Early Warning ✅ (completes M4)

- **Simple-first forecasts** (§46) for PRB, traffic, users, throughput and availability at
  Network / Region / District / Site / Cell scope: moving average vs **linear trend chosen by
  holdout MAE** (fit on all-but-last, scored on the last week), with 1 / 2 / 4 / 6-week
  horizons. Every forecast exposes trajectory, confidence, model quality, historical error
  (MAE / RMSE / directional accuracy) and an explanation.
- **Low-quality forecasts are suppressed** (§46): fewer than two weekly observations yields a
  `suppressed` state with an explicit reason — no fabricated numbers.
- **Early-warning risk states** (§45): Stable → Watch → At Risk → Likely Breach → Already
  Breached, classified per metric against real thresholds — the active ruleset's PRB
  threshold, a 99.5% availability expectation and a ~10 Mbps throughput floor; users/traffic
  (no hard threshold) classify by trajectory.
- **Per-cell risk table**: every cell in scope forecast for the selected metric, sorted worst
  first with current / forecast / threshold and a plain-English explanation; the clickable
  risk strip filters it. The scope's own aggregate series carries its entity-level risk state
  (e.g. the network is Stable while 11 cells are Already Breached).
- **Chart**: actual line + dashed forecast with the confidence band, the dashed threshold
  mark, unit-aware axis/tooltips, and a five-card forecast summary strip (next value, method,
  quality, band) that doubles as a metric switcher.

Verified by `npm run smoke` (`forecast: true`): network entity with all 5 series, PRB
threshold read from the active ruleset (90), 2 actual + 4 forecast points, valid bands,
risk counts summing to the entity count, KUM-002-A's single-week history correctly
suppressed, and site scope rollups.

### Milestone 5 — Reporting Center ✅ (first M5 module)

- **Report packs** (§51): Executive / Engineering / Investigation / Capacity Watch / Custom
  types, each with a default section set that you can toggle, reorder and save as a
  template (§52) in `report_definitions`. Section library: Executive Summary, KPI Trend,
  Region/District/Site Analysis, All Cells, NC Register, Persistent NC, Priority Queue,
  Forecast Risk, Health Matrix, Lifecycle Analysis.
- **Formats** (§53–55): Markdown, **CSV (Excel-friendly)** with per-section blocks, a
  **styled dark-themed HTML** report, and **real PDF via Electron `printToPDF`** (hidden
  window, zero new dependencies). The browser demo downloads md/csv/html directly and
  notes PDF requires the desktop app.
- **Snapshot freezing** (§55): every pack embeds scope, as-of week, ruleset version,
  thresholds (PRB / availability / throughput / district NC), KPI values, lifecycle
  classification counts and NC count — visible in the UI and written into every format.
- **History & schedules** (§56): generated packs are tracked in an `exports/` history
  manifest (workspace, period, template, formats, ruleset); the builder supports weekly /
  monthly / quarterly schedules on saved templates, and any history row can be regenerated.
- **Due-report check on open** (§56): on app start the app compares each saved template's
  schedule against its `lastGenerated` stamp and surfaces a banner listing due reports
  (with `overdueDays`) — one click generates the pack (inheriting the template's name,
  type and sections), another dismisses it until the next launch.

Verified by `npm run smoke` (`reports: true`): pack with 5 default sections, snapshot
freezing ruleset v2 + PRB 90 + NC count, md/csv/html content checks, a real non-empty PDF,
template save/list round-trip, history tracking, a custom Capacity pack, and the due-report
check (`dueReports: true` — a never-generated weekly template is due, generating it clears
the due flag while unrelated templates stay due).

### M5 — Hardening pass 2 (comparison, maintenance, Office formats, packaging) ✅

- **Snapshot comparison (§7)**: diff any two point-in-time snapshots across KPIs — network
  health score, PRB, availability, throughput, users, traffic and NC counts — with per-row
  ▲/▼ deltas (direction-aware: a PRB rise is good, an NC rise is bad) and a summary verdict
  card. Milestones are measured, not just restored.
- **Workspace Maintenance (§58)**: a Data Manager tab with **Integrity check** (catalog +
  per-table readability + PK uniqueness + `database_size`), **Optimize** (checkpoint + stats),
  **Compact** (rebuilds the workspace into a fresh file via `COPY FROM DATABASE`, then swaps
  it in), **Rebuild intelligence** (recomputes aggregates + classification from raw facts)
  and **Purge expired raw** — every destructive action writes a pre-action backup to
  `backups/` first, and storage analysis shows per-table + total workspace size.
- **Excel 13-sheet pack (§53)**: real `.xlsx` via `exceljs` — Overview, Executive Summary,
  KPI Trend, Region/District/Site Analysis, All Cells, NC Register, Persistent NC, Priority
  Queue, Forecast Risk, Health Matrix, Lifecycle Analysis and Definitions sheets, styled
  with header fills, frozen panes, auto-filter rows and a title block.
- **Editable PowerPoint deck (§54)**: real `.pptx` via `pptxgenjs` — title, snapshot,
  KPI-trend, region and priority slides with native editable tables/text, opened with a
  custom cover image in the Reporting Center. Both formats join the format toggles and are
  generated inside the report pack (browser demo downloads real zip blobs).
- **Portable packaging**: electron-builder `portable` target produces `release/4G_QoS.exe`;
  the app resolves its data folder from `PORTABLE_EXECUTABLE_DIR` (not `process.execPath`),
  so workspaces/backups/exports stay beside the executable. The worker chunk and the
  unpacked native DuckDB binding are verified inside the packaged asar. The executable,
  the taskbar window and the renderer tab all carry a custom app icon — dark navy rounded
  square with the cyan signal-bar motif (`scripts/generate-icon.cjs`, zero dependencies:
  run `npm run icon` to regenerate `build/icon.ico` + `build/icon.png` + `build/favicon.png`).
- **Maintenance scheduler (§58)**: configurable per-workspace schedule (enable, 6h–weekly
  cadence, any subset of integrity / purge / optimize / rebuild / compact, run-on-open)
  persisted in `maintenance_settings`. A main-process timer plus a due-check on every
  writable open runs the enabled actions when the cadence window elapses; each run is
  recorded in `maintenance_runs`, mirrored into the `notes_events` audit trail (visible
  in the Investigation timeline), and surfaced in the Data Manager Maintenance tab with
  last/next run, per-action results and run history.
- **Native Excel charts (§53)**: the 13-sheet pack embeds **real editable chart
  objects** — the generator injects OOXML chart parts (`xl/charts/*.xml` + drawing
  anchors) into the xlsx zip so KPI Trend (line), Region/District/Site Analysis (bars)
  and Executive Summary (components bar) open and restyle natively in Excel. The
  rasterized PNG renderings (SVG → hidden-window PNG, same infra as the PDF renderer)
  remain as the graceful fallback if injection ever fails. The Reporting Center builder
  lets you pick **which sheets get charts** (per-chart toggles + the KPI Trend metric:
  health+NC or NC-only), persists the choice in templates, and generation honors it —
  smoke-verified that a fully-disabled chart config produces no chart parts and no PNGs.
- **Ghana map (Executive Overview)**: the placeholder is now a live choropleth — 16-region
  GeoJSON embedded statically (`src/renderer/lib/ghanaRegions.ts`, 34 KB, offline),
  colored by health / NC cells / PRB with a visualMap scale, per-region tooltips, and
  **click-to-drill into a district choropleth**: 253 usable ADM2 district boundaries
  (`src/renderer/lib/ghanaDistricts.ts`, 202 KB, offline, geoBoundaries ODbL) render the
  selected region's districts colored by the same metric, alongside the worst-first
  district list, **with the parent region's boundary kept as a labelled outline** (same
  shared geo, so it stays aligned while zooming). **PRB % and NC cells use the reversed
  scale — higher = worse** (red at the top, labelled Worse/Better on the always-visible
  legend), since high utilization and more NC cells mean poorer conditions; only health
  is higher-better. Clicking any district — on the map or in the list — **opens its
  diagnosis in the Investigation Workspace** (`investigationTarget` + navigation),
  backed by `regionMap` / `regionDistricts` analytics endpoints that roll up the same
  `cell_health_history` + `agg_cell_weekly` data as the Health Matrix.

### M5 — Hardening pass 1 (background imports, raw archive, snapshots) ✅

- **Background imports**: CSV imports run in a worker thread (`importWorker?nodeWorker`);
  the main process closes its DuckDB handle, the worker runs staging → validation → merge →
  aggregates → intelligence on its own connection, streams phases back via `import:progress`,
  and the Data Manager renders a live phase bar. The worker only reports done after its
  DuckDB handle is fully released (Windows file-lock safety).
- **Raw-source archive (§9)**: every imported CSV is gzip-copied to
  `workspaces/<name>.qosdb.raw/` and tracked in `raw_archive` with a **90-day retention**
  window (`imported_at + 90 days`). Expired copies are purged automatically when a
  workspace opens writable (and on demand from Data Manager → Archive); processed data,
  filenames, checksums and import metadata always remain. The Archive tab shows every
  archived source with size, checksum, retention date, days left and a retained/expiring/
  expired badge plus a size/count strip and a **Purge expired** button.
- **Workspace snapshots (§7)**: point-in-time `.qosdb` copies stored in `backups/snapshots/`
  and tracked in `workspace_snapshots` (name, reason, notes). The Workspace module offers a
  create form, a snapshot list, **Restore** (writes a `pre-restore-*` safety backup to
  `backups/` first, then replaces the workspace and audits a `snapshot_restore` event) and
  **Delete**. Old workspaces get the new schema automatically on writable open
  (idempotent `raw_archive` / `path` backfill).

Verified by `npm run smoke` (`rawArchive: true, retentionPurge: true, snapshots: true,
snapshotRestore: true`): two imports → two gzip archive rows (gzip magic checked), backdated
file purged off disk and from `raw_archive`, snapshot create/list/restore round-trip with the
row count preserved and the restore audited.

### Milestone 4 — Investigation Workspace ✅ (first M4 module)

- **Searchable entity picker** (Cell / Site / District) with hierarchy paths.
- **Evidence-based diagnosis** (§47–48): KPI evidence strip (latest vs previous week with
  direction-aware deltas), deterministic findings written in **calibrated language**
  (`consistent with`, `suggests`, `evidence supports` — never claims root cause beyond the
  data), and **alternative hypotheses** with deterministic support scores and explicit
  supporting/contradicting evidence lists.
- **Action status workflow** (§44): Unreviewed → Investigating → Escalated → Optimization in
  progress → Monitoring → Resolved → Deferred, plus owner, external ticket and target review
  date, persisted in `entity_action_status` and audited into the timeline.
- **Notes & events** (§49): add user notes; the timeline mixes them with derived
  classification-change and priority-change events from the engine plus stored status events.
- **Before / after analysis** (§50): pick an intervention week and compare up to 8 weeks
  before vs after across PRB / throughput / users / volume / availability, with direction-
  aware improved/worsened marks; the intervention week is drawn on the aligned 5-grid
  actual-metrics chart.
- **Peer comparison** (same-scope siblings, worst health first), an interactive
  **investigation checklist**, and an **exportable report** — markdown written to `exports/`
  with classifications, evidence, findings, hypotheses, before/after and the event timeline.

Verified by `npm run smoke` (`investigation: true`): evidence deltas, calibrated findings,
5 hypotheses with in-range support scores, site/district rollups, status persistence with
an audited event, notes, and a report file that includes the deterministic conclusion.

## Requirements

- Node.js 20+ (this repo uses a portable user-scope install at `~/nodejs`)

## Quick start

```bash
export PATH="$HOME/nodejs:$PATH"   # if using the portable Node install

npm install        # first time only
npm run dev        # development with hot reload (opens the app window)
npm run build      # production build to out/
npm run typecheck  # TypeScript checks for main + renderer
npm run smoke      # headless verification of DuckDB/workspace/locking
```

`npm run dev` opens the app. Use **Locate Workspace** or **Create New Workspace** on the
welcome screen; recent workspaces are remembered in `app_state.json`.

## Layout

```text
src/
  main/            Electron main process
    index.ts       app bootstrap, window, workspace restore, smoke mode
    ipc.ts         IPC handlers (workspace / analytics / app state)
    paths.ts       portable folder resolution (PORTABLE_EXECUTABLE_DIR aware)
    smoke.ts       headless smoke test (npm run smoke)
    services/      appState (app_state.json), queryService (analytics)
    workspace/     manager.ts (lifecycle, locking, read-only), schema.ts (DDL)
  preload/         contextBridge API surface
  renderer/        React + Vite UI (nav, command bar, palette, modules)
shared/api.ts      shared IPC contracts (main <-> renderer)
out/               build output (main, preload, renderer)
```

## Roadmap

Milestones 0–5 and packaging are complete — the portable `4G_QoS.exe` build is described
in `IMPLEMENTATION_PLAN.md`. Remaining spec surface: the Ghana map data pass (map placeholder
is in place) and any follow-on sections you want to pull forward.
