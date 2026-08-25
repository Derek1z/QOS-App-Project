# Graph Report - QOS-App-Project  (2026-08-25)

## Corpus Check
- 102 files · ~166,814 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1266 nodes · 3311 edges · 63 communities (58 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 22 edges (avg confidence: 0.85)
- Token cost: 12,000 input · 2,400 output

## Community Hubs (Navigation)
- IPC Shared API & Contracts
- Workspace Snapshots & Lifecycle
- IPC Shared API & Contracts
- Canonical Data Schema & Archive
- Workspace Snapshots & Lifecycle
- NC Lifecycle & Priority Engine
- Network Explorer & Forecasting
- Investigation & RCA Diagnostics
- Data Import Core & Validation
- CSV & Excel Telemetry Parsers
- Application Shell & Navigation
- NC Lifecycle & Priority Engine
- Canonical Data Schema & Archive
- Network Explorer & Forecasting
- Workspace Snapshots & Lifecycle
- Derived KPI Engine & Formulas
- Background Import Worker Thread
- Ghana Geo Maps & Region Visualizer
- Build & Maintenance Scripts
- Investigation & RCA Diagnostics
- TypeScript Web Configuration
- Electron Vite Node Configuration
- App Icon & Asset Generator
- Investigation & RCA Diagnostics
- Comparison Lab Delta Analytics
- Canonical Data Schema & Archive
- Automated Reporting Center
- Electron Subsystem
- Appstatedata Subsystem
- Network Explorer & Forecasting
- Workspace Snapshots & Lifecycle
- Investigation & RCA Diagnostics
- ECharts Visualization Library
- Investigation & RCA Diagnostics
- Network Explorer & Forecasting
- Metricdistribution Subsystem
- Network Explorer & Forecasting
- Network Explorer & Forecasting
- Maintenanceaction Subsystem
- Build Subsystem
- App Icon & Asset Generator
- Network Explorer & Forecasting
- Demoreportpack Subsystem
- Package.json Subsystem
- Buildexcelcharts Subsystem
- ECharts Visualization Library
- Network Explorer & Forecasting
- Investigation & RCA Diagnostics
- Reportchartconfig Subsystem
- App Icon & Asset Generator
- App Icon & Asset Generator
- Buildnativecharttargets Subsystem
- Isnumeric Subsystem
- Automap Subsystem
- Tsconfig.json Subsystem
- Coveragerows Subsystem
- Delay Subsystem
- Demoworkspaceinfo Subsystem
- Mainx Subsystem

## God Nodes (most connected - your core abstractions)
1. `registerIpc()` - 67 edges
2. `runSmokeTest()` - 62 edges
3. `useAppStore` - 56 edges
4. `Technology` - 35 edges
5. `getCurrent()` - 26 edges
6. `runImportCoreInner()` - 25 edges
7. `DataManager()` - 25 edges
8. `emit()` - 24 edges
9. `tooltipStyle()` - 23 edges
10. `formatTimeLabel()` - 23 edges

## Surprising Connections (you probably didn't know these)
- `useAppStore` --calls--> `get()`  [EXTRACTED]
  src/renderer/store.ts → shared/api.ts
- `DiagnosticContext` --references--> `Technology`  [EXTRACTED]
  src/main/analytics/investigation/types.ts → shared/api.ts
- `AppStore` --references--> `Grain`  [EXTRACTED]
  src/renderer/store.ts → shared/api.ts
- `AppStore` --references--> `PeriodId`  [EXTRACTED]
  src/renderer/store.ts → shared/api.ts
- `Draft` --references--> `KpiDefinition`  [EXTRACTED]
  src/renderer/modules/KpiDefinitions.tsx → shared/api.ts

## Import Cycles
- 3-file cycle: `src/main/services/derivedKpiService.ts -> src/main/services/kpiService.ts -> src/main/workspace/manager.ts -> src/main/services/derivedKpiService.ts`
- 3-file cycle: `src/main/analytics/engine.ts -> src/main/analytics/nc.ts -> src/main/analytics/rules.ts -> src/main/analytics/engine.ts`
- 3-file cycle: `src/main/analytics/engine.ts -> src/main/analytics/health.ts -> src/main/analytics/rules.ts -> src/main/analytics/engine.ts`
- 3-file cycle: `src/main/analytics/engine.ts -> src/main/analytics/priority.ts -> src/main/analytics/rules.ts -> src/main/analytics/engine.ts`

## Hyperedges (group relationships)
- **QoS Core Analytics & Governance Pipeline** — spec_duckdb_workspace_architecture, spec_nc_lifecycle_engine, spec_priority_scoring_model, spec_ruleset_versioning_and_governance, spec_multi_technology_kpi_engine [EXTRACTED 1.00]

## Communities (63 total, 5 thin omitted)

### Community 0 - "IPC Shared API & Contracts"
Cohesion: 0.02
Nodes (21): BetterDirection, BUILTIN_DERIVED_KPIS, CellHealthRow, CellWeekPoint, CorrelationRow, CreatedWorkspaceEntry, DerivedOperation, ExecutiveKpiCardData (+13 more)

### Community 1 - "Workspace Snapshots & Lifecycle"
Cohesion: 0.07
Nodes (50): KpiDefinition, run(), SnapshotComparison, WorkspaceSnapshot, closeWorkspaceFlow(), createWorkspaceFlow(), errMsg(), openWorkspaceFlow() (+42 more)

### Community 2 - "IPC Shared API & Contracts"
Cohesion: 0.03
Nodes (48): DerivedKpiSuggestion, ExplorerBreadcrumb, ExplorerNode, ExplorerResult, ForecastPoint, ForecastRiskRow, ForecastSeries, HealthMatrixResult (+40 more)

### Community 3 - "Canonical Data Schema & Archive"
Cohesion: 0.08
Nodes (47): CanonicalField, FIELD_ORDER, GeoFieldStats, onProgress(), RawArchiveRow, RawArchiveStatus, RawArchiveStatusKind, SyntheticDataConfig (+39 more)

### Community 4 - "Workspace Snapshots & Lifecycle"
Cohesion: 0.09
Nodes (46): classifyRisk(), computeNetworkHealth(), getRules(), updateRules(), listKpiDefs(), workspaceTechnology(), addPeriod(), ALL_FORECAST_METRICS (+38 more)

### Community 5 - "NC Lifecycle & Priority Engine"
Cohesion: 0.07
Nodes (35): HealthComponentRow, HealthResult, Lifecycle, NcLifecycleResult, PRIORITY_MODES, PriorityMode, PriorityRow, Rules (+27 more)

### Community 6 - "Network Explorer & Forecasting"
Cohesion: 0.11
Nodes (42): activeTech(), entityJoins(), kpiBreachJoin(), MONTHS(), recomputeAggregates(), recomputeAllAggregates(), recomputeCellKpiMonthly(), recomputeCellKpiWeekly() (+34 more)

### Community 7 - "Investigation & RCA Diagnostics"
Cohesion: 0.12
Nodes (30): BeforeAfterMetric, DiagnosisFinding, DiagnosticHypothesis, EvidenceKpi, Hypothesis, InvestigationEvent, InvestigationPeer, InvestigationStatus (+22 more)

### Community 8 - "Data Import Core & Validation"
Cohesion: 0.10
Nodes (35): MappingConfig, ValidationIssue, affectedDateIds(), archiveRawFile(), backfillCellDims(), buildClean(), CANDIDATE_DATE_PATTERNS, count() (+27 more)

### Community 9 - "CSV & Excel Telemetry Parsers"
Cohesion: 0.12
Nodes (32): CsvSample, parseRecord(), CellLike, cellToText(), csvField(), DATE_ALIASES, dateColumnIndexes(), dateToText() (+24 more)

### Community 10 - "Application Shell & Navigation"
Cohesion: 0.12
Nodes (24): PeriodId, App(), ALL_MODULES, CreateWorkspaceModal(), MODULE_GROUPS, ModuleDef, ModulePlaceholder(), NcIntelligence() (+16 more)

### Community 11 - "NC Lifecycle & Priority Engine"
Cohesion: 0.09
Nodes (26): DynamicKpiCardData, ExecutiveOverviewResult, KpiOverviewResult, KpiTrendPoint, NcMovementRow, fmtCompactNumber(), fmtCompactRate(), fmtCompactVolume() (+18 more)

### Community 12 - "Canonical Data Schema & Archive"
Cohesion: 0.15
Nodes (30): ScatterPoint, importCoverage(), importHistory(), importQuality(), purgeRawArchive(), rawArchive(), registerIpc(), overrideDataDirs() (+22 more)

### Community 13 - "Network Explorer & Forecasting"
Cohesion: 0.10
Nodes (21): CellDetail, CellIntelligenceResult, CellIntelligenceRow, Grain, CellCompareModal(), cellDetailOption(), BAND_COLOR, LIFECYCLES (+13 more)

### Community 14 - "Workspace Snapshots & Lifecycle"
Cohesion: 0.08
Nodes (23): CellKpiValue, DueReport, ReportSnapshot, csvLine(), escCsv(), ExcelChart, historyPath(), JSZipLike (+15 more)

### Community 15 - "Derived KPI Engine & Formulas"
Cohesion: 0.13
Nodes (24): DerivedKPI, KpiDefPatch, ensureDerivedKpiSchema(), listDerivedKpis(), saveDerivedKpi(), conn(), discoverCurrent(), discoverKpiDefs() (+16 more)

### Community 16 - "Background Import Worker Thread"
Cohesion: 0.15
Nodes (23): runImportCore(), closeHandles(), main(), post(), WorkerMessage, acquireLock(), lockPath(), releaseLock() (+15 more)

### Community 17 - "Ghana Geo Maps & Region Visualizer"
Cohesion: 0.14
Nodes (21): DistrictMapRow, RegionMapRow, GHANA_DISTRICTS_GEOJSON, GhanaDistrictFeature, GHANA_REGIONS_GEOJSON, GhanaFeature, cleanName(), fmt() (+13 more)

### Community 18 - "Build & Maintenance Scripts"
Cohesion: 0.10
Nodes (19): checkHeadroom(), { cleanSmokeTemp }, human(), { join }, PROJECT_ROOT, { readdirSync, statSync, rmSync, statfsSync }, RELEASE_DIR, cleanSmokeTemp() (+11 more)

### Community 19 - "Investigation & RCA Diagnostics"
Cohesion: 0.25
Nodes (18): axisLabelStyle(), Chart(), PALETTE, tooltipStyle(), rankingOption(), investigationChartOption(), CORE_COLORS, coreKpiNcRateOption() (+10 more)

### Community 20 - "TypeScript Web Configuration"
Cohesion: 0.09
Nodes (21): DOM, DOM.Iterable, src/renderer/**/*.ts, src/renderer/**/*.tsx, compilerOptions, composite, esModuleInterop, forceConsistentCasingInFileNames (+13 more)

### Community 21 - "Electron Vite Node Configuration"
Cohesion: 0.09
Nodes (21): electron.vite.config.ts, electron-vite/node, src/main/**/*.ts, src/preload/**/*.ts, compilerOptions, composite, esModuleInterop, forceConsistentCasingInFileNames (+13 more)

### Community 22 - "App Icon & Asset Generator"
Cohesion: 0.12
Nodes (18): BAR_CYAN, BAR_GREEN, BG_BOTTOM, BG_TOP, chunk(), crc32(), CRC_TABLE, encodePng() (+10 more)

### Community 23 - "Investigation & RCA Diagnostics"
Cohesion: 0.14
Nodes (8): RecentWorkspace, Summary, Technology, WorkspaceInfo, CellIntelligence(), openDistrict(), openInvestigation(), AppStore

### Community 24 - "Comparison Lab Delta Analytics"
Cohesion: 0.14
Nodes (17): CompareMetric, CompareScope, CompareSort, CompareView, ComparisonKpi, ComparisonResult, ComparisonRow, formatCompare() (+9 more)

### Community 25 - "Canonical Data Schema & Archive"
Cohesion: 0.10
Nodes (17): CoverageRow, FIELD_LABELS, FileAnalysis, GeoStatsResult, ImportAuditRow, ImportResult, PreviewResult, QualityRow (+9 more)

### Community 26 - "Automated Reporting Center"
Cohesion: 0.12
Nodes (15): DEFAULT_CHARTS, REPORT_SECTIONS, REPORT_TYPES, ReportDefinition, ReportFormat, ReportHistoryRow, ReportPack, setSchedule() (+7 more)

### Community 27 - "Electron Subsystem"
Cohesion: 0.11
Nodes (19): electron, electron-builder, electron-vite, devDependencies, electron, electron-builder, electron-vite, @types/node (+11 more)

### Community 28 - "Appstatedata Subsystem"
Cohesion: 0.18
Nodes (15): AppStateData, bootstrap(), createWindow(), restoreLastWorkspace(), broadcastWorkspaceChanged(), dirs, ensureDirs(), AppState (+7 more)

### Community 29 - "Network Explorer & Forecasting"
Cohesion: 0.17
Nodes (15): ForecastHorizon, ForecastResult, ForecastRisk, ForecastScope, fmtFc(), forecastChartOption(), rcaSunburstChartOption(), Forecasting() (+7 more)

### Community 30 - "Workspace Snapshots & Lifecycle"
Cohesion: 0.23
Nodes (16): CreateSnapshotOpts, PriorityCenterOpts, WORKSPACE_CHANGED, snapshotsDir(), revealReport(), compareSnapshots(), createSnapshot(), findRow() (+8 more)

### Community 31 - "Investigation & RCA Diagnostics"
Cohesion: 0.12
Nodes (10): EntityOption, InvestigationResult, EVENT_LABEL, fmtV(), InvestigationWorkspace(), PHRASE_TONE, SCOPES, STATUSES (+2 more)

### Community 32 - "ECharts Visualization Library"
Cohesion: 0.12
Nodes (17): @duckdb/node-api, echarts, dependencies, @duckdb/node-api, echarts, exceljs, pptxgenjs, react (+9 more)

### Community 33 - "Investigation & RCA Diagnostics"
Cohesion: 0.15
Nodes (12): ActionStatus, InvestigationScope, PriorityBand, PriorityCenterResult, PriorityCenterRow, setStatus(), BANDS, bandTone() (+4 more)

### Community 34 - "Network Explorer & Forecasting"
Cohesion: 0.25
Nodes (15): ForecastMethod, ForecastMetric, ForecastQuality, addPeriod(), clampDomain(), decomposeSeries(), forecastSeries(), forecastTrajectory() (+7 more)

### Community 35 - "Metricdistribution Subsystem"
Cohesion: 0.24
Nodes (13): MetricDistribution, PerformanceResult, configurableScatterOption(), distributionOption(), DynamicQuadrant, formatMetric(), formatMetricVal(), MetricMeta (+5 more)

### Community 36 - "Network Explorer & Forecasting"
Cohesion: 0.14
Nodes (15): demoCellDetail(), demoCellIdOf(), demoCellIntelligence(), demoCellKpis(), demoComparison(), demoExplorer(), demoHealth(), demoHealthMatrix() (+7 more)

### Community 37 - "Network Explorer & Forecasting"
Cohesion: 0.17
Nodes (12): KPI Import & Auto-Mapping Guide, Engineering Implementation Roadmap & Milestones, QOS Network Intelligence Project Overview, DuckDB Single-File Workspace Architecture, Holt-Winters & Organic Forecasting Engine, Investigation & RCA Diagnostics Workspace, 4G/3G/2G QoS Network Intelligence Master Design Spec, Multi-Technology 2G/3G/4G KPI Engine (+4 more)

### Community 38 - "Maintenanceaction Subsystem"
Cohesion: 0.20
Nodes (11): MaintenanceAction, MaintenanceResult, MaintenanceScheduleSettings, ScheduledMaintenanceRun, ScheduledRunResult, CurrentWs, DEFAULT_ACTIONS, hydrateSettings() (+3 more)

### Community 39 - "Build Subsystem"
Cohesion: 0.18
Nodes (11): build, appId, asarUnpack, directories, portable, productName, output, **/*.node (+3 more)

### Community 40 - "App Icon & Asset Generator"
Cohesion: 0.18
Nodes (11): scripts, build, clean:smoke-temp, dev, dist, dist:portable, icon, preview:web (+3 more)

### Community 41 - "Network Explorer & Forecasting"
Cohesion: 0.20
Nodes (9): Api, ComparisonType, ExplorerLevel, ForecastOpts, HealthScope, ImportProgress, ReportOpts, api (+1 more)

### Community 42 - "Demoreportpack Subsystem"
Cohesion: 0.18
Nodes (11): demoReportPack(), rCsv(), rCsvLine(), rCsvOut(), rDownload(), rfmt(), rfmtK(), rHtmlOut() (+3 more)

### Community 43 - "Package.json Subsystem"
Cohesion: 0.22
Nodes (8): author, description, license, main, name, private, productName, version

### Community 44 - "Buildexcelcharts Subsystem"
Cohesion: 0.39
Nodes (8): buildExcelCharts(), fmt(), svgEscape(), svgHBarChart(), svgLineChart(), svgToPng(), svgVBarChart(), truncate()

### Community 45 - "ECharts Visualization Library"
Cohesion: 0.29
Nodes (7): chartAnchorXml(), chartRef(), chartXml(), colLetter(), escXml(), injectNativeCharts(), nextRid()

### Community 46 - "Network Explorer & Forecasting"
Cohesion: 0.33
Nodes (7): demoForecast(), fcForecast(), fcHistory(), fcHoldout(), fcMean(), fcRisk(), fcTrend()

### Community 47 - "Investigation & RCA Diagnostics"
Cohesion: 0.29
Nodes (7): demoInvestigation(), demoPriorityCenter(), demoRegionDistricts(), demoReportMarkdown(), invFmt(), invKey(), invMetricValue()

### Community 48 - "Reportchartconfig Subsystem"
Cohesion: 0.40
Nodes (6): ReportChartConfig, ReportSectionId, ReportType, DefConfig, ReportDefinitionLike, SectionData

### Community 49 - "App Icon & Asset Generator"
Cohesion: 0.40
Nodes (5): win, icon, signAndEditExecutable, target, portable

### Community 50 - "App Icon & Asset Generator"
Cohesion: 0.50
Nodes (3): files, build/icon.ico, out/**/*

### Community 51 - "Buildnativecharttargets Subsystem"
Cohesion: 0.50
Nodes (4): buildNativeChartTargets(), numCell(), renderExcel(), xlsxWidth()

### Community 52 - "Isnumeric Subsystem"
Cohesion: 0.50
Nodes (4): isNumeric(), mapRow(), parseDateOk(), validateSample()

### Community 53 - "Automap Subsystem"
Cohesion: 0.67
Nodes (3): autoMap(), makeFingerprint(), normalizeHeader()

## Knowledge Gaps
- **283 isolated node(s):** `name`, `productName`, `version`, `description`, `author` (+278 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Technology` connect `Investigation & RCA Diagnostics` to `IPC Shared API & Contracts`, `Workspace Snapshots & Lifecycle`, `IPC Shared API & Contracts`, `Canonical Data Schema & Archive`, `Workspace Snapshots & Lifecycle`, `Network Explorer & Forecasting`, `Investigation & RCA Diagnostics`, `Application Shell & Navigation`, `NC Lifecycle & Priority Engine`, `Network Explorer & Forecasting`, `Derived KPI Engine & Formulas`, `Background Import Worker Thread`, `Ghana Geo Maps & Region Visualizer`, `Investigation & RCA Diagnostics`, `Network Explorer & Forecasting`, `Workspace Snapshots & Lifecycle`, `Investigation & RCA Diagnostics`, `Metricdistribution Subsystem`, `Network Explorer & Forecasting`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `useAppStore` connect `Application Shell & Navigation` to `IPC Shared API & Contracts`, `Workspace Snapshots & Lifecycle`, `Investigation & RCA Diagnostics`, `Metricdistribution Subsystem`, `NC Lifecycle & Priority Engine`, `NC Lifecycle & Priority Engine`, `Network Explorer & Forecasting`, `Ghana Geo Maps & Region Visualizer`, `Investigation & RCA Diagnostics`, `Investigation & RCA Diagnostics`, `Comparison Lab Delta Analytics`, `Canonical Data Schema & Archive`, `Automated Reporting Center`, `Network Explorer & Forecasting`, `Investigation & RCA Diagnostics`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `AppStore` connect `Investigation & RCA Diagnostics` to `Workspace Snapshots & Lifecycle`, `Application Shell & Navigation`, `Network Explorer & Forecasting`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `name`, `productName`, `version` to the rest of the system?**
  _283 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `IPC Shared API & Contracts` be split into smaller, more focused modules?**
  _Cohesion score 0.024390243902439025 - nodes in this community are weakly interconnected._
- **Should `Workspace Snapshots & Lifecycle` be split into smaller, more focused modules?**
  _Cohesion score 0.06874717322478517 - nodes in this community are weakly interconnected._
- **Should `IPC Shared API & Contracts` be split into smaller, more focused modules?**
  _Cohesion score 0.03333333333333333 - nodes in this community are weakly interconnected._