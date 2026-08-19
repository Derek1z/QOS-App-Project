import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { useAppStore, on } from '../store'
import type {
  ActionStatus, EntityOption, InvestigationReport, InvestigationResult,
  InvestigationScope, Severity, Lifecycle
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

const CHECKLIST = [
  'Confirm PRB / congestion threshold breach days per week',
  'Review trend across the last 4 weeks',
  'Compare against site siblings (peer check)',
  'Verify availability against the 99.5% expectation',
  'Check backhaul / hardware errors when throughput is low',
  'Confirm data coverage — any gaps in imported weeks?',
  'Mark the intervention week once an action is taken'
]

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
  if (unit === 'MB') return `${(v / 1024).toFixed(1)} GB`
  if (unit === '%') return `${v.toFixed(1)}%`
  return Math.round(v).toLocaleString()
}

export default function InvestigationWorkspace(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const grain = useAppStore((s) => s.grain)
  const period = useAppStore((s) => s.period)
  const target = useAppStore((s) => s.investigationTarget)
  const setTarget = useAppStore((s) => s.setInvestigationTarget)
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

  // Dropdown overlay state: closed by default
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(
    async (ent: EntityOption | null, iv: string, scopeOverride?: InvestigationScope): Promise<void> => {
      if (!ent) {
        setResult(null)
        return
      }
      const s = scopeOverride ?? scope
      setLoading(true)
      setError(null)
      try {
        const r = await window.api.investigation.get(s, ent.id, { interventionWeek: iv || undefined, grain, period })
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
    [scope, grain, period]
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
  }, [workspace?.technology, workspace?.path])

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
          const opts = await window.api.investigation.search(scope, query.trim() || undefined)
          setOptions(opts)

          // Default auto-selection: if no entity is currently selected, immediately pick the top/highest priority entity
          if (!selected && opts.length > 0 && !target) {
            const top = opts[0]
            setSelected(top)
            void load(top, '')
          }
        } catch {
          setOptions([])
        }
      })()
    }, query === '' ? 0 : 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [scope, query, selected, target, load])

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
    void load(ent, '', target.scope)
    setTarget(null)
  }, [target, load, setTarget])

  const chartOption: EChartsOption | null = useMemo(
    () => (result && result.weeks.length > 0 ? investigationChartOption(result, prbThreshold, grain) : null),
    [result, prbThreshold, grain]
  )

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
          <span className="badge ov-tech-badge">{workspace?.technology ?? '4G'}</span>
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

      {/* Main Investigation Content */}
      {result && (
        <>
          {/* Status & Classification Card */}
          <div className="card">
            <div className="card-head-row">
              <div>
                <h3 style={{ margin: 0 }}>Action Status &amp; Assessment</h3>
                <span className="card-note">Last updated: {result.status.updatedAt ?? 'never'}</span>
              </div>
              {topIssueName && (
                <span className="badge" style={{ fontSize: '12px', background: 'rgba(56, 189, 248, 0.12)', color: '#38bdf8', fontWeight: 700 }}>
                  Diagnosis: {topIssueName}
                </span>
              )}
            </div>
            <div className="inv-status-row">
              <select
                className="sel"
                value={statusDraft.status}
                onChange={(e) => setStatusDraft({ ...statusDraft, status: e.target.value })}
              >
                <option value="">— Status —</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <input
                className="input"
                placeholder="Owner"
                value={statusDraft.owner}
                onChange={(e) => setStatusDraft({ ...statusDraft, owner: e.target.value })}
              />
              <input
                className="input"
                placeholder="External ticket"
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
                {saving ? 'Saving…' : 'Save Status'}
              </button>
            </div>
            <div className="inv-current">
              {result.current && (
                <>
                  <span className="inv-week">{result.current.weekStart} ({formatTimeLabel(result.current.weekStart, grain)})</span>
                  <Chip
                    text={result.current.lifecycle ?? '—'}
                    tone={result.current.lifecycle === 'Persistent NC' ? 'bad' : result.current.lifecycle === 'Recurring NC' ? 'warn' : result.current.lifecycle === 'New NC' ? 'ok' : 'dim'}
                  />
                  <Chip text={result.current.trend ?? '—'} tone={result.current.trend === 'Worsening' ? 'bad' : result.current.trend === 'Improving' ? 'ok' : 'dim'} />
                  <Chip text={result.current.severity ?? '—'} tone={result.current.severity === 'Critical' ? 'bad' : result.current.severity === 'High' ? 'warn' : 'dim'} />
                  {result.current.priorityScore != null && (
                    <span className="inv-priority" style={{ color: result.current.priorityScore >= 75 ? 'var(--danger)' : result.current.priorityScore >= 50 ? 'var(--warn)' : 'var(--text)' }}>
                      Priority {result.current.priorityScore} · {result.current.priorityBand}
                    </span>
                  )}
                  {result.current.isNc && <Chip text="NC" tone="bad" />}
                </>
              )}
            </div>
          </div>

          {/* KPI Evidence Strip */}
          <div className="card">
            <div className="card-head-row">
              <h3>KPI Evidence — Latest Week vs Previous</h3>
              <span className="card-note">{result.scope} scope · rollup of {result.path.length} levels</span>
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
              <h3>Actual Metrics — Weekly History</h3>
              <span className="card-note">5 aligned grids · PRB threshold {prbThreshold}% · intervention marked</span>
            </div>
            <Chart option={chartOption} height={560} />
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

          {/* Evidence-Based Diagnosis */}
          <div className="card">
            <div className="card-head-row">
              <h3>Evidence-Based Diagnosis</h3>
              <span className="card-note">Calibrated language — never claims root cause beyond data</span>
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
              <h3>Alternative Hypotheses &amp; Likely Causes</h3>
              <span className="card-note">Support scores are deterministic and descriptive</span>
            </div>
            {result.hypotheses.map((h) => (
              <div key={h.id} className="hypo">
                <div className="hypo-head">
                  <span className="hypo-title">{h.title}</span>
                  <Chip text={h.verdict} tone={VERDICT_TONE[h.verdict] ?? 'dim'} />
                  <span className="hypo-score">{h.score}/100</span>
                </div>
                <div className="hypo-bar">
                  <div className="hypo-fill" style={{ width: `${h.score}%` }} />
                </div>
                {(h.supporting.length > 0 || h.contradicting.length > 0 || (h.recommendations && h.recommendations.length > 0)) && (
                  <div className="hypo-evidence">
                    {h.supporting.length > 0 && (
                      <div className="hypo-side">
                        <span className="hypo-side-label hypo-for">For</span>
                        {h.supporting.map((s, i) => (
                          <div key={i} className="hypo-item">• {s}</div>
                        ))}
                      </div>
                    )}
                    {h.contradicting.length > 0 && (
                      <div className="hypo-side">
                        <span className="hypo-side-label hypo-against">Against</span>
                        {h.contradicting.map((c, i) => (
                          <div key={i} className="hypo-item">• {c}</div>
                        ))}
                      </div>
                    )}
                    {h.recommendations && h.recommendations.length > 0 && (
                      <div className="hypo-recs-box" style={{ gridColumn: '1 / -1', marginTop: '6px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text)' }}>Recommended Next Steps:</span>
                        {h.recommendations.map((rec, i) => (
                          <div key={i} style={{ marginTop: '2px' }}>→ {rec}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Before / After Analysis */}
          <div className="card">
            <div className="card-head-row">
              <h3>Before / After Analysis</h3>
              <label className="inv-iv-label">
                Intervention week:{' '}
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
                    <th>Before</th>
                    <th>After</th>
                    <th>Δ%</th>
                    <th>Improved</th>
                  </tr>
                </thead>
                <tbody>
                  {result.beforeAfter.map((b) => (
                    <tr key={b.metric}>
                      <td>{b.label}</td>
                      <td>{fmtV(b.before, b.unit)}</td>
                      <td>{fmtV(b.after, b.unit)}</td>
                      <td>{b.deltaPct == null ? '—' : `${b.deltaPct >= 0 ? '+' : ''}${b.deltaPct}%`}</td>
                      <td>
                        {b.improved == null ? (
                          '—'
                        ) : b.improved ? (
                          <span style={{ color: 'var(--green)' }}>▲ improved</span>
                        ) : (
                          <span style={{ color: 'var(--danger)' }}>▼ worsened</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="card-note">
              Windows: up to 8 weeks before and after the intervention week. Before = weeks before the mark, after = the
              mark and later weeks.
            </p>
          </div>

          {/* Peer Comparison */}
          <div className="card">
            <div className="card-head-row">
              <h3>Peer Comparison</h3>
              <span className="card-note">Same-scope siblings, worst health first</span>
            </div>
            {result.peers.length > 0 ? (
              <div className="preview-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Peer</th>
                      <th>Health</th>
                      <th>PRB</th>
                      <th>Speed</th>
                      <th>NC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.peers.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td>{p.healthScore ?? '—'}</td>
                        <td>{p.prbAvg == null ? '—' : `${p.prbAvg.toFixed(1)}%`}</td>
                        <td>{p.throughputKbps == null ? '—' : `${(p.throughputKbps / 1024).toFixed(1)} Mbps`}</td>
                        <td>{p.ncCells}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="card-note">No peers for this entity yet.</p>
            )}
          </div>

          {/* Notes / Events & Checklist */}
          <div className="cards">
            <div className="card">
              <div className="card-head-row">
                <h3>Notes &amp; Events</h3>
                <span className="card-note">{result.events.length} events</span>
              </div>
              <div className="row-actions">
                <input
                  className="input"
                  placeholder="Add a note…"
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
              <ul className="event-list">
                {result.events.slice(0, 20).map((ev) => (
                  <li key={ev.id} className={`event-item${ev.kind === 'status_change' ? ' event-status' : ''}`}>
                    <span className="event-kind">{EVENT_LABEL[ev.kind] ?? ev.kind}</span>
                    <span className="event-note">{ev.note ?? ''}</span>
                    <span className="event-meta">
                      {ev.occurredAt} · {ev.author ?? '—'}
                    </span>
                  </li>
                ))}
                {result.events.length === 0 && <li className="card-note">No events yet.</li>}
              </ul>
            </div>

            <div className="card">
              <div className="card-head-row">
                <h3>Investigation Checklist</h3>
                <span className="card-note">
                  {Object.values(checklist).filter(Boolean).length}/{CHECKLIST.length} done
                </span>
              </div>
              <ul className="checklist">
                {CHECKLIST.map((item) => (
                  <li key={item}>
                    <label className="check-item">
                      <input
                        type="checkbox"
                        checked={!!checklist[item]}
                        onChange={(e) => setChecklist({ ...checklist, [item]: e.target.checked })}
                      />
                      <span className={checklist[item] ? 'check-done' : ''}>{item}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}

      {/* Report Modal Drawer */}
      {report && (
        <div className="drawer-overlay" onClick={() => setReport(null)}>
          <div className="drawer report-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <div className="drawer-title">Investigation report</div>
                <div className="drawer-sub">{report.path}</div>
              </div>
              <button className="btn" onClick={() => setReport(null)}>✕</button>
            </div>
            <div className="report-body">
              <pre className="report-pre">{report.markdown}</pre>
            </div>
            <div className="row-actions">
              <button
                className="btn"
                onClick={() => {
                  void navigator.clipboard.writeText(report.markdown)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                {copied ? 'Copied ✓' : 'Copy markdown'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
