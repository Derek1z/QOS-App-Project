import { useEffect, useRef, useState } from 'react'
import { useAppStore, emit } from '../store'
import { refreshWorkspaceState, errMsg } from '../lib/flows'
import type {
  FileAnalysis, MappingConfig, PreviewResult, ImportResult,
  ImportAuditRow, CoverageRow, QualityRow, CanonicalField, ValidationIssue, ImportProgress,
  RawArchiveResult, MaintenanceAction, MaintenanceResult,
  MaintenanceScheduleSettings, ScheduledMaintenanceRun, KpiDefinition, GeoStatsResult, SheetInfo
} from '../../../shared/api'
import { FIELD_LABELS, FIELD_ORDER } from '../../../shared/api'
import { SheetSelectorModal } from '../components/SheetSelectorModal'

type Tab = 'import' | 'coverage' | 'audit' | 'quality' | 'archive' | 'maintenance'

// application-field-first geo mapping (spec §13): Region and District drive the
// geographic analysis, Site/Cell tie rows to cells — all user-overridable.
const GEO_FIELDS: CanonicalField[] = ['region', 'district', 'site', 'cell']

function geoFieldLabel(f: CanonicalField): string {
  return FIELD_LABELS[f] ?? f
}

const CADENCE_OPTIONS: Array<{ hours: number; label: string }> = [
  { hours: 6, label: 'Every 6 hours' },
  { hours: 12, label: 'Every 12 hours' },
  { hours: 24, label: 'Daily' },
  { hours: 72, label: 'Every 3 days' },
  { hours: 168, label: 'Weekly' }
]

const SCHED_ACTIONS: Array<{ id: MaintenanceAction; label: string }> = [
  { id: 'integrity', label: 'Integrity check' },
  { id: 'purge', label: 'Purge expired raw' },
  { id: 'optimize', label: 'Optimize (checkpoint)' },
  { id: 'rebuild', label: 'Rebuild aggregates' },
  { id: 'compact', label: 'Compact workspace' }
]

const MAINT_ACTIONS: Array<{ id: MaintenanceAction; label: string; hint: string; readOnly: boolean }> = [
  { id: 'integrity', label: 'Verify integrity', hint: 'PRAGMA integrity_check — read-only', readOnly: true },
  { id: 'storage', label: 'Analyze storage', hint: 'table sizes + file/WAL — read-only', readOnly: true },
  { id: 'optimize', label: 'Optimize database', hint: 'PRAGMA optimize + checkpoint', readOnly: false },
  { id: 'rebuild', label: 'Rebuild aggregates', hint: 'full recompute of aggregates + intelligence (backup first)', readOnly: false },
  { id: 'compact', label: 'Compact workspace', hint: 'rewrite into a fresh copy (backup first)', readOnly: false },
  { id: 'purge', label: 'Purge expired raw', hint: 'delete raw copies past the 90-day window (§9)', readOnly: false }
]

const EMPTY_ARCHIVE: RawArchiveResult = {
  rows: [],
  status: { total: 0, totalBytes: 0, retained: 0, expiring: 0, expired: 0 }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function IssueList({ issues }: { issues: ValidationIssue[] }): React.JSX.Element | null {
  if (!issues.length) return null
  return (
    <div className="issue-list">
      {issues.map((i, idx) => (
        <div key={idx} className={`issue issue-${i.severity}`}>
          <span className="issue-sev">{i.severity.toUpperCase()}</span>
          <span>{i.message}</span>
          {i.count != null && <span className="issue-count">× {i.count.toLocaleString()}</span>}
        </div>
      ))}
    </div>
  )
}

export default function DataManager(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const [tab, setTab] = useState<Tab>('import')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [analyses, setAnalyses] = useState<FileAnalysis[]>([])
  const [mappings, setMappings] = useState<Record<string, MappingConfig>>({})
  const [kpiDefs, setKpiDefs] = useState<KpiDefinition[]>([])
  // per-file state of the auto-suggested KPI assignments (spec §54a)
  const [kpiSuggest, setKpiSuggest] = useState<Record<string, 'applied' | 'dismissed'>>({})
  const [previews, setPreviews] = useState<Record<string, PreviewResult>>({})
  const [result, setResult] = useState<ImportResult | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [coverage, setCoverage] = useState<CoverageRow[]>([])
  const [audit, setAudit] = useState<ImportAuditRow[]>([])
  const [quality, setQuality] = useState<QualityRow[]>([])
  const [archive, setArchive] = useState<RawArchiveResult>(EMPTY_ARCHIVE)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [exportMsg, setExportMsg] = useState<Record<string, string>>({})
  const [geo, setGeo] = useState<Record<string, GeoStatsResult | null>>({})
  const [geoBusy, setGeoBusy] = useState<Record<string, boolean>>({})
  const [maintLog, setMaintLog] = useState<MaintenanceResult[]>([])
  const [maintAction, setMaintAction] = useState<MaintenanceAction | null>(null)
  const [sched, setSched] = useState<MaintenanceScheduleSettings | null>(null)
  const [schedDraft, setSchedDraft] = useState<MaintenanceScheduleSettings | null>(null)
  const [schedHistory, setSchedHistory] = useState<ScheduledMaintenanceRun[]>([])
  const [schedBusy, setSchedBusy] = useState(false)
  const [syntheticBusy, setSyntheticBusy] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [excelModalOpen, setExcelModalOpen] = useState(false)
  const [excelModalFile, setExcelModalFile] = useState<string>('')
  const [excelSheets, setExcelSheets] = useState<SheetInfo[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function handleFileSelection(paths: string[]): Promise<void> {
    if (!paths.length) return
    const excelPaths = paths.filter((p) => /\.(xlsx|xls)$/i.test(p))
    if (excelPaths.length > 0) {
      try {
        const sheets = await window.api.imports.inspectExcel(excelPaths[0])
        if (sheets.length > 0) {
          setExcelSheets(sheets)
          setExcelModalFile(excelPaths[0])
          setExcelModalOpen(true)
          return
        }
      } catch {
        /* fallback */
      }
    }
    void analyze(paths)
  }

  async function generateSynthetic(tech?: '2G' | '3G' | '4G'): Promise<void> {
    setSyntheticBusy(true)
    setError(null)
    try {
      const res = await window.api.synthetic.generate({
        technology: tech,
        weeks: 8,
        cellsPerTech: 20
      })
      await refreshWorkspaceState()
      await loadTabs()
      setError(`Successfully generated and imported ${res.rowsCount} rows for ${res.technology} dataset (${res.weeksCount} weeks, ${res.cellsCount} cells).`)
      emit('MODULE_CHANGED')
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSyntheticBusy(false)
    }
  }

  useEffect(() => {
    if (busy) {
      setElapsedSec(0)
      timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      setElapsedSec(0)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [busy])

  async function loadTabs(): Promise<void> {
    setCoverage(await window.api.imports.coverage())
    setAudit(await window.api.imports.history())
    setQuality(await window.api.imports.quality())
    try {
      setArchive(await window.api.imports.archive())
    } catch {
      setArchive(EMPTY_ARCHIVE)
    }
  }

  async function purgeExpired(): Promise<void> {
    setArchiveBusy(true)
    setError(null)
    try {
      const status = await window.api.imports.purgeArchive()
      setArchive(await window.api.imports.archive())
      if (status.expired > 0) setError(`Purged ${status.expired} expired raw file${status.expired === 1 ? '' : 's'}`)
      else setError(null)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setArchiveBusy(false)
    }
  }

  async function runMaint(id: MaintenanceAction): Promise<void> {
    setMaintAction(id)
    setError(null)
    try {
      const res = await window.api.maintenance.run(id)
      setMaintLog((prev) => [res, ...prev].slice(0, 30))
      // purge/compact can change archive + workspace state
      if (id === 'purge') setArchive(await window.api.imports.archive())
      if (id === 'compact') await refreshWorkspaceState()
      if (id === 'purge' || id === 'compact') await loadSchedule()
    } catch (e) {
      setMaintLog((prev) => [
        {
          action: id, ok: false, message: errMsg(e), startedAt: new Date().toISOString(), durationMs: 0
        } as MaintenanceResult,
        ...prev
      ].slice(0, 30))
    } finally {
      setMaintAction(null)
    }
  }

  async function loadSchedule(): Promise<void> {
    try {
      const s = await window.api.maintenance.getSchedule()
      setSched(s)
      setSchedDraft(s)
      setSchedHistory(await window.api.maintenance.scheduleHistory(10))
    } catch {
      /* scheduler surface unavailable in older workspaces */
    }
  }

  async function saveSchedule(): Promise<void> {
    if (!schedDraft) return
    setSchedBusy(true)
    setError(null)
    try {
      const saved = await window.api.maintenance.setSchedule({
        enabled: schedDraft.enabled,
        cadenceHours: schedDraft.cadenceHours,
        actions: schedDraft.actions,
        runOnOpen: schedDraft.runOnOpen
      })
      setSched(saved)
      setSchedDraft(saved)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSchedBusy(false)
    }
  }

  async function runScheduledNow(): Promise<void> {
    setSchedBusy(true)
    setError(null)
    try {
      const res = await window.api.maintenance.runScheduled()
      setMaintLog((prev) => res.results.concat(prev).slice(0, 30))
      if (res.ok) setArchive(await window.api.imports.archive())
      await refreshWorkspaceState()
      await loadSchedule()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSchedBusy(false)
    }
  }

  async function analyze(paths: string[]): Promise<void> {
    if (!paths.length) return
    setBusy(true)
    setError(null)
    setResult(null)
    setProgress(null)
    const off = window.api.imports.onProgress((p) => setProgress(p))
    try {
      const as = await window.api.imports.analyze(paths)
      setAnalyses(as)
      setKpiSuggest({})
      const next: Record<string, MappingConfig> = {}
      for (const a of as) {
        const m: MappingConfig = { columns: a.suggestedMapping }
        // remembered sources restore their accepted KPI assignments too
        if (a.knownProfile && Object.keys(a.suggestedKpiMapping ?? {}).length > 0) {
          m.kpiColumns = { ...a.suggestedKpiMapping }
        }
        next[a.id] = m
      }
      setMappings(next)
      for (const a of as) {
        if (a.errors.length === 0) {
          // Fast path: synthesize preview directly from the sample rows already parsed during analysis
          const sampleRows = a.sample ?? []
          if (sampleRows.length > 0) {
            const mapped = sampleRows.slice(0, 20).map((row) => {
              const obj: Record<string, string> = {}
              Object.entries(next[a.id].columns).forEach(([h, field]) => {
                const idx = a.header.indexOf(h)
                if (idx !== -1 && row[idx] != null) obj[field] = row[idx]
              })
              return obj
            })
            setPreviews((prev) => ({
              ...prev,
              [a.id]: { rows: mapped, issues: [], canImport: true }
            }))
          }
        }
      }
    } catch (e) {
      setError(errMsg(e))
    } finally {
      off()
      setBusy(false)
      setProgress(null)
    }
  }

  async function exportAsCsv(a: FileAnalysis): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.imports.exportCsv(a.path)
      if (res) {
        setExportMsg((prev) => ({ ...prev, [a.id]: `Exported to ${res.path}` }))
      }
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  async function preview(id: string, mapping: MappingConfig): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const p = await window.api.imports.preview(id, mapping)
      setPreviews((prev) => ({ ...prev, [id]: p }))
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  async function run(): Promise<void> {
    setBusy(true)
    setError(null)
    setResult(null)
    setProgress(null)
    // M5: the import now runs on a background worker; stream its phases in
    const off = window.api.imports.onProgress((p) => setProgress(p))
    try {
      let last: ImportResult | null = null
      for (const a of analyses) {
        const m = mappings[a.id]
        if (!m || a.errors.length > 0) continue
        last = await window.api.imports.run(a.id, m)
      }
      setResult(last)
      await refreshWorkspaceState()
      emit('IMPORT_COMPLETE')
      setAnalyses([])
      setMappings({})
      setPreviews({})
      await loadTabs()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      off()
      setBusy(false)
      setProgress(null)
    }
  }

  /** Application-field-first override: point a geo field at a source column. */
  function changeFieldColumn(id: string, field: CanonicalField, column: string): void {
    setMappings((prev) => {
      const cur = prev[id] ?? { columns: {}, kpiColumns: {} }
      const cols: Record<string, CanonicalField> = { ...cur.columns }
      for (const [k, v] of Object.entries(cols)) {
        if (v === field) delete cols[k]
      }
      if (column) cols[column] = field
      return { ...prev, [id]: { columns: cols, kpiColumns: { ...(cur.kpiColumns ?? {}) }, valueAliases: cur.valueAliases } }
    })
  }

  /** Match stats for the mapped geo fields against the workspace dimensions. */
  async function checkGeo(id: string, mapping: MappingConfig): Promise<void> {
    setGeoBusy((p) => ({ ...p, [id]: true }))
    try {
      const g = await window.api.imports.geoStats(id, mapping)
      setGeo((prev) => ({ ...prev, [id]: g }))
    } catch {
      setGeo((prev) => ({ ...prev, [id]: null }))
    } finally {
      setGeoBusy((p) => ({ ...p, [id]: false }))
    }
  }

  function columnFor(mapping: MappingConfig, field: CanonicalField): string {
    return Object.entries(mapping.columns).find(([, f]) => f === field)?.[0] ?? ''
  }

  /** One-click accept of a fuzzy geo suggestion: an unmatched source value is
   *  remapped onto the existing dimension name so the import re-points it
   *  instead of creating a new (misspelled) dimension row. */
  function applySuggestion(id: string, field: CanonicalField, value: string, suggestion: string): void {
    const cur = mappings[id] ?? { columns: {}, kpiColumns: {} }
    const aliases = { ...(cur.valueAliases ?? {}) }
    const fieldAliases = { ...(aliases[field] ?? {}) }
    fieldAliases[value] = suggestion
    aliases[field] = fieldAliases
    const next: MappingConfig = { ...cur, valueAliases: aliases }
    setMappings((prev) => ({ ...prev, [id]: next }))
    // re-check immediately so the matched/unmatched counts reflect the remap
    void checkGeo(id, next)
  }

  function changeMapping(id: string, header: string, field: CanonicalField | ''): void {
    setMappings((prev) => {
      const cur = prev[id] ?? { columns: {}, kpiColumns: {} }
      const cols: Record<string, CanonicalField> = { ...cur.columns }
      const kcols: Record<string, string> = { ...(cur.kpiColumns ?? {}) }
      for (const [k, v] of Object.entries(cols)) {
        if (v === field) delete cols[k]
      }
      if (field) {
        cols[header] = field
        delete kcols[header]
      } else {
        delete cols[header]
      }
      return { ...prev, [id]: { columns: cols, kpiColumns: kcols, valueAliases: cur.valueAliases } }
    })
  }

  function changeKpiMapping(id: string, header: string, kpiKey: string): void {
    setMappings((prev) => {
      const cur = prev[id] ?? { columns: {}, kpiColumns: {} }
      const cols: Record<string, CanonicalField> = { ...cur.columns }
      const kcols: Record<string, string> = { ...(cur.kpiColumns ?? {}) }
      if (kpiKey) kcols[header] = kpiKey
      else delete kcols[header]
      delete cols[header]
      return { ...prev, [id]: { columns: cols, kpiColumns: kcols, valueAliases: cur.valueAliases } }
    })
  }

  /** One-click accept of the fuzzy-matched KPI suggestions for a file. */
  async function applyKpiSuggestions(a: FileAnalysis): Promise<void> {
    const suggested = a.suggestedKpiMapping ?? {}
    const keys = Object.keys(suggested)
    if (keys.length === 0) return
    setMappings((prev) => {
      const cur = prev[a.id] ?? { columns: a.suggestedMapping }
      return { ...prev, [a.id]: { columns: cur.columns, kpiColumns: { ...suggested } } }
    })
    setKpiSuggest((prev) => ({ ...prev, [a.id]: 'applied' }))
    await preview(a.id, { columns: a.suggestedMapping, kpiColumns: { ...suggested } })
  }

  useEffect(() => {
    void (async () => {
      try {
        const defs = await window.api.kpis.list()
        setKpiDefs(defs)
      } catch {
        setKpiDefs([])
      }
    })()
  }, [workspace?.path])

  useEffect(() => {
    void loadTabs()
  }, [])

  useEffect(() => {
    if (tab === 'maintenance') void loadSchedule()
  }, [tab])

  const readOnly = workspace?.readOnly ?? false
  const isDemo = !!(window.api as unknown as { demo?: boolean }).demo

  /** Browser-preview convenience: drops a spec-shaped CSV through the normal
   *  API path so the import flow (analyze → map → validate → commit) can be
   *  exercised without preparing a file. Inert in Electron. */
  async function loadSample(): Promise<void> {
    const csv = [
      'Date/Time,Cell,District,Region,Site,PRB Utilization,Connected Users,Data Volume (MB),Availability,DL Throughput (kbps)',
      '2026-07-28 00:00,ACCRA_KWAME_01,Accra Metro,Greater Accra,ACCRA_KWAME,58.2,412,38250.5,99.8,21450',
      '2026-07-28 00:00,ACCRA_KWAME_02,Accra Metro,Greater Accra,ACCRA_KWAME,72.4,388,45120.1,99.9,19380',
      '2026-07-28 00:00,KUMASI_ASAFO_01,Asafo,Kumasi,KUMASI_ASAFO,45.9,267,28900.0,98.7,26100',
      '2026-07-28 00:00,TEMA_HARBOR_01,Tema,Tema,TEMA_HARBOR,81.3,521,61200.8,99.5,15890',
      '2026-07-29 00:00,ACCRA_KWAME_01,Accra Metro,Greater Accra,ACCRA_KWAME,61.0,430,39910.2,99.8,22050',
      '2026-07-29 00:00,ACCRA_KWAME_02,Accra Metro,Greater Accra,ACCRA_KWAME,69.8,401,43880.7,99.9,20560',
      '2026-07-29 00:00,KUMASI_ASAFO_01,Asafo,Kumasi,KUMASI_ASAFO,50.3,281,30250.5,98.7,24870',
      '2026-07-29 00:00,TEMA_HARBOR_01,Tema,Tema,TEMA_HARBOR,84.6,498,64500.2,99.4,14420',
      '2026-07-29 00:00,TEMA_HARBOR_01,Tema,Tema,TEMA_HARBOR,84.6,498,64500.2,99.4,14420',
      '2026-07-30 00:00,ACCRA_KWAME_01,Accra Metro,Greater Accra,ACCRA_KWAME,63.4,441,41050.9,99.7,23110',
      '2026-07-30 00:00,,Accra Metro,Greater Accra,ACCRA_KWAME,66.2,395,42001.3,99.8,21340',
      '2026-07-30 00:00,ACCRA_KWAME_02,Accra Metro,Greater Accra,ACCRA_KWAME,115.0,388,45120.1,99.9,19380',
      '2026-07-30 00:00,KUMASI_ASAFO_01,Asafo,Kumasi,KUMASI_ASAFO,52.7,274,30500.6,98.8,24400',
      '2026-07-31 00:00,KUMASI_ASAFO_01,Asafo,Kumasi,KUMASI_ASAFO,48.1,260,28800.4,98.6,25300',
      'not-a-date,ACCRA_KWAME_02,Accra Metro,Greater Accra,ACCRA_KWAME,55.0,301,31900.7,99.0,23450'
    ].join('\n')
    const file = new File([csv], 'sample_cells_2026-07-28.csv', { type: 'text/csv' })
    void analyze([window.api.files.path(file)])
  }

  const [techGuideTab, setTechGuideTab] = useState<'2G' | '3G' | '4G'>('3G')
  const [techGuideExpanded, setTechGuideExpanded] = useState(true)

  function downloadCsvTemplate(tech: '2G' | '3G' | '4G' | 'ALL') {
    let filename = ''
    let content = ''

    if (tech === '2G') {
      filename = '2G_GSM_QoS_Template.csv'
      content = [
        'Date/Time,Cell,Site,District,Region,TCH Congestion (%),SDCCH Congestion (%),Call Setup Success Rate (%),Call Drop Rate (%),Voice Traffic (Erl),TCH Availability (%),Connected Users,GPRS Traffic (MB),GPRS Throughput (kbps)',
        '2026-07-28 00:00,ACC_2G_01A,ACC_2G_01,Accra Metro,Greater Accra,0.85,0.42,98.6,0.45,45.2,99.9,142,12500.5,145.2',
        '2026-07-28 00:00,ACC_2G_01B,ACC_2G_01,Accra Metro,Greater Accra,1.20,0.80,97.4,0.68,52.1,99.8,168,14200.0,138.6',
        '2026-07-28 00:00,KUM_2G_02A,KUM_2G_02,Kumasi,Ashanti,2.80,2.15,92.4,1.85,62.8,98.5,210,18900.2,112.4'
      ].join('\n')
    } else if (tech === '3G') {
      filename = '3G_UMTS_QoS_Template.csv'
      content = [
        'Date/Time,Cell,Site,District,Region,3G CSSR (%),3G Call Drop Rate (%),3G DASR (%),DL Power Congestion,UL CE Congestion,DL Code Congestion,Iub Transport Congestion,PhyCh Failures,Sync Loss Drops,SHO Failure Rate (%),IRAT HO Failure Rate (%),HSDPA Throughput (kbps),HSUPA Throughput (kbps),3G Cell Availability (%),Connected Users,Data Volume (MB)',
        '2026-07-28 00:00,ACC_3G_01A,ACC_3G_01,Accra Metro,Greater Accra,97.8,0.62,99.1,12,8,2,4,3,2,0.8,1.2,3450,1120,99.8,285,54200.5',
        '2026-07-28 00:00,ACC_3G_01B,ACC_3G_01,Accra Metro,Greater Accra,96.5,0.78,98.6,18,14,5,8,6,4,1.1,1.5,3100,980,99.7,310,48900.2',
        '2026-07-28 00:00,KUM_3G_02A,KUM_3G_02,Kumasi,Ashanti,91.2,2.45,94.8,185,142,65,94,48,56,4.2,5.8,1240,410,97.6,412,38900.2'
      ].join('\n')
    } else if (tech === '4G') {
      filename = '4G_LTE_QoS_Template.csv'
      content = [
        'Date/Time,Cell,Site,District,Region,PRB Utilization (%),4G CSSR (%),4G Call Drop Rate (%),DSAF (%),DL Throughput (kbps),UL Throughput (kbps),4G Cell Availability (%),Connected Users,Data Volume (MB)',
        '2026-07-28 00:00,ACC_4G_01A,ACC_4G_01,Accra Metro,Greater Accra,68.4,98.9,0.32,0.45,28500,8400,99.9,350,124500.8',
        '2026-07-28 00:00,ACC_4G_01B,ACC_4G_01,Accra Metro,Greater Accra,74.2,97.8,0.48,0.65,24100,7600,99.8,390,118200.0',
        '2026-07-28 00:00,KUM_4G_02A,KUM_4G_02,Kumasi,Ashanti,89.5,93.1,1.48,2.30,11200,3200,98.2,540,168000.4'
      ].join('\n')
    } else {
      filename = 'Multi_Tech_QoS_Template.csv'
      content = [
        'Date/Time,Cell,Site,District,Region,Technology,PRB Utilization (%),CSSR (%),Call Drop Rate (%),Availability (%),DL Throughput (kbps),Connected Users,Data Volume (MB)',
        '2026-07-28 00:00,ACC_4G_01A,ACC_01,Accra Metro,Greater Accra,4G,68.4,98.9,0.32,99.9,28500,350,124500.8',
        '2026-07-28 00:00,ACC_3G_01A,ACC_01,Accra Metro,Greater Accra,3G,,97.8,0.62,99.8,3450,285,54200.5',
        '2026-07-28 00:00,ACC_2G_01A,ACC_01,Accra Metro,Greater Accra,2G,,98.6,0.45,99.9,145,142,12500.5'
      ].join('\n')
    }

    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const canRun = analyses.some((a) => {
    if (a.errors.length > 0) return false
    const cols = mappings[a.id]?.columns
    if (!cols) return false
    // columns is keyed by source header, so check the mapped canonical values
    const values = Object.values(cols)
    return values.includes('date') && values.includes('cell')
  })

  return (
    <div className="module">
      <div className="module-head">
        <h2>Data Manager</h2>
        <span className="module-workspace">{workspace?.name}</span>
        {readOnly && <span className="badge badge-ro">READ ONLY</span>}
      </div>

      <div className="tabs">
        <button className={`tab${tab === 'import' ? ' active' : ''}`} onClick={() => setTab('import')}>
          Import
        </button>
        <button className={`tab${tab === 'coverage' ? ' active' : ''}`} onClick={() => setTab('coverage')}>
          Coverage
        </button>
        <button className={`tab${tab === 'audit' ? ' active' : ''}`} onClick={() => setTab('audit')}>
          Audit
        </button>
        <button className={`tab${tab === 'quality' ? ' active' : ''}`} onClick={() => setTab('quality')}>
          Quality
        </button>
        <button className={`tab${tab === 'archive' ? ' active' : ''}`} onClick={() => setTab('archive')}>
          Archive
        </button>
        <button className={`tab${tab === 'maintenance' ? ' active' : ''}`} onClick={() => setTab('maintenance')}>
          Maintenance
        </button>
      </div>

      {error && <div className="notice notice-error">{error}</div>}
      {busy && (
        <div className="import-progress">
          <div className="import-progress-bar">
            <div className="import-progress-fill" />
          </div>
          <div className="import-progress-label">
            <span>
              {progress
                ? `${progress.phase}${progress.detail ? ` — ${progress.detail}` : ''}`
                : 'Working…'}
            </span>
            {elapsedSec > 0 && (
              <span className="import-elapsed" style={{ marginLeft: 12, opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>
                ⏱ {elapsedSec}s elapsed
              </span>
            )}
          </div>
        </div>
      )}

      {tab === 'import' && (
        <div>
          {/* Starter CSV Template Download Bar */}
          <div className="template-download-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>📥</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: '12px', color: '#f8fafc' }}>
                  Pre-Configured KPI Starter Templates
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                  Download official CSV templates with calibrated headers for 2G, 3G, 4G, or Multi-Tech datasets
                </div>
              </div>
            </div>
            <div className="template-btn-group">
              <button className="template-dl-btn" onClick={() => downloadCsvTemplate('2G')} title="Download 2G GSM Starter CSV with TCH/SDCCH and CSSR">
                📄 2G GSM CSV
              </button>
              <button className="template-dl-btn" onClick={() => downloadCsvTemplate('3G')} title="Download 3G UMTS Starter CSV with CSSR, CDR, DASR, Power/CE Congestion, and HSDPA Speed">
                📄 3G UMTS CSV
              </button>
              <button className="template-dl-btn" onClick={() => downloadCsvTemplate('4G')} title="Download 4G LTE Starter CSV with PRB, VoLTE CSSR/CDR, DSAF, and Throughput">
                📄 4G LTE CSV
              </button>
              <button className="template-dl-btn" style={{ borderColor: 'rgba(16, 185, 129, 0.4)', color: '#34d399', background: 'rgba(16, 185, 129, 0.08)' }} onClick={() => downloadCsvTemplate('ALL')} title="Download Combined Multi-Tech CSV">
                📦 All-in-One Multi-Tech
              </button>
            </div>
          </div>

          {/* Interactive Technology KPI Reference Guide */}
          <div className="import-tech-guide">
            <div className="import-tech-guide-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '16px' }}>📚</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: '#f8fafc' }}>
                    Technology KPI Specification &amp; Readiness Guide
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                    KPIs recognized across the application for regulatory compliance, diagnostics, and root-cause analysis
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="import-tech-tabs">
                  {(['2G', '3G', '4G'] as const).map((t) => (
                    <button
                      key={t}
                      className={`import-tech-tab-btn${techGuideTab === t ? ' active' : ''}`}
                      onClick={() => setTechGuideTab(t)}
                    >
                      {t} {t === '2G' ? 'GSM' : t === '3G' ? 'UMTS' : 'LTE'}
                    </button>
                  ))}
                </div>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setTechGuideExpanded((v) => !v)}
                  title={techGuideExpanded ? 'Collapse Guide' : 'Expand Guide'}
                >
                  {techGuideExpanded ? '▲' : '▼'}
                </button>
              </div>
            </div>

            {techGuideExpanded && (
              <div className="tech-kpi-grid">
                {techGuideTab === '2G' && (
                  <>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--danger)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">TCH Congestion</span>
                        <span className="tech-kpi-item-target">Target ≤ 2.0%</span>
                      </div>
                      <span className="tech-kpi-item-desc">Core traffic channel blocking. Triggers 2G Capacity &amp; Congestion alerts.</span>
                      <span className="tech-kpi-item-aliases">Aliases: tch congestion, 2g congestion, tch blocking, tch cong</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--danger)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">SDCCH Congestion</span>
                        <span className="tech-kpi-item-target">Target ≤ 2.0%</span>
                      </div>
                      <span className="tech-kpi-item-desc">Core signalling channel blocking. Triggers 2G accessibility alarms.</span>
                      <span className="tech-kpi-item-aliases">Aliases: sdcch congestion, signalling congestion, sdcch cong</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--accent)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">2G Call Connection Success (CSSR)</span>
                        <span className="tech-kpi-item-target">Target &gt; 95.0%</span>
                      </div>
                      <span className="tech-kpi-item-desc">Primary 2G voice accessibility regulatory KPI.</span>
                      <span className="tech-kpi-item-aliases">Aliases: 2g cssr, call setup success rate, cssr</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--accent)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">2G Call Drop Rate (CDR)</span>
                        <span className="tech-kpi-item-target">Target &lt; 1.0%</span>
                      </div>
                      <span className="tech-kpi-item-desc">Primary 2G retainability regulatory KPI.</span>
                      <span className="tech-kpi-item-aliases">Aliases: 2g call drop rate, drop call rate, 2g cdr, cdr</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--text-dim)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">2G Voice Traffic &amp; Users</span>
                        <span className="tech-kpi-item-target">Traffic (Erl) / Users (#)</span>
                      </div>
                      <span className="tech-kpi-item-desc">Carried Erlang load and concurrent subscribers.</span>
                      <span className="tech-kpi-item-aliases">Aliases: voice traffic, traffic (erl), connected users, 2g users</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--text-dim)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">TCH Availability</span>
                        <span className="tech-kpi-item-target">Target ≥ 99.5%</span>
                      </div>
                      <span className="tech-kpi-item-desc">Hardware/cell uptime percentage.</span>
                      <span className="tech-kpi-item-aliases">Aliases: tch availability, cell availability, availability</span>
                    </div>
                  </>
                )}

                {techGuideTab === '3G' && (
                  <>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--accent)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">3G Call Connection Success (CSSR)</span>
                        <span className="tech-kpi-item-target">Target &gt; 95.0%</span>
                      </div>
                      <span className="tech-kpi-item-desc">Primary 3G CS voice setup success rate (RRC + NAS).</span>
                      <span className="tech-kpi-item-aliases">Aliases: 3g cssr, rrc connection success rate, 3g call setup success</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--accent)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">3G Call Drop Rate (CDR)</span>
                        <span className="tech-kpi-item-target">Target &lt; 1.0%</span>
                      </div>
                      <span className="tech-kpi-item-desc">Primary 3G retainability regulatory KPI.</span>
                      <span className="tech-kpi-item-aliases">Aliases: 3g call drop rate, 3g cdr, cs drop call rate, rrc drop rate</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--accent)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">3G Data Access Success (DASR)</span>
                        <span className="tech-kpi-item-target">Target ≥ 98.0%</span>
                      </div>
                      <span className="tech-kpi-item-desc">Packet-switched (HSDPA/PS) connection setup success rate.</span>
                      <span className="tech-kpi-item-aliases">Aliases: 3g dasr, data access success rate, ps setup success rate, ps cssr</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--danger)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">DL Power &amp; UL CE Congestion</span>
                        <span className="tech-kpi-item-target">Target &lt; 100 events</span>
                      </div>
                      <span className="tech-kpi-item-desc">Downlink power saturation and Uplink Channel Element baseband exhaustion.</span>
                      <span className="tech-kpi-item-aliases">Aliases: 3g_dl_power_congestion, 3g_ul_ce_congestion, power congestion, ce congestion</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--danger)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">DL Code &amp; Iub Transport Congestion</span>
                        <span className="tech-kpi-item-target">Target &lt; 100 events</span>
                      </div>
                      <span className="tech-kpi-item-desc">OVSF channelization code blocking and NodeB-RNC backhaul link saturation.</span>
                      <span className="tech-kpi-item-aliases">Aliases: 3g_dl_code_congestion, 3g_iub_tn_congestion, code congestion, iub congestion</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--warn)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">PhyCh Failures &amp; Sync Loss Drops</span>
                        <span className="tech-kpi-item-target">Target &lt; 50 events</span>
                      </div>
                      <span className="tech-kpi-item-desc">Physical channel setup failures and out-of-sync radio link drops.</span>
                      <span className="tech-kpi-item-aliases">Aliases: 3g_phych_failures, 3g_sync_loss_drops, sync loss, phych failures</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--warn)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">Soft HO &amp; IRAT HO Failures</span>
                        <span className="tech-kpi-item-target">Target &lt; 2.0% / &lt; 3.0%</span>
                      </div>
                      <span className="tech-kpi-item-desc">Active set update failures and 3G-to-2G/4G inter-RAT handover drops.</span>
                      <span className="tech-kpi-item-aliases">Aliases: 3g_sho_failure_rate, 3g_irat_ho_failure_rate, sho failure, irat failure</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--text-dim)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">HSDPA / HSUPA Throughput</span>
                        <span className="tech-kpi-item-target">Speed (kbps) / Volume (MB)</span>
                      </div>
                      <span className="tech-kpi-item-desc">User payload data speeds and 3G traffic volume.</span>
                      <span className="tech-kpi-item-aliases">Aliases: hsdpa throughput, hsupa throughput, 3g throughput, data volume</span>
                    </div>
                  </>
                )}

                {techGuideTab === '4G' && (
                  <>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--danger)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">PRB Utilization</span>
                        <span className="tech-kpi-item-target">Target ≤ 80.0%</span>
                      </div>
                      <span className="tech-kpi-item-desc">Core Physical Resource Block capacity utilization.</span>
                      <span className="tech-kpi-item-aliases">Aliases: prb utilization, prb avg, prb util (%), 4g prb</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--accent)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">4G Call Connection Success (CSSR)</span>
                        <span className="tech-kpi-item-target">Target &gt; 95.0%</span>
                      </div>
                      <span className="tech-kpi-item-desc">VoLTE and EPS Bearer setup success rate.</span>
                      <span className="tech-kpi-item-aliases">Aliases: 4g cssr, volte setup success, e-rab setup success rate</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--accent)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">4G Call Drop Rate (CDR)</span>
                        <span className="tech-kpi-item-target">Target &lt; 1.0%</span>
                      </div>
                      <span className="tech-kpi-item-desc">VoLTE QCI-1 and E-RAB service drop rate.</span>
                      <span className="tech-kpi-item-aliases">Aliases: 4g call drop rate, volte drop rate, 4g cdr, erab drop rate</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--warn)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">Data Setup Access Failure (DSAF)</span>
                        <span className="tech-kpi-item-target">Target ≤ 1.5%</span>
                      </div>
                      <span className="tech-kpi-item-desc">LTE Data connection access failure percentage.</span>
                      <span className="tech-kpi-item-aliases">Aliases: dsaf, dsaf (%), data setup access failure, lte access failure</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--text-dim)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">DL / UL Throughput</span>
                        <span className="tech-kpi-item-target">Target ≥ 5000 / 1000 kbps</span>
                      </div>
                      <span className="tech-kpi-item-desc">User experienced 4G payload speeds.</span>
                      <span className="tech-kpi-item-aliases">Aliases: dl throughput (kbps), ul throughput (kbps), 4g speed</span>
                    </div>
                    <div className="tech-kpi-item" style={{ borderLeftColor: 'var(--text-dim)' }}>
                      <div className="tech-kpi-item-head">
                        <span className="tech-kpi-item-name">Cell Availability &amp; Users</span>
                        <span className="tech-kpi-item-target">Target ≥ 99.5% / Users (#)</span>
                      </div>
                      <span className="tech-kpi-item-desc">eNodeB cell uptime and concurrent RRC connected users.</span>
                      <span className="tech-kpi-item-aliases">Aliases: availability, connected users, active users, rrc connected ues</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {readOnly ? (
            <div className="notice">This workspace is read-only — imports are disabled.</div>
          ) : (
            <div
              className={`dropzone${dragOver ? ' over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                const paths = Array.from(e.dataTransfer.files).map((f) => window.api.files.path(f))
                void handleFileSelection(paths)
              }}
            >
              <div className="dropzone-inner">
                <div className="dropzone-icon">⬇️</div>
                <p>Drop CSV or Excel files here, or</p>
                <button className="btn btn-primary" onClick={() => fileInput.current?.click()}>
                  Choose files…
                </button>
                <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button
                    className="btn btn-ghost"
                    disabled={busy || syntheticBusy}
                    onClick={() => void generateSynthetic('2G')}
                    title="Generate multi-week 2G dataset with TCH/SDCCH congestion and call drops"
                  >
                    {syntheticBusy ? 'Generating…' : '⚡ Generate 2G Demo Data'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={busy || syntheticBusy}
                    onClick={() => void generateSynthetic('3G')}
                    title="Generate multi-week 3G dataset with CSSR, CDR, and DASR metrics"
                  >
                    {syntheticBusy ? 'Generating…' : '⚡ Generate 3G Demo Data'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={busy || syntheticBusy}
                    onClick={() => void generateSynthetic('4G')}
                    title="Generate multi-week 4G dataset with PRB, DSAF, and throughput metrics"
                  >
                    {syntheticBusy ? 'Generating…' : '⚡ Generate 4G Demo Data'}
                  </button>
                </div>
                {isDemo && (
                  <button className="btn btn-ghost" onClick={() => void loadSample()}>
                    Use sample CSV
                  </button>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept=".csv,.txt,.xlsx"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const paths = Array.from(e.target.files ?? []).map((f) => window.api.files.path(f))
                    void handleFileSelection(paths)
                    e.target.value = ''
                  }}
                />
              </div>
            </div>
          )}

          {analyses.length > 0 && (
            <div className="file-list">
              {analyses.length > 1 && (
                <div className="card glass-card" style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderLeft: '3px solid var(--accent)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '20px' }}>📦</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--accent)' }}>
                        Multi-File Batch Queue ({analyses.length} files detected)
                      </div>
                      <div className="card-note">
                        {analyses.filter(a => a.errors.length === 0).length} valid schemas · {analyses.reduce((acc, a) => acc + (a.sample?.length || 0), 0) > 0 ? `${analyses.length} files staged` : `${analyses.length} files staged`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn btn-primary"
                      disabled={busy || !canRun}
                      onClick={() => void run()}
                    >
                      🚀 Ingest All {analyses.length} Files in Batch
                    </button>
                  </div>
                </div>
              )}
              {analyses.map((a) => {
                const mapping = mappings[a.id] ?? { columns: a.suggestedMapping }
                const prev = previews[a.id]
                const suggestedKeys = Object.keys(a.suggestedKpiMapping ?? {})
                const showSuggest =
                  suggestedKeys.length > 0 &&
                  !a.knownProfile &&
                  kpiSuggest[a.id] !== 'applied' &&
                  kpiSuggest[a.id] !== 'dismissed'
                return (
                  <div key={a.id} className="card file-card">
                    <div className="file-head">
                      <span className="file-name">{a.filename}</span>
                      {a.knownProfile && <span className="badge badge-ok">KNOWN SOURCE</span>}
                      {a.detectedTechnology && (
                        <span className="badge badge-tech">TECH: {a.detectedTechnology}</span>
                      )}
                      <span className="file-conf">
                        mapping confidence {Math.round(a.confidence * 100)}%
                      </span>
                      {a.errors.length > 0 && (
                        <span className="file-err">blocked: {a.errors.join('; ')}</span>
                      )}
                    </div>
                    {showSuggest && (
                      <div className="notice kpi-suggest">
                        <span>
                          ✨ Auto-suggested {suggestedKeys.length} KPI{' '}
                          {suggestedKeys.length === 1 ? 'mapping' : 'mappings'} from the column
                          names — apply to analyze them as {a.header.length ? 'per-technology' : ''} KPIs.
                        </span>
                        <span className="suggest-actions">
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={busy}
                            onClick={() => void applyKpiSuggestions(a)}
                          >
                            Apply suggestions
                          </button>
                          <button
                            className="btn btn-sm"
                            disabled={busy}
                            onClick={() => setKpiSuggest((p) => ({ ...p, [a.id]: 'dismissed' }))}
                          >
                            Dismiss
                          </button>
                        </span>
                      </div>
                    )}
                    {kpiSuggest[a.id] === 'applied' && (
                      <div className="notice notice-ok">
                        ✓ {suggestedKeys.length} KPI suggestions applied — edit any column below if needed.
                      </div>
                    )}
                    {a.knownProfile && suggestedKeys.length > 0 && (
                      <div className="notice notice-ok">
                        ↺ Remembered {suggestedKeys.length} KPI{' '}
                        {suggestedKeys.length === 1 ? 'assignment' : 'assignments'} from the last
                        import of this source — adjust below if needed.
                      </div>
                    )}
                    {a.derivedSuggestions && a.derivedSuggestions.length > 0 && (
                      <div className="notice kpi-suggest" style={{ background: 'rgba(56, 189, 248, 0.08)', borderLeft: '3px solid #38bdf8', marginTop: 8 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div>
                            ⚡ <b>{a.derivedSuggestions.filter((s) => s.canCalculate).length} derived KPI{a.derivedSuggestions.filter((s) => s.canCalculate).length === 1 ? '' : 's'}</b> can be created from this dataset: {a.derivedSuggestions.map((s) => s.derivedKpi.name).join(', ')}
                          </div>
                          {a.derivedSuggestions.some((s) => !s.canCalculate) && (
                            <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                              {a.derivedSuggestions.filter((s) => !s.canCalculate).map((s) => `${s.derivedKpi.name}: missing ${s.missingSources.join(', ')}`).join(' · ')}
                            </div>
                          )}
                        </div>
                        <span className="suggest-actions">
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={busy}
                            onClick={async () => {
                              for (const s of a.derivedSuggestions ?? []) {
                                if (s.canCalculate) {
                                  await window.api.derived.save({ ...s.derivedKpi, enabled: true })
                                }
                              }
                              emit('KPIDEFS_CHANGED')
                            }}
                          >
                            Create All
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => emit('OPEN_TARGETS_MODAL')}
                          >
                            Review
                          </button>
                        </span>
                      </div>
                    )}

                    {/* Technology Feature Readiness Audit */}
                    {(() => {
                      const mappedCols = mapping.columns ?? {}
                      const mappedKpiCols = mapping.kpiColumns ?? {}
                      const allMappedKeys = new Set([
                        ...Object.values(mappedCols),
                        ...Object.values(mappedKpiCols)
                      ])

                      const hasDate = allMappedKeys.has('date')
                      const hasCell = allMappedKeys.has('cell')
                      const hasGeo = allMappedKeys.has('district') || allMappedKeys.has('region')
                      
                      const has2gCore = allMappedKeys.has('tch_congestion') || allMappedKeys.has('sdcch_congestion') || allMappedKeys.has('call_setup_success_2g') || allMappedKeys.has('call_drop_rate_2g')
                      const has3gCore = allMappedKeys.has('call_setup_success_3g') || allMappedKeys.has('call_drop_rate_3g') || allMappedKeys.has('data_access_success_3g')
                      const has3gDiag = allMappedKeys.has('3g_dl_power_congestion') || allMappedKeys.has('3g_ul_ce_congestion') || allMappedKeys.has('3g_dl_code_congestion') || allMappedKeys.has('3g_iub_tn_congestion') || allMappedKeys.has('3g_phych_failures') || allMappedKeys.has('3g_sync_loss_drops')
                      const has4gCore = allMappedKeys.has('prb_utilization') || allMappedKeys.has('call_setup_success_4g') || allMappedKeys.has('call_drop_rate_4g') || allMappedKeys.has('data_setup_success_4g')

                      const totalMapped = Object.keys(mappedCols).length + Object.keys(mappedKpiCols).length

                      return (
                        <div className="file-readiness-panel">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#f8fafc' }}>
                              ⚡ Technology Readiness Audit ({totalMapped} fields mapped)
                            </span>
                            <span style={{ fontSize: '11px', color: hasDate && hasCell ? '#34d399' : '#f87171', fontWeight: 600 }}>
                              {hasDate && hasCell ? '✓ Ingestion Ready' : '⚠️ Requires Date & Cell'}
                            </span>
                          </div>
                          <div className="readiness-pills-row">
                            <span className={`readiness-pill${hasDate && hasCell ? ' unlocked' : ''}`}>
                              {hasDate && hasCell ? '✓' : '○'} Cell Baseline
                            </span>
                            <span className={`readiness-pill${hasGeo ? ' unlocked' : ''}`}>
                              {hasGeo ? '✓' : '○'} GIS Region / District Matrix
                            </span>
                            <span className={`readiness-pill${has2gCore || has3gCore || has4gCore ? ' unlocked' : ''}`}>
                              {has2gCore || has3gCore || has4gCore ? '✓' : '○'} NC Regulatory Engine
                            </span>
                            <span className={`readiness-pill${has3gDiag || allMappedKeys.has('tch_congestion') || allMappedKeys.has('prb_utilization') ? ' unlocked' : ''}`}>
                              {has3gDiag || allMappedKeys.has('tch_congestion') || allMappedKeys.has('prb_utilization') ? '✓' : '○'} Root-Cause Diagnostics
                            </span>
                            <span className={`readiness-pill${totalMapped >= 4 ? ' unlocked' : ''}`}>
                              {totalMapped >= 4 ? '✓' : '○'} Forecast (backtested)
                            </span>
                          </div>
                        </div>
                      )
                    })()}

                    {a.errors.length === 0 && (
                      <>
                        <table className="map-table">
                          <thead>
                            <tr>
                              <th>Source column</th>
                              <th>Mapped to</th>
                            </tr>
                          </thead>
                          <tbody>
                            {a.header.map((h) => (
                              <tr key={h}>
                                <td className="map-src">{h}</td>
                                <td>
                                  <div className="map-cell">
                                    <select
                                      className="sel"
                                      value={mapping.columns[h] ?? ''}
                                      onChange={(e) =>
                                        changeMapping(a.id, h, e.target.value as CanonicalField | '')
                                      }
                                    >
                                      <option value="">— ignore —</option>
                                      {FIELD_ORDER.map((f) => (
                                        <option key={f} value={f}>
                                          {FIELD_LABELS[f]}
                                          {f === 'date' || f === 'cell' ? ' *' : ''}
                                        </option>
                                      ))}
                                    </select>
                                    <span className="map-or">or</span>
                                    <select
                                      className="sel"
                                      value={mapping.kpiColumns?.[h] ?? ''}
                                      onChange={(e) => changeKpiMapping(a.id, h, e.target.value)}
                                    >
                                      <option value="">— as extra KPI —</option>
                                      {kpiDefs.filter(k => k.technology === '2G').length > 0 && (
                                        <optgroup label="🏷️ 2G GSM Core & Supporting">
                                          {kpiDefs.filter(k => k.technology === '2G').map((k) => (
                                            <option key={k.kpiId} value={k.key}>
                                              {k.label}{k.unit ? ` (${k.unit})` : ''}{k.isCore ? ' ★' : ''}
                                            </option>
                                          ))}
                                        </optgroup>
                                      )}
                                      {kpiDefs.filter(k => k.technology === '3G').length > 0 && (
                                        <optgroup label="🏷️ 3G UMTS Core, Supporting & Diagnostics">
                                          {kpiDefs.filter(k => k.technology === '3G').map((k) => (
                                            <option key={k.kpiId} value={k.key}>
                                              {k.label}{k.unit ? ` (${k.unit})` : ''}{k.isCore ? ' ★' : ''}
                                            </option>
                                          ))}
                                        </optgroup>
                                      )}
                                      {kpiDefs.filter(k => k.technology === '4G').length > 0 && (
                                        <optgroup label="🏷️ 4G LTE Core & Supporting">
                                          {kpiDefs.filter(k => k.technology === '4G').map((k) => (
                                            <option key={k.kpiId} value={k.key}>
                                              {k.label}{k.unit ? ` (${k.unit})` : ''}{k.isCore ? ' ★' : ''}
                                            </option>
                                          ))}
                                        </optgroup>
                                      )}
                                      {kpiDefs.filter(k => !k.technology || (k.technology as string) === 'ALL').length > 0 && (
                                        <optgroup label="🏷️ General / Other KPIs">
                                          {kpiDefs.filter(k => !k.technology || (k.technology as string) === 'ALL').map((k) => (
                                            <option key={k.kpiId} value={k.key}>
                                              {k.label}{k.unit ? ` (${k.unit})` : ''}{k.isCore ? ' ★' : ''}
                                            </option>
                                          ))}
                                        </optgroup>
                                      )}
                                    </select>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="geo-panel">
                          <div className="geo-head">
                            <span className="geo-title">🌍 Geo mapping — application field → source column</span>
                            <button
                              className="btn btn-sm"
                              disabled={busy || geoBusy[a.id]}
                              onClick={() => void checkGeo(a.id, mapping)}
                            >
                              {geo[a.id] ? '⟳ Re-check location matches' : 'Check location matches'}
                            </button>
                          </div>
                          <table className="geo-table">
                            <thead>
                              <tr>
                                <th>Application field</th>
                                <th>Source column</th>
                                <th>Distinct values</th>
                                <th>Matched / unmatched</th>
                                <th>Unmatched values</th>
                              </tr>
                            </thead>
                            <tbody>
                              {GEO_FIELDS.map((f) => {
                                const st = geo[a.id]?.fields.find((x) => x.field === f)
                                return (
                                  <tr key={f}>
                                    <td className="geo-field">{geoFieldLabel(f)}</td>
                                    <td>
                                      <select
                                        className="sel"
                                        value={columnFor(mapping, f)}
                                        onChange={(e) => changeFieldColumn(a.id, f, e.target.value)}
                                      >
                                        <option value="">— unmapped —</option>
                                        {a.header.map((h) => (
                                          <option key={h} value={h}>
                                            {h}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                    <td className="geo-num">{st ? st.distinct : '—'}</td>
                                    <td className="geo-num">
                                      {st
                                        ? `${st.matched} / ${st.unmatched}`
                                        : '—'}
                                    </td>
                                    <td className="geo-um">
                                      {st && st.topUnmatched.length > 0
                                        ? st.topUnmatched.map((v) => {
                                            const sugg = st.suggestions?.[v]
                                            const applied = mapping.valueAliases?.[f]?.[v]
                                            return (
                                              <span key={v} className="chip">
                                                {v}
                                                {applied ? (
                                                  <span className="chip-sugg applied" title="Will be remapped to the existing dimension on import">
                                                    → {applied} ✓
                                                  </span>
                                                ) : sugg ? (
                                                  <span className="chip-sugg" title="Closest existing dimension name — apply to remap on import">
                                                    → {sugg}
                                                    <button
                                                      className="btn btn-xs"
                                                      disabled={busy || geoBusy[a.id]}
                                                      onClick={() => applySuggestion(a.id, f, v, sugg)}
                                                    >
                                                      Apply
                                                    </button>
                                                  </span>
                                                ) : null}
                                              </span>
                                            )
                                          })
                                        : st
                                          ? <span className="card-note">all matched</span>
                                          : '—'}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                          {geo[a.id] && (
                            <p className="card-note">
                              Checked {(geo[a.id] as GeoStatsResult).totalRows} source rows against the workspace
                              dimension tables — unmatched values are shown so nothing is
                              silently dropped.
                            </p>
                          )}
                        </div>
                        {prev && <IssueList issues={prev.issues} />}
                        {prev && prev.rows.length > 0 && (
                          <div className="preview">
                            <div className="preview-title">Preview (first rows)</div>
                            <div className="preview-scroll">
                              <table className="preview-table">
                                <thead>
                                  <tr>
                                    {FIELD_ORDER.filter(
                                      (f) => f === 'date' || Object.values(mapping.columns).includes(f)
                                    ).map((f) => (
                                      <th key={f}>{FIELD_LABELS[f]}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {prev.rows.slice(0, 6).map((r, i) => (
                                    <tr key={i}>
                                      {FIELD_ORDER.filter(
                                        (f) => f === 'date' || Object.values(mapping.columns).includes(f)
                                      ).map((f) => (
                                        <td key={f}>{r[f] ?? '—'}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        <div className="row-actions">
                          <button className="btn" disabled={busy} onClick={() => void preview(a.id, mapping)}>
                            Validate &amp; Preview
                          </button>
                          {/\.(xlsx|xls)$/i.test(a.path) && (
                            <button className="btn" disabled={busy} onClick={() => void exportAsCsv(a)}>
                              Export as CSV…
                            </button>
                          )}
                        </div>
                        {exportMsg[a.id] && <p className="card-note export-ok">✓ {exportMsg[a.id]}</p>}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {analyses.length > 0 && (
            <div className="row-actions import-actions">
              <button className="btn btn-primary" disabled={busy || !canRun} onClick={() => void run()}>
                Import selected files
              </button>
              <button className="btn" disabled={busy} onClick={() => setAnalyses([])}>
                Clear
              </button>
            </div>
          )}

          {result && (
            <div className="card result-card">
              <h3>Import complete</h3>
              <div className="kpi-strip">
                <div className="kpi">
                  <div className="kpi-value">{result.insertedRows.toLocaleString()}</div>
                  <div className="kpi-label">Inserted rows</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{result.duplicatesIgnored.toLocaleString()}</div>
                  <div className="kpi-label">Duplicates ignored</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{result.rejectedRows.toLocaleString()}</div>
                  <div className="kpi-label">Rejected rows</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{result.newCells}</div>
                  <div className="kpi-label">New cells</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{result.qualityScore}</div>
                  <div className="kpi-label">Quality score</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{(result.durationMs / 1000).toFixed(1)}s</div>
                  <div className="kpi-label">Duration</div>
                </div>
              </div>
              <p className="card-note">
                Backup: <code>{result.backupPath ?? '—'}</code> · Audit id #{result.importId}
                {result.archivePath && (
                  <>
                    {' '}· Raw source archived (<code>{result.archivePath}</code>, kept 90 days
                    {result.retentionUntil ? ` until ${new Date(result.retentionUntil).toLocaleDateString()}` : ''})
                  </>
                )}
              </p>
              {result.issues.filter((i) => i.severity !== 'info').length > 0 && (
                <IssueList issues={result.issues.filter((i) => i.severity !== 'info')} />
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'coverage' && (
        <div className="card">
          <h3>Daily coverage</h3>
          {coverage.length === 0 ? (
            <p className="card-note">No coverage data yet — import some data first.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Observed cells</th>
                  <th>Expected cells</th>
                  <th>Coverage %</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((c) => (
                  <tr key={c.date}>
                    <td>{c.date}</td>
                    <td>{c.observedCells.toLocaleString()}</td>
                    <td>{c.expectedCells.toLocaleString()}</td>
                    <td>{c.coveragePct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="card">
          <h3>Import audit</h3>
          {audit.length === 0 ? (
            <p className="card-note">No imports recorded yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>When</th>
                  <th>File</th>
                  <th>Source</th>
                  <th>Inserted</th>
                  <th>Duplicates</th>
                  <th>Rejected</th>
                  <th>Ruleset</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.importId}>
                    <td>{a.importId}</td>
                    <td>{a.importedAt}</td>
                    <td className="audit-file">{a.files}</td>
                    <td>{a.sourceRows.toLocaleString()}</td>
                    <td>{a.insertedRows.toLocaleString()}</td>
                    <td>{a.duplicatesIgnored.toLocaleString()}</td>
                    <td>{a.rejectedRows.toLocaleString()}</td>
                    <td>{a.rulesetVersion != null ? `v${a.rulesetVersion}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'quality' && (
        <div className="card">
          <h3>Data quality scores</h3>
          {quality.length === 0 ? (
            <p className="card-note">No quality scores yet — import some data first.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Coverage %</th>
                  <th>KPI completeness %</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {quality.map((q) => (
                  <tr key={q.date}>
                    <td>{q.date}</td>
                    <td>{q.coveragePct.toFixed(1)}%</td>
                    <td>{q.completenessPct.toFixed(1)}%</td>
                    <td>{q.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'maintenance' && (
        <div>
          {sched && schedDraft && !readOnly && (
            <div className="card">
              <div className="file-head">
                <h3>Scheduled maintenance (spec §58)</h3>
                <button
                  className="btn"
                  disabled={schedBusy || !schedDraft.enabled}
                  onClick={() => void runScheduledNow()}
                >
                  {schedBusy ? 'Running…' : '⚡ Run now'}
                </button>
              </div>
              <p className="card-note">
                Runs the selected actions automatically on a cadence while the app is open —
                integrity checks and raw-archive purges keep the workspace healthy without
                manual attention. Every scheduled run is written to the audit trail.
              </p>
              <div className="kpi-strip">
                <div className="kpi">
                  <div className="kpi-value">
                    <span className={`badge ${sched.enabled ? 'badge-ok' : 'badge-ro'}`}>
                      {sched.enabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </div>
                  <div className="kpi-label">Scheduler</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">
                    {sched.nextRunAt ? new Date(sched.nextRunAt).toLocaleString() : '—'}
                  </div>
                  <div className="kpi-label">Next scheduled run</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">
                    {sched.lastRunAt
                      ? `${new Date(sched.lastRunAt).toLocaleString()}${sched.lastOk != null ? ` · ${sched.lastOk ? 'passed' : 'FAILED'}` : ''}`
                      : 'never'}
                  </div>
                  <div className="kpi-label">Last run</div>
                </div>
              </div>

              <div className="sched-row">
                <label className="sched-field">
                  <span>Enabled</span>
                  <button
                    className={`btn ${schedDraft.enabled ? 'btn-primary' : ''}`}
                    onClick={() => setSchedDraft({ ...schedDraft, enabled: !schedDraft.enabled })}
                  >
                    {schedDraft.enabled ? 'On' : 'Off'}
                  </button>
                </label>
                <label className="sched-field">
                  <span>Cadence</span>
                  <select
                    className="sched-select"
                    value={schedDraft.cadenceHours}
                    onChange={(e) => setSchedDraft({ ...schedDraft, cadenceHours: Number(e.target.value) })}
                  >
                    {CADENCE_OPTIONS.map((o) => (
                      <option key={o.hours} value={o.hours}>{o.label}</option>
                    ))}
                  </select>
                </label>
                <label className="sched-field sched-actions">
                  <span>Actions</span>
                  <span className="sched-checks">
                    {SCHED_ACTIONS.map((a) => (
                      <label key={a.id} className="sched-check">
                        <input
                          type="checkbox"
                          checked={schedDraft.actions.includes(a.id)}
                          onChange={(e) => {
                            const actions = e.target.checked
                              ? [...schedDraft.actions, a.id]
                              : schedDraft.actions.filter((x) => x !== a.id)
                            setSchedDraft({ ...schedDraft, actions })
                          }}
                        />
                        {a.label}
                      </label>
                    ))}
                  </span>
                </label>
                <label className="sched-field">
                  <span>Run on open</span>
                  <button
                    className={`btn ${schedDraft.runOnOpen ? 'btn-primary' : ''}`}
                    onClick={() => setSchedDraft({ ...schedDraft, runOnOpen: !schedDraft.runOnOpen })}
                  >
                    {schedDraft.runOnOpen ? 'Yes' : 'No'}
                  </button>
                </label>
              </div>
              <div className="file-head sched-save">
                <button
                  className="btn btn-primary"
                  disabled={schedBusy}
                  onClick={() => void saveSchedule()}
                >
                  {schedBusy ? 'Saving…' : 'Save schedule'}
                </button>
                <span className="card-note">
                  {schedDraft.enabled && schedDraft.actions.length === 0
                    ? 'Pick at least one action.'
                    : sched.enabled !== schedDraft.enabled ||
                      sched.cadenceHours !== schedDraft.cadenceHours ||
                      sched.runOnOpen !== schedDraft.runOnOpen ||
                      sched.actions.join(',') !== schedDraft.actions.join(',')
                      ? 'Unsaved changes.'
                      : ''}
                </span>
              </div>

              {schedHistory.length > 0 && (
                <div className="maint-log">
                  <b>Scheduled run history</b>
                  {schedHistory.map((r) => (
                    <div key={r.runId} className={`maint-entry${r.ok ? '' : ' err'}`}>
                      <div className="maint-entry-head">
                        <span className={`badge ${r.ok ? 'badge-ok' : 'badge-ro'}`}>{r.ok ? 'OK' : 'FAILED'}</span>
                        <b>{r.actions.join(' + ')}</b>
                        <span className="card-note">
                          {new Date(r.ranAt).toLocaleString()} · {(r.durationMs / 1000).toFixed(1)}s
                        </span>
                      </div>
                      <div className="maint-entry-msg">{r.summary}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card">
            <h3>Workspace maintenance (spec §58)</h3>
            <p className="card-note">
              State-altering actions (rebuild, compact) write a pre-action backup to{' '}
              <code>backups/</code> first. The workspace stays open — verify integrity and
              storage analysis are read-only.
            </p>
            {readOnly && <div className="notice">This workspace is read-only — only Verify integrity and Analyze storage are available.</div>}
            <div className="maint-grid">
              {MAINT_ACTIONS.map((a) => (
                <div key={a.id} className={`maint-action${maintAction === a.id ? ' busy' : ''}`}>
                  <div className="maint-label">
                    <b>{a.label}</b>
                    <span className="card-note">{a.hint}</span>
                  </div>
                  <button
                    className="btn"
                    disabled={maintAction !== null || (readOnly && !a.readOnly)}
                    onClick={() => void runMaint(a.id)}
                  >
                    {maintAction === a.id ? 'Running…' : 'Run'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {maintLog.length > 0 && (
            <div className="card">
              <h3>Maintenance log</h3>
              <div className="maint-log">
                {maintLog.map((m, i) => (
                  <div key={i} className={`maint-entry${m.ok ? '' : ' err'}`}>
                    <div className="maint-entry-head">
                      <span className={`badge ${m.ok ? 'badge-ok' : 'badge-ro'}`}>{m.ok ? 'OK' : 'FAILED'}</span>
                      <b>{m.action}</b>
                      <span className="card-note">
                        {new Date(m.startedAt).toLocaleTimeString()} · {(m.durationMs / 1000).toFixed(1)}s
                      </span>
                    </div>
                    <div className="maint-entry-msg">{m.message}</div>
                    {m.action === 'storage' && m.ok && m.detail != null && (
                      <StorageTable detail={m.detail as { fileSize: number; walSize: number; tables: Array<{ table: string; rows: number }> }} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'archive' && (
        <div>
          <div className="card">
            <div className="file-head">
              <h3>Raw-source archive (spec §9)</h3>
              {!readOnly && (
                <button
                  className="btn"
                  disabled={busy || archiveBusy || archive.status.expired === 0}
                  onClick={() => void purgeExpired()}
                >
                  {archiveBusy ? 'Purging…' : `Purge expired (${archive.status.expired})`}
                </button>
              )}
            </div>
            <p className="card-note">
              Every imported raw data file (CSV / Excel) is gzip-archived beside the workspace and kept for{' '}
              <b>90 days</b>. After that the raw copy is purged automatically on open — processed
              data, filenames, checksums and import metadata always remain.
            </p>
            {archive.rows.length === 0 ? (
              <p className="card-note">No archived sources yet — import some data first.</p>
            ) : (
              <div className="kpi-strip">
                <div className="kpi">
                  <div className="kpi-value">{archive.status.total}</div>
                  <div className="kpi-label">Archived files</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{fmtBytes(archive.status.totalBytes)}</div>
                  <div className="kpi-label">Archived size</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{archive.status.retained}</div>
                  <div className="kpi-label">Retained</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{archive.status.expiring}</div>
                  <div className="kpi-label">Expiring ≤ 7d</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{archive.status.expired}</div>
                  <div className="kpi-label">Expired</div>
                </div>
              </div>
            )}
          </div>
          {archive.rows.length > 0 && (
            <div className="card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Imported</th>
                    <th>Size</th>
                    <th>Checksum</th>
                    <th>Retention until</th>
                    <th>Days left</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {archive.rows.map((a) => (
                    <tr key={a.archiveId}>
                      <td className="audit-file">{a.filename}</td>
                      <td>{new Date(a.importedAt).toLocaleString()}</td>
                      <td>{fmtBytes(a.sizeBytes)}</td>
                      <td className="audit-file">{a.checksum.slice(0, 10)}…</td>
                      <td>{new Date(a.retentionUntil).toLocaleDateString()}</td>
                      <td>{a.daysLeft < 0 ? 'expired' : a.daysLeft}</td>
                      <td>
                        <span
                          className={`badge ${
                            a.status === 'retained'
                              ? 'badge-ok'
                              : a.status === 'expiring'
                                ? 'badge-warn'
                                : 'badge-ro'
                          }`}
                        >
                          {a.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <SheetSelectorModal
        fileName={excelModalFile}
        sheets={excelSheets}
        isOpen={excelModalOpen}
        onClose={() => setExcelModalOpen(false)}
        onConfirm={() => {
          setExcelModalOpen(false)
          void analyze([excelModalFile])
        }}
      />
    </div>
  )
}

function StorageTable({ detail }: {
  detail: { fileSize: number; walSize: number; tables: Array<{ table: string; rows: number }> }
}): React.JSX.Element {
  return (
    <div className="maint-storage">
      <div className="kpi-strip">
        <div className="kpi">
          <div className="kpi-value">{(detail.fileSize / 1024 / 1024).toFixed(1)} MB</div>
          <div className="kpi-label">Workspace file</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{detail.walSize > 0 ? `${(detail.walSize / 1024 / 1024).toFixed(2)} MB` : '—'}</div>
          <div className="kpi-label">WAL pending</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{detail.tables.length}</div>
          <div className="kpi-label">Tables</div>
        </div>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Table</th>
            <th>Rows</th>
          </tr>
        </thead>
        <tbody>
          {detail.tables.slice(0, 20).map((t) => (
            <tr key={t.table}>
              <td className="audit-file">{t.table}</td>
              <td>{t.rows.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

