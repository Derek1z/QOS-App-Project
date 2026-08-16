# 4G QoS Network Intelligence — Implementation Plan

Feasibility verdict for `4G_QoS_Network_Intelligence_Master_Design_Spec.md`: **implementable**.
The spec is internally consistent and maps cleanly onto mature technology. Details below.

## Blocker (environment)

This machine currently has **no Node.js / npm / bun / deno / working Python**.
The whole stack (Electron, DuckDB) requires Node.js 20+. Nothing can be built or
tested until a Node runtime is installed (user-scope portable install, no admin needed).

## Technology mapping

| Spec requirement | Choice | Notes |
|---|---|---|
| Desktop app, Windows-only, no browser tab | **Electron** | Matches spec exactly |
| Embedded analytics, 50M–100M rows | **DuckDB** via `@duckdb/node-api` (native bindings) | Disk spill, SQL aggregation; `.qosdb` = one DuckDB file per workspace |
| One portable exe, no install, no admin | **electron-builder `portable` target** | Self-extracts to temp; find the portable folder via `PORTABLE_EXECUTABLE_DIR` env var. Only spec point needing a packaging trick |
| Charting: heatmaps, Ghana map, sync cursors, bands, PNG export | **Apache ECharts** (canvas) | Single engine covers all chart modes; aggregate before rendering, never feed raw fact rows |
| Virtualized tables/matrices | **TanStack Virtual** + DuckDB-driven paging | Renderer never holds huge arrays |
| UI framework | **React + Vite** renderer | 15 modules with heavy shared state justify it |
| Background work, no console windows | Electron utilityProcess workers | Imports/reports/forecasts/backups run off the renderer |

## Architecture

- **Main process**: window lifecycle, workspace lock (single writable instance), backups,
  raw-archive retention, encryption (SQLCipher-style via DuckDB secrets), maintenance.
- **Analytics core**: one module exposing the spec's Query Service
  (`getNetworkSummary`, `getCellHistory`, `getHealthMatrix`, `getPriorityQueue`,
  `getNcLifecycle`, `getForecastRisk`, …). UI never embeds SQL.
- **Cache**: L1 in-memory active-screen → L2 persisted aggregates in `.qosdb` →
  L3 full fact history. Cache keys = workspace + ruleset + period + grain + scope + metric.
- **Event bus**: `FILTER_CHANGED`, `PERIOD_CHANGED`, `WORKSPACE_CHANGED`,
  `RULESET_CHANGED`, `IMPORT_COMPLETE`, `FORECAST_UPDATED`, `CELL_SELECTED`.
- **Ruleset versioning**: threshold changes write a new ruleset version, never touch
  raw facts, trigger recompute of derived intelligence, and are referenced by reports.

## Milestones

### M0 — Workspace skeleton (foundation)
- Electron shell: main/preload/renderer, portable folder model (`workspaces/`, `backups/`,
  `exports/`, `app_state.json` beside the exe).
- Workspace create / open / recent / validate / cached summary; read-only mode +
  single-writable-instance lock.
- Full DuckDB schema: `dim_region/district/site/cell/source/date`, `fact_cell_daily`,
  derived aggregates (`agg_cell_weekly/monthly`, site/district/region/network grains),
  intelligence tables, `ruleset`, `import_audit`.
- App shell: collapsible left nav (15 modules), global command bar, command palette (Ctrl+K),
  background task manager, event bus.

### M1 — Import pipeline
- CSV (later XLSX) detection, **smart mapping** with per-source-fingerprint memory,
  validation (error/warning/info), preview, atomic batch merge, dedupe (Date+Cell,
  oldest-first wins), import audit, data-quality score, coverage view.
- Raw-source archive with 90-day retention; backup before major imports.
- Incremental processing: only affected days/weeks/months/cells re-aggregated.

### M2 — Analytics engine
- Time grains (daily/weekly/monthly; complete ISO weeks only, W31-style labels).
- Weekly NC logic (breach days ≥ N, default 1), district compliance (default 10%).
- Lifecycle (New/Recurring/Persistent/Recovering), trend, severity classifications.
- Priority Score (default weights 25/20/15/15/15/10, 5 modes), Network Health Score.
- Ruleset versioning + recompute + audit.

### M3 — Analytical modules
- Executive Overview (KPI strip, health score, Ghana map, top priorities, comparison +
  presentation mode), Network Explorer, Cell Intelligence (all cells, 5 aligned detail
  charts + relationship view), Performance Analysis (percentiles, heatmaps, scatter,
  correlation), NC Intelligence, Health Matrix (virtualized, 5 modes), Comparison Lab.

### M4 — Action modules
- Investigation Workspace (evidence-based diagnosis with calibrated language, notes/events,
  before/after, exportable report), Priority Center + action workflow, Forecasting
  (simple-first: MA/linear → ETS → robust; risk states; MAE/RMSE tracking), snapshots.

### M5 — Reporting & hardening
- Report builder + templates; Excel (13-sheet pack), PPTX, PDF, CSV, PNG exporters.
- Encryption (password + recovery key, audited recovery, protected exports), 7-rotating
  backups, maintenance (optimize/integrity/compact/purge), workspace health checks.
- 50M+ row performance pass: L2 aggregate coverage, query memory limits, disk spill,
  scatter density mode, long-series auto-grain.
- Package to portable `4G_QoS.exe`.

## Notes / caveats

- "Never claim configuration-level causes" (§77) is respected: diagnosis uses calibrated
  phrasing (`consistent with`, `suggests`, `evidence supports`) and only imported data.
- Raw facts are immutable; all rules are versioned classifications over them (§79).
- The only spec item that needs explanation is the single-exe portable target:
  Electron's portable exe unpacks to `%TEMP%` on launch, so the app must resolve its
  data folder from `PORTABLE_EXECUTABLE_DIR` (where the user placed `4G_QoS.exe`),
  not from `process.execPath`. Workspaces/backups/exports then stay fully portable.
- App size will be ~100–150 MB for the exe. Acceptable for the target.

## Build order

1. ✅ Node 22 installed (portable zip at `~/nodejs`, user scope, no admin).
2. ✅ Electron + Vite + React + TS scaffolded (`src/main`, `src/preload`, `src/renderer`).
3. ✅ **M0 done** — workspace create/open/validate/close, read-only mode, write lock,
   full DuckDB schema, query service, app shell with nav + command bar + palette.
4. ✅ **M1 done** — import pipeline: CSV drag-and-drop / file picker, smart mapping with
   remembered source profiles (fingerprints), validation (error/warning/info) with preview,
   atomic transactional merge, Date+Cell dedupe (oldest wins), dimension upserts,
   incremental aggregate refresh (weekly/monthly + site/district/region/network), coverage,
   data quality scoring, import audit, pre-import backups (7-rotation), checksums.
   Verified by `npm run smoke` (SMOKE_OK: importOk, importInserted=6, importDedupe, profileRemembered).
5. ✅ **M2 done** — analytics engine (`src/main/analytics/`): weekly NC lifecycle
   (New / Recurring / Persistent / Recovering, per-cell streaks vs `persistent_weeks`),
   trend (5 signals with noise tolerances, per-observed-day normalization) and severity
   (urgency bands from persistence + PRB excess + breach days + trend + availability)
   written to `cell_nc_lifecycle`; Priority Score 0–100 with the spec's default weights
   (25/20/15/15/15/10), five modes and Critical/High/Medium/Watch/Low bands into
   `cell_priority_history`; network health (computed on the fly from `agg_network_weekly`)
   and per-cell health into `cell_health_history`. Ruleset versioning (`rules:get/update`):
   changes create a new version, recompute all aggregates + intelligence, and are audited
   in `notes_events`. Refresh is incremental on import (affected cells only) and full on
   ruleset change. UI: NC Intelligence module (lifecycle/trend/severity distributions,
   filterable cell table, priority queue with mode switch) + ruleset editor in Workspace.
   Verified by `npm run smoke` (SMOKE_OK: ncLifecycle, ncRecurring="Recurring NC",
   priorityQueue="ACC-001-A", healthScore=72.5, rulesetVersioned, rulesRecompute).
6. ✅ **M3 complete** — ECharts via a shared, tree-shaken `Chart` wrapper. Executive
   Overview (health line + NC movement stacked area with threshold marks), Health Matrix
   heatmap (Cell/Site/District/Region scopes via `getHealthMatrix`), Cell Intelligence
   (searchable/filterable/paginated all-cells table via `getCellIntelligence`; per-cell
   detail drawer with an aligned 4-grid chart and weekly NC strip via `getCellDetail`),
   Performance Analysis (percentile curves via `quantile_cont`, PRB-vs-throughput quadrant
   scatter, Pearson correlation matrix via `corr` — all through `getPerformance`),
   Comparison Lab (period-vs-period and region-vs-region deltas, Actual/Indexed/Delta
   modes, difference ranking via `getComparison`), Network Explorer (Region → District →
   Site → Cell drill-down with breadcrumbs, search, health rollups from
   `cell_health_history` and cell-detail drawer via `getExplorer`). Verified by
   `npm run smoke` (ncMovement, healthMatrix, cellIntelligence, cellDetail, performance,
   comparison, explorer).
7. ✅ **M4 (Investigation Workspace) started** — `src/main/services/investigationService.ts`:
   searchable Cell/Site/District picker; deterministic evidence-based diagnosis with
   **calibrated language** (`consistent with` / `suggests` / `evidence supports`, never root
   cause beyond the data) and alternative hypotheses with support scores and
   supporting/contradicting evidence; action-status workflow (§44) persisted in
   `entity_action_status` with audited status events; user notes + derived
   classification/priority events in the timeline; before/after analysis (§50) with a
   selectable intervention week drawn on the aligned 5-grid chart; peer comparison;
   interactive checklist; **exportable markdown report** written to `exports/`. UI:
   `InvestigationWorkspace` module (evidence strip, diagnosis, hypotheses, before/after,
   peers, notes/events, checklist, report modal). Verified by `npm run smoke`
   (investigation: true).
8. ✅ **M4 (Priority Center)** — `getPriorityCenter(scope, status, band, search,
   overdueOnly, sort, limit/offset)` in `queryService`: every Cell/Site/District joined with
   its balanced-mode priority score (latest `cell_priority_history`) and `entity_action_status`
   (status/owner/ticket/review date); per-scope rollup queries (count, per-status counts via
   a subquery so DuckDB's GROUP BY rules hold, overdue count) keep the list and the
   rollups consistent; overdue = past review date excluding Resolved/Deferred. UI:
   `PriorityCenter` module — scope seg, status/band/search filters, clickable status
   rollup strip, overdue-only toggle, priority/due/name sorting, bulk status apply,
   pagination, and per-row → link into the Investigation Workspace via the store's
   `investigationTarget`. Verified by `npm run smoke` (priorityCenter: true).
9. ✅ **M4 (Forecasting & Early Warning)** — `getForecast(scope, entityId, metric, horizon)`
   in `queryService` backed by the pure `src/main/analytics/forecast.ts` engine: one SQL
   pass over `agg_cell_weekly` per scope, then simple-first forecasts (§46) in JS —
   moving average vs linear trend chosen by holdout MAE, with MAE/RMSE/directional accuracy,
   confidence, quality (suppressed < 2 observations), and 1/2/4/6-week horizons. Risk
   classification (§45): Stable/Watch/At Risk/Likely Breach/Already Breached against the
   ruleset PRB threshold, a 99.5% availability floor and a 10 Mbps throughput floor;
   users/traffic classify by trajectory. UI: `Forecasting` module — scope seg + focus-gated
   entity picker (Network → Region/District/Site/Cell), metric + horizon segs, clickable
   risk-count strip, actual/forecast line with confidence band + threshold mark, five-card
   forecast summary, and the per-cell risk table (worst first, filterable, paginated).
   Verified by `npm run smoke` (forecast: true).
10. ✅ **M5 (Reporting Center)** — `src/main/services/reportingService.ts`: report packs
   (§51) for Executive / Engineering / Investigation / Capacity Watch / Custom, each with a
   configurable + reorderable section library (Executive Summary, KPI Trend, Region/District/
   Site Analysis, All Cells, NC Register, Persistent NC, Priority Queue, Forecast Risk,
   Health Matrix, Lifecycle Analysis) fed by the existing queryService getters. Formats:
   Markdown, CSV (Excel-friendly blocks), styled dark HTML, and **real PDF via a hidden
   BrowserWindow + `printToPDF`** (no new dependencies). **Snapshot freezing** (§55): scope,
   as-of week, ruleset version, thresholds, KPIs, classifications and NC count embedded in
   every format and shown in the UI. Templates persist in `report_definitions` (§52) with
   weekly/monthly/quarterly schedules; generated packs are tracked in an
   `exports/report-history.json` manifest (§56) and any row can be regenerated. A
   **due-report check on open** (§56) compares each template's schedule against its
   `lastGenerated` stamp and shows an app-level banner with Generate-now / Dismiss; a
   scheduled run inherits the template's name, type and sections. UI:
   `ReportingCenter` module — type seg, name/schedule, format toggles, builder checklist
   with up/down reorder + save/apply templates, snapshot card, iframe HTML preview, and the
   history table. Verified by `npm run smoke` (reports: true). Also fixed: the smoke run's
   hidden PDF window used to fire `window-all-closed → app.quit()` and race the run's exit
   (127, lost stdout) — the handler now ignores `--smoke` mode.
11. ✅ **M5 hardening** — background imports already landed with the worker
    (`importWorker?nodeWorker`, phase stream on `import:progress`, Data Manager progress
    bar); this pass added the remaining hardening items:
    - **Raw-source archive & 90-day retention (§9)** — `src/main/import/importCore.ts`
      gzip-copies each imported CSV into `workspaces/<name>.qosdb.raw/` inside the worker
      and records it in a new `raw_archive` table (`imported_at + 90 days`);
      `src/main/import/importer.ts` gains `rawArchive()` (index + retained/expiring/expired
      status) and `purgeRawArchive()`; expired copies are purged on every writable open and
      on demand from Data Manager → Archive (new tab). Processed data and import metadata
      always survive the purge (§9).
    - **Workspace snapshots (§7)** — new `src/main/services/snapshotService.ts`: create
      (clean point-in-time copy after closing the handle, Windows-lock pattern), list,
      restore (writes a `pre-restore-*` safety backup to `backups/` first, replaces the
      workspace, audits `snapshot_restore` in `notes_events`) and remove. UI: Workspace
      module snapshots card (create form, list, Restore/Delete). Old workspaces get the
      `raw_archive` table and `workspace_snapshots.path` via an idempotent backfill in
      `workspace/manager.ts` on writable open.
    - Verified by `npm run smoke` (rawArchive, retentionPurge, snapshots, snapshotRestore).
    - Also fixed: the import worker now releases its DuckDB handle *before* posting `done`,
      closing a Windows file-lock race where the main process could fail to reopen the
      workspace after a worker import.
12. ✅ **Packaging → portable `4G_QoS.exe`** — electron-builder `portable` target
    (`release/4G_QoS.exe`), with `PORTABLE_EXECUTABLE_DIR` resolution in `src/main/paths.ts`
    so workspaces/backups/exports live beside the executable instead of the temp dir the
    portable exe unpacks to. Native DuckDB binding is unpacked (asarUnpack) and the worker
    chunk is packaged as extraResources; both are verified inside the built asar.
    `npm run dist` produces the artifact.
13. ✅ **M5 hardening 2 (comparison, maintenance, Office formats)** —
    - **Snapshot comparison** — `snapshotService.compareSnapshots(a, b)` opens two snapshot
      files read-only and diffs them across KPIs (health score, PRB, availability,
      throughput, users, traffic, NC counts) with direction-aware deltas and a verdict;
      UI in the Workspace module's Snapshots card (pick any two, see the delta table).
    - **Workspace Maintenance (§58)** — new `src/main/services/maintenanceService.ts` with
      `integrityCheck` (catalog + per-table readability + PK uniqueness + `database_size`;
      this DuckDB build exposes no `pragma_integrity_check`, so the check is structural),
      `optimize` (checkpoint + stats), `compact` (build a fresh file via `COPY FROM DATABASE
      <catalog>` — the default catalog is the file name, not `main` — then swap it in),
      `rebuildIntelligence` (recompute aggregates + classification from raw facts) and
      `purgeExpiredRaw`; every destructive action writes a pre-action backup to `backups/`
      first. UI: Data Manager → Maintenance tab with action cards + storage analysis.
    - **Excel 13-sheet pack (§53)** — real `.xlsx` via `exceljs` in `reportingService`
      (13 sheets, styled header fills, frozen panes, auto-filters, title block).
    - **Editable PowerPoint (§54)** — real `.pptx` via `pptxgenjs` (title/snapshot/trend/
      region/priority slides with native editable tables + text).
    - Reporting Center gains Excel/PowerPoint format toggles; browser demo generates real
      zip blobs via JSZip. Verified by `npm run smoke` (snapshotCompare, maintenance,
      xlsxPptx — real PK-zip xlsx/pptx files checked).
14. ✅ **Maintenance scheduler (§58)** — new `src/main/services/maintenanceScheduler.ts`:
    per-workspace settings in a single-row `maintenance_settings` table (enabled, 6–168h
    cadence, actions, run-on-open), run history in `maintenance_runs`. A 60s main-process
    timer + a due-check on every writable workspace open call `maybeRunScheduled()`, which
    runs the enabled actions through the existing `runMaintenance` pipeline when the
    cadence window elapses; runs are mirrored into `notes_events` (kind `maintenance_run`)
    for the audit trail. IPC/preload: `maintenance:getSchedule / setSchedule / runScheduled /
    scheduleHistory`. UI: Data Manager → Maintenance gains a scheduler card (enable toggle,
    cadence select, action checkboxes, run-on-open, Save, Run now, last/next run KPIs and
    run history). Verified by `npm run smoke` (`maintenanceScheduler: true` — defaults,
    persistence round-trip, backdated due-run fires, last-run updated, history + audit
    entry written, disabled scheduler skips both automatic and manual runs).
15. ✅ **Native Excel charts (§53) + Ghana map** —
    - Excel charts: `reportingService` first renders SVG line/bar charts (weekly health +
      NC trend, region/district/site health worst-first, health components), rasterizes
      them to PNG via a hidden BrowserWindow + `capturePage` (same infra as the PDF
      renderer) and embeds them via `wb.addImage`. On top of that it **injects native
      editable OOXML chart parts** (`injectNativeCharts`): real `xl/charts/chartN.xml`
      line/bar chart XML + drawing anchors wired through sheet rels and `[Content_Types]`
      referencing the sheets' own data cells, with the PNGs kept as the fallback on any
      injection failure. `ReportChartConfig` (per-sheet toggles + KPI Trend metric)
      persists with templates in the Reporting Center and gates both native parts and
      PNGs. Smoke verifies ≥2 PNGs (`xlsxCharts`), ≥1 real chart XML part
      (`xlsxNativeCharts`), and a fully-disabled config injecting neither (`xlsxChartConfig`).
    - Ghana map: 16-region GeoJSON (virgoaugustine/Ghana-GeoJSON-data, MIT) simplified to
      34 KB (`src/renderer/lib/ghanaRegions.ts`) and registered with ECharts `MapChart`.
      New `getRegionMap` / `getRegionDistricts` queries in `queryService` roll regions and
      districts up from `cell_health_history` + `agg_cell_weekly` (same methodology as the
      Health Matrix). New `GhanaMap` component in Executive Overview: metric seg (health /
      NC cells / PRB), visualMap choropleth, per-region tooltips, **click-to-drill into a
      district choropleth** — 253 usable ADM2 boundaries (geoBoundaries GHA ADM2, ODbL;
      simplified 3 MB → 202 KB with centroid point-in-polygon region membership in
      `src/renderer/lib/ghanaDistricts.ts`) render the selected region's districts colored
      by the active metric, alongside the worst-first district list. Clicking a district
      (map polygon or list row) opens its **diagnosis in the Investigation Workspace** via
      `investigationTarget`. Note: undefined-valued data items crash ECharts' visualMap
      hover linking, so no-data regions are excluded from the series data (they render
      with the muted fallback color) rather than nulled. Verified by smoke
      (`regionMap: true`).

## M1 notes / deferred

- Imports run on a background worker thread (`importWorker?nodeWorker`) with phase
  progress streamed to the Data Manager — no main-process UI blocking.
- Raw source retention (90-day archive, §9), XLSX + PPTX exports (§53/§54) and workspace
  maintenance (§58) all landed in the M5 hardening passes.
