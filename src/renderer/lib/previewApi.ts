import type {
  Api, WorkspaceInfo, FileAnalysis, MappingConfig, PreviewResult, ImportResult, ImportAuditRow,
  CoverageRow, QualityRow, CanonicalField, ValidationIssue, NcLifecycleResult, GeoStatsResult,
  PriorityRow, HealthResult, NcMovementRow, HealthScope, HealthMatrixResult,
  CellIntelligenceResult, CellIntelligenceRow, CellDetail, Lifecycle, Trend, Severity,
  Rules, RulesPatch, PriorityMode, PerformanceResult, MetricDistribution,
  PercentilePoint, PerfMetric, ScatterPoint,  ComparisonResult, ComparisonKpi,
  ComparisonRow, ComparisonType, CompareScope, CompareMetric, NcTransition,
  ExplorerLevel, ExplorerResult, ExplorerNode, ExplorerBreadcrumb,
  RegionMapRow, DistrictMapRow,
  InvestigationScope, InvestigationResult, InvestigationStatus, EvidenceKpi,
  DiagnosisFinding, Hypothesis, InvestigationEvent, BeforeAfterMetric,
  InvestigationWeek, InvestigationPeer, EntityOption, ActionStatus,
  InvestigationReport, PriorityCenterResult, PriorityCenterRow, PriorityCenterOpts,
  PriorityBand, ForecastMetric, ForecastRisk, ForecastHorizon, ForecastMethod,
  ForecastQuality, ForecastScope, ForecastResult, ForecastSeries, ForecastPoint,
  ForecastRiskRow, ForecastOpts, ReportType, ReportSectionId, ReportFormat,
  ReportPack, ReportOpts, ReportDefinition, ReportHistoryRow, ReportSnapshot,
  ReportSectionDef, DueReport, ImportProgress, RawArchiveResult, RawArchiveRow,
  RawArchiveStatus, WorkspaceSnapshot, CreateSnapshotOpts, SnapshotComparison,
  SnapshotComparisonKpi, MaintenanceAction, MaintenanceResult,
  MaintenanceScheduleSettings, ScheduledMaintenanceRun, ScheduledRunResult,
  ReportChartConfig, KpiDefinition, KpiDefPatch, KpiDiscovery, CellKpiValue, Technology,
  KpiOverviewResult, KpiOverviewKpi, KpiOverviewCell, KpiTrendPoint
} from '../../../shared/api'
import { DEFAULT_CHARTS, FIELD_ORDER, PRIORITY_MODES, REPORT_SECTIONS, REPORT_TYPES } from '../../../shared/api'
import { weekLabel } from './overviewCharts'

/** Browser-only stub installed when the renderer runs outside Electron
 *  (e.g. the Vite dev-server preview). IPC-backed calls return demo data so
 *  the shell, navigation and modules render without a real workspace.
 *
 *  The import pipeline genuinely runs end-to-end in memory: dropped CSV files
 *  are parsed in the browser, auto-mapped (with remembered profiles), validated
 *  with error/warning/info severities, "committed" into a module-level fact
 *  store with Date+Cell dedupe (oldest wins), and reported through the real
 *  ImportResult / audit / coverage / quality shapes. Nothing touches disk. */

// --- demo workspace state (stands in for DuckDB) ---------------------------

interface DemoFact {
  date: string
  cell: string
  district: string | null
  region: string | null
  site: string | null
  prb: string | null
  users: string | null
  volume: string | null
  availability: string | null
  throughput: string | null
}

const demoFacts: DemoFact[] = []
let demoWorkspaceName = 'Preview Network'
let demoTech: Technology = '4G'
// remembered choices for workspace creation (demo mirror of appState)
const demoAppState: {
  lastTechnology?: Technology
  lastWorkspaceDir?: string
  technologyByDir?: Record<string, Technology>
  createdWorkspaces?: Array<{ name: string; technology: Technology; createdAt: string }>
} = {}
let demoKpiSeq = 100
// per-cell demo extra KPI values keyed `${cellId}|${weekStart}|${kpiKey}`
const demoKpiValues = new Map<string, number>()

const DEMO_KPI_SEEDS: Array<{
  technology: Technology; key: string; label: string; unit: string;
  worseIsHigher: boolean; target: number | null; agg: KpiDefinition['agg']; aliases: string[]
}> = [
  { technology: '2G', key: 'tch_congestion', label: 'TCH Congestion', unit: '%', worseIsHigher: true, target: 2, agg: 'avg', aliases: ['tch congestion', 'tch congestion (%)', 'tch congestion rate', 'congestion'] },
  { technology: '2G', key: 'sdcch_congestion', label: 'SDCCH Congestion', unit: '%', worseIsHigher: true, target: 2, agg: 'avg', aliases: ['sdcch congestion', 'sdcch congestion (%)', 'sdcch congestion rate'] },
  { technology: '2G', key: 'tch_availability', label: 'TCH Availability', unit: '%', worseIsHigher: false, target: 99.5, agg: 'avg', aliases: ['tch availability', 'tch availability (%)', 'availability'] },
  { technology: '2G', key: 'drop_call_rate', label: 'Drop Call Rate', unit: '%', worseIsHigher: true, target: 1.5, agg: 'avg', aliases: ['drop call rate', 'call drop rate', 'dropped call rate (%)', 'drops (%)'] },
  { technology: '2G', key: 'call_setup_success', label: 'Call Setup Success', unit: '%', worseIsHigher: false, target: 98.5, agg: 'avg', aliases: ['call setup success', 'cssr', 'call setup success rate (%)'] },
  { technology: '2G', key: 'gprs_traffic', label: 'GPRS Traffic', unit: 'MB', worseIsHigher: false, target: null, agg: 'sum', aliases: ['gprs traffic', 'gprs traffic (mb)', 'gprs data volume'] },
  { technology: '2G', key: 'gprs_throughput', label: 'GPRS/EDGE Throughput', unit: 'kbps', worseIsHigher: false, target: null, agg: 'avg', aliases: ['gprs throughput', 'gprs/edge throughput', 'throughput', 'dl throughput (kbps)', 'edge throughput'] },
  { technology: '2G', key: 'connected_users', label: 'Connected Users', unit: '', worseIsHigher: false, target: null, agg: 'avg', aliases: ['connected users', 'users', 'active users', 'rrc connected ues'] },
  { technology: '3G', key: 'ce_utilization', label: 'CE Utilization', unit: '%', worseIsHigher: true, target: 70, agg: 'avg', aliases: ['ce utilization', 'ce utilization (%)', 'channel element utilization'] },
  { technology: '3G', key: 'hsdpa_throughput', label: 'HSDPA Throughput', unit: 'kbps', worseIsHigher: false, target: null, agg: 'avg', aliases: ['hsdpa throughput', 'hsdpa throughput (kbps)', 'dl throughput (kbps)', 'throughput'] },
  { technology: '3G', key: 'hsupa_throughput', label: 'HSUPA Throughput', unit: 'kbps', worseIsHigher: false, target: null, agg: 'avg', aliases: ['hsupa throughput', 'hsupa throughput (kbps)', 'ul throughput'] },
  { technology: '3G', key: 'rrc_connection_success', label: 'RRC Connection Success', unit: '%', worseIsHigher: false, target: 98.5, agg: 'avg', aliases: ['rrc connection success', 'rrc setup success rate', 'cssr'] },
  { technology: '3G', key: 'drop_call_rate', label: 'Drop Call Rate', unit: '%', worseIsHigher: true, target: 1.5, agg: 'avg', aliases: ['drop call rate', 'call drop rate', 'dropped call rate (%)'] },
  { technology: '3G', key: 'data_volume', label: 'Data Volume', unit: 'MB', worseIsHigher: false, target: null, agg: 'sum', aliases: ['data volume', 'data volume (mb)', 'traffic (mb)', 'volume'] },
  { technology: '3G', key: 'connected_users', label: 'Connected Users', unit: '', worseIsHigher: false, target: null, agg: 'avg', aliases: ['connected users', 'users', 'active users', 'rrc connected ues'] },
  { technology: '4G', key: 'prb_utilization', label: 'PRB Utilization', unit: '%', worseIsHigher: true, target: 80, agg: 'avg', aliases: ['prb utilization', 'prb', 'prb util', 'prb utilization (%)', '4g prb', 'peak hour traffic utilization'] },
  { technology: '4G', key: 'dl_throughput', label: 'DL Throughput', unit: 'kbps', worseIsHigher: false, target: null, agg: 'avg', aliases: ['dl throughput', 'throughput', 'dl throughput (kbps)', 'e-utran ip throughput ue dl', 'e-utran ip throughput ue dl (kbps)'] },
  { technology: '4G', key: 'connected_users', label: 'Connected Users', unit: '', worseIsHigher: false, target: null, agg: 'avg', aliases: ['connected users', 'users', 'rrc connected ues', 'rrc connected ues (avg)', 'active users'] },
  { technology: '4G', key: 'data_volume', label: 'Data Volume', unit: 'MB', worseIsHigher: false, target: null, agg: 'sum', aliases: ['data volume', 'data volume (mb)', 'traffic (mb)', '4g data volume', 'volume'] },
  { technology: '4G', key: 'availability', label: 'Availability', unit: '%', worseIsHigher: false, target: 99.5, agg: 'avg', aliases: ['availability', 'cell availability', 'availability (%)', '4g cell availability'] },
  { technology: '4G', key: 'drop_call_rate', label: 'Drop Call Rate', unit: '%', worseIsHigher: true, target: 1.5, agg: 'avg', aliases: ['drop call rate', 'call drop rate', 'erab drop rate'] }
]

let demoKpiDefs: KpiDefinition[] = seedDemoKpiDefs()

function seedDemoKpiDefs(): KpiDefinition[] {
  return DEMO_KPI_SEEDS.map((s, i) => ({
    kpiId: i + 1,
    technology: s.technology,
    key: s.key,
    label: s.label,
    unit: s.unit,
    worseIsHigher: s.worseIsHigher,
    target: s.target,
    agg: s.agg,
    sourceHeaders: s.aliases,
    isCustom: false,
    active: true,
    sortOrder: i,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }))
}

function demoKpisFor(tech: Technology): KpiDefinition[] {
  return demoKpiDefs.filter((d) => d.technology === tech)
}

function demoKpiKeyByAlias(tech: Technology, header: string): string | null {
  const norm = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const n = norm(header)
  for (const d of demoKpisFor(tech)) {
    for (const a of [...d.sourceHeaders, d.label, d.key]) {
      if (norm(a) === n) return d.key
    }
  }
  // fuzzy fallback: word-set overlap (Jaccard) >= 0.5 — mirrors the desktop
  // discovery so the preview suggests the same KPI assignments
  const tokens = (s: string): string[] => norm(s).split(' ').filter(Boolean)
  const hTokens = tokens(header)
  let best: string | null = null
  let bestScore = 0.5
  if (hTokens.length > 0) {
    for (const d of demoKpisFor(tech)) {
      for (const a of [...d.sourceHeaders, d.label, d.key]) {
        const aTokens = tokens(a)
        if (aTokens.length === 0) continue
        let inter = 0
        for (const t of hTokens) if (aTokens.includes(t)) inter++
        const sim = inter / (hTokens.length + aTokens.length - inter)
        if (sim > bestScore) {
          bestScore = sim
          best = d.key
        }
      }
    }
  }
  return best
}

function demoKpiDiscover(headers: string[], tech: Technology): KpiDiscovery {
  const mapping: Record<string, string> = {}
  let matched = 0
  for (const h of headers) {
    const key = demoKpiKeyByAlias(tech, h)
    if (key) {
      mapping[h] = key
      matched++
    }
  }
  return { mapping, confidence: headers.length > 0 ? matched / headers.length : 0 }
}
const cellsSeen = new Set<string>()
const factKeys = new Set<string>() // `${date}|${cell}`
// fingerprint -> remembered mapping (canonical columns + accepted KPI assignments)
const profiles = new Map<string, { columns: Record<string, CanonicalField>; kpiColumns: Record<string, string> }>()
const auditRows: ImportAuditRow[] = []
const demoArchiveRows: RawArchiveRow[] = []
let demoArchiveSeq = 0
const demoSnapshots: WorkspaceSnapshot[] = []
let demoSnapSeq = 0
let schedState: MaintenanceScheduleSettings = {
  enabled: false,
  cadenceHours: 24,
  actions: ['integrity', 'purge'],
  runOnOpen: true,
  lastRunAt: null,
  lastOk: null,
  lastSummary: null,
  nextRunAt: null
}
let schedHistoryState: ScheduledMaintenanceRun[] = []
const fileRegistry = new Map<string, File>() // pseudo-path -> browser File
const analysisRegistry = new Map<
  string,
  { file: File; header: string[]; sample: string[][]; fingerprint: string }
>()
let idCounter = 0
let importCounter = 0

// background-import progress bus (M5): the demo run simulates worker phases
const importProgressCbs = new Set<(p: ImportProgress) => void>()
function emitImportProgress(p: ImportProgress): void {
  for (const cb of importProgressCbs) cb(p)
}
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function demoMaintenanceRun(action: MaintenanceAction): Promise<MaintenanceResult> {
  const startedAt = new Date().toISOString()
  const t0 = performance.now()
  await delay(450)
  const msgs: Record<MaintenanceAction, string> = {
    integrity: 'Integrity check passed — the database is consistent.',
    optimize: 'Optimizer pass complete and checkpoint written (WAL merged into the workspace).',
    rebuild: 'All aggregates and derived intelligence recomputed (facts unchanged). Pre-action backup: C:\\Demo\\backups\\maintenance-rebuild-*.qosdb',
    compact: 'Workspace compacted into a fresh copy: 45.8 MB → 45.2 MB. Pre-action backup: C:\\Demo\\backups\\maintenance-compact-*.qosdb',
    purge: 'No expired raw sources to purge — 1 file(s) retained under the 90-day window.',
    storage: 'Workspace 45.8 MB on disk; 16 tables.'
  }
  const detail = action === 'storage'
    ? {
        fileSize: 48_000_000,
        walSize: 0,
        tables: [
          { table: 'fact_cell_daily', rows: BASELINE.rowCount + demoFacts.length },
          { table: 'agg_cell_weekly', rows: 2_850 },
          { table: 'dim_cell', rows: BASELINE.cells + cellsSeen.size },
          { table: 'cell_nc_lifecycle', rows: 2_850 },
          { table: 'cell_health_history', rows: 2_850 },
          { table: 'dim_date', rows: 5_842 }
        ]
      }
    : undefined
  return { action, ok: true, message: msgs[action], startedAt, durationMs: Math.round(performance.now() - t0), detail }
}

/** Static demo baseline the imported rows are layered on top of, so the KPI
 *  strip and status bar look rich before the first import and still visibly
 *  grow afterwards. */
const BASELINE = {
  rowCount: 143_000,
  cells: 2850,
  minDate: '2026-01-01',
  maxDate: '2026-07-31'
}

// --- CSV parsing ------------------------------------------------------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (!(row.length === 1 && row[0] === '')) rows.push(row)
      row = []
      i++
      continue
    }
    field += c
    i++
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

// --- mapping heuristics (mirrors src/main/import/mapping.ts) ----------------

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const FIELD_ALIASES: Record<CanonicalField, string[]> = {
  date: ['datetime', 'date', 'day', 'time', 'timestamp', 'date/time', 'date_time', 'report date', 'day (date)'],
  cell: ['cell', 'cell id', 'cellid', 'cell name', 'cellname', 'lcell', 'cell_id', 'sector'],
  district: ['district', 'district name', 'districtname', 'dist'],
  region: ['region', 'region name', 'regionname'],
  site: ['basestation', 'base station', 'site', 'bts', 'site id', 'siteid', 'site name', 'site_id'],
  prb: ['4g peak hour traffic utilization_nca', 'prb utilization', 'prb', 'prb util', 'peak hour traffic utilization', 'prb_utilization', 'prb utilisation', '4g prb'],
  users: ['rrc connected ues (avg)_std(#)', 'connected users', 'rrc connected ues', 'rrc connected users', 'users', 'connected_users', 'rrc connected ues (avg)'],
  volume: ['4g data volume_std(mb)', 'data volume', 'data volume (mb)', 'data_volume_mb', 'traffic', 'volume mb', '4g data volume', 'traffic (mb)'],
  availability: ['4g cell availability_std(%)', 'availability', 'cell availability', 'availability_pct', 'cell availability (%)', '4g cell availability'],
  throughput: ['e-utran ip throughput ue dl_std(kbps)', 'dl throughput', 'throughput', 'e-utran ip throughput ue dl', 'dl_throughput_kbps', 'throughput dl', 'eutran ip throughput ue dl', 'ip throughput']
}

const aliasIndex = new Map<string, CanonicalField>()
for (const field of FIELD_ORDER) {
  for (const a of FIELD_ALIASES[field]) aliasIndex.set(normalizeHeader(a), field)
}

function autoMap(headers: string[]): Record<string, CanonicalField> {
  const mapping: Record<string, CanonicalField> = {}
  const used = new Set<CanonicalField>()
  for (const h of headers) {
    const f = aliasIndex.get(normalizeHeader(h))
    if (f && !used.has(f)) {
      mapping[h] = f
      used.add(f)
    }
  }
  return mapping
}

function mappingConfidence(mapping: Record<string, CanonicalField>): number {
  const values = Object.values(mapping)
  if (!values.includes('date') || !values.includes('cell')) return 0.2
  const kpis: CanonicalField[] = ['prb', 'users', 'volume', 'availability', 'throughput']
  const mappedKpis = kpis.filter((k) => values.includes(k)).length
  return Math.round((0.5 + 0.5 * (mappedKpis / kpis.length)) * 100) / 100
}

function makeFingerprint(headers: string[]): string {
  const norm = headers.map(normalizeHeader)
  const ordered = norm.join('|')
  const sorted = [...norm].sort().join(',')
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5
  for (const c of ordered) h1 = Math.imul(h1 ^ c.charCodeAt(0), 0x01000193) >>> 0
  for (const c of sorted) h2 = Math.imul(h2 ^ c.charCodeAt(0), 0x01000193) >>> 0
  return h1.toString(16) + '-' + h2.toString(16)
}

// --- validation (mirrors src/main/import/validator.ts) ----------------------

const KPI_LABELS: Array<{ field: CanonicalField; label: string }> = [
  { field: 'prb', label: 'PRB utilization' },
  { field: 'users', label: 'Connected users' },
  { field: 'volume', label: 'Data volume' },
  { field: 'availability', label: 'Availability' },
  { field: 'throughput', label: 'DL throughput' }
]

function parseDateOk(raw: string | null | undefined): boolean {
  const s = (raw ?? '').trim()
  if (!s) return false
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return !Number.isNaN(Date.parse(s.slice(0, 10)))
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (mdy) {
    const m = Number(mdy[2])
    const d = Number(mdy[1])
    return m >= 1 && m <= 12 && d >= 1 && d <= 31
  }
  const ymd = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s)
  if (ymd) {
    const m = Number(ymd[2])
    const d = Number(ymd[3])
    return m >= 1 && m <= 12 && d >= 1 && d <= 31
  }
  return false
}

function isNumeric(s: string | null | undefined): boolean {
  if (s == null) return false
  const t = s.trim()
  if (!t) return false
  return !Number.isNaN(Number(t))
}

function validateSample(header: string[], rows: string[][], mapping: MappingConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const fields = Object.values(mapping.columns)
  if (!fields.includes('date')) issues.push({ severity: 'error', message: 'No column mapped to Date/Time (required)' })
  if (!fields.includes('cell')) issues.push({ severity: 'error', message: 'No column mapped to Cell (required)' })
  if (rows.length === 0) {
    issues.push({ severity: 'info', message: 'No data rows in sample' })
    return issues
  }

  const idx = (field: CanonicalField): number => header.findIndex((h) => mapping.columns[h] === field)
  const dateIdx = idx('date')
  const cellIdx = idx('cell')
  let badDates = 0
  let badCells = 0
  const unparsed: Record<string, number> = {}
  let prbOob = 0
  let availOob = 0
  let missingDistrict = 0
  let missingRegion = 0

  for (const row of rows) {
    if (dateIdx >= 0 && !parseDateOk(row[dateIdx])) badDates++
    if (cellIdx >= 0 && !(row[cellIdx] ?? '').trim()) badCells++
    for (const k of KPI_LABELS) {
      const i = idx(k.field)
      if (i >= 0 && row[i] != null && row[i] !== '' && !isNumeric(row[i])) {
        unparsed[k.label] = (unparsed[k.label] ?? 0) + 1
      }
    }
    const p = idx('prb')
    if (p >= 0 && isNumeric(row[p]) && (Number(row[p]) < 0 || Number(row[p]) > 100)) prbOob++
    const a = idx('availability')
    if (a >= 0 && isNumeric(row[a]) && (Number(row[a]) < 0 || Number(row[a]) > 100)) availOob++
    const d = idx('district')
    if (d >= 0 && !(row[d] ?? '').trim()) missingDistrict++
    const r = idx('region')
    if (r >= 0 && !(row[r] ?? '').trim()) missingRegion++
  }

  if (badDates > 0) issues.push({ severity: 'error', message: 'Rows with unparseable or missing dates', count: badDates })
  if (badCells > 0) issues.push({ severity: 'error', message: 'Rows with missing Cell', count: badCells })
  for (const [label, n] of Object.entries(unparsed)) {
    issues.push({ severity: 'warning', message: `${label} values that are not numeric`, count: n })
  }
  if (prbOob > 0) issues.push({ severity: 'warning', message: 'PRB utilization outside 0-100%', count: prbOob })
  if (availOob > 0) issues.push({ severity: 'warning', message: 'Availability outside 0-100%', count: availOob })
  if (missingDistrict > 0) issues.push({ severity: 'info', message: 'Rows missing District', count: missingDistrict })
  if (missingRegion > 0) issues.push({ severity: 'info', message: 'Rows missing Region', count: missingRegion })
  return issues
}

/** Maps one source row to canonical fields; returns null when the row cannot be
 *  committed (unparseable date or missing cell) — counted as rejected. */
function mapRow(header: string[], row: string[], columns: Record<string, CanonicalField>): DemoFact | null {
  const idx = (field: CanonicalField): string | null => {
    const h = header.find((hh) => columns[hh] === field)
    return h !== undefined ? row[header.indexOf(h)] : null
  }
  const dateRaw = (idx('date') ?? '').trim()
  const cellRaw = (idx('cell') ?? '').trim()
  if (!parseDateOk(dateRaw) || !cellRaw) return null
  const pick = (v: string | null): string | null => {
    const t = (v ?? '').trim()
    return t === '' ? null : t
  }
  return {
    date: dateRaw.slice(0, 10),
    cell: cellRaw,
    district: pick(idx('district')),
    region: pick(idx('region')),
    site: pick(idx('site')),
    prb: pick(idx('prb')),
    users: pick(idx('users')),
    volume: pick(idx('volume')),
    availability: pick(idx('availability')),
    throughput: pick(idx('throughput'))
  }
}

function orderedMappedRows(header: string[], rows: string[][], columns: Record<string, CanonicalField>): Array<Record<string, string | null>> {
  return rows.map((row) => {
    const out: Record<string, string | null> = {}
    for (const field of FIELD_ORDER) {
      const h = header.find((hh) => columns[hh] === field)
      out[field] = h !== undefined ? (row[header.indexOf(h)] ?? null) : null
    }
    return out
  })
}

// --- derived demo statistics ------------------------------------------------

function factDateRange(): { min: string; max: string } {
  let min = ''
  let max = ''
  for (const f of demoFacts) {
    if (f.date < min || min === '') min = f.date
    if (f.date > max || max === '') max = f.date
  }
  return { min: min || BASELINE.minDate, max: max || BASELINE.maxDate }
}

function coverageRows(): CoverageRow[] {
  const byDate = new Map<string, Set<string>>()
  for (const f of demoFacts) {
    let s = byDate.get(f.date)
    if (!s) {
      s = new Set()
      byDate.set(f.date, s)
    }
    s.add(f.cell)
  }
  const expected = cellsSeen.size
  if (expected === 0) return []
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, cells]) => ({
      date,
      observedCells: cells.size,
      expectedCells: expected,
      coveragePct: Math.round((cells.size / expected) * 1000) / 10
    }))
}

function qualityRows(): QualityRow[] {
  const byDate = new Map<string, DemoFact[]>()
  for (const f of demoFacts) {
    let a = byDate.get(f.date)
    if (!a) {
      a = []
      byDate.set(f.date, a)
    }
    a.push(f)
  }
  const cov = new Map(coverageRows().map((c) => [c.date, c.coveragePct]))
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, facts]) => {
      const kpiFields: (keyof DemoFact)[] = ['prb', 'users', 'volume', 'availability', 'throughput']
      let present = 0
      for (const f of facts) for (const k of kpiFields) if (f[k] != null) present++
      const completenessPct = Math.round((present / (facts.length * kpiFields.length)) * 1000) / 10
      const coveragePct = cov.get(date) ?? 100
      return { date, coveragePct, completenessPct, score: Math.round(0.5 * coveragePct + 0.5 * completenessPct) }
    })
}

// --- M2 demo analytics (deterministic, coherent with the baseline) ----------

const NC_NAMES = ['ACC', 'KUM', 'TMA', 'TAM', 'SPD', 'CAP', 'HO', 'WNR']

function demoNcLifecycle(): NcLifecycleResult {
  const weekStart = '2026-07-27'
  const cells: NcLifecycleResult['cells'] = []
  let n = 0
  const add = (
    prefix: string, idx: number, isNc: boolean, lifecycle: NcLifecycleResult['cells'][number]['lifecycle'],
    trend: NcLifecycleResult['cells'][number]['trend'], severity: NcLifecycleResult['cells'][number]['severity'],
    prb: number, breach: number
  ): void => {
    cells.push({
      cellId: 100000 + n,
      cellName: `${prefix}-${String(idx + 1).padStart(3, '0')}-A`,
      site: `${prefix}-${String(idx + 1).padStart(3, '0')}`,
      district: idx % 5 === 0 ? 'Kumasi' : 'Accra Metro',
      region: idx % 5 === 0 ? 'Ashanti' : 'Greater Accra',
      weekStart,
      isNc,
      lifecycle,
      trend,
      severity,
      breachDays: breach,
      prbAvg: prb
    })
    n++
  }
  // 12 NC cells: persistent / recurring / new with severity spread
  const ncMix: Array<[number, NcLifecycleResult['cells'][number]['lifecycle'], NcLifecycleResult['cells'][number]['trend'], NcLifecycleResult['cells'][number]['severity'], number, number]> = [
    [0, 'Persistent NC', 'Worsening', 'Critical', 96, 7],
    [1, 'Persistent NC', 'Stable', 'Critical', 93, 6],
    [2, 'Persistent NC', 'Stable', 'High', 89, 5],
    [3, 'Recurring NC', 'Worsening', 'High', 92, 4],
    [4, 'Recurring NC', 'Stable', 'High', 88, 3],
    [5, 'Recurring NC', 'Worsening', 'High', 90, 4],
    [6, 'Recurring NC', 'Stable', 'Watch', 84, 2],
    [7, 'New NC', 'Worsening', 'Watch', 91, 3],
    [8, 'New NC', 'Stable', 'Watch', 86, 2],
    [9, 'New NC', 'Stable', 'Watch', 82, 1],
    [10, 'New NC', 'Improving', 'Watch', 83, 2],
    [11, 'New NC', 'Stable', 'Watch', 81, 1]
  ]
  for (const [i, life, trend, sev, prb, breach] of ncMix) {
    add(NC_NAMES[i % NC_NAMES.length], Math.floor(i / NC_NAMES.length), true, life, trend, sev, prb, breach)
  }
  // 10 recovering + 218 healthy cells
  for (let i = 0; i < 10; i++) {
    add(NC_NAMES[i % NC_NAMES.length], 2 + i, false, 'Recovering', i % 2 === 0 ? 'Improving' : 'Stable', 'Normal', 66 + (i % 5), 0)
  }
  for (let i = 0; i < 218; i++) {
    const p = 38 + ((i * 13) % 40)
    add(NC_NAMES[i % NC_NAMES.length], 12 + i, false, 'Healthy', i % 4 === 0 ? 'Improving' : i % 4 === 2 ? 'Worsening' : 'Stable', 'Normal', p, 0)
  }
  // imported demo cells, if any
  const seen = new Set<string>()
  for (const f of demoFacts) {
    if (seen.has(f.cell)) continue
    seen.add(f.cell)
    const prb = f.prb != null ? Number(f.prb) : 0
    const isNc = prb >= 80
    add(
      f.cell.replace(/-[AB]$/, ''), cells.length, isNc,
      isNc ? 'New NC' : 'Healthy', 'Stable',
      isNc ? (prb >= 90 ? 'High' : 'Watch') : 'Normal',
      prb, isNc ? 1 : 0
    )
  }
  const byLifecycle: NcLifecycleResult['byLifecycle'] = { Healthy: 0, 'New NC': 0, 'Recurring NC': 0, 'Persistent NC': 0, Recovering: 0 }
  const byTrend: NcLifecycleResult['byTrend'] = { Improving: 0, Stable: 0, Worsening: 0 }
  const bySeverity: NcLifecycleResult['bySeverity'] = { Normal: 0, Watch: 0, High: 0, Critical: 0 }
  let ncCells = 0
  for (const c of cells) {
    byLifecycle[c.lifecycle]++
    byTrend[c.trend]++
    bySeverity[c.severity]++
    if (c.isNc) ncCells++
  }
  return {
    weekStart,
    totalCells: cells.length,
    ncCells,
    ncRate: Math.round((ncCells / cells.length) * 1000) / 10,
    byLifecycle,
    byTrend,
    bySeverity,
    cells
  }
}

function demoPriority(mode: PriorityMode): PriorityRow[] {
  const base: Array<[string, number, number, number, number, number, number]> = [
    ['ACC-001', 96, 100, 100, 70, 80, 45],
    ['KUM-002', 88, 80, 100, 40, 60, 30],
    ['TMA-003', 81, 90, 70, 50, 75, 25],
    ['TAM-004', 74, 70, 35, 90, 55, 60],
    ['SPD-005', 66, 60, 0, 100, 90, 20],
    ['CAP-006', 58, 50, 70, 20, 30, 15],
    ['HO-007', 52, 55, 35, 10, 25, 5],
    ['WNR-008', 43, 45, 0, 5, 15, 10],
    ['ACC-009', 31, 30, 0, 0, 10, 0],
    ['KUM-010', 22, 20, 0, 0, 5, 0]
  ]
  return base.map(([cellName, score, prbSeverity, persistence, userImpact, trafficImpact, throughputDegradation], i) => ({
    cellId: 200000 + i,
    cellName,
    site: cellName,
    district: i % 2 === 0 ? 'Accra Metro' : 'Kumasi',
    region: i % 2 === 0 ? 'Greater Accra' : 'Ashanti',
    asOf: '2026-07-27',
    score,
    band: score >= 90 ? 'Critical' : score >= 75 ? 'High' : score >= 50 ? 'Medium' : score >= 25 ? 'Watch' : 'Low',
    mode,
    components: {
      prbSeverity,
      persistence,
      userImpact,
      trafficImpact,
      throughputDegradation,
      worseningTrend: score >= 80 ? 100 : score >= 60 ? 50 : 0,
      kpiBreach: Math.round(Math.min(100, Math.max(0, score / 2)))
    }
  }))
}

function demoNcMovement(limit = 8): NcMovementRow[] {
  const weeks = ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']
  const newNc = [14, 11, 9, 12, 8, 10, 9, 5]
  const rec = [6, 7, 8, 7, 9, 8, 8, 4]
  const per = [2, 3, 3, 4, 4, 4, 4, 3]
  const recov = [4, 5, 6, 4, 7, 5, 6, 8]
  return weeks.slice(-limit).map((weekStart, i) => {
    const j = weeks.length - limit + i
    const nc = newNc[j] + rec[j] + per[j]
    const total = 240
    return {
      weekStart,
      newNc: newNc[j],
      recurring: rec[j],
      persistent: per[j],
      recovering: recov[j],
      ncCells: nc,
      totalCells: total,
      ncRate: Math.round((nc / total) * 1000) / 10
    }
  })
}

/** Map a demo cell name to a stable cell id (baseline cells + imported ones). */
function demoCellIdOf(name: string): number | null {
  const nameToId = new Map<number, string>()
  for (const c of demoNcLifecycle().cells) nameToId.set(c.cellId, c.cellName)
  for (const [id, n] of nameToId) if (n === name) return id
  // imported cell that isn't in the baseline: assign deterministically
  if (!name) return null
  return 200_000 + ((name.charCodeAt(0) * 31 + name.length * 17) % 50_000)
}

function demoCellKpis(cellId: number, weekStart: string): CellKpiValue[] {
  return demoKpisFor(demoTech).map((d) => {
    // deterministic per-cell value from the definition + cell
    const raw = demoKpiValues.get(`${cellId}|${d.key}`)
    let value: number | null
    if (raw != null) value = raw
    else if (d.key === 'drop_call_rate') value = Math.round(((cellId * 7) % 40) * 10) / 100
    else if (d.key === 'prb_utilization' || d.key === 'ce_utilization') value = Math.round(30 + ((cellId * 17) % 65))
    else if (d.key === 'tch_congestion' || d.key === 'sdcch_congestion') value = Math.round(((cellId * 11) % 50) * 10) / 100
    else if (d.key === 'tch_availability' || d.key === 'availability' || d.key === 'rrc_connection_success') value = Math.round((99 + ((cellId * 5) % 10) / 10) * 100) / 100
    else if (d.agg === 'sum') value = 1_000 + ((cellId * 97) % 40_000)
    else value = 4_000 + ((cellId * 37) % 30_000)
    const target = d.target
    let breached = false
    if (value != null && target != null) {
      breached = d.worseIsHigher ? value > target : value < target
    }
    return {
      key: d.key,
      label: d.label,
      unit: d.unit,
      value,
      target,
      worseIsHigher: d.worseIsHigher,
      breached
    }
  })
}

function demoCellIntelligence(opts: {
  search?: string
  lifecycle?: Lifecycle | ''
  trend?: Trend | ''
  severity?: Severity | ''
  minPriority?: number
  limit?: number
  offset?: number
} = {}): CellIntelligenceResult {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100))
  const offset = Math.max(0, opts.offset ?? 0)
  const cells = demoNcLifecycle().cells
  const priorityOf = (r: (typeof cells)[number]): number => {
    const base = r.severity === 'Critical' ? 90 : r.severity === 'High' ? 74 : r.severity === 'Watch' ? 58 : r.lifecycle === 'Recovering' ? 30 : 20
    return base + ((r.cellId * 13) % 8)
  }
  const all: CellIntelligenceRow[] = cells.map((c) => {
    const score = priorityOf(c)
    return {
      cellId: c.cellId,
      cellName: c.cellName,
      site: c.site,
      district: c.district,
      region: c.region,
      weekStart: c.weekStart,
      isNc: c.isNc,
      lifecycle: c.lifecycle,
      trend: c.trend,
      severity: c.severity,
      prbAvg: c.prbAvg,
      breachDays: c.breachDays,
      throughputKbps: 14_000 + ((c.cellId * 37) % 12_000),
      users: 120 + ((c.cellId * 53) % 900),
      volumeMb: 8_000 + ((c.cellId * 97) % 60_000),
      availability: 99 + ((c.cellId * 7) % 10) / 10,
      priorityScore: score,
      priorityBand: score >= 90 ? 'Critical' : score >= 75 ? 'High' : score >= 50 ? 'Medium' : score >= 25 ? 'Watch' : 'Low',
      kpis: demoCellKpis(c.cellId, c.weekStart)
    }
  })
  const q = (opts.search ?? '').toLowerCase()
  const filtered = all.filter(
    (r) =>
      (!q || r.cellName.toLowerCase().includes(q) || (r.site ?? '').toLowerCase().includes(q) || (r.district ?? '').toLowerCase().includes(q)) &&
      (!opts.lifecycle || r.lifecycle === opts.lifecycle) &&
      (!opts.trend || r.trend === opts.trend) &&
      (!opts.severity || r.severity === opts.severity) &&
      (opts.minPriority == null || (r.priorityScore ?? 0) >= opts.minPriority)
  )
  return { total: filtered.length, rows: filtered.slice(offset, offset + limit) }
}

function demoCellDetail(cellId: number): CellDetail | null {
  const base = demoNcLifecycle().cells.find((c) => c.cellId === cellId)
  if (!base) return null
  const end = new Date(Date.UTC(2026, 6, 27)) // 2026-07-27
  const weeks: CellDetail['weeks'] = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(end)
    d.setUTCDate(d.getUTCDate() - (11 - i) * 7)
    const weekStart = d.toISOString().slice(0, 10)
    const wobble = ((cellId + i * 7) % 11) - 5
    const isNc = base.isNc && i >= 12 - (base.lifecycle === 'Persistent NC' ? 4 : base.lifecycle === 'Recurring NC' ? 3 : base.lifecycle === 'New NC' ? 1 : 0)
    return {
      weekStart,
      prbAvg: Math.round(Math.min(100, Math.max(20, (base.prbAvg ?? 55) + wobble * 1.4)) * 10) / 10,
      throughputKbps: 14_000 + ((cellId * 37 + i * 211) % 12_000),
      users: 120 + ((cellId * 53 + i * 131) % 900),
      volumeMb: 8_000 + ((cellId * 97 + i * 317) % 60_000),
      availability: Math.round((99 + ((cellId * 7 + i) % 10) / 10) * 10) / 10,
      breachDays: isNc ? 1 + ((i * 3) % 3) : 0,
      isNc,
      lifecycle: isNc ? base.lifecycle : i >= 11 && base.lifecycle === 'Recovering' ? 'Recovering' : 'Healthy',
      severity: isNc ? base.severity : 'Normal'
    }
  })
  return {
    cellId: base.cellId,
    cellName: base.cellName,
    site: base.site,
    district: base.district,
    region: base.region,
    current: {
      weekStart: base.weekStart,
      lifecycle: base.lifecycle,
      trend: base.trend,
      severity: base.severity,
      priorityScore: 40 + ((cellId * 13) % 55),
      priorityBand: 'Medium',
      prbAvg: base.prbAvg
    },
    weeks,
    kpis: demoCellKpis(cellId, base.weekStart)
  }
}

function demoPoints(min: number, max: number): PercentilePoint[] {
  const pts: PercentilePoint[] = []
  for (let p = 0; p <= 100; p += 5) {
    const t = p / 100
    pts.push({ p, value: Math.round((min + (max - min) * Math.pow(t, 1.12)) * 10) / 10 })
  }
  return pts
}

function demoPerformance(): PerformanceResult {
  const cells = demoNcLifecycle().cells
  const weekStart = '2026-07-27'
  const prbThreshold = 80
  const METRICS: Array<{ metric: PerfMetric; label: string; unit: string; min: number; max: number }> = [
    { metric: 'prb', label: 'PRB utilization', unit: '%', min: 38, max: 97 },
    { metric: 'throughput', label: 'DL throughput', unit: 'kbps', min: 14_000, max: 26_000 },
    { metric: 'users', label: 'Connected users', unit: '', min: 120, max: 1_020 },
    { metric: 'volume', label: 'Data volume', unit: 'MB', min: 8_000, max: 68_000 },
    { metric: 'availability', label: 'Availability', unit: '%', min: 99.0, max: 99.9 }
  ]
  const distributions: MetricDistribution[] = METRICS.map((m) => {
    const points = demoPoints(m.min, m.max)
    const mean = points.reduce((s, p) => s + (p.value ?? 0), 0) / points.length
    return {
      metric: m.metric,
      label: m.label,
      unit: m.unit,
      points,
      mean: Math.round(mean * 10) / 10,
      min: points[0].value,
      max: points[20].value,
      p50: points[10].value,
      p90: points[18].value,
      n: cells.length
    }
  })
  const scatter: ScatterPoint[] = cells.map((c, i) => {
    const prb = c.prbAvg
    // index-squared spread so the first (NC) cells land on both sides of the
    // median speed — a realistic congested/busy mix instead of one degenerate quadrant
    const throughputKbps = 14_000 + ((i * i * 977) % 12_000)
    const users = 120 + ((c.cellId * 53) % 900)
    return {
      cellId: c.cellId,
      cellName: c.cellName,
      district: c.district,
      region: c.region,
      prb,
      throughputKbps,
      users,
      isNc: c.isNc,
      quadrant: 'healthy'
    }
  })
  const sorted = scatter.map((s) => s.throughputKbps ?? 0).sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)]
  for (const s of scatter) {
    const prb = s.prb ?? 0
    const thr = s.throughputKbps ?? 0
    if (prb > prbThreshold) s.quadrant = thr < med ? 'congested' : 'busy'
    else s.quadrant = thr < med ? 'quiet' : 'healthy'
  }
  const pairs: Array<[PerfMetric, PerfMetric, number]> = [
    ['prb', 'throughput', -0.61],
    ['prb', 'users', 0.52],
    ['prb', 'volume', 0.47],
    ['prb', 'availability', -0.38],
    ['throughput', 'users', 0.18],
    ['throughput', 'volume', 0.42],
    ['throughput', 'availability', 0.15],
    ['users', 'volume', 0.71],
    ['users', 'availability', -0.05],
    ['volume', 'availability', -0.12]
  ]
  return {
    weekStart,
    totalCells: scatter.length,
    prbThreshold,
    throughputMedianKbps: med,
    distributions,
    scatter,
    correlations: pairs.map(([a, b, v]) => ({ a, b, pearson: v, n: cells.length * 2 }))
  }
}

function demoComparison(opts: {
  type?: ComparisonType
  scope?: CompareScope
  metric?: CompareMetric
} = {}): ComparisonResult {
  const type = opts.type ?? 'period'
  // region mode always compares regions against the network baseline
  const scope: CompareScope = type === 'region' ? 'region' : (opts.scope ?? 'cell')
  const metric = opts.metric ?? 'prb'
  const weekA = '2026-07-27'
  const weekB = '2026-07-20'
  const cells = demoNcLifecycle().cells

  const METRICS: Array<{
    metric: CompareMetric
    label: string
    unit: string
    agg: 'avg' | 'sum'
    worseIsHigher: boolean
  }> = [
    { metric: 'prb', label: 'PRB utilization', unit: '%', agg: 'avg', worseIsHigher: true },
    { metric: 'throughput', label: 'DL throughput', unit: 'kbps', agg: 'avg', worseIsHigher: false },
    { metric: 'users', label: 'Connected users', unit: '', agg: 'sum', worseIsHigher: false },
    { metric: 'volume', label: 'Data volume', unit: 'MB', agg: 'sum', worseIsHigher: false },
    { metric: 'availability', label: 'Availability', unit: '%', agg: 'avg', worseIsHigher: false },
    { metric: 'nc', label: 'NC cells', unit: '', agg: 'sum', worseIsHigher: true }
  ]
  const keyOf = (c: (typeof cells)[number]): string =>
    scope === 'cell' ? c.cellName : scope === 'site' ? c.site ?? c.cellName : scope === 'district' ? c.district ?? c.cellName : c.region ?? c.cellName

  // per-cell values for both weeks (B drifts −10%…+10%), NC transitions derived
  const per = cells.map((c) => {
    const i = cells.indexOf(c)
    const prb = c.prbAvg ?? 0
    const thr = 14_000 + ((i * i * 977) % 12_000)
    const usr = 120 + ((c.cellId * 53) % 900)
    const vol = 8_000 + ((c.cellId * 97) % 60_000)
    const avail = 99 + ((c.cellId * 7) % 10) / 10
    const drift = (((c.cellId * 31) % 21) - 10) / 100
    const valsA: Record<string, number> = { prb, thr, usr, vol, avail }
    const valsB: Record<string, number> = {}
    for (const k of ['prb', 'thr', 'usr', 'vol', 'avail']) {
      valsB[k] = Math.round(valsA[k] * (1 + drift) * 10) / 10
    }
    const ncA = c.isNc ? 1 : 0
    const t = (c.cellId * 7) % 10
    let transition: NcTransition = 'ok'
    let ncB = ncA
    if (ncA === 1) {
      transition = t < 2 ? 'recovered' : 'nc'
      ncB = transition === 'recovered' ? 0 : 1
    } else {
      transition = t === 0 ? 'new' : 'ok'
      ncB = transition === 'new' ? 1 : 0
    }
    return { key: keyOf(c), name: c.cellName, valsA, valsB, ncA, ncB, transition }
  })

  const aggNum = (list: typeof per, field: 'valsA' | 'valsB', key: string, agg: 'avg' | 'sum'): number | null => {
    const vs = list.map((p) => p[field][key]).filter((v) => v != null)
    if (vs.length === 0) return null
    return agg === 'avg' ? vs.reduce((s, v) => s + v, 0) / vs.length : vs.reduce((s, v) => s + v, 0)
  }

  if (type === 'region') {
    // group the latest week by region; network = all cells
    const groups = new Map<string, typeof per>()
    for (const p of per) {
      const g = groups.get(p.key) ?? []
      g.push(p)
      groups.set(p.key, g)
    }
    const kpis: ComparisonKpi[] = METRICS.map((m) => {
      const key = m.metric === 'nc' ? 'ncA' : m.metric === 'throughput' ? 'thr' : m.metric === 'users' ? 'usr' : m.metric === 'volume' ? 'vol' : m.metric === 'availability' ? 'avail' : 'prb'
      const net = aggNum(per, 'valsA', key, m.agg)
      const vals = [...groups.values()].map((g) => aggNum(g, 'valsA', key, m.agg)).filter((v): v is number => v != null)
      return {
        metric: m.metric,
        label: m.label,
        unit: m.unit,
        worseIsHigher: m.worseIsHigher,
        current: net == null ? null : Math.round(net * 100) / 100,
        previous: null,
        delta: null,
        deltaPct: null,
        best: vals.length > 0 ? Math.round(Math.max(...vals) * 100) / 100 : null,
        worst: vals.length > 0 ? Math.round(Math.min(...vals) * 100) / 100 : null
      }
    })
    const mDef = METRICS.find((m) => m.metric === metric)!
    const key = mDef.metric === 'nc' ? 'ncA' : mDef.metric === 'throughput' ? 'thr' : mDef.metric === 'users' ? 'usr' : mDef.metric === 'volume' ? 'vol' : mDef.metric === 'availability' ? 'avail' : 'prb'
    const network = aggNum(per, 'valsA', key, mDef.agg)
    const rows: ComparisonRow[] = [...groups.entries()]
      .map(([name, g]) => {
        const v = aggNum(g, 'valsA', key, mDef.agg)
        const nc = g.reduce((s, p) => s + p.ncA, 0)
        return {
          id: name.charCodeAt(0),
          name,
          current: v == null ? null : Math.round(v * 100) / 100,
          previous: network == null ? null : Math.round(network * 100) / 100,
          delta: v == null || network == null ? null : Math.round((v - network) * 100) / 100,
          deltaPct: v == null || network == null || network === 0 ? null : Math.round(((v - network) / Math.abs(network)) * 1000) / 10,
          ncCells: nc,
          cells: g.length,
          transition: null
        }
      })
      .sort((x, y) => x.name.localeCompare(y.name))
    return { type, scope, metric, aLabel: weekA, bLabel: 'Network avg', totalRows: rows.length, kpis, rows }
  }

  // period mode: group each week by scope
  const groupWeek = (field: 'valsA' | 'valsB', ncField: 'ncA' | 'ncB'): Map<string, typeof per> => {
    const g = new Map<string, typeof per>()
    for (const p of per) {
      const list = g.get(p.key) ?? []
      list.push(p)
      g.set(p.key, list)
    }
    return g
  }
  const groupsA = groupWeek('valsA', 'ncA')
  const groupsB = groupWeek('valsB', 'ncB')
  const mDef = METRICS.find((m) => m.metric === metric)!
  const key = mDef.metric === 'nc' ? 'ncA' : mDef.metric === 'throughput' ? 'thr' : mDef.metric === 'users' ? 'usr' : mDef.metric === 'volume' ? 'vol' : mDef.metric === 'availability' ? 'avail' : 'prb'
  const kpis: ComparisonKpi[] = METRICS.map((m) => {
    const k = m.metric === 'nc' ? 'ncA' : m.metric === 'throughput' ? 'thr' : m.metric === 'users' ? 'usr' : m.metric === 'volume' ? 'vol' : m.metric === 'availability' ? 'avail' : 'prb'
    const cur = aggNum(per, 'valsA', k, m.agg)
    const prev = aggNum(per, 'valsB', k, m.agg)
    return {
      metric: m.metric,
      label: m.label,
      unit: m.unit,
      worseIsHigher: m.worseIsHigher,
      current: cur == null ? null : Math.round(cur * 100) / 100,
      previous: prev == null ? null : Math.round(prev * 100) / 100,
      delta: cur == null || prev == null ? null : Math.round((cur - prev) * 100) / 100,
      deltaPct: cur == null || prev == null || prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10,
      best: null,
      worst: null
    }
  })
  const rows: ComparisonRow[] = [...new Set([...groupsA.keys(), ...groupsB.keys()])].map((name) => {
    const gA = groupsA.get(name) ?? []
    const gB = groupsB.get(name) ?? []
    const cur = gA.length > 0 ? aggNum(gA, 'valsA', key, mDef.agg) : null
    const prev = gB.length > 0 ? aggNum(gB, 'valsB', key, mDef.agg) : null
    const ncA = gA.reduce((s, p) => s + p.ncA, 0)
    const ncB = gB.reduce((s, p) => s + p.ncB, 0)
    let transition: NcTransition = 'ok'
    if (ncA > 0 && ncB > 0) transition = 'nc'
    else if (ncA > 0) transition = 'new'
    else if (ncB > 0) transition = 'recovered'
    return {
      id: name.charCodeAt(0),
      name,
      current: cur == null ? null : Math.round(cur * 100) / 100,
      previous: prev == null ? null : Math.round(prev * 100) / 100,
      delta: cur == null || prev == null ? null : Math.round((cur - prev) * 100) / 100,
      deltaPct: cur == null || prev == null || prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10,
      ncCells: ncA,
      cells: gA.length || gB.length,
      transition
    }
  })
  return { type, scope, metric, aLabel: weekA, bLabel: weekB, totalRows: rows.length, kpis, rows }
}

// --- Ghana map demo (Executive Overview) -------------------------------------
// Region names must match the 16-region GeoJSON embedded in ghanaRegions.ts.
const GHANA_REGION_NAMES = [
  'Ahafo', 'Ashanti', 'Bono', 'Bono East', 'Central', 'Eastern', 'Greater Accra',
  'North East', 'Northern', 'Oti', 'Savannah', 'Upper East', 'Upper West', 'Volta',
  'Western', 'Western North'
]

function demoRegionMap(): RegionMapRow[] {
  return GHANA_REGION_NAMES.map((name, i) => ({
    id: i + 1,
    name,
    cells: 90 + ((i * 113) % 420),
    ncCells: Math.max(0, Math.round((105 - (55 + ((i * 37) % 45))) / 10)),
    healthScore: 55 + ((i * 37) % 45),
    prbAvg: Math.round((40 + ((i * 53) % 55)) * 10) / 10,
    throughputKbps: 12_000 + ((i * 877) % 14_000),
    users: 40_000 + ((i * 337) % 200_000),
    volumeMb: 300_000 + ((i * 997) % 1_900_000),
    availability: (985 + ((i * 13) % 15)) / 10
  }))
}

const DEMO_DISTRICTS: Record<string, string[]> = {
  'Greater Accra': ['Accra Metro', 'Tema', 'Ga East', 'Ga West', 'Adenta', 'La Dade-Kotopon', 'Ashaiman', 'Kpone-Katamanso'],
  'Ashanti': ['Kumasi Metro', 'Asokore Mampong', 'Atwima Nwabiagya', 'Ejisu', 'Oforikrom', 'Asante Akim North'],
  'Northern': ['Tamale Metro', 'Sagnarigu', 'Savelugu', 'Kumbungu', 'Tolon', 'Yendi'],
  'Western': ['Sekondi Takoradi', 'Shama', 'Ahanta West', 'Nzema East', 'Tarkwa-Nsuaem', 'Wassa East'],
  'Central': ['Cape Coast Metro', 'Komenda-Edina-Eguafo-Abrem', 'Mfantsiman', 'Agona West', 'Asikuma-Odoben-Brakwa'],
  'Eastern': ['Koforidua', 'New Juaben South', 'Akuapim North', 'Lower Manya Krobo', 'Fanteakwa'],
  'Volta': ['Ho Municipal', 'Hohoe', 'Keta', 'Kpando', 'Anloga', 'North Tongu'],
  'Upper East': ['Bolgatanga', 'Bawku', 'Kassena-Nankana', 'Bongo'],
  'Upper West': ['Wa Municipal', 'Nadowli-Kaleo', 'Lawra', 'Daffiama'],
  'Oti': ['Dambai', 'Krachi East', 'Jasikan', 'Nkwanta South'],
  'Savannah': ['Damango', 'Bole', 'East Gonja', 'Central Gonja'],
  'North East': ['Nalerigu', 'Chereponi', 'Yunyoo', 'Mamprugu-Moagduri'],
  'Bono': ['Sunyani', 'Dormaa', 'Wenchi', 'Tain'],
  'Bono East': ['Techiman', 'Atebubu', 'Kintampo North', 'Nkoranza'],
  'Ahafo': ['Goaso', 'Asunafo North', 'Tano North'],
  'Western North': ['Sefwi Wiawso', 'Sefwi Akontombra', 'Bia West', 'Juaboso']
}

function demoRegionDistricts(regionId: number): DistrictMapRow[] {
  const region = GHANA_REGION_NAMES[regionId - 1] ?? 'Greater Accra'
  const names = DEMO_DISTRICTS[region] ?? ['District A', 'District B', 'District C']
  return names.map((name, i) => {
    const health = Math.max(30, Math.min(98, 60 + ((i * 47) % 40) - (regionId % 3) * 6))
    return {
      id: regionId * 100 + i + 1,
      name,
      region,
      cells: 20 + ((i * 97) % 180),
      ncCells: Math.max(0, Math.round((95 - health) / 9)),
      healthScore: health,
      prbAvg: Math.round((35 + ((i * 71) % 60)) * 10) / 10,
      throughputKbps: 9_000 + ((i * 613) % 11_000),
      users: 8_000 + ((i * 229) % 90_000),
      volumeMb: 40_000 + ((i * 421) % 500_000),
      availability: (985 + ((i * 9) % 14)) / 10
    }
  })
}

function demoExplorer(
  level: ExplorerLevel,
  parentId: number | null = null,
  opts: { q?: string } = {}
): ExplorerResult {
  const q = (opts.q ?? '').trim().toLowerCase()
  const cells = demoNcLifecycle().cells
  const cellHealth = (c: (typeof cells)[number]): number => 50 + ((c.cellId * 37) % 50)
  const idx = (c: (typeof cells)[number]): number => c.cellId - 100000
  const cellKpi = (c: (typeof cells)[number]) => ({
    prb: c.prbAvg ?? 0,
    thr: 14_000 + ((idx(c) * idx(c) * 977) % 12_000),
    usr: 120 + ((c.cellId * 53) % 900),
    vol: 8_000 + ((c.cellId * 97) % 60_000),
    avail: 99 + ((c.cellId * 7) % 10) / 10,
    nc: c.isNc ? 1 : 0,
    health: cellHealth(c)
  })
  const priorityOf = (c: (typeof cells)[number]): number => {
    const base = c.severity === 'Critical' ? 90 : c.severity === 'High' ? 74 : c.severity === 'Watch' ? 58 : c.lifecycle === 'Recovering' ? 30 : 20
    return base + ((c.cellId * 13) % 8)
  }

  // stable ids from sorted names so drill-down parentIds resolve
  const nameId = (names: string[]): Map<string, number> => {
    const m = new Map<string, number>()
    ;[...new Set(names)].sort().forEach((n, i) => m.set(n, i + 1))
    return m
  }
  const regionId = nameId(cells.map((c) => c.region ?? '—'))
  const districtId = nameId(cells.map((c) => c.district ?? '—'))
  const siteId = nameId(cells.map((c) => c.site ?? c.cellName))
  const regionOf = (id: number): string => [...regionId.entries()].find(([, v]) => v === id)?.[0] ?? ''
  const districtOf = (id: number): string => [...districtId.entries()].find(([, v]) => v === id)?.[0] ?? ''
  const siteOf = (id: number): string => [...siteId.entries()].find(([, v]) => v === id)?.[0] ?? ''

  const agg = (list: typeof cells) => {
    const ks = list.map(cellKpi)
    return {
      health: Math.round((ks.reduce((s, k) => s + k.health, 0) / Math.max(1, ks.length)) * 10) / 10,
      nc: ks.reduce((s, k) => s + k.nc, 0),
      prb: Math.round((ks.reduce((s, k) => s + k.prb, 0) / Math.max(1, ks.length)) * 10) / 10,
      thr: Math.round((ks.reduce((s, k) => s + k.thr, 0) / Math.max(1, ks.length)) * 10) / 10,
      usr: ks.reduce((s, k) => s + k.usr, 0),
      vol: ks.reduce((s, k) => s + k.vol, 0),
      avail: Math.round((ks.reduce((s, k) => s + k.avail, 0) / Math.max(1, ks.length)) * 10) / 10
    }
  }

  let nodes: ExplorerNode[] = []
  let breadcrumb: ExplorerBreadcrumb[] = []

  if (level === 'region') {
    nodes = [...regionId.keys()].map((name) => {
      const list = cells.filter((c) => (c.region ?? '—') === name)
      const a = agg(list)
      return { id: regionId.get(name)!, name, level, healthScore: a.health, ncCells: a.nc, cells: list.length, prbAvg: a.prb, throughputKbps: a.thr, users: a.usr, volumeMb: a.vol, availability: a.avail, isNc: false, lifecycle: null, severity: null, priorityScore: null, priorityBand: null }
    })
  } else if (level === 'district') {
    const region = regionOf(parentId ?? 0)
    breadcrumb = region ? [{ id: parentId!, name: region, level: 'region' }] : []
    nodes = [...districtId.keys()].map((name): ExplorerNode | null => {
      const list = cells.filter((c) => (c.district ?? '—') === name && (c.region ?? '—') === region)
      if (list.length === 0) return null
      const a = agg(list)
      return { id: districtId.get(name)!, name, level, healthScore: a.health, ncCells: a.nc, cells: list.length, prbAvg: a.prb, throughputKbps: a.thr, users: a.usr, volumeMb: a.vol, availability: a.avail, isNc: false, lifecycle: null, severity: null, priorityScore: null, priorityBand: null }
    }).filter((n): n is ExplorerNode => n != null)
  } else if (level === 'site') {
    const district = districtOf(parentId ?? 0)
    const region = [...regionId.keys()].find((r) => cells.some((c) => (c.region ?? '—') === r && (c.district ?? '—') === district)) ?? ''
    breadcrumb = [
      ...(region ? [{ id: regionId.get(region)!, name: region, level: 'region' as const }] : []),
      ...(district ? [{ id: parentId!, name: district, level: 'district' as const }] : [])
    ]
    nodes = [...siteId.keys()].map((name): ExplorerNode | null => {
      const list = cells.filter((c) => (c.site ?? c.cellName) === name && (c.district ?? '—') === district)
      if (list.length === 0) return null
      const a = agg(list)
      return { id: siteId.get(name)!, name, level, healthScore: a.health, ncCells: a.nc, cells: list.length, prbAvg: a.prb, throughputKbps: a.thr, users: a.usr, volumeMb: a.vol, availability: a.avail, isNc: false, lifecycle: null, severity: null, priorityScore: null, priorityBand: null }
    }).filter((n): n is ExplorerNode => n != null)
  } else {
    const site = siteOf(parentId ?? 0)
    const district = [...districtId.keys()].find((d) => cells.some((c) => (c.district ?? '—') === d && (c.site ?? c.cellName) === site)) ?? ''
    const region = [...regionId.keys()].find((r) => cells.some((c) => (c.region ?? '—') === r && (c.district ?? '—') === district)) ?? ''
    breadcrumb = [
      ...(region ? [{ id: regionId.get(region)!, name: region, level: 'region' as const }] : []),
      ...(district ? [{ id: districtId.get(district)!, name: district, level: 'district' as const }] : []),
      ...(site ? [{ id: parentId!, name: site, level: 'site' as const }] : [])
    ]
    nodes = cells
      .filter((c) => (c.site ?? c.cellName) === site)
      .map((c) => {
        const k = cellKpi(c)
        const score = priorityOf(c)
        return {
          id: c.cellId,
          name: c.cellName,
          level,
          healthScore: k.health,
          ncCells: k.nc,
          cells: 1,
          prbAvg: k.prb,
          throughputKbps: k.thr,
          users: k.usr,
          volumeMb: k.vol,
          availability: Math.round(k.avail * 10) / 10,
          isNc: c.isNc,
          lifecycle: c.lifecycle,
          severity: c.severity,
          priorityScore: score,
          priorityBand: score >= 90 ? 'Critical' : score >= 75 ? 'High' : score >= 50 ? 'Medium' : 'Watch'
        }
      })
  }

  if (q) nodes = nodes.filter((n) => n.name.toLowerCase().includes(q))
  nodes.sort((a, b) => (a.healthScore ?? 101) - (b.healthScore ?? 101) || a.name.localeCompare(b.name))
  return {
    level,
    parentId,
    breadcrumb,
    nodes,
    ncCells: nodes.reduce((s, n) => s + n.ncCells, 0),
    totalCells: nodes.reduce((s, n) => s + n.cells, 0)
  }
}

function demoPriorityCenter(opts: PriorityCenterOpts = {}): PriorityCenterResult {
  const scope: InvestigationScope = opts.scope ?? 'cell'
  const mode: PriorityMode = opts.mode ?? 'balanced'
  const cells = demoNcLifecycle().cells
  const idx = (c: (typeof cells)[number]): number => c.cellId - 100000
  const priorityOf = (c: (typeof cells)[number]): number => {
    const base = c.severity === 'Critical' ? 90 : c.severity === 'High' ? 74 : c.severity === 'Watch' ? 58 : c.lifecycle === 'Recovering' ? 30 : 20
    return base + ((c.cellId * 13) % 8)
  }
  const bandOf = (s: number): PriorityBand | null =>
    s >= 90 ? 'Critical' : s >= 75 ? 'High' : s >= 50 ? 'Medium' : s >= 25 ? 'Watch' : 'Low'

  const nameId = (names: string[]): Map<string, number> => {
    const m = new Map<string, number>()
    ;[...new Set(names)].sort().forEach((n, i) => m.set(n, i + 1))
    return m
  }
  const siteId = nameId(cells.map((c) => c.site ?? c.cellName))
  const districtId = nameId(cells.map((c) => c.district ?? '—'))
  const regionId = nameId(cells.map((c) => c.region ?? '—'))

  const OWNERS = ['Ops', 'RF Eng', 'Capacity', 'Backhaul', null]
  const statusFor = (
    sc: InvestigationScope, id: number, isNc: boolean, score: number
  ): { status: ActionStatus | null; owner: string | null; ticket: string | null; review: string | null } => {
    const saved = invState.get(invKey(sc, id))?.status
    if (saved) return { status: saved.status, owner: saved.owner, ticket: saved.externalTicket, review: saved.targetReviewDate }
    const h = (id * 31) % 17
    if (!isNc && score < 75) {
      // healthy low-priority: mostly unset, a few resolved
      if (h % 5 === 0) {
        const d = new Date(Date.UTC(2026, 6, 20))
        return { status: 'Resolved', owner: OWNERS[h % 4], ticket: `INC-${1000 + (id % 900)}`, review: d.toISOString().slice(0, 10) }
      }
      return { status: null, owner: null, ticket: null, review: null }
    }
    // NC / high-priority entities: workflow statuses with owners + due dates
    const st: ActionStatus[] = ['Unreviewed', 'Investigating', 'Escalated', 'Monitoring', 'Optimization in progress']
    const status = st[h % st.length]
    const days = ((id * 17) % 21) - 7 // -7 .. +13 → some overdue
    const d = new Date(Date.UTC(2026, 6, 27 + days))
    return {
      status,
      owner: status === 'Unreviewed' ? null : (OWNERS[(id * 7) % 4] as string),
      ticket: status === 'Unreviewed' ? null : `INC-${1000 + ((id * 13) % 900)}`,
      review: d.toISOString().slice(0, 10)
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  let rows: PriorityCenterRow[] = []

  if (scope === 'cell') {
    rows = cells.map((c) => {
      const score = priorityOf(c)
      const s = statusFor('cell', c.cellId, c.isNc, score)
      return {
        id: c.cellId,
        name: c.cellName,
        scope,
        path: [c.region, c.district, c.site, c.cellName].filter((v): v is string => !!v),
        priorityScore: score,
        priorityBand: bandOf(score),
        status: s.status,
        owner: s.owner,
        externalTicket: s.ticket,
        targetReviewDate: s.review,
        overdue: s.review != null && s.review < today && s.status !== 'Resolved' && s.status !== 'Deferred',
        ncCells: c.isNc ? 1 : 0,
        cells: 1,
        prbAvg: c.prbAvg ?? null
      }
    })
  } else {
    const groupKey = scope === 'site' ? ((c: (typeof cells)[number]) => c.site ?? c.cellName) : ((c: (typeof cells)[number]) => c.district ?? '—')
    const groups = new Map<string, (typeof cells)[number][]>()
    for (const c of cells) {
      const k = groupKey(c)
      const l = groups.get(k) ?? []
      l.push(c)
      groups.set(k, l)
    }
    for (const [name, list] of groups) {
      const id = scope === 'site' ? siteId.get(name)! : districtId.get(name)!
      const region = list[0].region ?? ''
      const district = list[0].district ?? ''
      const nc = list.filter((c) => c.isNc).length
      const score = Math.max(...list.map(priorityOf))
      const s = statusFor(scope, id, nc > 0, score)
      rows.push({
        id,
        name,
        scope,
        path: [region, district, name].filter((v): v is string => !!v),
        priorityScore: score,
        priorityBand: bandOf(score),
        status: s.status,
        owner: s.owner,
        externalTicket: s.ticket,
        targetReviewDate: s.review,
        overdue: s.review != null && s.review < today && s.status !== 'Resolved' && s.status !== 'Deferred',
        ncCells: nc,
        cells: list.length,
        prbAvg: Math.round((list.reduce((a, c) => a + (c.prbAvg ?? 0), 0) / list.length) * 10) / 10
      })
    }
  }

  if (opts.search) {
    const q = opts.search.toLowerCase()
    rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.path.some((p) => p.toLowerCase().includes(q)))
  }
  if (opts.status) {
    rows = opts.status === 'unset' ? rows.filter((r) => r.status == null) : rows.filter((r) => r.status === opts.status)
  }
  if (opts.band) {
    rows = rows.filter((r) => r.priorityBand === opts.band)
  }
  if (opts.overdueOnly) {
    rows = rows.filter((r) => r.overdue)
  }
  rows.sort((a, b) =>
    opts.sort === 'due'
      ? (a.targetReviewDate ?? '9999').localeCompare(b.targetReviewDate ?? '9999') || (b.priorityScore ?? -1) - (a.priorityScore ?? -1)
      : opts.sort === 'name'
        ? a.name.localeCompare(b.name)
        : (b.priorityScore ?? -1) - (a.priorityScore ?? -1)
  )
  const total = rows.length
  const byStatus: Record<string, number> = {}
  for (const r of rows) byStatus[r.status ?? 'unset'] = (byStatus[r.status ?? 'unset'] ?? 0) + 1
  const overdue = rows.filter((r) => r.overdue).length
  const offset = Math.max(0, opts.offset ?? 0)
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100))
  return { total, rows: rows.slice(offset, offset + limit), byStatus, overdue }
}

// --- forecasting demo (§45–46) ---------------------------------------------
// Mirrors src/main/analytics/forecast.ts in JS: simple-first methods, holdout
// quality, and risk classification. 12 weeks of deterministic history per cell
// ending at the current demo week.

const fcMean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)

function fcTrend(xs: number[]): { slope: number; intercept: number } {
  const n = xs.length
  const sx = (n * (n - 1)) / 2
  const sxx = (n * (n - 1) * (2 * n - 1)) / 6
  const sy = xs.reduce((a, b) => a + b, 0)
  const sxy = xs.reduce((a, b, i) => a + b * i, 0)
  const denom = n * sxx - sx * sx
  if (denom === 0) return { slope: 0, intercept: fcMean(xs) }
  return { slope: (n * sxy - sx * sy) / denom, intercept: (sy - ((n * sxy - sx * sy) / denom) * sx) / n }
}

function fcHoldout(xs: number[], predict: (i: number) => number): { mae: number; rmse: number; dir: number | null } {
  const n = xs.length
  if (n < 2) return { mae: 0, rmse: 0, dir: null }
  const errs: number[] = []
  let hits = 0
  let dn = 0
  for (let i = 1; i < n; i++) {
    const p = predict(i)
    const a = xs[i]
    errs.push(Math.abs(p - a))
    const pm = p - xs[i - 1]
    const am = a - xs[i - 1]
    if (pm !== 0 && am !== 0 && Math.sign(pm) === Math.sign(am)) hits++
    dn++
  }
  return {
    mae: errs.reduce((a, b) => a + b, 0) / errs.length,
    rmse: Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / errs.length),
    dir: dn > 0 ? hits / dn : null
  }
}

function fcForecast(
  values: number[],
  label: string,
  unit: string
): { method: string; quality: string; next: number | null; lower: number | null; upper: number | null; confidence: number | null; mae: number | null; rmse: number | null; dir: number | null; explanation: string } {
  const n = values.length
  const scale = Math.max(1e-6, Math.abs(fcMean(values)))
  if (n < 2) {
    return {
      method: 'suppressed', quality: 'suppressed', next: null, lower: null, upper: null,
      confidence: null, mae: null, rmse: null, dir: null,
      explanation: `Insufficient history (${n} week${n === 1 ? '' : 's'}) for ${label.toLowerCase()} — forecast suppressed (spec §46).`
    }
  }
  let method = 'moving-average'
  let mae = 0
  let rmse = 0
  let dir: number | null = null
  let next: number | null = null
  let conf: number | null = null
  if (n >= 3) {
    const maE = fcHoldout(values, (i) => (i === n - 1 ? fcMean(values.slice(0, n - 1)) : fcMean(values.slice(0, i + 1))))
    const lt = fcTrend(values.slice(0, n - 1))
    const ltE = fcHoldout(values, (i) => (i === n - 1 ? lt.intercept + lt.slope * i : values[i]))
    if (ltE.mae <= maE.mae) {
      method = 'linear-trend'; mae = ltE.mae; rmse = ltE.rmse; dir = ltE.dir
    } else {
      method = 'moving-average'; mae = maE.mae; rmse = maE.rmse; dir = maE.dir
    }
    next = method === 'linear-trend' ? Math.max(0, fcTrend(values).intercept + fcTrend(values).slope * n) : fcMean(values)
    conf = Math.round(Math.min(92, Math.max(15, 100 - (mae / scale) * 220)))
    if (n < 4) conf = Math.min(conf, 55)
  } else {
    method = 'moving-average'
    next = fcMean(values)
    mae = Math.abs(values[1] - values[0])
    rmse = mae
    dir = null
    conf = 40
  }
  const band = Math.max(scale * 0.08, Math.abs(fcMean(values) - (next ?? fcMean(values))) * 1.2, mae * 1.5)
  const lower = next == null ? null : Math.max(0, next - band)
  const upper = next == null ? null : next + band
  const quality = n < 3 ? 'low' : mae / scale <= 0.05 ? 'high' : mae / scale <= 0.15 ? 'medium' : 'low'
  const parts = [`${method === 'linear-trend' ? 'linear trend' : 'moving average'} over ${n} weeks of ${label.toLowerCase()}`]
  parts.push(`holdout MAE ${mae.toFixed(2)} ${unit}`)
  parts.push(`RMSE ${rmse.toFixed(2)} ${unit}`)
  if (dir != null) parts.push(`directional accuracy ${Math.round(dir * 100)}%`)
  if (n < 4) parts.push('limited history — quality capped')
  parts.push(`next ${label.toLowerCase()} ≈ ${next?.toFixed(1) ?? '—'} ${unit}`)
  return { method, quality, next, lower, upper, confidence: conf, mae, rmse, dir, explanation: parts.join('; ') + '.' }
}

function fcRisk(
  threshold: number | null, worseIsHigher: boolean, history: number[], forecast: number | null, label: string
): { risk: ForecastRisk; explanation: string } {
  const latest = history.length > 0 ? history[history.length - 1] : null
  if (threshold == null) {
    if (latest == null || forecast == null || history.length < 2) {
      return { risk: 'Stable', explanation: `${label}: insufficient data to classify.` }
    }
    const growth = Math.abs(forecast - latest) / Math.max(1, Math.abs(latest))
    if (growth >= 0.15) {
      return { risk: 'Watch', explanation: `${label} is forecast to move ${forecast - latest >= 0 ? 'up' : 'down'} ${(growth * 100).toFixed(0)}% — monitor for congestion impact.` }
    }
    return { risk: 'Stable', explanation: `${label} trajectory is flat.` }
  }
  if (latest == null || forecast == null) {
    return { risk: 'Stable', explanation: `${label}: insufficient data to classify.` }
  }
  if (worseIsHigher ? latest >= threshold : latest <= threshold) {
    return { risk: 'Already Breached', explanation: `${label} is already ${latest.toFixed(1)} vs the ${threshold.toFixed(1)} threshold (${worseIsHigher ? 'at or above' : 'at or below'}).` }
  }
  if (worseIsHigher ? forecast >= threshold : forecast <= threshold) {
    return { risk: 'Likely Breach', explanation: `${label} is ${latest.toFixed(1)} now but forecast at ${forecast.toFixed(1)} crosses the ${threshold.toFixed(1)} threshold within the horizon.` }
  }
  const margin = worseIsHigher ? (threshold - forecast) / threshold : (forecast - threshold) / threshold
  if (margin <= 0.1) return { risk: 'At Risk', explanation: `${label} forecast ${forecast.toFixed(1)} is within 10% of the ${threshold.toFixed(1)} threshold.` }
  if (margin <= 0.2) return { risk: 'Watch', explanation: `${label} forecast ${forecast.toFixed(1)} is within 20% of the ${threshold.toFixed(1)} threshold.` }
  return { risk: 'Stable', explanation: `${label} forecast ${forecast.toFixed(1)} is comfortably inside the threshold.` }
}

const FC_METRICS: Array<{ metric: ForecastMetric; label: string; unit: string; worseIsHigher: boolean }> = [
  { metric: 'prb', label: 'PRB utilization', unit: '%', worseIsHigher: true },
  { metric: 'traffic', label: 'Data volume', unit: 'MB', worseIsHigher: false },
  { metric: 'users', label: 'Connected users', unit: '', worseIsHigher: false },
  { metric: 'throughput', label: 'DL throughput', unit: 'kbps', worseIsHigher: false },
  { metric: 'availability', label: 'Availability', unit: '%', worseIsHigher: false }
]

function fcHistory(c: { cellId: number; prbAvg: number | null }, weeksN: number): Record<string, number[]> {
  // deterministic 12-week walk ending at the current value (NC cells rise toward breach)
  const idx = c.cellId - 100000
  const wob = (i: number, salt: number): number => (((i * 7 + idx * 3 + salt) % 9) - 4)
  const prbCur = c.prbAvg ?? 50
  const prbStep = 0.4 + ((c.cellId * 7) % 17) / 10
  const prb = Array.from({ length: weeksN }, (_, i) => Math.min(100, Math.max(18, prbCur - (weeksN - 1 - i) * prbStep + wob(i, 1))))
  const usrCur = 120 + ((c.cellId * 53) % 900)
  const usrStep = 1 + ((c.cellId * 11) % 13) / 10
  const usr = Array.from({ length: weeksN }, (_, i) => Math.max(10, usrCur - (weeksN - 1 - i) * usrStep + wob(i, 2)))
  const volCur = 8_000 + ((c.cellId * 97) % 60_000)
  const volStep = 60 + ((c.cellId * 13) % 140)
  const vol = Array.from({ length: weeksN }, (_, i) => Math.max(100, volCur - (weeksN - 1 - i) * volStep + wob(i, 3) * 40))
  const thrCur = 14_000 + ((idx * idx * 977) % 12_000)
  const thrStep = 60 + ((c.cellId * 17) % 120)
  const thr = Array.from({ length: weeksN }, (_, i) => Math.max(1_000, thrCur - (weeksN - 1 - i) * thrStep + wob(i, 4) * 80))
  const avCur = 99 + ((c.cellId * 7) % 10) / 10
  const avStep = 0.02 + ((c.cellId * 5) % 10) / 100
  const av = Array.from({ length: weeksN }, (_, i) => Math.min(100, Math.max(90, avCur - (weeksN - 1 - i) * avStep + wob(i, 5) * 0.08)))
  return { prb, traffic: vol, users: usr, throughput: thr, availability: av }
}

function demoForecast(opts: ForecastOpts = {}): ForecastResult {
  const scope: ForecastScope = opts.scope ?? 'network'
  const metric: ForecastMetric = opts.metric ?? 'prb'
  const horizon: ForecastHorizon = opts.horizon ?? '4w'
  const weeksAhead = horizon === '1w' ? 1 : horizon === '2w' ? 2 : horizon === '4w' ? 4 : 6
  const cells = demoNcLifecycle().cells
  const prbThreshold = demoRules?.prbThresholdPct ?? 80
  const threshold = metric === 'prb' ? prbThreshold : metric === 'availability' ? 99.5 : metric === 'throughput' ? 10_000 : null

  const nameId = (names: string[]): Map<string, number> => {
    const m = new Map<string, number>()
    ;[...new Set(names)].sort().forEach((n, i) => m.set(n, i + 1))
    return m
  }
  const regionId = nameId(cells.map((c) => c.region ?? '—'))
  const districtId = nameId(cells.map((c) => c.district ?? '—'))
  const siteId = nameId(cells.map((c) => c.site ?? c.cellName))
  const regionOf = (id: number): string => [...regionId.entries()].find(([, v]) => v === id)?.[0] ?? ''
  const districtOf = (id: number): string => [...districtId.entries()].find(([, v]) => v === id)?.[0] ?? ''
  const siteOf = (id: number): string => [...siteId.entries()].find(([, v]) => v === id)?.[0] ?? ''

  // scope → cell filter + entity name/path
  let inScope = cells
  let entityName = 'Network'
  let entityPath = ['Network']
  if (scope === 'region') {
    const region = regionOf(opts.entityId ?? 0)
    inScope = cells.filter((c) => (c.region ?? '—') === region)
    entityName = region
    entityPath = ['Network', region]
  } else if (scope === 'district') {
    const district = districtOf(opts.entityId ?? 0)
    inScope = cells.filter((c) => (c.district ?? '—') === district)
    entityName = district
    entityPath = ['Network', inScope[0]?.region ?? '—', district]
  } else if (scope === 'site') {
    const site = siteOf(opts.entityId ?? 0)
    inScope = cells.filter((c) => (c.site ?? c.cellName) === site)
    entityName = site
    entityPath = ['Network', inScope[0]?.region ?? '—', inScope[0]?.district ?? '—', site]
  } else if (scope === 'cell') {
    inScope = cells.filter((c) => c.cellId === opts.entityId)
    entityName = inScope[0]?.cellName ?? ''
    entityPath = ['Network', inScope[0]?.region ?? '—', inScope[0]?.district ?? '—', inScope[0]?.site ?? '—', entityName].filter((p) => p !== '—')
  }

  // 12 Mondays ending at the demo's latest week (2026-07-27)
  const weekStarts = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 4, 11 + i * 7))
    return d.toISOString().slice(0, 10)
  })
  const asOf = weekStarts[weekStarts.length - 1]
  const addWeeks = (ds: string, w: number): string => {
    const d = new Date(ds + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + w * 7)
    return d.toISOString().slice(0, 10)
  }
  const history = new Map<number, Record<string, number[]>>()
  for (const c of inScope) history.set(c.cellId, fcHistory(c, weekStarts.length))

  const series: ForecastSeries[] = FC_METRICS.map((m) => {
    const points: ForecastPoint[] = weekStarts.map((ws0, i) => {
      const vals = inScope.map((c) => history.get(c.cellId)?.[m.metric]?.[i]).filter((v): v is number => v != null)
      if (vals.length === 0) return { weekStart: ws0, label: weekLabel(ws0), value: null, kind: 'actual' as const, lower: null, upper: null }
      const value = m.metric === 'users' || m.metric === 'traffic'
        ? vals.reduce((a, b) => a + b, 0)
        : vals.reduce((a, b) => a + b, 0) / vals.length
      return { weekStart: ws0, label: weekLabel(ws0), value: Math.round(value * 100) / 100, kind: 'actual' as const, lower: null, upper: null }
    })
    const fc = fcForecast(points.map((p) => p.value).filter((v): v is number => v != null), m.label, m.unit)
    let last = weekStarts[weekStarts.length - 1]
    for (let i = 1; i <= weeksAhead; i++) {
      last = addWeeks(last, 1)
      points.push({
        weekStart: last,
        label: weekLabel(last),
        value: fc.next == null ? null : Math.round(fc.next * 100) / 100,
        kind: 'forecast',
        lower: fc.lower == null ? null : Math.round(fc.lower * 100) / 100,
        upper: fc.upper == null ? null : Math.round(fc.upper * 100) / 100
      })
    }
    return {
      metric: m.metric,
      label: m.label,
      unit: m.unit,
      worseIsHigher: m.worseIsHigher,
      threshold: metric === 'prb' ? prbThreshold : metric === 'availability' ? 99.5 : metric === 'throughput' ? 10_000 : null,
      points,
      forecast: {
        method: fc.method as ForecastMethod,
        quality: fc.quality as ForecastQuality,
        next: fc.next,
        lower: fc.lower,
        upper: fc.upper,
        confidence: fc.confidence,
        mae: fc.mae,
        rmse: fc.rmse,
        directionalAccuracy: fc.dir == null ? null : Math.round(fc.dir * 100),
        explanation: fc.explanation
      }
    }
  })

  // risk rows: per cell for the selected metric, worst first
  const mDef = FC_METRICS.find((m) => m.metric === metric)!
  const riskRows: ForecastRiskRow[] = inScope.map((c) => {
    const values = history.get(c.cellId)?.[metric] ?? []
    const fc = fcForecast(values, mDef.label, mDef.unit)
    const cls = fcRisk(threshold, mDef.worseIsHigher, values, fc.next, mDef.label)
    const path = [c.region, c.district, c.site].filter((v): v is string => !!v && v !== '—')
    return {
      id: c.cellId,
      name: c.cellName,
      path,
      current: values.length > 0 ? Math.round(values[values.length - 1] * 100) / 100 : null,
      forecast: fc.next == null ? null : Math.round(fc.next * 100) / 100,
      threshold,
      risk: cls.risk,
      explanation: cls.explanation,
      cells: 1,
      ncCells: c.isNc ? 1 : 0
    }
  })
  const RISK_RANK: Record<ForecastRisk, number> = { 'Already Breached': 0, 'Likely Breach': 1, 'At Risk': 2, Watch: 3, Stable: 4 }
  riskRows.sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk] || (b.current ?? -Infinity) - (a.current ?? -Infinity))
  const riskCounts: Record<ForecastRisk, number> = { Stable: 0, Watch: 0, 'At Risk': 0, 'Likely Breach': 0, 'Already Breached': 0 }
  for (const row of riskRows) riskCounts[row.risk]++

  const selSeries = series.find((s) => s.metric === metric)!
  const selHistory = selSeries.points.filter((p) => p.kind === 'actual').map((p) => p.value).filter((v): v is number => v != null)
  const entityRisk = fcRisk(threshold, mDef.worseIsHigher, selHistory, selSeries.forecast.next, mDef.label)

  return {
    asOf,
    horizon,
    metric,
    entity: { scope, id: opts.entityId ?? null, name: entityName, path: entityPath.filter((p) => p !== '—') },
    series,
    risk: entityRisk.risk,
    riskExplanation: entityRisk.explanation,
    riskCounts,
    riskRows: riskRows.slice(0, 60),
    totalEntities: inScope.length
  }
}

// --- M5 reporting demo (§51–56) --------------------------------------------
// Builds report packs from the demo analytics getters with the same renderers
// as src/main/services/reportingService.ts; files download in the browser and
// history/templates live in module memory.

interface RptTable {
  title: string
  columns: string[]
  rows: Array<Array<string | number | null>>
  note?: string
}

const rfmt = (v: number | null | undefined, unit = '', digits = 1): string =>
  v == null ? '—' : `${Number(v).toFixed(digits)}${unit}`

const rfmtK = (v: number | null | undefined): string =>
  v == null ? '—' : `${Math.round(v).toLocaleString()}`

const rCsv = (v: string | number | null): string => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const rHtml = (v: string | number | null): string =>
  v == null ? '—' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function rSection(id: ReportSectionId): Promise<{ id: ReportSectionId; table: RptTable }> {
  const a = window.api.analytics
  try {
    switch (id) {
      case 'executive-summary': {
        const s = await a.summary()
        const h = await a.health()
        const q = await a.priorityQueue('balanced', 10)
        const rows: Array<Array<string | number | null>> = [
          ['Observed rows', rfmtK(s?.rowCount)],
          ['Cells / Sites / Districts / Regions', `${rfmtK(s?.cells)} / ${rfmtK(s?.sites)} / ${rfmtK(s?.districts)} / ${rfmtK(s?.regions)}`],
          ['Avg PRB utilization', rfmt(s?.avgPrb, '%')],
          ['Data volume', s?.totalVolumeMb == null ? '—' : `${(s.totalVolumeMb / 1024).toFixed(1)} GB`],
          ['Connected users', rfmtK(s?.totalUsers)],
          ['DL throughput', s?.avgThroughputKbps == null ? '—' : `${(s.avgThroughputKbps / 1024).toFixed(1)} Mbps`],
          ['Availability', rfmt(s?.avgAvailability, '%')],
          ['Weekly NC cells', rfmtK(s?.weeklyNcCells)],
          ['Ruleset version', s?.rulesetVersion ?? null]
        ]
        const latest = h?.network?.[h.network.length - 1]
        if (latest) {
          rows.push(['Network health score', latest.score])
          rows.push(['Health components (cap/thr/avail/nc/growth)', `${latest.capacity} / ${latest.throughput} / ${latest.availability} / ${latest.ncRecurrence} / ${latest.growth}`])
        }
        rows.push(['Top priorities', (q ?? []).slice(0, 5).map((p) => `${p.cellName} (${p.band}, ${p.score})`).join('; ') || '—'])
        return { id, table: { title: 'Executive Summary', columns: ['KPI', 'Value'], rows, note: `NC rate and health as of the latest completed week (${latest?.asOf ?? '—'}).` } }
      }
      case 'kpi-trend': {
        const mv = await a.ncMovement(8)
        const h = await a.health()
        return {
          id,
          table: {
            title: 'KPI Trend',
            columns: ['Week', 'New NC', 'Recurring', 'Persistent', 'Recovering', 'NC cells', 'NC rate'],
            rows: mv.map((m) => [m.weekStart, m.newNc, m.recurring, m.persistent, m.recovering, m.ncCells, m.ncRate == null ? null : `${m.ncRate.toFixed(1)}%`]),
            note: `Network health (last ${Math.min(8, h?.network.length ?? 0)} weeks): score + capacity/throughput/availability/nc-recurrence/growth.`
          }
        }
      }
      case 'region-analysis': return rMatrix('region', 'Region Analysis')
      case 'district-analysis': return rMatrix('district', 'District Analysis')
      case 'site-analysis': return rMatrix('site', 'Site Analysis')
      case 'all-cells': {
        const r = await a.cellIntelligence({ limit: 200 })
        return {
          id,
          table: {
            title: 'All Cells',
            columns: ['Cell', 'Region', 'District', 'Site', 'Lifecycle', 'Trend', 'Severity', 'PRB %', 'Priority'],
            rows: r.rows.map((c) => [c.cellName, c.region ?? '', c.district ?? '', c.site ?? '', c.lifecycle, c.trend, c.severity, c.prbAvg == null ? null : c.prbAvg.toFixed(1), c.priorityScore ?? null]),
            note: `Showing ${r.total} cells (first ${r.rows.length}).`
          }
        }
      }
      case 'nc-register': {
        const r = await a.cellIntelligence({ limit: 400 })
        const nc = r.rows.filter((c) => c.isNc)
        return {
          id,
          table: {
            title: 'NC Register',
            columns: ['Cell', 'Region', 'District', 'Site', 'Lifecycle', 'Trend', 'Severity', 'PRB %', 'Breach days'],
            rows: nc.map((c) => [c.cellName, c.region ?? '', c.district ?? '', c.site ?? '', c.lifecycle, c.trend, c.severity, c.prbAvg == null ? null : c.prbAvg.toFixed(1), c.breachDays]),
            note: `${nc.length} NC cells under the active ruleset.`
          }
        }
      }
      case 'persistent-nc': {
        const r = await a.cellIntelligence({ lifecycle: 'Persistent NC', limit: 100 })
        return {
          id,
          table: {
            title: 'Persistent NC',
            columns: ['Cell', 'Region', 'District', 'Site', 'Trend', 'Severity', 'PRB %', 'Breach days', 'Priority'],
            rows: r.rows.map((c) => [c.cellName, c.region ?? '', c.district ?? '', c.site ?? '', c.trend, c.severity, c.prbAvg == null ? null : c.prbAvg.toFixed(1), c.breachDays, c.priorityScore ?? null]),
            note: `${r.total} persistent NC cells — escalation candidates.`
          }
        }
      }
      case 'priority-queue': {
        const q = await a.priorityQueue('balanced', 50)
        return {
          id,
          table: {
            title: 'Priority Queue',
            columns: ['Cell', 'Region', 'District', 'Site', 'Score', 'Band', 'PRB severity', 'Persistence', 'Trend'],
            rows: q.map((p) => [p.cellName, p.region ?? '', p.district ?? '', p.site ?? '', p.score, p.band, p.components.prbSeverity, p.components.persistence, p.components.worseningTrend]),
            note: 'Balanced mode, latest week. Higher score = more urgent.'
          }
        }
      }
      case 'forecast-risk': {
        const f = await a.forecast({})
        return {
          id,
          table: {
            title: 'Forecast Risk',
            columns: ['Cell', 'Path', 'Current', 'Forecast', 'Threshold', 'Risk'],
            rows: f.riskRows.slice(0, 25).map((r) => [r.name, r.path.join(' › '), r.current, r.forecast, r.threshold, r.risk]),
            note: `${f.totalEntities} entities; ${f.riskCounts['Already Breached'] ?? 0} already breached, ${f.riskCounts['Likely Breach'] ?? 0} likely to breach within the ${f.horizon} horizon.`
          }
        }
      }
      case 'health-matrix': {
        const m = await a.healthMatrix('cell', { weeks: 8, limit: 30 })
        return {
          id,
          table: {
            title: 'Health Matrix',
            columns: ['Cell', ...m.weeks.map((w) => w.slice(5))],
            rows: m.rows.map((r) => [r.name, ...r.scores.map((s) => s == null ? null : s.toFixed(0))]),
            note: 'Green ≥ 80, amber 65–79, red < 65 (cell × week health scores).'
          }
        }
      }
      case 'lifecycle-analysis': {
        const l = await a.ncLifecycle()
        return {
          id,
          table: {
            title: 'Lifecycle Analysis',
            columns: ['Dimension', 'Bucket', 'Count'],
            rows: [
              ...Object.entries(l.byLifecycle).map(([k, v]) => ['Lifecycle', k, v]),
              ...Object.entries(l.byTrend).map(([k, v]) => ['Trend', k, v]),
              ...Object.entries(l.bySeverity).map(([k, v]) => ['Severity', k, v]),
              ['NC rate', '—', l.ncRate == null ? null : `${l.ncRate.toFixed(1)}%`]
            ],
            note: `Week ${l.weekStart ?? '—'}: ${l.ncCells} of ${l.totalCells} cells in NC.`
          }
        }
      }
      default:
        return { id, table: { title: id, columns: ['Note'], rows: [['Section not available']] } }
    }
  } catch (e) {
    return { id, table: { title: id, columns: ['Note'], rows: [[`Section unavailable: ${e instanceof Error ? e.message : String(e)}`]] } }
  }
}

async function rMatrix(scope: 'region' | 'district' | 'site', title: string): Promise<{ id: ReportSectionId; table: RptTable }> {
  const m = await window.api.analytics.healthMatrix(scope, { limit: 30 })
  const last = m.weeks[m.weeks.length - 1]?.slice(5)
  return {
    id: (scope === 'region' ? 'region-analysis' : scope === 'district' ? 'district-analysis' : 'site-analysis') as ReportSectionId,
    table: { title, columns: ['Name', `Score (${last ?? 'latest'})`, 'Cells'], rows: m.rows.map((r) => [r.name, r.scores[r.scores.length - 1]?.toFixed(1) ?? null, '—']), note: 'Rolled up from cell health; worst first.' }
  }
}

const rCsvLine = (cells: Array<string | number | null>): string => cells.map(rCsv).join(',')

function rMarkdown(name: string, sections: Array<{ id: ReportSectionId; table: RptTable }>, snap: ReportSnapshot): string {
  const L: string[] = []
  L.push(`# ${name}`, '')
  L.push(`Generated ${new Date().toISOString()} · scope ${snap.scope} · as of ${snap.asOf} · ruleset v${snap.rulesetVersion ?? '—'}`)
  L.push('', `> ${snap.note}`, '')
  for (const s of sections) {
    L.push(`## ${s.table.title}`, '')
    L.push(`| ${s.table.columns.join(' | ')} |`, `| ${s.table.columns.map(() => '---').join(' | ')} |`)
    for (const row of s.table.rows) L.push(`| ${row.map((c) => String(c ?? '—').replace(/\|/g, '\\|')).join(' | ')} |`)
    if (s.table.note) L.push('', `*${s.table.note}*`)
    L.push('')
  }
  L.push('---', '*Generated by 2G/3G/4G QoS Network Intelligence — Reporting Center.*')
  return L.join('\n')
}

function rCsvOut(name: string, sections: Array<{ id: ReportSectionId; table: RptTable }>): string {
  const L: string[] = [rCsvLine(['#', name])]
  for (const s of sections) {
    L.push(rCsvLine(['##', s.table.title]))
    L.push(rCsvLine(s.table.columns))
    for (const row of s.table.rows) L.push(rCsvLine(row))
    L.push('')
  }
  return L.join('\n')
}

function rHtmlOut(name: string, sections: Array<{ id: ReportSectionId; table: RptTable }>, snap: ReportSnapshot): string {
  const esc = rHtml
  const table = (t: RptTable): string =>
    `<table><thead><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(name)}</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0e121a; color:#d7dde8; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; margin:0; padding:28px 36px; }
  h1 { font-size:22px; margin:0 0 4px; color:#fff; }
  h2 { font-size:15px; margin:22px 0 8px; color:#38bdf8; border-bottom:1px solid #263041; padding-bottom:4px; }
  .meta { color:#8b95a7; font-size:12px; margin-bottom:4px; }
  .note { color:#8b95a7; font-size:11px; margin:6px 0 0; }
  table { border-collapse:collapse; width:100%; margin:6px 0 10px; font-size:11px; }
  th { background:#1a2130; color:#d7dde8; text-align:left; padding:5px 8px; border:1px solid #263041; }
  td { padding:4px 8px; border:1px solid #232c3c; }
  tr:nth-child(even) td { background:#121720; }
  footer { color:#8b95a7; font-size:10px; margin-top:24px; border-top:1px solid #263041; padding-top:8px; }
</style></head><body>
  <h1>${esc(name)}</h1>
  <p class="meta">Generated ${new Date().toISOString()} · scope ${esc(snap.scope)} · as of ${esc(snap.asOf)} · ruleset v${esc(snap.rulesetVersion)} · ${esc(snap.ncCount)} NC cells</p>
  <p class="note">${esc(snap.note)}</p>
  ${sections.map((s) => `<section><h2>${esc(s.table.title)}</h2>${table(s.table)}${s.table.note ? `<p class="note">${esc(s.table.note)}</p>` : ''}</section>`).join('\n')}
  <footer>2G/3G/4G QoS Network Intelligence — Reporting Center (spec §51–56). Hypotheses are descriptive, not causal (spec §48).</footer>
</body></html>`
}

const demoDefs: ReportDefinition[] = [
  {
    id: 1,
    name: 'Weekly Management',
    type: 'executive',
    sections: ['executive-summary', 'priority-queue', 'forecast-risk', 'kpi-trend'],
    schedule: 'weekly',
    lastGenerated: null, // never generated → due now (§56)
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    charts: { ...DEFAULT_CHARTS }
  },
  {
    id: 2,
    name: 'Monthly Network Performance',
    type: 'engineering',
    sections: ['executive-summary', 'kpi-trend', 'region-analysis', 'all-cells', 'nc-register', 'lifecycle-analysis'],
    schedule: 'monthly',
    lastGenerated: new Date(Date.now() - 24 * 86400000).toISOString(), // 24 days ago → due
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    charts: { ...DEFAULT_CHARTS }
  },
  {
    id: 3,
    name: 'Quarterly Capacity Review',
    type: 'capacity',
    sections: ['persistent-nc', 'priority-queue', 'forecast-risk', 'health-matrix'],
    schedule: 'quarterly',
    lastGenerated: new Date(Date.now() - 2 * 86400000).toISOString(), // 2 days ago → not due
    createdAt: new Date(Date.now() - 120 * 86400000).toISOString(),
    charts: { ...DEFAULT_CHARTS }
  }
]
const demoHistory: ReportHistoryRow[] = []
let demoDefSeq = 3

function demoDueReports(): DueReport[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const DAY = 86400000
  const SCHED: Record<string, number> = { weekly: 7, monthly: 30, quarterly: 91 }
  const due: DueReport[] = []
  for (const d of demoDefs) {
    const days = SCHED[d.schedule ?? '']
    if (!days) continue
    if (!d.lastGenerated) {
      due.push({ definitionId: d.id, name: d.name, type: d.type, schedule: d.schedule ?? '', lastGenerated: null, nextDue: today.toISOString().slice(0, 10), overdueDays: 0 })
      continue
    }
    const last = new Date(d.lastGenerated)
    last.setHours(0, 0, 0, 0)
    const next = new Date(last.getTime() + days * DAY)
    if (next > today) continue
    due.push({
      definitionId: d.id,
      name: d.name,
      type: d.type,
      schedule: d.schedule ?? '',
      lastGenerated: d.lastGenerated,
      nextDue: next.toISOString().slice(0, 10),
      overdueDays: Math.max(0, Math.round((today.getTime() - next.getTime()) / DAY))
    })
  }
  return due.sort((a, b) => b.overdueDays - a.overdueDays || a.name.localeCompare(b.name))
}

function rDownload(name: string, content: string, ext: string): string {
  const type = ext === 'md' ? 'text/markdown' : ext === 'csv' ? 'text/csv' : 'text/html'
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return `exports/${name}`
}

async function demoReportPack(opts: ReportOpts = {}): Promise<ReportPack> {
  let type: ReportType = opts.type ?? 'executive'
  let sections: ReportSectionId[] =
    opts.sections && opts.sections.length > 0
      ? opts.sections
      : REPORT_SECTIONS.filter((s) => s.defaultFor.includes(type)).map((s) => s.id)
  const formats: ReportFormat[] = opts.formats && opts.formats.length > 0 ? opts.formats : ['md', 'csv', 'html']
  // a scheduled run inherits the definition's name, type and sections (§56)
  const def = opts.definitionId != null ? demoDefs.find((d) => d.id === opts.definitionId) : null
  if (def) {
    if (!opts.type) type = def.type
    if (!opts.sections?.length && def.sections.length > 0) sections = def.sections
  }
  const name = opts.name?.trim() || def?.name || `Report ${type.charAt(0).toUpperCase() + type.slice(1)}`
  const slug = name.replace(/[^A-Za-z0-9_-]+/g, '_').toLowerCase() || 'report'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const id = `${slug}-${stamp}`

  const a = window.api.analytics
  const s = await a.summary()
  const rules = demoRules
  const h = await a.health()
  const nc = await a.ncLifecycle()
  const snap: ReportSnapshot = {
    scope: 'network',
    asOf: nc.weekStart ?? '—',
    rulesetVersion: rules?.version ?? null,
    thresholds: { prb: rules?.prbThresholdPct ?? 80, availability: 99.5, throughput: 10_000, districtNc: rules?.districtNcThresholdPct ?? 10 },
    kpis: {
      avgPrb: s?.avgPrb ?? null,
      avgThroughputKbps: s?.avgThroughputKbps ?? null,
      totalUsers: s?.totalUsers ?? null,
      totalVolumeMb: s?.totalVolumeMb ?? null,
      avgAvailability: s?.avgAvailability ?? null,
      healthScore: h?.network?.[h.network.length - 1]?.score ?? null
    },
    classifications: nc.byLifecycle,
    ncCount: nc.ncCells,
    note: `Snapshot frozen at generation time: thresholds, KPIs, classifications and ruleset v${rules?.version ?? '—'} are embedded in every format.`
  }

  const sectionData: Array<{ id: ReportSectionId; table: RptTable }> = []
  for (const id2 of sections) sectionData.push(await rSection(id2))

  const md = rMarkdown(name, sectionData, snap)
  const csv = rCsvOut(name, sectionData)
  const html = rHtmlOut(name, sectionData, snap)

  const files: ReportPack['files'] = {}
  if (formats.includes('md')) files.md = { path: rDownload(`${id}.md`, md, 'md'), content: md }
  if (formats.includes('csv')) files.csv = { path: rDownload(`${id}.csv`, csv, 'csv'), content: csv }
  if (formats.includes('html')) files.html = { path: rDownload(`${id}.html`, html, 'html'), content: html }
  if (formats.includes('pdf')) files.pdf = { path: '', content: 'PDF generation requires the desktop app (Electron printToPDF).' }
  if (formats.includes('xlsx')) {
    try {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Executive Summary')
      ws.addRow([name])
      ws.addRow([`Generated ${new Date().toISOString()}`])
      ws.addRow(['KPI', 'Value'])
      ws.addRow(['Network health', snap.kpis.healthScore ?? '—'])
      ws.addRow(['Avg PRB %', snap.kpis.avgPrb ?? '—'])
      ws.addRow(['Availability %', snap.kpis.avgAvailability ?? '—'])
      ws.addRow(['NC cells', snap.ncCount])
      const ws2 = wb.addWorksheet('Import Metadata')
      ws2.addRow(['#', 'File', 'Inserted'])
      for (const a of auditRows) ws2.addRow([a.importId, a.files, a.insertedRows])
      // honor the builder's native-chart config (spec §53): demo the same
      // chart plan the desktop pack embeds as native Excel chart objects
      const charts = opts.charts ?? DEFAULT_CHARTS
      const ws3 = wb.addWorksheet('Chart Plan')
      ws3.addRow(['Chart', 'Sheet', 'Enabled', 'Metric'])
      ws3.addRow(['KPI Trend', 'KPI Trend', charts.kpiTrend.enabled ? 'yes' : 'no', charts.kpiTrend.metric])
      ws3.addRow(['Executive Summary', 'Executive Summary', charts.executive.enabled ? 'yes' : 'no', 'health'])
      ws3.addRow(['Region Analysis', 'Region Analysis', charts.region.enabled ? 'yes' : 'no', 'health'])
      ws3.addRow(['District Analysis', 'District Analysis', charts.district.enabled ? 'yes' : 'no', 'health'])
      ws3.addRow(['Site Analysis', 'Site Analysis', charts.site.enabled ? 'yes' : 'no', 'health'])
      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${id}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      files.xlsx = { path: `exports/${id}.xlsx`, content: 'Excel written to exports/' }
    } catch (e) {
      files.xlsx = { path: '', content: `Excel failed in demo: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  if (formats.includes('pptx')) {
    try {
      const PptxGenJS = (await import('pptxgenjs')).default
      const pptx = new PptxGenJS()
      pptx.layout = 'LAYOUT_16x9'
      const s1 = pptx.addSlide()
      s1.background = { color: '0E121A' }
      s1.addText(name, { x: 0.6, y: 1.5, w: 9, h: 1, fontSize: 32, bold: true, color: 'FFFFFF' })
      s1.addText('2G/3G/4G QoS Network Intelligence — Reporting Center', { x: 0.6, y: 2.7, w: 9, h: 0.5, fontSize: 14, color: '38BDF8' })
      s1.addText(`As of ${snap.asOf} · ruleset v${snap.rulesetVersion ?? '—'}`, { x: 0.6, y: 3.4, w: 9, h: 0.4, fontSize: 12, color: '8B95A7' })
      const s2 = pptx.addSlide()
      s2.background = { color: '0E121A' }
      s2.addText('Executive Summary', { x: 0.4, y: 0.3, w: 9, h: 0.5, fontSize: 20, bold: true, color: 'FFFFFF' })
      s2.addText(
        [`Network health score: ${snap.kpis.healthScore ?? '—'} / 100`, `NC cells: ${snap.ncCount}`].map((b) => ({ text: b })),
        { x: 0.6, y: 1.0, w: 8.8, h: 4, fontSize: 14, color: 'D7DDE8', breakLine: true }
      )
      const blob = (await pptx.write({ outputType: 'blob' })) as Blob
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${id}.pptx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      files.pptx = { path: `exports/${id}.pptx`, content: 'PowerPoint written to exports/' }
    } catch (e) {
      files.pptx = { path: '', content: `PowerPoint failed in demo: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  const row: ReportHistoryRow = { id, name, type, sections, formats, rulesetVersion: snap.rulesetVersion, createdAt: new Date().toISOString(), path: `exports/${id}.md` }
  demoHistory.unshift(row)
  if (demoHistory.length > 200) demoHistory.length = 200

  // a scheduled run marks the definition as generated (§56)
  if (def) def.lastGenerated = new Date().toISOString()

  return { id, name, type, sections, formats, files, rulesetVersion: snap.rulesetVersion, asOf: snap.asOf, snapshot: snap }
}

// --- M4 investigation demo -------------------------------------------------

const invState = new Map<string, { status: InvestigationStatus; events: InvestigationEvent[] }>()
let invNoteId = 0
const invKey = (scope: InvestigationScope, id: number): string => `${scope}:${id}`

function invMetricValue(w: InvestigationWeek | undefined, m: PerfMetric | 'nc'): number | null {
  if (!w) return null
  switch (m) {
    case 'prb': return w.prbAvg
    case 'throughput': return w.throughputKbps
    case 'users': return w.users
    case 'volume': return w.volumeMb
    case 'availability': return w.availability
    case 'nc': return w.isNc ? 1 : 0
  }
}

const INV_METRICS: Array<{ metric: PerfMetric | 'nc'; label: string; unit: string; worseIsHigher: boolean }> = [
  { metric: 'prb', label: 'PRB utilization', unit: '%', worseIsHigher: true },
  { metric: 'throughput', label: 'DL throughput', unit: 'kbps', worseIsHigher: false },
  { metric: 'users', label: 'Connected users', unit: '', worseIsHigher: false },
  { metric: 'volume', label: 'Data volume', unit: 'MB', worseIsHigher: false },
  { metric: 'availability', label: 'Availability', unit: '%', worseIsHigher: false },
  { metric: 'nc', label: 'NC cells', unit: '', worseIsHigher: true }
]

const invFmt = (v: number | null, unit: string): string => {
  if (v == null) return '—'
  if (unit === 'kbps') return `${(v / 1024).toFixed(1)} Mbps`
  if (unit === 'MB') return `${(v / 1024).toFixed(1)} GB`
  if (unit === 'pp') return `${v.toFixed(1)}pp`
  if (unit === '%') return `${v.toFixed(1)}%`
  return Math.round(v).toLocaleString()
}

function demoInvestigation(
  scope: InvestigationScope,
  entityId: number,
  opts: { interventionWeek?: string } = {}
): InvestigationResult | null {
  const cells = demoNcLifecycle().cells
  const nameId = (names: string[]): Map<string, number> => {
    const m = new Map<string, number>()
    ;[...new Set(names)].sort().forEach((n, i) => m.set(n, i + 1))
    return m
  }
  const siteId = nameId(cells.map((c) => c.site ?? c.cellName))
  const districtId = nameId(cells.map((c) => c.district ?? '—'))
  const regionId = nameId(cells.map((c) => c.region ?? '—'))
  const nameOf = (m: Map<string, number>, id: number): string => [...m.entries()].find(([, v]) => v === id)?.[0] ?? ''

  let group: (typeof cells)[number][]
  let entityName: string
  let path: string[]
  if (scope === 'cell') {
    const c = cells.find((x) => x.cellId === entityId)
    if (!c) return null
    group = [c]
    entityName = c.cellName
    path = [c.region, c.district, c.site, c.cellName].filter((v): v is string => !!v)
  } else if (scope === 'site') {
    const name = nameOf(siteId, entityId)
    if (!name) return null
    group = cells.filter((c) => (c.site ?? c.cellName) === name)
    entityName = name
    const d = group[0]?.district ?? ''
    const r = group[0]?.region ?? ''
    path = [r, d, name].filter((v): v is string => !!v)
  } else {
    let name = nameOf(districtId, entityId)
    if (!name) {
      // district id from the Ghana map demo space (regionId * 100 + i + 1):
      // build a plausible diagnosis so map click-through works in the demo
      const regionIdx = Math.floor(entityId / 100)
      const idx = (entityId % 100) - 1
      const row = regionIdx >= 1 && idx >= 0 ? demoRegionDistricts(regionIdx)[idx] : null
      if (!row) return null
      name = row.name
      const base: (typeof cells)[number] = {
        cellId: entityId + 500000,
        cellName: `${row.name} (district)`, // synthetic representative cell
        site: row.name,
        district: row.name,
        region: row.region ?? '',
        weekStart: '2026-07-27',
        isNc: row.ncCells > 0,
        lifecycle: row.ncCells > 2 ? 'Recurring NC' : row.ncCells > 0 ? 'New NC' : 'Healthy',
        trend: row.healthScore != null && row.healthScore < 60 ? 'Worsening' : 'Stable',
        severity: row.healthScore != null && row.healthScore < 60 ? 'High' : 'Normal',
        breachDays: 0,
        prbAvg: row.prbAvg
      }
      group = [base]
      entityName = row.name
      path = [row.region ?? '', row.name].filter((v): v is string => !!v)
    } else {
      group = cells.filter((c) => (c.district ?? '—') === name)
      entityName = name
      const r = group[0]?.region ?? ''
      path = [r, name].filter((v): v is string => !!v)
    }
  }

  const end = new Date(Date.UTC(2026, 6, 27))
  const cellWeeks = (c: (typeof cells)[number]): InvestigationWeek[] =>
    Array.from({ length: 12 }, (_, i) => {
      const d = new Date(end)
      d.setUTCDate(d.getUTCDate() - (11 - i) * 7)
      const weekStart = d.toISOString().slice(0, 10)
      const wobble = ((c.cellId + i * 7) % 11) - 5
      const isNc = c.isNc && i >= 12 - (c.lifecycle === 'Persistent NC' ? 4 : c.lifecycle === 'Recurring NC' ? 3 : c.lifecycle === 'New NC' ? 1 : 0)
      return {
        weekStart,
        prbAvg: Math.round(Math.min(100, Math.max(20, (c.prbAvg ?? 55) + wobble * 1.4)) * 10) / 10,
        throughputKbps: 14_000 + ((c.cellId * 37 + i * 211) % 12_000),
        users: 120 + ((c.cellId * 53 + i * 131) % 900),
        volumeMb: 8_000 + ((c.cellId * 97 + i * 317) % 60_000),
        availability: Math.round((99 + ((c.cellId * 7 + i) % 10) / 10) * 10) / 10,
        isNc,
        lifecycle: isNc ? c.lifecycle : i >= 11 && c.lifecycle === 'Recovering' ? 'Recovering' : 'Healthy'
      }
    })

  let weeks: InvestigationWeek[]
  if (scope === 'cell') {
    weeks = cellWeeks(group[0])
  } else {
    const byWeek = new Map<string, InvestigationWeek[]>()
    for (const c of group) {
      for (const w of cellWeeks(c)) {
        const list = byWeek.get(w.weekStart) ?? []
        list.push(w)
        byWeek.set(w.weekStart, list)
      }
    }
    weeks = [...byWeek.keys()].sort().map((weekStart) => {
      const ws = byWeek.get(weekStart)!
      const avg = (k: 'prbAvg' | 'throughputKbps' | 'availability'): number | null => {
        const vs = ws.map((w) => w[k]).filter((v): v is number => v != null)
        return vs.length === 0 ? null : vs.reduce((s, v) => s + v, 0) / vs.length
      }
      return {
        weekStart,
        prbAvg: avg('prbAvg'),
        throughputKbps: avg('throughputKbps'),
        users: ws.reduce((s, w) => s + (w.users ?? 0), 0),
        volumeMb: ws.reduce((s, w) => s + (w.volumeMb ?? 0), 0),
        availability: avg('availability'),
        isNc: ws.some((w) => w.isNc),
        lifecycle: null
      }
    })
  }

  const last = weeks[weeks.length - 1]
  const prev = weeks[weeks.length - 2]
  const base = scope === 'cell' ? group[0] : null
  const current: InvestigationResult['current'] =
    scope === 'cell' && base
      ? {
          weekStart: last?.weekStart ?? '',
          lifecycle: base.lifecycle,
          trend: base.trend,
          severity: base.severity,
          priorityScore: 40 + ((base.cellId * 13) % 55),
          priorityBand: 'Medium',
          prbAvg: base.prbAvg,
          isNc: base.isNc
        }
      : last
        ? { weekStart: last.weekStart, lifecycle: null, trend: null, severity: null, priorityScore: null, priorityBand: null, prbAvg: last.prbAvg, isNc: last.isNc }
        : null

  const evidence: EvidenceKpi[] = INV_METRICS.map((m) => {
    const cur = invMetricValue(last, m.metric)
    const pv = invMetricValue(prev, m.metric)
    let delta: number | null = null
    let deltaPct: number | null = null
    if (cur != null && pv != null) {
      delta = cur - pv
      if (pv !== 0) deltaPct = (delta / Math.abs(pv)) * 100
    }
    return {
      metric: m.metric,
      label: m.label,
      unit: m.unit,
      worseIsHigher: m.worseIsHigher,
      current: cur == null ? null : Math.round(cur * 100) / 100,
      previous: pv == null ? null : Math.round(pv * 100) / 100,
      delta: delta == null ? null : Math.round(delta * 100) / 100,
      deltaPct: deltaPct == null ? null : Math.round(deltaPct * 10) / 10
    }
  })
  const kpi = (m: PerfMetric | 'nc'): EvidenceKpi => evidence.find((e) => e.metric === m)!

  // deterministic findings + hypotheses mirroring the real engine's rules
  let ncStreak = 0
  for (let i = weeks.length - 1; i >= 0 && weeks[i].isNc; i--) ncStreak++
  const isNc = last?.isNc ?? false
  const prbK = kpi('prb')
  const thrK = kpi('throughput')
  const usrK = kpi('users')
  const volK = kpi('volume')
  const avK = kpi('availability')
  const threshold = 80
  const findings: DiagnosisFinding[] = []
  const f = (id: string, level: DiagnosisFinding['level'], phrase: DiagnosisFinding['phrase'], text: string): void => {
    findings.push({ id, level, phrase, text })
  }
  if (prbK.current != null && prbK.current >= threshold) {
    f('prb_high', 'evidence', 'consistent with', `PRB utilization of ${invFmt(prbK.current, '%')} is at or above the ${threshold}% ruleset threshold.`)
  }
  if (prbK.delta != null && prbK.delta >= 3) {
    f('prb_rising', 'suggestion', 'suggests', `PRB rose ${invFmt(prbK.delta, 'pp')} week-over-week — demand is building.`)
  }
  if (thrK.deltaPct != null && thrK.deltaPct <= -10) {
    f('thr_drop', 'suggestion', 'suggests', `DL throughput fell ${Math.abs(Math.round(thrK.deltaPct * 10) / 10)}% week-over-week — a user-experience impact is plausible.`)
  }
  if (usrK.deltaPct != null && usrK.deltaPct >= 10) {
    f('users_growth', 'evidence', 'consistent with', `Connected users grew ${Math.round(usrK.deltaPct * 10) / 10}% week-over-week.`)
  }
  if (volK.deltaPct != null && volK.deltaPct >= 10) {
    f('volume_growth', 'evidence', 'consistent with', `Data volume grew ${Math.round(volK.deltaPct * 10) / 10}% week-over-week.`)
  }
  if (avK.current != null && avK.current < 99.5) {
    f('avail_low', 'suggestion', 'suggests', `Availability of ${invFmt(avK.current, '%')} is below the 99.5% engineering expectation.`)
  }
  if (ncStreak >= 2) f('persistent', 'evidence', 'evidence supports', `${entityName} has been classified NC for ${ncStreak} consecutive weeks (${current?.lifecycle ?? 'NC'}).`)
  if (isNc && ncStreak === 1) f('entered_nc', 'evidence', 'evidence supports', `The entity entered NC status this week (${current?.lifecycle ?? 'NC'}).`)
  if (!isNc && weeks.some((w) => w.isNc)) {
    f('recovered', 'evidence', 'evidence supports', `Classified ${current?.lifecycle ?? 'Healthy'} after previous NC activity — the trajectory is improving.`)
  }
  f('conclusion', 'conclusion', 'evidence supports',
    isNc
      ? `Deterministic conclusion: active ${current?.lifecycle ?? 'NC'} concern with priority ${current?.priorityScore ?? '—'} (${current?.priorityBand ?? '—'}).`
      : `Deterministic conclusion: no active NC classification — recent history includes ${weeks.filter((w) => w.isNc).length} NC week(s); monitor for recurrence.`)

  const prbHigh = prbK.current != null && prbK.current >= threshold
  const thrDrop = thrK.deltaPct != null && thrK.deltaPct <= -10
  const usersUp = usrK.deltaPct != null && usrK.deltaPct >= 10
  const volUp = volK.deltaPct != null && volK.deltaPct >= 10
  const availLow = avK.current != null && avK.current < 99.5
  const persistent = ncStreak >= 2
  const entering = isNc && ncStreak === 1
  const H: Array<{ id: string; title: string; support: number; contra: number; sup: string[]; con: string[] }> = [
    { id: 'capacity', title: 'Capacity-driven congestion', support: 0, contra: 0, sup: [], con: [] },
    { id: 'interference', title: 'RF / interference degradation', support: 0, contra: 0, sup: [], con: [] },
    { id: 'backhaul', title: 'Backhaul / transport limitation', support: 0, contra: 0, sup: [], con: [] },
    { id: 'growth', title: 'Demand / growth pressure', support: 0, contra: 0, sup: [], con: [] },
    { id: 'transient', title: 'Transient / event-driven spike', support: 0, contra: 0, sup: [], con: [] }
  ]
  const push = (h: (typeof H)[number], side: 'sup' | 'con', w: number, text: string): void => {
    if (side === 'sup') { h.support += w; h.sup.push(text) } else { h.contra += w; h.con.push(text) }
  }
  const [cap, inter, back, growth, trans] = H
  if (prbHigh) push(cap, 'sup', 20, `PRB at/above the ${threshold}% threshold`)
  if (persistent) push(cap, 'sup', 15, `NC for ${ncStreak} consecutive weeks`)
  if (volUp) push(cap, 'sup', 10, `Data volume up ${Math.round(volK.deltaPct! * 10) / 10}% week-over-week`)
  if (usersUp) push(cap, 'sup', 10, `Users up ${Math.round(usrK.deltaPct! * 10) / 10}% week-over-week`)
  if (!prbHigh) push(cap, 'con', 15, `PRB below the ${threshold}% threshold`)
  if (!isNc) push(cap, 'con', 10, `Not currently classified NC`)
  if (availLow) push(inter, 'sup', 20, 'Availability below 99.5%')
  if (thrDrop) push(inter, 'sup', 15, 'Throughput falling week-over-week')
  if (!prbHigh && (prbK.delta ?? 0) >= 3) push(inter, 'sup', 10, 'PRB rising while below the threshold')
  if (prbHigh) push(inter, 'con', 10, 'PRB already above the threshold — suggests load rather than RF')
  if (thrDrop) push(back, 'sup', 20, `Throughput down ${Math.abs(Math.round(thrK.deltaPct! * 10) / 10)}% under load`)
  if (prbHigh) push(back, 'sup', 10, 'High PRB with constrained throughput')
  if (!availLow) push(back, 'sup', 10, 'Availability normal — not an RF outage pattern')
  if (availLow) push(back, 'con', 10, 'Availability low — points to RF rather than backhaul')
  if (!thrDrop) push(back, 'con', 15, 'Throughput stable')
  if (usersUp) push(growth, 'sup', 20, `Users up ${Math.round(usrK.deltaPct! * 10) / 10}% week-over-week`)
  if (volUp) push(growth, 'sup', 15, `Volume up ${Math.round(volK.deltaPct! * 10) / 10}% week-over-week`)
  if (prbHigh) push(growth, 'sup', 10, `PRB at/above the ${threshold}% threshold`)
  if (!usersUp) push(growth, 'con', 15, 'Users flat or falling')
  if (!volUp) push(growth, 'con', 10, 'Volume flat or falling')
  if (entering) push(trans, 'sup', 20, 'New NC classification this week')
  if (ncStreak === 1) push(trans, 'sup', 10, `Only ${ncStreak} NC week so far`)
  if (persistent) push(trans, 'con', 20, `NC for ${ncStreak} consecutive weeks`)
  if (!isNc) push(trans, 'con', 15, 'Not currently classified NC')
  const hypotheses: Hypothesis[] = H.map((h) => {
    const score = Math.max(5, Math.min(95, 40 + h.support - h.contra))
    return { id: h.id, title: h.title, score, verdict: score >= 65 ? 'consistent' : score >= 45 ? 'suggests' : 'not supported', supporting: h.sup, contradicting: h.con }
  })

  const key = invKey(scope, entityId)
  const stored = invState.get(key) ?? { status: { status: null, owner: null, externalTicket: null, targetReviewDate: null, updatedAt: null }, events: [] }
  // derived events: classification changes across weeks + a priority change
  const events: InvestigationEvent[] = [...stored.events]
  if (scope === 'cell') {
    let prevLife: string | null = null
    for (const w of weeks) {
      if (w.lifecycle && prevLife && w.lifecycle !== prevLife) {
        events.push({ id: -events.length - 1, occurredAt: w.weekStart, kind: 'classification_change', note: `Lifecycle ${prevLife} → ${w.lifecycle}`, author: 'engine' })
      }
      if (w.lifecycle) prevLife = w.lifecycle
    }
    if (base) {
      events.push({ id: -events.length - 1, occurredAt: last?.weekStart ?? '', kind: 'priority_change', note: `Priority ${30 + ((base.cellId * 13) % 40)} → ${current?.priorityScore ?? 0}`, author: 'engine' })
    }
  }
  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id - a.id)

  let interventionWeek = opts.interventionWeek ?? null
  if (!interventionWeek && weeks.length > 1) interventionWeek = weeks[Math.floor(weeks.length / 2)].weekStart
  const beforeW = weeks.filter((w) => interventionWeek == null || w.weekStart < interventionWeek).slice(-8)
  const afterW = weeks.filter((w) => interventionWeek == null || w.weekStart >= interventionWeek).slice(0, 8)
  const avgOf = (list: InvestigationWeek[], m: PerfMetric | 'nc'): number | null => {
    const vs = list.map((w) => invMetricValue(w, m)).filter((v): v is number => v != null)
    if (vs.length === 0) return null
    if (m === 'users' || m === 'volume') return vs.reduce((s, v) => s + v, 0)
    return vs.reduce((s, v) => s + v, 0) / vs.length
  }
  const beforeAfter: BeforeAfterMetric[] = INV_METRICS.map((m) => {
    const b = avgOf(beforeW, m.metric)
    const a = avgOf(afterW, m.metric)
    const deltaPct = b == null || a == null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100
    const improved = b == null || a == null ? null : m.worseIsHigher ? a < b : a > b
    return { metric: m.metric, label: m.label, unit: m.unit, before: b == null ? null : Math.round(b * 100) / 100, after: a == null ? null : Math.round(a * 100) / 100, deltaPct: deltaPct == null ? null : Math.round(deltaPct * 10) / 10, improved }
  })

  // peers: same-scope siblings, worst health first
  const healthOf = (c: (typeof cells)[number]): number => 50 + ((c.cellId * 37) % 50)
  const peerGroup =
    scope === 'cell'
      ? cells.filter((c) => c.site === base?.site)
      : scope === 'site'
        ? cells.filter((c) => c.district === group[0]?.district)
        : cells.filter((c) => c.region === group[0]?.region)
  const byPeer = new Map<string, (typeof cells)[number][]>()
  for (const c of peerGroup) {
    const k = scope === 'cell' ? c.cellName : scope === 'site' ? c.site ?? c.cellName : c.district ?? '—'
    const list = byPeer.get(k) ?? []
    list.push(c)
    byPeer.set(k, list)
  }
  const peers: InvestigationPeer[] = [...byPeer.entries()]
    .map(([name, cs]) => ({
      name,
      prbAvg: Math.round((cs.reduce((s, c) => s + (c.prbAvg ?? 0), 0) / cs.length) * 10) / 10,
      throughputKbps: 14_000 + ((cs[0].cellId * 37) % 12_000),
      healthScore: Math.round(cs.reduce((s, c) => s + healthOf(c), 0) / cs.length),
      ncCells: cs.filter((c) => c.isNc).length
    }))
    .sort((a, b) => (a.healthScore ?? 101) - (b.healthScore ?? 101))
    .slice(0, 10)

  return {
    scope,
    entityId,
    entityName,
    path,
    current,
    evidence,
    findings,
    hypotheses,
    events: events.slice(0, 40),
    status: stored.status,
    beforeAfter,
    interventionWeek,
    weeks,
    peers
  }
}

function demoSearch(scope: InvestigationScope, q = ''): EntityOption[] {
  const cells = demoNcLifecycle().cells
  const query = q.trim().toLowerCase()
  const nameId = (names: string[]): Map<string, number> => {
    const m = new Map<string, number>()
    ;[...new Set(names)].sort().forEach((n, i) => m.set(n, i + 1))
    return m
  }
  const siteId = nameId(cells.map((c) => c.site ?? c.cellName))
  const districtId = nameId(cells.map((c) => c.district ?? '—'))
  const regionId = nameId(cells.map((c) => c.region ?? '—'))
  const opts: EntityOption[] = []
  const match = (s: string): boolean => !query || s.toLowerCase().includes(query)
  if (scope === 'cell') {
    for (const c of cells) {
      if (match(c.cellName) || match(c.site ?? '') || match(c.district ?? '') || match(c.region ?? '')) {
        opts.push({ id: c.cellId, name: c.cellName, path: [c.region, c.district, c.site, c.cellName].filter((v): v is string => !!v) })
      }
    }
  } else if (scope === 'site') {
    for (const [name, id] of siteId) {
      const cs = cells.filter((c) => (c.site ?? c.cellName) === name)
      if (cs.length > 0 && (match(name) || match(cs[0].district ?? '') || match(cs[0].region ?? ''))) {
        opts.push({ id, name, path: [cs[0].region, cs[0].district, name].filter((v): v is string => !!v) })
      }
    }
  } else {
    for (const [name, id] of districtId) {
      const cs = cells.filter((c) => (c.district ?? '—') === name)
      if (cs.length > 0 && (match(name) || match(cs[0].region ?? ''))) {
        opts.push({ id, name, path: [cs[0].region, name].filter((v): v is string => !!v) })
      }
    }
  }
  return opts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 50)
}

function demoReportMarkdown(res: InvestigationResult): string {
  const L: string[] = []
  L.push(`# Investigation report — ${res.entityName}`)
  L.push('')
  L.push(`- Scope: ${res.scope}`)
  L.push(`- Hierarchy: ${res.path.join(' › ')}`)
  L.push(`- Generated: ${new Date().toISOString()}`)
  L.push(`- Action status: ${res.status.status ?? 'Unreviewed'}${res.status.owner ? ` · owner: ${res.status.owner}` : ''}${res.status.externalTicket ? ` · ticket: ${res.status.externalTicket}` : ''}`)
  if (res.current) {
    L.push('')
    L.push('## Classification')
    L.push(`- Lifecycle: ${res.current.lifecycle ?? '—'} · Trend: ${res.current.trend ?? '—'} · Severity: ${res.current.severity ?? '—'} · NC: ${res.current.isNc ? 'yes' : 'no'}`)
    L.push(`- Priority: ${res.current.priorityScore ?? '—'} (${res.current.priorityBand ?? '—'})`)
  }
  L.push('', '## KPI evidence (latest week vs previous)', '', '| Metric | Current | Previous | Δ | Δ% |', '|---|---|---|---|---|')
  for (const e of res.evidence) {
    L.push(`| ${e.label} | ${invFmt(e.current, e.unit)} | ${invFmt(e.previous, e.unit)} | ${e.delta == null ? '—' : (e.delta >= 0 ? '+' : '') + invFmt(e.delta, e.unit)} | ${e.deltaPct == null ? '—' : (e.deltaPct >= 0 ? '+' : '') + e.deltaPct.toFixed(1) + '%'} |`)
  }
  L.push('', '## Findings (calibrated language)', '')
  for (const f of res.findings) L.push(`- *[${f.level}] ${f.phrase}* — ${f.text}`)
  L.push('', '## Alternative hypotheses (descriptive, not causal)', '')
  for (const h of res.hypotheses) {
    L.push(`### ${h.title} — ${h.verdict} (support ${h.score}/100)`)
    for (const s of h.supporting) L.push(`- For: ${s}`)
    for (const c of h.contradicting) L.push(`- Against: ${c}`)
  }
  L.push('', '## Before / after', '')
  L.push(`Intervention window at week: ${res.interventionWeek ?? '—'}`, '', '| Metric | Before | After | Δ% | Improved |', '|---|---|---|---|---|')
  for (const b of res.beforeAfter) {
    L.push(`| ${b.label} | ${invFmt(b.before, b.unit)} | ${invFmt(b.after, b.unit)} | ${b.deltaPct == null ? '—' : (b.deltaPct >= 0 ? '+' : '') + b.deltaPct.toFixed(1) + '%'} | ${b.improved == null ? '—' : b.improved ? 'yes' : 'no'} |`)
  }
  L.push('', '## Events', '')
  for (const ev of res.events.slice(0, 25)) L.push(`- ${ev.occurredAt} — ${ev.kind}: ${ev.note ?? ''} (${ev.author ?? '—'})`)
  L.push('', '---', '*Generated by 2G/3G/4G QoS Network Intelligence. Hypotheses are descriptive, not causal (spec §48).*')
  return L.join('\n')
}

function demoHealthMatrix(
  scope: HealthScope,
  opts: { weeks?: number; limit?: number; sort?: 'worst' | 'name' } = {}
): HealthMatrixResult {
  const weeksN = Math.min(26, Math.max(2, opts.weeks ?? 12))
  const limit = Math.min(200, Math.max(1, opts.limit ?? 60))
  const weeks = Array.from({ length: weeksN }, (_, i) => {
    const d = new Date(Date.UTC(2026, 4, 4 + i * 7)) // Mondays from 2026-05-04
    return d.toISOString().slice(0, 10)
  })
  const cells = demoNcLifecycle().cells
  const keyOf: Record<HealthScope, (c: (typeof cells)[number]) => string> = {
    cell: (c) => c.cellName,
    site: (c) => c.site ?? '—',
    district: (c) => c.district ?? '—',
    region: (c) => c.region ?? '—'
  }
  const groups = new Map<string, { name: string; base: number }[]>()
  for (const c of cells) {
    const key = keyOf[scope](c)
    const base = c.isNc ? (c.severity === 'Critical' ? 41 : c.severity === 'High' ? 53 : 62) : 74 + ((c.cellId * 7) % 25)
    const list = groups.get(key) ?? []
    list.push({ name: key, base })
    groups.set(key, list)
  }
  let rows = [...groups.values()].map((g, gi) => ({
    id: gi,
    name: g[0].name,
    base: Math.round(g.reduce((a, b) => a + b.base, 0) / g.length),
    count: g.length
  }))
  const latest = rows.map((r) => r.base + (((weeksN - 1) * 3 + r.id) % 7) - 3)
  if (opts.sort !== 'name') rows.sort((a, b) => latest[rows.indexOf(a)] - latest[rows.indexOf(b)])
  else rows.sort((a, b) => a.name.localeCompare(b.name))
  rows = rows.slice(0, limit)
  return {
    scope,
    weeks,
    rows: rows.map((r, i) => ({
      id: r.id,
      name: r.name,
      scores: weeks.map((_, w) =>
        Math.round(Math.min(100, Math.max(30, r.base + ((w * 3 + i) % 7) - 3)) * 10) / 10
      )
    }))
  }
}

function demoHealth(): HealthResult {
  const weeks = ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']
  const scores = [74.1, 73.5, 71.9, 72.8, 71.2, 70.4, 69.8, 72.5]
  const network = weeks.map((asOf, i) => {
    const s = scores[i]
    return {
      asOf,
      score: s,
      capacity: Math.round((s - 8 + (i % 3)) * 10) / 10,
      throughput: Math.round((s + 5 - (i % 4)) * 10) / 10,
      availability: 99.6,
      ncRecurrence: Math.round((100 - 4.6 * 3 - (i % 2)) * 10) / 10,
      growth: Math.round((s - 15 + (i % 5)) * 10) / 10
    }
  })
  const cells: HealthResult['cells'] = demoNcLifecycle().cells
    .map((c, i) => ({
      cellId: c.cellId,
      cellName: c.cellName,
      site: c.site,
      district: c.district,
      region: c.region,
      weekStart: '2026-07-27',
      healthScore: c.isNc ? (c.severity === 'Critical' ? 41 : c.severity === 'High' ? 53 : 62) : 74 + ((i * 7) % 25)
    }))
    .sort((a, b) => a.healthScore - b.healthScore)
    .slice(0, 60)
  return { network, cells }
}

let demoRules: Rules = {
  version: 12,
  createdAt: '2026-07-01T08:00:00.000Z',
  prbThresholdPct: 80,
  weeklyBreachDays: 1,
  persistentWeeks: 3,
  districtNcThresholdPct: 10,
  priorityWeights: [25, 20, 15, 15, 15, 10],
  notes: 'Demo ruleset — edits bump the version like the real engine'
}

// --- the stub ---------------------------------------------------------------

export const previewApi: Api & { demo: true } = {
  demo: true,
  files: {
    /** Registers the browser File so the pseudo-path can be resolved later. */
    path: (file) => {
      const key = `demo://${file.name}`
      fileRegistry.set(key, file)
      return key
    }
  },
  workspace: {
    listRecent: async () => [
      {
        path: 'C:\\Demo\\workspaces\\Preview_Network.qosdb',
        name: 'Preview Network',
        lastOpened: new Date().toISOString()
      }
    ],
    pickOpen: async () => 'C:\\Demo\\workspaces\\' + demoWorkspaceName + '.qosdb',
    pickDirectory: async () => 'C:\\Demo\\workspaces',
    create: async (_dir: string, name: string, technology?: string) => {
      if (name.trim()) demoWorkspaceName = name.trim()
      demoTech = technology === '2G' || technology === '3G' ? technology : '4G'
      demoFacts.length = 0
      factKeys.clear()
      cellsSeen.clear()
      demoKpiValues.clear()
      return demoWorkspaceInfo()
    },
    open: async () => {
      throw new Error('Opening workspaces is not available in browser preview mode')
    },
    isLocked: async (): Promise<{ locked: boolean; pid?: number }> => ({ locked: false }),
    close: async () => {},
    info: async () => demoWorkspaceInfo(),
    setTechnology: async (technology: Technology): Promise<WorkspaceInfo> => {
      demoTech = technology === '2G' || technology === '3G' ? technology : '4G'
      demoKpiValues.clear()
      return demoWorkspaceInfo()
    },
    onChanged: () => () => {},
    snapshots: async (): Promise<WorkspaceSnapshot[]> => demoSnapshots,
    createSnapshot: async (name: string, opts?: CreateSnapshotOpts): Promise<WorkspaceSnapshot> => {
      const s: WorkspaceSnapshot = {
        snapshotId: ++demoSnapSeq,
        name,
        reason: opts?.reason ?? null,
        notes: opts?.notes ?? null,
        createdAt: new Date().toISOString(),
        sizeBytes: 48_000_000 + demoFacts.length * 200,
        path: `C:\\Demo\\backups\\snapshots\\${name.replace(/[^A-Za-z0-9_-]+/g, '_')}-${Date.now()}.qosdb`
      }
      demoSnapshots.unshift(s)
      return s
    },
    restoreSnapshot: async (): Promise<WorkspaceInfo> => demoWorkspaceInfo(),
    removeSnapshot: async (id: number): Promise<void> => {
      const i = demoSnapshots.findIndex((s) => s.snapshotId === id)
      if (i >= 0) demoSnapshots.splice(i, 1)
    },
    compareSnapshots: async (aId: number, bId: number): Promise<SnapshotComparison> => {
      const pick = (id: number): WorkspaceSnapshot | undefined => demoSnapshots.find((s) => s.snapshotId === id)
      const a = pick(aId)
      const b = pick(bId)
      const aName = a?.name ?? 'Baseline'
      const bName = b?.name ?? 'Current'
      const base: Record<string, number> = {
        rows: BASELINE.rowCount, cells: BASELINE.cells, avg_prb: 61.4,
        avg_availability: 99.6, avg_throughput_kbps: 21_200, total_users: 1_258_000,
        total_volume_mb: 4_125_000, nc_cells: 132, health_score: 73, ruleset_version: 12
      }
      const drift = aId > bId ? -1 : 1 // snapshot A is the older baseline
      const kpis: SnapshotComparisonKpi[] = [
        { key: 'rows', label: 'Observed rows', unit: '', a: base.rows, b: base.rows + 240 * drift, delta: 240 * drift, deltaPct: drift * 0.17, worseIsHigher: false },
        { key: 'cells', label: 'Cells', unit: '', a: base.cells, b: base.cells + 4 * drift, delta: 4 * drift, deltaPct: drift * 0.14, worseIsHigher: false },
        { key: 'avg_prb', label: 'Avg PRB utilization', unit: '%', a: base.avg_prb, b: base.avg_prb - 2.1 * drift, delta: -2.1 * drift, deltaPct: drift * 3.4, worseIsHigher: true },
        { key: 'avg_availability', label: 'Availability', unit: '%', a: base.avg_availability, b: base.avg_availability + 0.1 * drift, delta: 0.1 * drift, deltaPct: drift * 0.1, worseIsHigher: false },
        { key: 'avg_throughput_kbps', label: 'DL throughput', unit: 'kbps', a: base.avg_throughput_kbps, b: base.avg_throughput_kbps + 400 * drift, delta: 400 * drift, deltaPct: drift * 1.9, worseIsHigher: false },
        { key: 'total_users', label: 'Connected users', unit: '', a: base.total_users, b: base.total_users + 9_000 * drift, delta: 9_000 * drift, deltaPct: drift * 0.7, worseIsHigher: false },
        { key: 'total_volume_mb', label: 'Data volume', unit: 'MB', a: base.total_volume_mb, b: base.total_volume_mb + 31_000 * drift, delta: 31_000 * drift, deltaPct: drift * 0.75, worseIsHigher: false },
        { key: 'nc_cells', label: 'Weekly NC cells', unit: '', a: base.nc_cells, b: base.nc_cells - 6 * drift, delta: -6 * drift, deltaPct: drift * 4.5, worseIsHigher: true },
        { key: 'health_score', label: 'Avg cell health score', unit: '', a: base.health_score, b: base.health_score + 2 * drift, delta: 2 * drift, deltaPct: drift * 2.7, worseIsHigher: false },
        { key: 'ruleset_version', label: 'Ruleset version', unit: '', a: base.ruleset_version, b: base.ruleset_version + 1 * drift, delta: 1 * drift, deltaPct: null, worseIsHigher: false }
      ]
      return {
        a: { snapshotId: aId, name: aName, createdAt: a?.createdAt ?? new Date().toISOString() },
        b: { snapshotId: bId, name: bName, createdAt: b?.createdAt ?? new Date().toISOString() },
        kpis
      }
    }
  },
  maintenance: {
    run: (action: MaintenanceAction) => demoMaintenanceRun(action),
    getSchedule: async (): Promise<MaintenanceScheduleSettings> => {
      const nextRunAt = schedState.enabled
        ? new Date((schedState.lastRunAt ? new Date(schedState.lastRunAt).getTime() : Date.now()) + schedState.cadenceHours * 3_600_000).toISOString()
        : null
      return { ...schedState, nextRunAt }
    },
    setSchedule: async (patch): Promise<MaintenanceScheduleSettings> => {
      schedState = { ...schedState, ...patch }
      const nextRunAt = schedState.enabled
        ? new Date((schedState.lastRunAt ? new Date(schedState.lastRunAt).getTime() : Date.now()) + schedState.cadenceHours * 3_600_000).toISOString()
        : null
      return { ...schedState, nextRunAt }
    },
    runScheduled: async (): Promise<ScheduledRunResult> => {
      if (!schedState.enabled) {
        return { ok: false, ran: false, results: [], summary: 'Skipped — the scheduler is disabled', skippedReason: 'disabled' }
      }
      const t0 = performance.now()
      const results: MaintenanceResult[] = []
      for (const a of schedState.actions) {
        results.push(await demoMaintenanceRun(a))
      }
      const ok = results.every((r) => r.ok)
      const summary = ok
        ? `Scheduled maintenance passed: ${results.length} action(s) — ${results.map((r) => `${r.action} ${(r.durationMs / 1000).toFixed(1)}s`).join(', ')}.`
        : 'Scheduled maintenance had failures.'
      const nowIso = new Date().toISOString()
      schedState = { ...schedState, lastRunAt: nowIso, lastOk: ok, lastSummary: summary }
      schedHistoryState = [
        {
          runId: schedHistoryState.length + 1,
          ranAt: nowIso,
          ok,
          actions: [...schedState.actions],
          summary,
          durationMs: Math.round(performance.now() - t0)
        },
        ...schedHistoryState
      ].slice(0, 10)
      return { ok, ran: true, results, summary }
    },
    scheduleHistory: async (limit?: number): Promise<ScheduledMaintenanceRun[]> =>
      schedHistoryState.slice(0, limit ?? 10)
  },
  analytics: {
    summary: async (opts?: { period?: string; grain?: string }) => {
      const { min, max } = factDateRange()
      return {
        rowCount: BASELINE.rowCount + demoFacts.length,
        minDate: min < BASELINE.minDate ? min : BASELINE.minDate,
        maxDate: max > BASELINE.maxDate ? max : BASELINE.maxDate,
        cells: BASELINE.cells + cellsSeen.size,
        sites: 570,
        districts: 45,
        regions: 16,
        rulesetVersion: 12,
        weeklyNcCells: 132,
        weeklyTotalRows: BASELINE.cells + cellsSeen.size,
        avgPrb: 61.4,
        totalVolumeMb: 4_125_000,
        totalUsers: 1_258_000,
        avgThroughputKbps: 21_200,
        avgAvailability: 99.6,
        grain: (opts?.grain as 'daily' | 'weekly' | 'monthly') ?? 'weekly',
        periodStart: null,
        periodEnd: null
      }
    },
    ncLifecycle: async (): Promise<NcLifecycleResult> => demoNcLifecycle(),
    ncMovement: async (limit = 8): Promise<NcMovementRow[]> => demoNcMovement(limit),
    healthMatrix: async (
      scope: HealthScope,
      opts?: { weeks?: number; limit?: number; sort?: 'worst' | 'name' }
    ): Promise<HealthMatrixResult> => demoHealthMatrix(scope, opts),
    cellIntelligence: async (opts?: {
      search?: string
      lifecycle?: Lifecycle | ''
      trend?: Trend | ''
      severity?: Severity | ''
      minPriority?: number
      limit?: number
      offset?: number
    }): Promise<CellIntelligenceResult> => demoCellIntelligence(opts),
    cellDetail: async (cellId: number): Promise<CellDetail | null> => demoCellDetail(cellId),
    performance: async (): Promise<PerformanceResult> => demoPerformance(),
    comparison: async (opts?: {
      type?: ComparisonType
      scope?: CompareScope
      metric?: CompareMetric
    }): Promise<ComparisonResult> => demoComparison(opts ?? {}),
    explorer: async (
      level: ExplorerLevel,
      parentId?: number | null,
      opts?: { q?: string }
    ): Promise<ExplorerResult> => demoExplorer(level, parentId ?? null, opts),
    regionMap: async (): Promise<RegionMapRow[]> => demoRegionMap(),
    regionDistricts: async (regionId: number): Promise<DistrictMapRow[]> => demoRegionDistricts(regionId),
    priorityCenter: async (opts?: PriorityCenterOpts): Promise<PriorityCenterResult> =>
      demoPriorityCenter(opts),
    forecast: async (opts?: ForecastOpts): Promise<ForecastResult> => demoForecast(opts),
    priorityQueue: async (mode: PriorityMode, limit = 10): Promise<PriorityRow[]> =>
      demoPriority(mode).slice(0, limit),
    health: async (_grain?: string): Promise<HealthResult> => demoHealth(),
    kpiOverview: async (limit = 8): Promise<KpiOverviewResult> => {
      const tech = demoTech
      const cells = demoNcLifecycle().cells
      const byKey = new Map<
        string,
        {
          key: string; label: string; unit: string; target: number | null; worseIsHigher: boolean
          breached: number; observed: number; sevSum: number
        }
      >()
      const cellAgg = new Map<number, { score: number; breached: number }>()
      for (const c of cells) {
        let cellScore = 0
        let cellBreached = 0
        for (const v of demoCellKpis(c.cellId, c.weekStart)) {
          const agg = byKey.get(v.key) ?? {
            key: v.key, label: v.label, unit: v.unit, target: v.target,
            worseIsHigher: v.worseIsHigher, breached: 0, observed: 0, sevSum: 0
          }
          agg.observed++
          if (v.value != null && v.target != null && v.target !== 0) {
            const sev = v.worseIsHigher
              ? ((v.value - v.target) / v.target) * 100
              : ((v.target - v.value) / v.target) * 100
            if (sev > 0) {
              agg.breached++
              agg.sevSum += Math.min(100, sev)
              cellScore += Math.min(100, sev)
              cellBreached++
            }
          }
          byKey.set(v.key, agg)
        }
        if (cellBreached > 0) cellAgg.set(c.cellId, { score: cellScore / cellBreached, breached: cellBreached })
      }
      // weekly value history (last 8 weeks) for the trend sparklines — a
      // deterministic wobble around the current value; breach weeks flagged
      const demoWeekStarts = (): string[] => {
        const out: string[] = []
        const d = new Date(Date.UTC(2026, 6, 27))
        for (let i = 7; i >= 0; i--) {
          const w = new Date(d)
          w.setUTCDate(w.getUTCDate() - i * 7)
          out.push(w.toISOString().slice(0, 10))
        }
        return out
      }
      const demoTrend = (key: string, label: string, unit: string, target: number | null, worseIsHigher: boolean): KpiTrendPoint[] => {
        const weeks = demoWeekStarts()
        const base = demoCellKpis(1, weeks[weeks.length - 1]).find((v) => v.key === key)?.value ?? 50
        return weeks.map((w, i) => {
          const value = Math.round(Math.max(0, base + ((key.length + i * 7) % 11 - 5) * (worseIsHigher ? 4 : 0.4)) * 10) / 10
          const breached = target != null && (worseIsHigher ? value > target : value < target)
          return { weekStart: w, value, breached }
        })
      }
      const kpis: KpiOverviewKpi[] = [...byKey.values()]
        .filter((k) => k.breached > 0)
        .map((k) => ({
          key: k.key,
          label: k.label,
          unit: k.unit,
          target: k.target,
          worseIsHigher: k.worseIsHigher,
          breachedCells: k.breached,
          observedCells: k.observed,
          avgSeverity: k.breached > 0 ? Math.round((k.sevSum / k.breached) * 10) / 10 : null,
          trend: demoTrend(k.key, k.label, k.unit, k.target, k.worseIsHigher)
        }))
        .sort((a, b) => (b.avgSeverity ?? 0) - (a.avgSeverity ?? 0))
        .slice(0, limit)
      const worstCells: KpiOverviewCell[] = [...cellAgg.entries()]
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, limit)
        .map(([cellId, a]) => {
          const base = cells.find((c) => c.cellId === cellId)
          return {
            cellId,
            cellName: base?.cellName ?? `Cell ${cellId}`,
            site: base?.site ?? null,
            district: base?.district ?? null,
            breachScore: Math.round(a.score * 10) / 10,
            breachedKpis: a.breached
          }
        })
      return { technology: tech, weekStart: cells[0]?.weekStart ?? null, kpis, worstCells }
    }
  },
  investigation: {
    search: async (scope: InvestigationScope, q?: string): Promise<EntityOption[]> => demoSearch(scope, q),
    get: async (
      scope: InvestigationScope,
      entityId: number,
      opts?: { interventionWeek?: string }
    ): Promise<InvestigationResult | null> => demoInvestigation(scope, entityId, opts),
    setStatus: async (
      scope: InvestigationScope,
      entityId: number,
      patch: {
        status?: ActionStatus | null
        owner?: string | null
        externalTicket?: string | null
        targetReviewDate?: string | null
      }
    ): Promise<InvestigationStatus> => {
      const key = invKey(scope, entityId)
      const prev = invState.get(key)?.status ?? { status: null, owner: null, externalTicket: null, targetReviewDate: null, updatedAt: null }
      const next: InvestigationStatus = {
        status: patch.status !== undefined ? patch.status : prev.status,
        owner: patch.owner !== undefined ? patch.owner : prev.owner,
        externalTicket: patch.externalTicket !== undefined ? patch.externalTicket : prev.externalTicket,
        targetReviewDate: patch.targetReviewDate !== undefined ? patch.targetReviewDate : prev.targetReviewDate,
        updatedAt: new Date().toISOString()
      }
      const stored = invState.get(key) ?? { status: prev, events: [] }
      const parts: string[] = []
      if (patch.status !== undefined && patch.status !== prev.status) parts.push(`status: ${prev.status ?? 'Unreviewed'} → ${patch.status}`)
      if (patch.owner !== undefined && patch.owner !== prev.owner) parts.push(`owner: ${patch.owner ?? '—'}`)
      stored.events.push({
        id: --invNoteId,
        occurredAt: new Date().toISOString(),
        kind: 'status_change',
        note: parts.join('; ') || 'status details updated',
        author: 'user'
      })
      stored.status = next
      invState.set(key, stored)
      return next
    },
    addNote: async (scope: InvestigationScope, entityId: number, note: string): Promise<InvestigationEvent> => {
      const key = invKey(scope, entityId)
      const stored = invState.get(key) ?? { status: { status: null, owner: null, externalTicket: null, targetReviewDate: null, updatedAt: null }, events: [] }
      const ev: InvestigationEvent = { id: --invNoteId, occurredAt: new Date().toISOString(), kind: 'user_note', note, author: 'user' }
      stored.events.push(ev)
      invState.set(key, stored)
      return ev
    },
    exportReport: async (scope: InvestigationScope, entityId: number): Promise<InvestigationReport | null> => {
      const res = demoInvestigation(scope, entityId)
      if (!res) return null
      const markdown = demoReportMarkdown(res)
      const blob = new Blob([markdown], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${scope}-${res.entityName.replace(/[^A-Za-z0-9_-]+/g, '_')}-report.md`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      return { path: `exports/${a.download}`, markdown }
    }
  },
  rules: {
    get: async (): Promise<Rules | null> => demoRules,
    update: async (patch: RulesPatch): Promise<Rules> => {
      demoRules = {
        ...demoRules,
        ...patch,
        priorityWeights: patch.priorityWeights ?? demoRules.priorityWeights,
        version: demoRules.version + 1,
        createdAt: new Date().toISOString()
      }
      return demoRules
    }
  },
  kpis: {
    list: async (technology?: Technology): Promise<KpiDefinition[]> =>
      technology ? demoKpisFor(technology) : [...demoKpiDefs],
    save: async (patch: KpiDefPatch): Promise<KpiDefinition> => {
      const tech = patch.technology ?? demoTech
      const existing = patch.kpiId != null
        ? demoKpiDefs.find((d) => d.kpiId === patch.kpiId)
        : demoKpiDefs.find((d) => d.technology === tech && d.key === patch.key)
      const now = new Date().toISOString()
      if (existing) {
        const merged: KpiDefinition = {
          ...existing,
          ...patch,
          technology: tech,
          updatedAt: now
        }
        demoKpiDefs = demoKpiDefs.map((d) => (d.kpiId === existing.kpiId ? merged : d))
        return merged
      }
      const def: KpiDefinition = {
        kpiId: ++demoKpiSeq,
        technology: tech,
        key: patch.key ?? '',
        label: patch.label ?? '',
        unit: patch.unit ?? '',
        worseIsHigher: patch.worseIsHigher ?? true,
        target: patch.target ?? null,
        agg: patch.agg ?? 'avg',
        sourceHeaders: patch.sourceHeaders ?? [],
        isCustom: true,
        active: patch.active ?? true,
        sortOrder: demoKpisFor(tech).length,
        createdAt: now,
        updatedAt: now
      }
      demoKpiDefs.push(def)
      return def
    },
    remove: async (kpiId: number): Promise<void> => {
      const target = demoKpiDefs.find((d) => d.kpiId === kpiId)
      demoKpiDefs = demoKpiDefs.filter((d) => d.kpiId !== kpiId)
      if (target) {
        for (const key of [...demoKpiValues.keys()]) {
          if (key.endsWith('|' + target.key)) demoKpiValues.delete(key)
        }
      }
    },
    discover: async (headers: string[], technology?: Technology): Promise<KpiDiscovery> => {
      return demoKpiDiscover(headers, technology ?? demoTech)
    },
    seed: async (technology?: Technology): Promise<KpiDefinition[]> => {
      const tech = technology ?? demoTech
      const seeds = DEMO_KPI_SEEDS.filter((s) => s.technology === tech)
      const now = new Date().toISOString()
      demoKpiDefs = demoKpiDefs.filter((d) => d.technology !== tech || d.isCustom)
      seeds.forEach((s, i) => {
        demoKpiDefs.push({
          kpiId: ++demoKpiSeq,
          technology: tech,
          key: s.key,
          label: s.label,
          unit: s.unit,
          worseIsHigher: s.worseIsHigher,
          target: s.target,
          agg: s.agg,
          sourceHeaders: s.aliases,
          isCustom: false,
          active: true,
          sortOrder: i,
          createdAt: now,
          updatedAt: now
        })
      })
      return demoKpisFor(tech)
    }
  },
  reports: {
    generate: async (opts?: ReportOpts): Promise<ReportPack> => demoReportPack(opts),
    definitions: async (): Promise<ReportDefinition[]> => [...demoDefs],
    saveDefinition: async (
      name: string,
      type: ReportType,
      sections: ReportSectionId[],
      schedule?: string | null,
      charts?: ReportChartConfig
    ): Promise<ReportDefinition> => {
      const d: ReportDefinition = { id: ++demoDefSeq, name, type, sections: [...sections], schedule: schedule ?? null, charts: charts ? { ...charts } : { ...DEFAULT_CHARTS }, lastGenerated: null, createdAt: new Date().toISOString() }
      demoDefs.unshift(d)
      return d
    },
    due: async (): Promise<DueReport[]> => demoDueReports(),
    history: async (): Promise<ReportHistoryRow[]> => [...demoHistory],
    reveal: async (path: string): Promise<void> => {
      // browser demo: nothing to reveal on disk
      void path
    }
  },
  appState: {
    get: async () => ({
      recentWorkspaces: [
        {
          path: 'C:\\Demo\\workspaces\\Preview_Network.qosdb',
          name: 'Preview Network',
          lastOpened: new Date().toISOString()
        }
      ],
      lastTechnology: demoAppState.lastTechnology,
      lastWorkspaceDir: demoAppState.lastWorkspaceDir,
      technologyByDir: demoAppState.technologyByDir,
      createdWorkspaces: demoAppState.createdWorkspaces,
      theme: 'dark' as const,
      density: 'compact' as const
    }),
    set: async (p) => {
      if (p.lastTechnology) demoAppState.lastTechnology = p.lastTechnology
      if (p.lastWorkspaceDir) demoAppState.lastWorkspaceDir = p.lastWorkspaceDir
      if (p.technologyByDir) demoAppState.technologyByDir = { ...(demoAppState.technologyByDir ?? {}), ...p.technologyByDir }
      if (p.createdWorkspaces) demoAppState.createdWorkspaces = p.createdWorkspaces
      return {
        recentWorkspaces: [],
        lastTechnology: demoAppState.lastTechnology,
        lastWorkspaceDir: demoAppState.lastWorkspaceDir,
        technologyByDir: demoAppState.technologyByDir,
        createdWorkspaces: demoAppState.createdWorkspaces,
        theme: 'dark' as const,
        density: 'compact' as const,
        ...p
      }
    }
  },
  imports: {
    analyze: async (paths: string[]): Promise<FileAnalysis[]> => {
      const out: FileAnalysis[] = []
      for (const p of paths) {
        const file = fileRegistry.get(p)
        if (!file) {
          out.push({
            id: `demo-${++idCounter}`,
            path: p,
            filename: p.replace(/^demo:\/\//, ''),
            header: [],
            sample: [],
            fingerprint: '',
            suggestedMapping: {},
            suggestedKpiMapping: {},
            confidence: 0,
            knownProfile: false,
            errors: ['File could not be read']
          })
          continue
        }
        emitImportProgress({ phase: 'Reading file', detail: file.name })
        await delay(100)
        const rows = parseCsv(await file.text())
        if (rows.length === 0) {
          out.push({
            id: `demo-${++idCounter}`,
            path: p,
            filename: file.name,
            header: [],
            sample: [],
            fingerprint: '',
            suggestedMapping: {},
            suggestedKpiMapping: {},
            confidence: 0,
            knownProfile: false,
            errors: ['Empty file']
          })
          continue
        }
        emitImportProgress({ phase: 'Scanning columns', detail: file.name })
        await delay(80)
        const header = rows[0].map((h) => h.trim())
        const suggested = autoMap(header)
        const fingerprint = makeFingerprint(header)
        emitImportProgress({ phase: 'Checking saved profile', detail: file.name })
        await delay(60)
        const remembered = profiles.get(fingerprint) ?? null
        const id = `demo-${++idCounter}`
        analysisRegistry.set(id, { file, header, sample: rows.slice(1, 21), fingerprint })
        const errors: string[] = []
        const mappedValues = Object.values(suggested)
        if (!mappedValues.includes('date')) errors.push('No date column recognized')
        if (!mappedValues.includes('cell')) errors.push('No cell column recognized')
        if (rows.length < 2) errors.push('No data rows after header')
        out.push({
          id,
          path: p,
          filename: file.name,
          header,
          sample: rows.slice(1, 6),
          fingerprint,
          suggestedMapping: remembered ? remembered.columns : suggested,
          suggestedKpiMapping: remembered
            ? remembered.kpiColumns
            : demoKpiDiscover(header, demoTech).mapping,
          confidence: mappingConfidence(suggested),
          knownProfile: remembered !== null,
          errors
        })
      }
      return out
    },
    preview: async (id: string, mapping: MappingConfig): Promise<PreviewResult> => {
      const rec = analysisRegistry.get(id)
      if (!rec) {
        return {
          rows: [],
          issues: [{ severity: 'error', message: 'Analysis expired — re-drop the file' }],
          canImport: false
        }
      }
      const issues = validateSample(rec.header, rec.sample, mapping)
      return {
        rows: orderedMappedRows(rec.header, rec.sample.slice(0, 8), mapping.columns),
        issues,
        canImport: issues.every((i) => i.severity !== 'error')
      }
    },
    run: async (id: string, mapping: MappingConfig): Promise<ImportResult> => {
      const rec = analysisRegistry.get(id)
      if (!rec) throw new Error('Analysis expired — re-drop the file')
      const t0 = performance.now()
      const rows = parseCsv(await rec.file.text())
      const dataRows = rows.slice(1)

      // simulate the desktop worker's phase stream (M5 background import)
      emitImportProgress({ phase: 'Reading file', detail: rec.file.name })
      await delay(220)
      emitImportProgress({ phase: 'Validating' })
      await delay(180)
      emitImportProgress({ phase: 'Merging' })
      await delay(160)

      let inserted = 0
      let rejected = 0
      let duplicates = 0
      const newCells: string[] = []
      const seenInFile = new Set<string>()
      for (const row of dataRows) {
        const fact = mapRow(rec.header, row, mapping.columns)
        if (!fact) {
          rejected++
          continue
        }
        const key = `${fact.date}|${fact.cell}`
        if (seenInFile.has(key) || factKeys.has(key)) {
          duplicates++ // Date+Cell dedupe — oldest wins
          continue
        }
        seenInFile.add(key)
        factKeys.add(key)
        if (!cellsSeen.has(fact.cell)) {
          cellsSeen.add(fact.cell)
          newCells.push(fact.cell)
        }
        demoFacts.push(fact)
        // spec §54a: extra columns mapped to KPI keys become per-cell values
        const kpiCols = mapping.kpiColumns ?? {}
        const cellId = demoCellIdOf(fact.cell)
        if (cellId != null) {
          for (const [header, kpiKey] of Object.entries(kpiCols)) {
            const idx = rec.header.indexOf(header)
            if (idx < 0) continue
            const v = Number.parseFloat((row[idx] ?? '').replace(',', ''))
            if (Number.isNaN(v)) continue
            demoKpiValues.set(`${cellId}|${kpiKey}`, v)
          }
        }
        inserted++
      }

      // Remember the mapping profile for this source fingerprint (spec §13),
      // including the accepted KPI assignments (spec §54a).
      if (inserted > 0) {
        profiles.set(rec.fingerprint, {
          columns: { ...mapping.columns },
          kpiColumns: { ...(mapping.kpiColumns ?? {}) }
        })
      }

      const importId = ++importCounter
      const confidence = mappingConfidence(mapping.columns)
      const issueRows = validateSample(rec.header, dataRows, mapping)

      // Transparent quality score (spec §17): coverage, completeness, reject
      // rate, mapping confidence, duplicate rate.
      const affected = new Set(demoFacts.slice(-inserted).map((f) => f.date))
      const cov = new Map(coverageRows().map((c) => [c.date, c.coveragePct]))
      const q = qualityRows()
      let avgCoverage = 0
      let avgCompleteness = 0
      let n = 0
      for (const r of q) {
        if (!affected.has(r.date)) continue
        avgCoverage += cov.get(r.date) ?? 100
        avgCompleteness += r.completenessPct
        n++
      }
      avgCoverage = n > 0 ? avgCoverage / n : 100
      avgCompleteness = n > 0 ? avgCompleteness / n : 100
      const sourceRows = dataRows.length
      const rejectRate = sourceRows > 0 ? rejected / sourceRows : 0
      const dupeRate = sourceRows > 0 ? duplicates / sourceRows : 0
      const qualityScore = Math.round(
        0.35 * avgCoverage +
          0.25 * avgCompleteness +
          0.15 * confidence * 100 +
          0.15 * (1 - rejectRate) * 100 +
          0.1 * (1 - dupeRate) * 100
      )

      auditRows.unshift({
        importId,
        importedAt: new Date().toISOString(),
        files: rec.file.name,
        sourceRows,
        insertedRows: inserted,
        duplicatesIgnored: duplicates,
        rejectedRows: rejected,
        mappingProfile: rec.fingerprint,
        rulesetVersion: 12
      })

      // demo raw-source archive (spec §9): a 90-day retained gzip copy
      const importedAt = new Date()
      const demoArchivePath = `C:\\Demo\\workspaces\\Preview_Network.qosdb.raw\\${importId}_${rec.file.name}.gz`
      const demoRetentionUntil = new Date(importedAt.getTime() + 90 * 86400000).toISOString()
      demoArchiveRows.unshift({
        archiveId: ++demoArchiveSeq,
        importId,
        filename: rec.file.name,
        sizeBytes: Math.round(rec.file.size * 0.21),
        checksum: 'demo-' + makeFingerprint(rec.header).slice(0, 12),
        importedAt: importedAt.toISOString(),
        retentionUntil: demoRetentionUntil,
        daysLeft: 90,
        status: 'retained'
      })

      emitImportProgress({ phase: 'Finalizing' })
      await delay(120)
      const durationMs = Math.round(Math.max(performance.now() - t0, 800))
      return {
        importId,
        filename: rec.file.name,
        sourceRows,
        insertedRows: inserted,
        duplicatesIgnored: duplicates,
        rejectedRows: rejected,
        newCells: newCells.length,
        issues: issueRows,
        qualityScore,
        durationMs,
        backupPath: `C:\\Demo\\backups\\Preview_Network_${importId}.qosdb`,
        archivePath: demoArchivePath,
        retentionUntil: demoRetentionUntil
      }
    },
    history: async (): Promise<ImportAuditRow[]> => auditRows,
    coverage: async (): Promise<CoverageRow[]> => coverageRows(),
    quality: async (): Promise<QualityRow[]> => qualityRows(),
    archive: async (): Promise<RawArchiveResult> => {
      const rows = [...demoArchiveRows]
      return { rows, status: demoArchiveStatus(rows) }
    },
    purgeArchive: async (): Promise<RawArchiveStatus> => {
      const kept = demoArchiveRows.filter((r) => r.status !== 'expired')
      demoArchiveRows.splice(0, demoArchiveRows.length, ...kept)
      return demoArchiveStatus(demoArchiveRows)
    },
    exportCsv: async (_sourcePath: string): Promise<{ path: string } | null> => null,
    geoStats: async (_id: string, mapping: MappingConfig): Promise<GeoStatsResult | null> => ({
      totalRows: 30,
      fields: (['region', 'district', 'site', 'cell'] as CanonicalField[]).map((field) => ({
        field,
        column: Object.entries(mapping).find(([, f]) => f === field)?.[0] ?? null,
        distinct: 0, matched: 0, unmatched: 0, topUnmatched: [], suggestions: {}
      }))
    }), 
    onProgress: (cb: (p: ImportProgress) => void): (() => void) => {
      importProgressCbs.add(cb)
      return () => importProgressCbs.delete(cb)
    }
  }
}

/** Reusable demo WorkspaceInfo (snapshot restore returns the same shape). */
function demoWorkspaceInfo(): WorkspaceInfo {
  const { min, max } = factDateRange()
  return {
    path: 'C:\\Demo\\workspaces\\Preview_Network.qosdb',
    name: demoWorkspaceName + ' (browser demo)',
    readOnly: false,
    schemaVersion: '0.1.0',
    createdAt: new Date().toISOString(),
    sizeBytes: 48_000_000 + demoFacts.length * 200,
    rowCount: BASELINE.rowCount + demoFacts.length,
    minDate: min < BASELINE.minDate ? min : BASELINE.minDate,
    maxDate: max > BASELINE.maxDate ? max : BASELINE.maxDate,
    dims: { regions: 16, districts: 45, sites: 570, cells: BASELINE.cells + cellsSeen.size },
    rulesetVersion: 12,
    technology: demoTech
  }
}

function demoArchiveStatus(rows: RawArchiveRow[]): RawArchiveStatus {
  const status: RawArchiveStatus = { total: rows.length, totalBytes: 0, retained: 0, expiring: 0, expired: 0 }
  for (const r of rows) {
    status.totalBytes += r.sizeBytes
    if (r.status === 'retained') status.retained++
    else if (r.status === 'expiring') status.expiring++
    else status.expired++
  }
  return status
}
