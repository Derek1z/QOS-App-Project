/** Shared contracts between the Electron main process (IPC) and the renderer.
 *  This file must stay free of node/electron imports so both tsconfigs can use it. */

export interface RecentWorkspace {
  path: string
  name: string
  lastOpened: string
}

export type Technology = '2G' | '3G' | '4G'

export interface WorkspaceInfo {
  path: string
  name: string
  readOnly: boolean
  schemaVersion: string
  createdAt: string | null
  sizeBytes: number
  rowCount: number
  minDate: string | null
  maxDate: string | null
  dims: { regions: number; districts: number; sites: number; cells: number }
  rulesetVersion: number | null
  /** Network technology this workspace is scoped to (workspace_meta). */
  technology: Technology
}

// --- per-technology KPI definition registry (spec §54a) ---------------------

/** How an extra (non-canonical) KPI is rolled up from daily facts. */
export type KpiAgg = 'avg' | 'sum' | 'max' | 'min'

export interface KpiDefinition {
  kpiId: number
  technology: Technology
  /** stable machine key, e.g. 'tch_congestion' — also the import column key */
  key: string
  label: string
  unit: string
  /** true = higher values are worse (congestion, drop rate); false = higher is better */
  worseIsHigher: boolean
  /** editable target/objective for breach flags and scoring */
  target: number | null
  agg: KpiAgg
  /** source header aliases matched during import auto-mapping */
  sourceHeaders: string[]
  isCustom: boolean
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type KpiDefPatch = Partial<
  Omit<KpiDefinition, 'createdAt' | 'updatedAt'>
>

/** One cell's value for one extra KPI in the latest week. */
export interface CellKpiValue {
  key: string
  label: string
  unit: string
  value: number | null
  target: number | null
  worseIsHigher: boolean
  /** value breaches the target in the worse direction */
  breached: boolean
}

/** KPI discovery result: source headers -> best-matching KPI keys. */
export interface KpiDiscovery {
  /** header (as written in the file) -> kpi key */
  mapping: Record<string, string>
  confidence: number
}

export interface Summary {
  rowCount: number
  minDate: string | null
  maxDate: string | null
  cells: number
  sites: number
  districts: number
  regions: number
  rulesetVersion: number | null
  weeklyNcCells: number
  weeklyTotalRows: number
  avgPrb: number | null
  totalVolumeMb: number | null
  totalUsers: number | null
  avgThroughputKbps: number | null
  avgAvailability: number | null
}

export interface AppStateData {
  recentWorkspaces: RecentWorkspace[]
  lastWorkspacePath?: string
  theme: 'dark'
  density: 'compact'
}

// --- import pipeline contracts (spec §12-§18) ---

export type CanonicalField =
  | 'date'
  | 'cell'
  | 'district'
  | 'region'
  | 'site'
  | 'prb'
  | 'users'
  | 'volume'
  | 'availability'
  | 'throughput'

export const FIELD_LABELS: Record<CanonicalField, string> = {
  date: 'Date / Time',
  cell: 'Cell',
  district: 'District',
  region: 'Region',
  site: 'Site / Base Station',
  prb: 'PRB Utilization (%)',
  users: 'Connected Users',
  volume: 'Data Volume (MB)',
  availability: 'Availability (%)',
  throughput: 'DL Throughput (kbps)'
}

export const FIELD_ORDER: CanonicalField[] = [
  'date', 'cell', 'district', 'region', 'site',
  'prb', 'users', 'volume', 'availability', 'throughput'
]

export interface FileAnalysis {
  id: string
  path: string
  filename: string
  header: string[]
  sample: string[][]
  fingerprint: string
  suggestedMapping: Record<string, CanonicalField>
  confidence: number
  knownProfile: boolean
  errors: string[]
}

export interface MappingConfig {
  columns: Record<string, CanonicalField>
  /** extra columns mapped to per-technology KPI keys (spec §54a):
   *  source header -> KpiDefinition.key */
  kpiColumns?: Record<string, string>
}

export type IssueSeverity = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  severity: IssueSeverity
  message: string
  count?: number
}

export interface PreviewResult {
  rows: Array<Record<string, string | null>>
  issues: ValidationIssue[]
  canImport: boolean
}

export interface ImportResult {
  importId: number
  filename: string
  sourceRows: number
  insertedRows: number
  duplicatesIgnored: number
  rejectedRows: number
  newCells: number
  issues: ValidationIssue[]
  qualityScore: number
  durationMs: number
  backupPath: string | null
  /** gzip-archived copy of the raw source (spec §9), if the archive succeeded */
  archivePath: string | null
  /** when the raw copy is purged (import time + 90 days) */
  retentionUntil: string | null
}

export interface ImportAuditRow {
  importId: number
  importedAt: string
  files: string
  sourceRows: number
  insertedRows: number
  duplicatesIgnored: number
  rejectedRows: number
  mappingProfile: string | null
  rulesetVersion: number | null
}

export interface CoverageRow {
  date: string
  observedCells: number
  expectedCells: number
  coveragePct: number
}

export interface QualityRow {
  date: string
  coveragePct: number
  completenessPct: number
  score: number
}

// --- raw-source archive & retention (spec §9) ------------------------------

export type RawArchiveStatusKind = 'retained' | 'expiring' | 'expired'

export interface RawArchiveRow {
  archiveId: number
  importId: number
  filename: string
  sizeBytes: number
  checksum: string
  importedAt: string
  retentionUntil: string
  daysLeft: number
  status: RawArchiveStatusKind
}

export interface RawArchiveStatus {
  total: number
  totalBytes: number
  retained: number
  expiring: number
  expired: number
}

export interface RawArchiveResult {
  rows: RawArchiveRow[]
  status: RawArchiveStatus
}

// --- workspace snapshots (spec §7) ------------------------------------------

export interface WorkspaceSnapshot {
  snapshotId: number
  name: string
  reason: string | null
  notes: string | null
  createdAt: string
  sizeBytes: number
  path: string
}

export interface CreateSnapshotOpts {
  reason?: string
  notes?: string
}

/** Diff two point-in-time snapshots across KPIs (spec §7: snapshots are for
 *  analytical milestones — measuring the change is as important as restoring). */
export interface SnapshotComparisonKpi {
  key: string
  label: string
  unit: string
  a: number | null
  b: number | null
  delta: number | null
  deltaPct: number | null
  worseIsHigher: boolean
}

export interface SnapshotComparison {
  a: { snapshotId: number; name: string; createdAt: string }
  b: { snapshotId: number; name: string; createdAt: string }
  kpis: SnapshotComparisonKpi[]
}

// --- workspace maintenance (spec §58) ---------------------------------------

export type MaintenanceAction =
  | 'integrity' // verify database integrity (read-only)
  | 'optimize'  // PRAGMA optimize + CHECKPOINT
  | 'rebuild'   // full aggregate + intelligence recompute (backup first)
  | 'compact'   // copy-database compaction into a fresh file (backup first)
  | 'purge'     // purge expired raw-source copies (§9)
  | 'storage'   // storage analysis (read-only)

export interface MaintenanceResult {
  action: MaintenanceAction
  ok: boolean
  message: string
  startedAt: string
  durationMs: number
  detail?: unknown
}

/** Scheduler settings (workspace-scoped, single row). */
export interface MaintenanceScheduleSettings {
  enabled: boolean
  /** Hours between scheduled runs: 1–168 (weekly). */
  cadenceHours: number
  /** Actions to run automatically. 'storage' is excluded (read-only analysis). */
  actions: MaintenanceAction[]
  /** Also run a due check whenever the workspace opens writable. */
  runOnOpen: boolean
  lastRunAt: string | null
  lastOk: boolean | null
  lastSummary: string | null
  /** Computed: lastRunAt + cadence (or now if never run and enabled). */
  nextRunAt: string | null
}

/** One scheduled maintenance run, persisted for history. */
export interface ScheduledMaintenanceRun {
  runId: number
  ranAt: string
  ok: boolean
  actions: MaintenanceAction[]
  summary: string
  durationMs: number
}

export interface ScheduledRunResult {
  ok: boolean
  results: MaintenanceResult[]
  ran: boolean
  summary: string
  skippedReason?: string
}

// --- M2 analytics engine contracts (spec §20-§22, §35-§39, §43, §29) ---

export type Lifecycle = 'Healthy' | 'New NC' | 'Recurring NC' | 'Persistent NC' | 'Recovering'
export type Trend = 'Improving' | 'Stable' | 'Worsening'
export type Severity = 'Normal' | 'Watch' | 'High' | 'Critical'
export type PriorityMode = 'balanced' | 'customer' | 'congestion' | 'persistence' | 'deterioration'
export type PriorityBand = 'Critical' | 'High' | 'Medium' | 'Watch' | 'Low'

export const PRIORITY_MODES: PriorityMode[] = ['balanced', 'customer', 'congestion', 'persistence', 'deterioration']

export interface NcLifecycleRow {
  cellId: number
  cellName: string
  site: string | null
  district: string | null
  region: string | null
  weekStart: string
  isNc: boolean
  lifecycle: Lifecycle
  trend: Trend
  severity: Severity
  breachDays: number
  prbAvg: number | null
}

export interface NcLifecycleResult {
  weekStart: string | null
  totalCells: number
  ncCells: number
  ncRate: number | null
  byLifecycle: Record<Lifecycle, number>
  byTrend: Record<Trend, number>
  bySeverity: Record<Severity, number>
  cells: NcLifecycleRow[]
}

export interface NcMovementRow {
  weekStart: string
  newNc: number
  recurring: number
  persistent: number
  recovering: number
  ncCells: number
  totalCells: number
  ncRate: number | null
}

export interface PriorityRow {
  cellId: number
  cellName: string
  site: string | null
  district: string | null
  region: string | null
  asOf: string
  score: number
  band: PriorityBand
  mode: PriorityMode
  components: {
    prbSeverity: number
    persistence: number
    userImpact: number
    trafficImpact: number
    throughputDegradation: number
    worseningTrend: number
  }
}

export interface HealthComponentRow {
  asOf: string
  score: number
  capacity: number
  throughput: number
  availability: number
  ncRecurrence: number
  growth: number
}

export interface CellHealthRow {
  cellId: number
  cellName: string
  site: string | null
  district: string | null
  region: string | null
  weekStart: string
  healthScore: number
}

export interface HealthResult {
  network: HealthComponentRow[]
  cells: CellHealthRow[]
}

export type HealthScope = 'cell' | 'site' | 'district' | 'region'

export interface HealthMatrixRow {
  id: number
  name: string
  scores: Array<number | null>
}

export interface HealthMatrixResult {
  scope: HealthScope
  weeks: string[]
  rows: HealthMatrixRow[]
}

export interface CellIntelligenceRow {
  cellId: number
  cellName: string
  site: string | null
  district: string | null
  region: string | null
  weekStart: string
  isNc: boolean
  lifecycle: Lifecycle
  trend: Trend
  severity: Severity
  prbAvg: number | null
  breachDays: number
  throughputKbps: number | null
  users: number | null
  volumeMb: number | null
  availability: number | null
  priorityScore: number | null
  priorityBand: PriorityBand | null
  /** extra per-technology KPI values for the latest week (spec §54a) */
  kpis: CellKpiValue[]
}

export interface CellIntelligenceResult {
  total: number
  rows: CellIntelligenceRow[]
}

export interface CellWeekPoint {
  weekStart: string
  prbAvg: number | null
  throughputKbps: number | null
  users: number | null
  volumeMb: number | null
  availability: number | null
  breachDays: number
  isNc: boolean
  lifecycle: Lifecycle
  severity: Severity
}

export interface CellDetail {
  cellId: number
  cellName: string
  site: string | null
  district: string | null
  region: string | null
  current: {
    weekStart: string
    lifecycle: Lifecycle
    trend: Trend
    severity: Severity
    priorityScore: number | null
    priorityBand: PriorityBand | null
    prbAvg: number | null
  } | null
  weeks: CellWeekPoint[]
}

export type PerfMetric = 'prb' | 'throughput' | 'users' | 'volume' | 'availability'

export interface PercentilePoint {
  p: number
  value: number | null
}

export interface MetricDistribution {
  metric: PerfMetric
  label: string
  unit: string
  points: PercentilePoint[]
  mean: number | null
  min: number | null
  max: number | null
  p50: number | null
  p90: number | null
  n: number
}

export type ScatterQuadrant = 'congested' | 'busy' | 'quiet' | 'healthy'

export interface ScatterPoint {
  cellId: number
  cellName: string
  district: string | null
  region: string | null
  prb: number | null
  throughputKbps: number | null
  users: number | null
  isNc: boolean
  quadrant: ScatterQuadrant
}

export interface CorrelationRow {
  a: PerfMetric
  b: PerfMetric
  pearson: number | null
  n: number
}

export interface PerformanceResult {
  weekStart: string
  totalCells: number
  prbThreshold: number
  throughputMedianKbps: number | null
  distributions: MetricDistribution[]
  scatter: ScatterPoint[]
  correlations: CorrelationRow[]
}

export type ComparisonType = 'period' | 'region'
export type CompareScope = 'cell' | 'site' | 'district' | 'region'
export type CompareMetric = PerfMetric | 'nc'
export type CompareView = 'actual' | 'indexed' | 'delta'
export type CompareSort = 'worst' | 'best' | 'name'
export type NcTransition = 'nc' | 'new' | 'recovered' | 'ok'

export interface ComparisonKpi {
  metric: CompareMetric
  label: string
  unit: string
  worseIsHigher: boolean
  current: number | null
  previous: number | null
  delta: number | null
  deltaPct: number | null
  best: number | null
  worst: number | null
}

export interface ComparisonRow {
  id: number
  name: string
  current: number | null
  previous: number | null
  delta: number | null
  deltaPct: number | null
  ncCells: number
  cells: number
  transition: NcTransition | null
}

export interface ComparisonResult {
  type: ComparisonType
  scope: CompareScope
  metric: CompareMetric
  aLabel: string
  bLabel: string
  totalRows: number
  kpis: ComparisonKpi[]
  rows: ComparisonRow[]
}

export type ExplorerLevel = 'region' | 'district' | 'site' | 'cell'

export interface ExplorerNode {
  id: number
  name: string
  level: ExplorerLevel
  healthScore: number | null
  ncCells: number
  cells: number
  prbAvg: number | null
  throughputKbps: number | null
  users: number | null
  volumeMb: number | null
  availability: number | null
  isNc: boolean
  lifecycle: Lifecycle | null
  severity: Severity | null
  priorityScore: number | null
  priorityBand: PriorityBand | null
}

export interface ExplorerBreadcrumb {
  id: number
  name: string
  level: ExplorerLevel
}

export interface ExplorerResult {
  level: ExplorerLevel
  parentId: number | null
  breadcrumb: ExplorerBreadcrumb[]
  nodes: ExplorerNode[]
  ncCells: number
  totalCells: number
}

// --- Ghana map (Executive Overview): per-region KPIs + district drill-down ---

export interface RegionMapRow {
  id: number
  name: string
  cells: number
  ncCells: number
  healthScore: number | null
  prbAvg: number | null
  throughputKbps: number | null
  users: number | null
  volumeMb: number | null
  availability: number | null
}

export interface DistrictMapRow extends RegionMapRow {
  region: string | null
}

export type InvestigationScope = 'cell' | 'site' | 'district'
export type ActionStatus =
  | 'Unreviewed'
  | 'Investigating'
  | 'Escalated'
  | 'Optimization in progress'
  | 'Monitoring'
  | 'Resolved'
  | 'Deferred'

export interface InvestigationStatus {
  status: ActionStatus | null
  owner: string | null
  externalTicket: string | null
  targetReviewDate: string | null
  updatedAt: string | null
}

export interface EvidenceKpi {
  metric: PerfMetric | 'nc'
  label: string
  unit: string
  current: number | null
  previous: number | null
  delta: number | null
  deltaPct: number | null
  worseIsHigher: boolean
}

export interface DiagnosisFinding {
  id: string
  level: 'evidence' | 'suggestion' | 'conclusion'
  phrase: 'consistent with' | 'suggests' | 'evidence supports' | 'evidence contradicts'
  text: string
}

export interface Hypothesis {
  id: string
  title: string
  score: number
  verdict: 'consistent' | 'suggests' | 'not supported'
  supporting: string[]
  contradicting: string[]
}

export interface InvestigationEvent {
  id: number
  occurredAt: string
  kind: string
  note: string | null
  author: string | null
}

export interface BeforeAfterMetric {
  metric: PerfMetric | 'nc'
  label: string
  unit: string
  before: number | null
  after: number | null
  deltaPct: number | null
  improved: boolean | null
}

export interface InvestigationWeek {
  weekStart: string
  prbAvg: number | null
  throughputKbps: number | null
  users: number | null
  volumeMb: number | null
  availability: number | null
  isNc: boolean
  lifecycle: Lifecycle | null
}

export interface InvestigationPeer {
  name: string
  prbAvg: number | null
  throughputKbps: number | null
  healthScore: number | null
  ncCells: number
}

export interface InvestigationResult {
  scope: InvestigationScope
  entityId: number
  entityName: string
  path: string[]
  current: {
    weekStart: string
    lifecycle: Lifecycle | null
    trend: Trend | null
    severity: Severity | null
    priorityScore: number | null
    priorityBand: PriorityBand | null
    prbAvg: number | null
    isNc: boolean
  } | null
  evidence: EvidenceKpi[]
  findings: DiagnosisFinding[]
  hypotheses: Hypothesis[]
  events: InvestigationEvent[]
  status: InvestigationStatus
  beforeAfter: BeforeAfterMetric[]
  interventionWeek: string | null
  weeks: InvestigationWeek[]
  peers: InvestigationPeer[]
}

export interface InvestigationReport {
  path: string
  markdown: string
}

export interface EntityOption {
  id: number
  name: string
  path: string[]
}

// --- forecasting & early warning (§45–46) ----------------------------------

export type ForecastMetric = 'prb' | 'traffic' | 'users' | 'throughput' | 'availability'
export type ForecastRisk = 'Stable' | 'Watch' | 'At Risk' | 'Likely Breach' | 'Already Breached'
export type ForecastHorizon = '1w' | '2w' | '4w' | '6w'
export type ForecastMethod = 'moving-average' | 'linear-trend' | 'suppressed'
export type ForecastQuality = 'high' | 'medium' | 'low' | 'suppressed'
export type ForecastScope = 'network' | 'region' | 'district' | 'site' | 'cell'

export interface ForecastPoint {
  weekStart: string
  label: string
  value: number | null
  kind: 'actual' | 'forecast'
  lower: number | null
  upper: number | null
}

export interface ForecastSummary {
  method: ForecastMethod
  quality: ForecastQuality
  next: number | null
  lower: number | null
  upper: number | null
  confidence: number | null
  mae: number | null
  rmse: number | null
  directionalAccuracy: number | null
  explanation: string
}

export interface ForecastSeries {
  metric: ForecastMetric
  label: string
  unit: string
  worseIsHigher: boolean
  threshold: number | null
  points: ForecastPoint[]
  forecast: ForecastSummary
}

export interface ForecastRiskRow {
  id: number
  name: string
  path: string[]
  current: number | null
  forecast: number | null
  threshold: number | null
  risk: ForecastRisk
  explanation: string
  cells: number
  ncCells: number
}

export interface ForecastResult {
  asOf: string
  horizon: ForecastHorizon
  metric: ForecastMetric
  entity: { scope: ForecastScope; id: number | null; name: string; path: string[] }
  series: ForecastSeries[]
  risk: ForecastRisk
  riskExplanation: string
  riskCounts: Record<ForecastRisk, number>
  riskRows: ForecastRiskRow[]
  totalEntities: number
}

export interface ForecastOpts {
  scope?: ForecastScope
  entityId?: number | null
  metric?: ForecastMetric
  horizon?: ForecastHorizon
}

// --- reporting center (§51–56) ---------------------------------------------

export type ReportType = 'executive' | 'engineering' | 'investigation' | 'capacity' | 'custom'
export type ReportFormat = 'md' | 'csv' | 'html' | 'pdf' | 'xlsx' | 'pptx'
export type ReportSectionId =
  | 'executive-summary'
  | 'kpi-trend'
  | 'region-analysis'
  | 'district-analysis'
  | 'site-analysis'
  | 'all-cells'
  | 'nc-register'
  | 'persistent-nc'
  | 'priority-queue'
  | 'forecast-risk'
  | 'health-matrix'
  | 'lifecycle-analysis'

export interface ReportSectionDef {
  id: ReportSectionId
  label: string
  blurb: string
  defaultFor: ReportType[]
}

export const REPORT_TYPES: Array<{ id: ReportType; label: string }> = [
  { id: 'executive', label: 'Executive' },
  { id: 'engineering', label: 'Engineering' },
  { id: 'investigation', label: 'Investigation' },
  { id: 'capacity', label: 'Capacity Watch' },
  { id: 'custom', label: 'Custom' }
]

export const REPORT_SECTIONS: ReportSectionDef[] = [
  { id: 'executive-summary', label: 'Executive Summary', blurb: 'KPI strip, health score, top priorities', defaultFor: ['executive', 'custom'] },
  { id: 'kpi-trend', label: 'KPI Trend', blurb: 'NC movement and network health over weeks', defaultFor: ['executive', 'engineering', 'custom'] },
  { id: 'region-analysis', label: 'Region Analysis', blurb: 'Region roll-ups, worst first', defaultFor: ['executive', 'engineering', 'custom'] },
  { id: 'district-analysis', label: 'District Analysis', blurb: 'District roll-ups, worst first', defaultFor: ['engineering', 'custom'] },
  { id: 'site-analysis', label: 'Site Analysis', blurb: 'Site roll-ups, worst first', defaultFor: ['engineering', 'custom'] },
  { id: 'all-cells', label: 'All Cells', blurb: 'Every cell with lifecycle/trend/severity/priority', defaultFor: ['engineering', 'custom'] },
  { id: 'nc-register', label: 'NC Register', blurb: 'All NC cells with lifecycle + severity', defaultFor: ['engineering', 'investigation', 'custom'] },
  { id: 'persistent-nc', label: 'Persistent NC', blurb: 'Persistent NC cells requiring escalation', defaultFor: ['investigation', 'capacity', 'custom'] },
  { id: 'priority-queue', label: 'Priority Queue', blurb: 'Top priority cells with scores and bands', defaultFor: ['executive', 'engineering', 'capacity', 'custom'] },
  { id: 'forecast-risk', label: 'Forecast Risk', blurb: 'At-risk cells from the forecast engine', defaultFor: ['executive', 'capacity', 'custom'] },
  { id: 'health-matrix', label: 'Health Matrix', blurb: 'Cell × week health scores', defaultFor: ['capacity', 'custom'] },
  { id: 'lifecycle-analysis', label: 'Lifecycle Analysis', blurb: 'NC lifecycle/trend/severity counts', defaultFor: ['engineering', 'investigation', 'custom'] }
]

export interface ReportDefinition {
  id: number
  name: string
  type: ReportType
  sections: ReportSectionId[]
  schedule: string | null
  charts: ReportChartConfig
  lastGenerated: string | null
  createdAt: string
}

export interface ReportHistoryRow {
  id: string
  name: string
  type: ReportType
  sections: ReportSectionId[]
  formats: ReportFormat[]
  rulesetVersion: number | null
  createdAt: string
  path: string
}

export interface ReportSnapshot {
  scope: string
  asOf: string
  rulesetVersion: number | null
  thresholds: Record<string, number | null>
  kpis: Record<string, number | null>
  classifications: Record<string, number>
  ncCount: number
  note: string
}

export interface ReportPack {
  id: string
  name: string
  type: ReportType
  sections: ReportSectionId[]
  formats: ReportFormat[]
  files: Partial<Record<ReportFormat, { path: string; content: string }>>
  rulesetVersion: number | null
  asOf: string
  snapshot: ReportSnapshot
}

/** Native-chart configuration for the Excel pack (§53): which sheets get a
 *  chart and (for the KPI Trend line chart) which metric to plot. */
export interface ReportChartConfig {
  kpiTrend: { enabled: boolean; metric: 'health' | 'nc' }
  executive: { enabled: boolean }
  region: { enabled: boolean }
  district: { enabled: boolean }
  site: { enabled: boolean }
}

export const DEFAULT_CHARTS: ReportChartConfig = {
  kpiTrend: { enabled: true, metric: 'health' },
  executive: { enabled: true },
  region: { enabled: true },
  district: { enabled: true },
  site: { enabled: true }
}

export interface ReportOpts {
  type?: ReportType
  sections?: ReportSectionId[]
  name?: string
  formats?: ReportFormat[]
  charts?: ReportChartConfig
  definitionId?: number
}

/** A saved report definition whose schedule is due (spec §56). */
export interface DueReport {
  definitionId: number
  name: string
  type: ReportType
  schedule: string
  lastGenerated: string | null
  nextDue: string
  overdueDays: number
}

export interface PriorityCenterRow {
  id: number
  name: string
  scope: InvestigationScope
  path: string[]
  priorityScore: number | null
  priorityBand: PriorityBand | null
  status: ActionStatus | null
  owner: string | null
  externalTicket: string | null
  targetReviewDate: string | null
  overdue: boolean
  ncCells: number
  cells: number
  prbAvg: number | null
}

export interface PriorityCenterResult {
  total: number
  rows: PriorityCenterRow[]
  byStatus: Record<string, number>
  overdue: number
}

export interface PriorityCenterOpts {
  scope?: InvestigationScope
  mode?: PriorityMode
  status?: ActionStatus | 'unset' | ''
  band?: PriorityBand | ''
  search?: string
  overdueOnly?: boolean
  sort?: 'priority' | 'due' | 'name'
  limit?: number
  offset?: number
}

export interface Rules {
  version: number
  createdAt: string
  prbThresholdPct: number
  weeklyBreachDays: number
  persistentWeeks: number
  districtNcThresholdPct: number
  priorityWeights: number[]
  notes: string | null
}

export type RulesPatch = Partial<
  Omit<Rules, 'version' | 'createdAt'>
>

/** Progress event streamed from the import worker while a CSV is being staged,
 *  validated, merged and re-aggregated (M5 background-import hardening). */
export interface ImportProgress {
  phase: string
  detail?: string
}

export interface Api {
  files: {
    path(file: File): string
  }
  imports: {
    analyze(paths: string[]): Promise<FileAnalysis[]>
    preview(id: string, mapping: MappingConfig): Promise<PreviewResult>
    run(id: string, mapping: MappingConfig): Promise<ImportResult>
    history(): Promise<ImportAuditRow[]>
    coverage(): Promise<CoverageRow[]>
    quality(): Promise<QualityRow[]>
    onProgress(cb: (p: ImportProgress) => void): () => void
    /** raw-source archive index (spec §9): retained files + retention status */
    archive(): Promise<RawArchiveResult>
    /** delete raw copies past their 90-day retention window */
    purgeArchive(): Promise<RawArchiveStatus>
  }
  workspace: {
    listRecent(): Promise<RecentWorkspace[]>
    pickOpen(): Promise<string | null>
    pickDirectory(): Promise<string | null>
    create(dir: string, name: string, technology?: Technology): Promise<WorkspaceInfo>
    open(path: string, opts?: { readOnly?: boolean }): Promise<WorkspaceInfo>
    close(): Promise<void>
    info(): Promise<WorkspaceInfo | null>
    onChanged(cb: () => void): () => void
    snapshots(): Promise<WorkspaceSnapshot[]>
    createSnapshot(name: string, opts?: CreateSnapshotOpts): Promise<WorkspaceSnapshot>
    restoreSnapshot(id: number): Promise<WorkspaceInfo>
    removeSnapshot(id: number): Promise<void>
    compareSnapshots(aId: number, bId: number): Promise<SnapshotComparison>
  }
  maintenance: {
    run(action: MaintenanceAction): Promise<MaintenanceResult>
    getSchedule(): Promise<MaintenanceScheduleSettings>
    setSchedule(patch: {
      enabled?: boolean
      cadenceHours?: number
      actions?: MaintenanceAction[]
      runOnOpen?: boolean
    }): Promise<MaintenanceScheduleSettings>
    /** Run the scheduled actions now, regardless of cadence. */
    runScheduled(): Promise<ScheduledRunResult>
    scheduleHistory(limit?: number): Promise<ScheduledMaintenanceRun[]>
  }
  analytics: {
    summary(): Promise<Summary | null>
    ncLifecycle(): Promise<NcLifecycleResult>
    ncMovement(limit?: number): Promise<NcMovementRow[]>
    priorityQueue(mode: PriorityMode, limit?: number): Promise<PriorityRow[]>
    health(): Promise<HealthResult>
    healthMatrix(
      scope: HealthScope,
      opts?: { weeks?: number; limit?: number; sort?: 'worst' | 'name' }
    ): Promise<HealthMatrixResult>
    cellIntelligence(opts?: {
      search?: string
      lifecycle?: Lifecycle | ''
      trend?: Trend | ''
      severity?: Severity | ''
      minPriority?: number
      limit?: number
      offset?: number
    }): Promise<CellIntelligenceResult>
    cellDetail(cellId: number): Promise<CellDetail | null>
    performance(): Promise<PerformanceResult>
    comparison(opts?: {
      type?: ComparisonType
      scope?: CompareScope
      metric?: CompareMetric
    }): Promise<ComparisonResult>
    explorer(
      level: ExplorerLevel,
      parentId?: number | null,
      opts?: { q?: string }
    ): Promise<ExplorerResult>
    /** Ghana map: one row per region with latest-week KPIs. */
    regionMap(): Promise<RegionMapRow[]>
    /** Ghana map drill-down: districts of one region with latest-week KPIs. */
    regionDistricts(regionId: number): Promise<DistrictMapRow[]>
    priorityCenter(opts?: PriorityCenterOpts): Promise<PriorityCenterResult>
    forecast(opts?: ForecastOpts): Promise<ForecastResult>
  }
  rules: {
    get(): Promise<Rules | null>
    update(patch: RulesPatch): Promise<Rules>
  }
  kpis: {
    /** all definitions for one technology (or all if omitted) */
    list(technology?: Technology): Promise<KpiDefinition[]>
    /** insert or update a definition (matched on technology+key) */
    save(def: KpiDefinition | KpiDefPatch): Promise<KpiDefinition>
    remove(kpiId: number): Promise<void>
    /** match source headers to KPI aliases for import auto-mapping */
    discover(headers: string[], technology?: Technology): Promise<KpiDiscovery>
    /** (re)create the built-in per-technology seed sets */
    seed(technology?: Technology): Promise<KpiDefinition[]>
  }
  investigation: {
    search(scope: InvestigationScope, q?: string): Promise<EntityOption[]>
    get(
      scope: InvestigationScope,
      entityId: number,
      opts?: { interventionWeek?: string }
    ): Promise<InvestigationResult | null>
    setStatus(
      scope: InvestigationScope,
      entityId: number,
      patch: {
        status?: ActionStatus | null
        owner?: string | null
        externalTicket?: string | null
        targetReviewDate?: string | null
      }
    ): Promise<InvestigationStatus>
    addNote(scope: InvestigationScope, entityId: number, note: string): Promise<InvestigationEvent>
    exportReport(scope: InvestigationScope, entityId: number): Promise<InvestigationReport | null>
  }
  reports: {
    generate(opts?: ReportOpts): Promise<ReportPack>
    definitions(): Promise<ReportDefinition[]>
    saveDefinition(
      name: string,
      type: ReportType,
      sections: ReportSectionId[],
      schedule?: string | null,
      charts?: ReportChartConfig
    ): Promise<ReportDefinition>
    due(): Promise<DueReport[]>
    history(): Promise<ReportHistoryRow[]>
    reveal(path: string): Promise<void>
  }
  appState: {
    get(): Promise<AppStateData>
    set(patch: Partial<AppStateData>): Promise<AppStateData>
  }
}
