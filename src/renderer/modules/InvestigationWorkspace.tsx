import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { useAppStore, on } from '../store'
import type {
  ActionStatus, EntityOption, InvestigationReport, InvestigationResult,
  InvestigationScope, Severity, Lifecycle, Technology
} from '../../../shared/api'
import Chart from '../lib/Chart'
import { investigationChartOption } from '../lib/investigationCharts'
import { formatTimeLabel } from '../lib/overviewCharts'

const SCOPES: Array<{ id: InvestigationScope; label: string }> = [
  { id: 'cell', label: 'Cell' },
  { id: 'site', label: 'Site' },
  { id: 'district', label: 'District' }
]

const STATUSES: ActionStatus[] = [
  'Unreviewed',
  'Investigating',
  'Escalated',
  'Optimization in progress',
  'Monitoring',
  'Resolved',
  'Deferred'
]

const TECH_CHECKLISTS: Record<Technology, string[]> = {
  '4G': [
    'Confirm 4G DL PRB utilization breach days & peak hour load',
    'Review 4G DL user throughput against the 10.0 Mbps benchmark',
    'Audit Random Access / PRACH root sequence indices for preamble collisions',
    'Inspect MIMO antenna electrical/mechanical down-tilts and VSWR feeder alarms',
    'Compare against co-located site sibling sectors (peer check)',
    'Verify S1-U / X2 backhaul latency, packet loss, and buffer utilization',
    'Mark the intervention week once physical or parameter changes are applied'
  ],
  '3G': [
    'Confirm 3G DL Power Congestion and UL CE Congestion event counts',
    'Audit Physical Channel (PhyCh) setup failures and Radio Link Sync Loss abnormal drops',
    'Inspect 3G Call Setup Success (CSSR) and Data Access Success (DASR)',
    'Check Scrambling Code (PSC) reuse distance and neighbor clashes',
    'Verify Iub transmission link capacity and NodeB credit congestion',
    'Compare against co-located 3G carrier siblings on the same NodeB',
    'Mark the intervention week once RF optimization is committed'
  ],
  '2G': [
    'Confirm 2G TCH Congestion (%) and SDCCH signalling congestion rates',
    'Audit Frequency Plan & BCCH/TCH co-channel / adjacent channel interference',
    'Inspect 2G TCH Call Drop Rate (%) and Handover Success Rate (HOSR)',
    'Check TRX hardware faults, combiner loss, and VSWR return-loss alarms',
    'Review Handover Hysteresis, Power Control, and PBGT threshold parameters',
    'Compare against co-located 2G sectors on the same BTS site',
    'Mark the intervention week once frequency or antenna retuning is completed'
  ]
}

function Chip({ text, tone }: { text: string; tone?: 'ok' | 'warn' | 'bad' | 'dim' }): React.JSX.Element {
  return <span className={`chip chip-${tone ?? 'dim'}`}>{text}</span>
}

const PHRASE_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'dim'> = {
  'evidence supports': 'ok',
  'consistent with': 'ok',
  suggests: 'warn',
  'evidence contradicts': 'bad'
}

const VERDICT_TONE: Record<string, 'ok' | 'warn' | 'bad'> = {
  consistent: 'bad',
  suggests: 'warn',
  'not supported': 'ok'
}

const EVENT_LABEL: Record<string, string> = {
  user_note: '📝 Note',
  status_change: '🚦 Status change',
  classification_change: '🏷️ Classification',
  priority_change: '🎯 Priority',
  ruleset_change: '⚙️ Ruleset'
}

function fmtV(v: number | null, unit: string): string {
  if (v == null) return '—'
  if (unit === 'kbps') return `${(v / 1024).toFixed(1)} Mbps`
  if (unit === 'Mbps') return `${v.toFixed(1)} Mbps`
  if (unit === 'Erl') return `${v.toFixed(1)} Erl`
  if (unit === 'MB') return `${(v / 1024).toFixed(1)} GB`
  if (unit === '%' || unit === 'pp') return `${v.toFixed(1)}%`
  return Math.round(v).toLocaleString()
}

export default function InvestigationWorkspace(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const grain = useAppStore((s) => s.grain)
  const period = useAppStore((s) => s.period)
  const target = useAppStore((s) => s.investigationTarget)
  const setTarget = useAppStore((s) => s.setInvestigationTarget)
  const [tech, setTech] = useState<Technology>(workspace?.technology ?? '4G')
  const [scope, setScope] = useState<InvestigationScope>('cell')
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<EntityOption[]>([])
  const [selected, setSelected] = useState<EntityOption | null>(null)
  const [result, setResult] = useState<InvestigationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prbThreshold, setPrbThreshold] = useState(80)
  const [intervention, setIntervention] = useState('')
  const [statusDraft, setStatusDraft] = useState({ status: '', owner: '', externalTicket: '', targetReviewDate: '' })
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const [report, setReport] = useState<InvestigationReport | null>(null)
  const [copied, setCopied] = useState(false)
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState<'evidence' | 'rca' | 'peers' | 'workflow'>('evidence')

  // Dropdown overlay state: closed by default
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (workspace?.technology) {
      setTech(workspace.technology)
    }
  }, [workspace?.technology])

  const load = useCallback(
    async (ent: EntityOption | null, iv: string, scopeOverride?: InvestigationScope, techOverride?: Technology): Promise<void> => {
      if (!ent) {
        setResult(null)
        return
      }
      const s = scopeOverride ?? scope
      const activeTech = techOverride ?? tech
      setLoading(true)
      setError(null)
      try {
        const r = await window.api.investigation.get(s, ent.id, {
          interventionWeek: iv || undefined,
          grain,
          period,
          technology: activeTech
        })
        setResult(r)
        if (r) {
          setIntervention(r.interventionWeek ?? '')
          setStatusDraft({
            status: r.status.status ?? '',
            owner: r.status.owner ?? '',
            externalTicket: r.status.externalTicket ?? '',
            targetReviewDate: r.status.targetReviewDate ?? ''
          })
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [scope, grain, period, tech]
  )

  // Listen to outside clicks and Escape key to close the dropdown popover
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  // Auto-focus search input when dropdown opens
  useEffect(() => {
    if (dropdownOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }, [dropdownOpen])

  // Close dropdown on technology or ruleset change
  useEffect(() => {
    setDropdownOpen(false)
  }, [tech, workspace?.path])

  useEffect(() => {
    const off = on('WORKSPACE_CHANGED', () => setDropdownOpen(false))
    return () => off()
  }, [])

  // Entity search (debounced)
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      void (async () => {
        try {
          const opts = await window.api.investigation.search(scope, query.trim() || undefined, tech)
          setOptions(opts)

          // Default auto-selection: if no entity is currently selected, immediately pick the top/highest priority entity
          if (!selected && opts.length > 0 && !target) {
            const top = opts[0]
            setSelected(top)
            void load(top, '', undefined, tech)
          }
        } catch {
          setOptions([])
        }
      })()
    }, query === '' ? 0 : 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [scope, query, selected, target, load, tech])

  // Load rules threshold
  useEffect(() => {
    void (async () => {
      try {
        const rules = await window.api.rules.get()
        if (rules) setPrbThreshold(rules.prbThresholdPct)
      } catch {
        /* keep default */
      }
    })()
  }, [workspace?.path])

  // Cross-module navigation target (e.g. from Overview or Priority Center)
  useEffect(() => {
    if (!target) return
    const ent: EntityOption = { id: target.id, name: target.name, path: target.path }
    setScope(target.scope)
    setQuery('')
    setDropdownOpen(false)
    setSelected(ent)
    void load(ent, '', target.scope, tech)
    setTarget(null)
  }, [target, load, setTarget, tech])

  const chartOption: EChartsOption | null = useMemo(
    () => (result && result.weeks.length > 0 ? investigationChartOption(result, prbThreshold, grain, tech) : null),
    [result, prbThreshold, grain, tech]
  )

  const activeChecklist = TECH_CHECKLISTS[tech] ?? TECH_CHECKLISTS['4G']

  async function pick(ent: EntityOption): Promise<void> {
    setQuery('')
    setDropdownOpen(false)
    setSelected(ent)
    await load(ent, '')
  }

  async function saveStatus(): Promise<void> {
    if (!selected) return
    setSaving(true)
    try {
      await window.api.investigation.setStatus(scope, selected.id, {
        status: (statusDraft.status || null) as ActionStatus | null,
        owner: statusDraft.owner || null,
        externalTicket: statusDraft.externalTicket || null,
        targetReviewDate: statusDraft.targetReviewDate || null
      })
      await load(selected, intervention)
    } finally {
      setSaving(false)
    }
  }

  async function addNote(): Promise<void> {
    if (!selected || !note.trim()) return
    await window.api.investigation.addNote(scope, selected.id, note.trim())
    setNote('')
    await load(selected, intervention)
  }

  async function exportReport(): Promise<void> {
    if (!selected) return
    const rep = await window.api.investigation.exportReport(scope, selected.id)
    if (rep) setReport(rep)
  }

  // Find top hypothesis issue label if available
  const topHypothesis = result?.hypotheses && result.hypotheses.length > 0 ? result.hypotheses[0] : null
  const topIssueName = topHypothesis ? topHypothesis.title : result?.current?.lifecycle

  // Counts of detected issues for summary banner
  const criticalCount = options.filter((o) => o.severity === 'Critical').length
  const highCount = options.filter((o) => o.severity === 'High').length
  const persistentCount = options.filter((o) => o.lifecycle === 'Persistent NC' || o.lifecycle === 'Chronic NC').length

  return (
    <div className="module">
      {/* Module Header */}
      <div className="module-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2>Investigation Workspace</h2>
          <div className="seg">
            {(['4G', '3G', '2G'] as Technology[]).map((t) => (
              <button
                key={t}
                className={`seg-btn${tech === t ? ' active' : ''}`}
                onClick={() => {
                  setTech(t)
                  if (selected) void load(selected, intervention, undefined, t)
                }}
              >
                {t === '4G' ? '4G LTE' : t === '3G' ? '3G UMTS' : '2G GSM'}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="module-workspace">{workspace?.name}</span>
          {selected && <span className="module-workspace">{selected.path.join(' › ')}</span>}
        </div>
      </div>

      {/* Compact Entity Picker & Non-Intrusive Searchable Selector */}
      <div className="inv-picker">
        <div className="seg">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              className={`seg-btn${scope === s.id ? ' active' : ''}`}
              onClick={() => {
                setScope(s.id)
                setSelected(null)
                setResult(null)
                setQuery('')
                setDropdownOpen(false)
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Compact Dropdown Control (Only opens on click) */}
        <div className="inv-selector-container" ref={dropdownRef}>
          <button
            type="button"
            className="inv-selector-btn"
            onClick={() => setDropdownOpen((prev) => !prev)}
            aria-expanded={dropdownOpen}
          >
            <span className="inv-selector-text">
              {selected ? (
                <>
                  <span style={{ color: 'var(--text-dim)', fontSize: '11px', marginRight: '4px' }}>[{scope.toUpperCase()}]</span>
                  <span style={{ fontWeight: 700 }}>{selected.name}</span>
                  {selected.path.length > 1 && (
                    <span style={{ color: 'var(--text-dim)', fontSize: '11.5px', marginLeft: '6px' }}>
                      ({selected.path.slice(0, -1).join(' › ')})
                    </span>
                  )}
                  {selected.severity && (
                    <span
                      className={`badge badge-sev-${selected.severity.toLowerCase()}`}
                      style={{ marginLeft: '8px', fontSize: '10px', padding: '1px 5px' }}
                    >
                      {selected.severity}
                    </span>
                  )}
                </>
              ) : (
                <span style={{ color: 'var(--text-dim)' }}>Select {scope} to investigate…</span>
              )}
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>{dropdownOpen ? '▲' : '▼'}</span>
          </button>

          {/* Floating Dropdown Popover */}
          {dropdownOpen && (
            <div className="inv-dropdown-popover">
              <div className="inv-dropdown-search-wrap">
                <input
                  ref={searchInputRef}
                  className="input inv-dropdown-search-input"
                  placeholder={`Search ${scope}s, site, district, KPI or issue…`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="inv-dropdown-list">
                {options.length === 0 ? (
                  <div className="inv-dropdown-empty">No matching {scope}s found</div>
                ) : (
                  options.map((o) => {
                    const isCur = selected?.id === o.id
                    return (
                      <button
                        key={`${scope}-${o.id}`}
                        type="button"
                        className={`inv-option-item${isCur ? ' active' : ''}`}
                        onClick={() => void pick(o)}
                      >
                        <div className="inv-option-main">
                          <span className="inv-option-name">{o.name}</span>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            {o.score != null && o.score > 0 && (
                              <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600 }}>
                                Prio {Math.round(o.score)}
                              </span>
                            )}
                            {o.severity && (
                              <span
                                className={`badge badge-sev-${o.severity.toLowerCase()}`}
                                style={{ fontSize: '10px', padding: '1px 5px' }}
                              >
                                {o.severity}
                              </span>
                            )}
                            {o.lifecycle && (
                              <span className="badge" style={{ fontSize: '10px', padding: '1px 5px' }}>
                                {o.lifecycle}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="inv-option-sub">
                          {o.path.join(' › ')}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <button className="btn btn-ghost" disabled={!selected} onClick={() => void exportReport()}>
          Export Report
        </button>
      </div>

      {/* Detected Issues Summary Banner */}
      {options.length > 0 && (
        <div className="detected-issues-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: 'var(--text)' }}>
              Detected Issues ({options.length} {scope}s):
            </span>
            {criticalCount > 0 && (
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                🚨 {criticalCount} Critical Severity
              </span>
            )}
            {highCount > 0 && (
              <span style={{ color: 'var(--amber, #f59e0b)', fontWeight: 600 }}>
                ⚠️ {highCount} High Severity
              </span>
            )}
            {persistentCount > 0 && (
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
                🔥 {persistentCount} Persistent NC
              </span>
            )}
            {criticalCount === 0 && highCount === 0 && persistentCount === 0 && (
              <span style={{ color: 'var(--text-dim)' }}>All observed {scope}s operational</span>
            )}
          </div>
          {selected && (
            <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
              Active: <b>{selected.name}</b>
            </span>
          )}
        </div>
      )}

      {error && <div className="notice notice-error">{error}</div>}

      {/* Clean Empty State when no investigations exist */}
      {!selected && !loading && !error && (
        <div className="inv-empty-state">
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔍</div>
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>No Active Investigation</h3>
          <p style={{ color: 'var(--text-dim)', fontSize: '13px', maxWidth: '480px', margin: '0 auto 16px auto' }}>
            No significant issue matching the current investigation rules was detected.
          </p>
          <div style={{ background: 'var(--bg-2)', borderRadius: '6px', padding: '14px 18px', maxWidth: '440px', margin: '0 auto', textAlign: 'left', fontSize: '12px', color: 'var(--text-dim)' }}>
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>Try:</div>
            <ul style={{ margin: 0, paddingLeft: '18px', lineHeight: 1.6 }}>
              <li>Changing the network technology toggle</li>
              <li>Expanding the date range or grain in the command bar</li>
              <li>Reviewing extra KPIs in Data Manager</li>
              <li>Adjusting investigation thresholds in the Targets panel</li>
            </ul>
          </div>
        </div>
      )}

      {selected && loading && !result && <div className="notice">Loading investigation…</div>}

      {/* Executive Hero Banner */}
      {result && (
        <>
          <div className="inv-hero-card">
            <div className="inv-hero-main">
              <div className="inv-hero-title-row">
                <span style={{ color: 'var(--accent)', fontSize: '13px', fontWeight: 700 }}>
                  [{scope.toUpperCase()}]
                </span>
                <span className="inv-hero-name">{selected?.name ?? result.scope}</span>
                {selected?.path && <span className="inv-hero-path">{selected.path.join(' › ')}</span>}
              </div>

              <div className="inv-hero-badges">
                {result.current && (
                  <>
                    <Chip
                      text={`Lifecycle: ${result.current.lifecycle ?? '—'}`}
                      tone={result.current.lifecycle === 'Persistent NC' ? 'bad' : result.current.lifecycle === 'Recurring NC' ? 'warn' : result.current.lifecycle === 'New NC' ? 'ok' : 'dim'}
                    />
                    <Chip
                      text={`Trend: ${result.current.trend ?? '—'}`}
                      tone={result.current.trend === 'Worsening' ? 'bad' : result.current.trend === 'Improving' ? 'ok' : 'dim'}
                    />
                    <Chip
                      text={`Severity: ${result.current.severity ?? '—'}`}
                      tone={result.current.severity === 'Critical' ? 'bad' : result.current.severity === 'High' ? 'warn' : 'dim'}
                    />
                    {result.current.priorityScore != null && (
                      <span
                        className="badge"
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          background: result.current.priorityScore >= 75 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(251, 191, 36, 0.15)',
                          color: result.current.priorityScore >= 75 ? '#f87171' : '#fbbf24',
                          border: '1px solid currentColor'
                        }}
                      >
                        Priority {result.current.priorityScore} · {result.current.priorityBand}
                      </span>
                    )}
                    {result.current.isNc && <Chip text="NC Active" tone="bad" />}
                    <span className="inv-week">
                      As of {result.current.weekStart} ({formatTimeLabel(result.current.weekStart, grain)})
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Top Right Diagnosis Verdict Hero */}
            <div className="inv-verdict-box">
              <div>
                <div className="inv-verdict-head">
                  <span>Deterministic RCA Verdict</span>
                  {topHypothesis && (
                    <span style={{ color: '#38bdf8' }}>Score {topHypothesis.score}/100</span>
                  )}
                </div>
                <div className="inv-verdict-title">
                  {topIssueName ?? 'Operational Parameter Normal'}
                </div>
                {topHypothesis && (
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
                    Verdict: <b style={{ color: topHypothesis.verdict === 'consistent' ? '#f87171' : '#38bdf8' }}>{topHypothesis.verdict}</b>
                    {' · '}{topHypothesis.supporting.length} supporting indicator(s)
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                  Status: <b style={{ color: 'var(--text)' }}>{result.status.status ?? 'Unreviewed'}</b>
                  {result.status.owner && <span> · Owner: <b>{result.status.owner}</b></span>}
                </span>
                <button
                  className="btn btn-sm btn-primary"
                  style={{ fontSize: '11px', padding: '3px 10px' }}
                  onClick={() => void exportReport()}
                >
                  📄 Export Report
                </button>
              </div>
            </div>
          </div>

          {/* Tabbed Investigation Workbench Bar */}
          <div className="inv-tab-bar">
            <button
              className={`inv-tab-btn${activeTab === 'evidence' ? ' active' : ''}`}
              onClick={() => setActiveTab('evidence')}
            >
              📊 Telemetry &amp; Evidence Matrix
            </button>
            <button
              className={`inv-tab-btn${activeTab === 'rca' ? ' active' : ''}`}
              onClick={() => setActiveTab('rca')}
            >
              🧠 Root Cause &amp; Hypotheses ({result.hypotheses.length})
            </button>
            <button
              className={`inv-tab-btn${activeTab === 'peers' ? ' active' : ''}`}
              onClick={() => setActiveTab('peers')}
            >
              👥 Sibling &amp; Peer Comparison ({result.peers.length})
            </button>
            <button
              className={`inv-tab-btn${activeTab === 'workflow' ? ' active' : ''}`}
              onClick={() => setActiveTab('workflow')}
            >
              📋 Workflow &amp; Audit Log ({result.events.length})
            </button>
          </div>

          {/* TAB 1: Telemetry & KPI Evidence */}
          {activeTab === 'evidence' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* KPI Evidence Strip */}
              <div className="card">
                <div className="card-head-row">
                  <h3>KPI Evidence — Latest Period vs Previous</h3>
                  <span className="card-note">{result.scope} scope · {result.path.length} level rollup</span>
                </div>
                <div className="kpi-strip">
                  {result.evidence.map((e) => {
                    const better = e.delta == null ? null : e.worseIsHigher ? e.delta < 0 : e.delta > 0
                    const tone = better === null ? '' : better ? 'kpi-delta-good' : 'kpi-delta-bad'
                    const arrow = e.delta == null ? '' : e.delta >= 0 ? '▲' : '▼'
                    return (
                      <div key={e.metric} className="kpi cmp-kpi" title={e.label}>
                        <div className="kpi-value">{fmtV(e.current, e.unit)}</div>
                        <div className="kpi-label">{e.label}</div>
                        <div className="cmp-kpi-sub">
                          <span className="cmp-kpi-prev">was {fmtV(e.previous, e.unit)}</span>
                          {e.delta != null && (
                            <span className={`cmp-kpi-delta ${tone}`}>
                              {arrow} {fmtV(e.delta, e.unit)}
                              {e.deltaPct != null ? ` (${e.deltaPct >= 0 ? '+' : ''}${e.deltaPct}%)` : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Actual Metrics Chart */}
              <div className="card">
                <div className="card-head-row">
                  <h3>Actual Telemetry Metrics — Period History</h3>
                  <span className="card-note">
                    {tech === '4G'
                      ? `PRB threshold ${prbThreshold}%`
                      : tech === '3G'
                      ? 'CSSR threshold 95.0% · DASR threshold 98.0%'
                      : 'TCH Congestion threshold 2.0%'} · Intervention point marked
                  </span>
                </div>
                <Chart option={chartOption} height={500} />
                {result.weeks.length > 0 && (
                  <div className="week-strip">
                    {result.weeks.map((w) => (
                      <span
                        key={w.weekStart}
                        className={`week-cell${w.isNc ? ' week-nc' : ''}`}
                        title={`${w.weekStart}: ${w.lifecycle ?? 'OK'}`}
                      >
                        {w.isNc ? (w.lifecycle === 'Persistent NC' ? 'P' : w.lifecycle === 'Recurring NC' ? 'R' : 'N') : '·'}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Before / After Analysis */}
              <div className="card">
                <div className="card-head-row">
                  <h3>Intervention Impact (Before vs After)</h3>
                  <label className="inv-iv-label">
                    Intervention period:{' '}
                    <select
                      className="sel"
                      value={intervention}
                      onChange={(e) => {
                        setIntervention(e.target.value)
                        void load(selected, e.target.value)
                      }}
                    >
                      {result.weeks.map((w) => (
                        <option key={w.weekStart} value={w.weekStart}>
                          {w.weekStart} ({formatTimeLabel(w.weekStart, grain)})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="preview-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>Before Intervention</th>
                        <th>After Intervention</th>
                        <th>Δ Change %</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.beforeAfter.map((b) => (
                        <tr key={b.metric}>
                          <td><b>{b.label}</b></td>
                          <td>{fmtV(b.before, b.unit)}</td>
                          <td>{fmtV(b.after, b.unit)}</td>
                          <td>{b.deltaPct == null ? '—' : `${b.deltaPct >= 0 ? '+' : ''}${b.deltaPct}%`}</td>
                          <td>
                            {b.improved == null ? (
                              '—'
                            ) : b.improved ? (
                              <span style={{ color: 'var(--green)', fontWeight: 600 }}>▲ Improved</span>
                            ) : (
                              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>▼ Worsened</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Root Cause & Hypotheses Engine */}
          {activeTab === 'rca' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Evidence-Based Diagnosis */}
              <div className="card">
                <div className="card-head-row">
                  <h3>Calibrated Evidence Findings</h3>
                  <span className="card-note">Automated diagnostic verification from telemetry evidence</span>
                </div>
                <ul className="finding-list">
                  {result.findings.map((f) => (
                    <li key={f.id} className={`finding finding-${f.level}`}>
                      <Chip text={f.phrase} tone={PHRASE_TONE[f.phrase] ?? 'dim'} />
                      <span className="finding-text">{f.text}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Alternative Diagnostic Hypotheses */}
              <div className="card">
                <div className="card-head-row">
                  <h3>Diagnostic Hypotheses &amp; Potential Root Causes</h3>
                  <span className="card-note">Deterministic score ranking based on multi-dimensional telemetry</span>
                </div>
                {result.hypotheses.map((h) => (
                  <div key={h.id} className="hypo">
                    <div className="hypo-head">
                      <span className="hypo-title">{h.title}</span>
                      <Chip text={h.verdict} tone={VERDICT_TONE[h.verdict] ?? 'dim'} />
                      <span className="hypo-score">Confidence {h.score}%</span>
                    </div>
                    <div className="hypo-bar">
                      <div
                        className="hypo-fill"
                        style={{
                          width: `${h.score}%`,
                          background: h.score >= 70 ? 'var(--danger)' : h.score >= 40 ? 'var(--warn)' : 'var(--accent)'
                        }}
                      />
                    </div>
                    {(h.supporting.length > 0 || h.contradicting.length > 0 || (h.recommendations && h.recommendations.length > 0)) && (
                      <div className="hypo-evidence">
                        {h.supporting.length > 0 && (
                          <div className="hypo-side">
                            <span className="hypo-side-label hypo-for">Supporting Evidence</span>
                            {h.supporting.map((s, i) => (
                              <div key={i} className="hypo-item">✓ {s}</div>
                            ))}
                          </div>
                        )}
                        {h.contradicting.length > 0 && (
                          <div className="hypo-side">
                            <span className="hypo-side-label hypo-against">Contradicting Evidence</span>
                            {h.contradicting.map((c, i) => (
                              <div key={i} className="hypo-item">✕ {c}</div>
                            ))}
                          </div>
                        )}
                        {h.recommendations && h.recommendations.length > 0 && (
                          <div className="hypo-recs-box" style={{ gridColumn: '1 / -1', marginTop: '6px' }}>
                            <span style={{ fontWeight: 700, color: 'var(--accent)' }}>Recommended Engineering Action:</span>
                            {h.recommendations.map((rec, i) => (
                              <div key={i} style={{ marginTop: '2px', color: 'var(--text)' }}>→ {rec}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Sibling & Peer Comparison */}
          {activeTab === 'peers' && (
            <div className="card">
              <div className="card-head-row">
                <h3>Peer Comparison — Co-Located Siblings &amp; Neighbors</h3>
                <span className="card-note">Same site and district cluster, worst health first</span>
              </div>
              {result.peers.length > 0 ? (
                <div className="preview-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Peer Sector</th>
                        <th className="num">Health Score</th>
                        <th className="num">{tech === '4G' ? 'PRB Util' : tech === '3G' ? '3G Util' : 'TCH Cong'}</th>
                        <th className="num">{tech === '4G' ? 'DL Speed' : tech === '3G' ? 'HSDPA Speed' : 'Voice Traffic'}</th>
                        <th className="num">NC Sectors</th>
                        <th>Cluster Insight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.peers.map((p) => (
                        <tr key={p.name}>
                          <td><b>{p.name}</b></td>
                          <td className="num">{p.healthScore ?? '—'}</td>
                          <td className="num">{p.prbAvg == null ? '—' : `${p.prbAvg.toFixed(1)}%`}</td>
                          <td className="num">
                            {p.throughputKbps == null
                              ? '—'
                              : tech === '2G'
                              ? `${p.throughputKbps.toFixed(1)} Erl`
                              : `${(p.throughputKbps / 1024).toFixed(1)} Mbps`}
                          </td>
                          <td className="num">{p.ncCells}</td>
                          <td>
                            {p.ncCells > 0 ? (
                              <span style={{ color: '#f87171' }}>
                                Cluster breach observed in {scope === 'cell' ? 'same site' : scope === 'site' ? 'same district' : 'same region'}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--green)' }}>Sibling is healthy (isolated cell fault)</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="card-note">No co-located peers found for this entity.</p>
              )}
            </div>
          )}

          {/* TAB 4: Workflow, Notes & Audit Log */}
          {activeTab === 'workflow' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Status & Assignment Card */}
              <div className="card">
                <div className="card-head-row">
                  <h3>Workflow Status &amp; Ownership</h3>
                  <span className="card-note">Last updated: {result.status.updatedAt ?? 'never'}</span>
                </div>
                <div className="inv-status-row">
                  <select
                    className="sel"
                    value={statusDraft.status}
                    onChange={(e) => setStatusDraft({ ...statusDraft, status: e.target.value })}
                  >
                    <option value="">— Select Status —</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <input
                    className="input"
                    placeholder="Assigned Owner / Team"
                    value={statusDraft.owner}
                    onChange={(e) => setStatusDraft({ ...statusDraft, owner: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="External Ticket ID (e.g. INC-4921)"
                    value={statusDraft.externalTicket}
                    onChange={(e) => setStatusDraft({ ...statusDraft, externalTicket: e.target.value })}
                  />
                  <input
                    className="input"
                    type="date"
                    value={statusDraft.targetReviewDate}
                    onChange={(e) => setStatusDraft({ ...statusDraft, targetReviewDate: e.target.value })}
                  />
                  <button className="btn btn-primary" disabled={saving} onClick={() => void saveStatus()}>
                    {saving ? 'Saving…' : 'Save Status & Ownership'}
                  </button>
                </div>
              </div>

              {/* Engineering Checklist */}
              <div className="card">
                <div className="card-head-row">
                  <h3>{tech} Engineering Investigation Checklist</h3>
                  <span className="card-note">Root cause validation &amp; recovery protocol</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {activeChecklist.map((item, idx) => (
                    <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(checklist[item])}
                        onChange={(e) => setChecklist({ ...checklist, [item]: e.target.checked })}
                      />
                      <span style={{ color: checklist[item] ? 'var(--text-dim)' : 'var(--text)', textDecoration: checklist[item] ? 'line-through' : 'none' }}>
                        {item}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Notes & Activity Log */}
              <div className="card">
                <div className="card-head-row">
                  <h3>Activity Audit Timeline &amp; Notes</h3>
                  <span className="card-note">{result.events.length} chronological events</span>
                </div>
                <div className="row-actions" style={{ marginBottom: '12px' }}>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    placeholder="Add an engineering note or observation…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void addNote()
                    }}
                  />
                  <button className="btn btn-primary" disabled={!note.trim()} onClick={() => void addNote()}>
                    Add Note
                  </button>
                </div>
                <ul className="timeline">
                  {result.events.map((ev, i) => (
                    <li key={i} className="timeline-item">
                      <span className="timeline-date">{ev.occurredAt}</span>
                      <span className="timeline-body">
                        <b>{EVENT_LABEL[ev.kind] ?? ev.kind}:</b> {ev.note}
                      </span>
                    </li>
                  ))}
                  {result.events.length === 0 && (
                    <li className="timeline-item" style={{ color: 'var(--text-dim)', fontSize: '12px' }}>
                      No notes or activity events recorded yet.
                    </li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {/* Report Preview Modal */}
          {report && (
            <div className="modal-backdrop" onClick={() => setReport(null)}>
              <div className="modal-card" style={{ maxWidth: '700px', width: '90%' }} onClick={(e) => e.stopPropagation()}>
                <div className="modal-head">
                  <h3>Investigation Report — {selected?.name ?? 'Export'}</h3>
                  <button className="btn btn-sm btn-ghost" onClick={() => setReport(null)}>✕</button>
                </div>
                <div className="modal-body" style={{ maxHeight: '420px', overflowY: 'auto' }}>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: '11px', color: 'var(--text)' }}>
                    {report.markdown}
                  </pre>
                </div>
                <div className="modal-foot" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Saved to {report.path}</span>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      void navigator.clipboard.writeText(report.markdown)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                  >
                    {copied ? 'Copied to Clipboard!' : 'Copy Markdown'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
