import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { useAppStore } from '../store'
import type {
  ActionStatus, EntityOption, InvestigationReport, InvestigationResult,
  InvestigationScope
} from '../../../shared/api'
import Chart from '../lib/Chart'
import { investigationChartOption } from '../lib/investigationCharts'
import { weekLabel } from '../lib/overviewCharts'

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
  'Confirm PRB threshold breach days per week',
  'Review trend across the last 4 weeks',
  'Compare against site siblings (peer check)',
  'Verify availability against the 99.5% expectation',
  'Check backhaul utilisation when throughput is low',
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
        const r = await window.api.investigation.get(s, ent.id, { interventionWeek: iv || undefined })
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
    [scope]
  )

  // entity search (debounced)
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      void (async () => {
        try {
          const opts = await window.api.investigation.search(scope, query.trim() || undefined)
          setOptions(opts)
        } catch {
          setOptions([])
        }
      })()
    }, query === '' ? 0 : 300)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [scope, query])

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

  // cross-module navigation: a Priority Center row can hand us a target entity
  useEffect(() => {
    if (!target) return
    const ent: EntityOption = { id: target.id, name: target.name, path: target.path }
    setScope(target.scope)
    setQuery('')
    setOptions([])
    setSelected(ent)
    void load(ent, '', target.scope)
    setTarget(null)
  }, [target, load, setTarget])

  const chartOption: EChartsOption | null = useMemo(
    () => (result && result.weeks.length > 0 ? investigationChartOption(result, prbThreshold) : null),
    [result, prbThreshold]
  )

  async function pick(ent: EntityOption): Promise<void> {
    setQuery('')
    setOptions([])
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

  return (
    <div className="module">
      <div className="module-head">
        <h2>Investigation Workspace</h2>
        <span className="module-workspace">{workspace?.name}</span>
        {selected && <span className="module-workspace">{selected.path.join(' › ')}</span>}
      </div>

      {/* entity picker */}
      <div className="row-actions filter-row inv-picker">
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
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="inv-search">
          <input
            className="input"
            placeholder={`Search ${scope}s… (e.g. ACC-001-A)`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {options.length > 0 && (
            <div className="inv-dropdown">
              {options.slice(0, 10).map((o) => (
                <button key={`${scope}-${o.id}`} className="inv-option" onClick={() => void pick(o)}>
                  <span className="inv-option-name">{o.name}</span>
                  <span className="inv-option-path">{o.path.join(' › ')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="btn" disabled={!selected} onClick={() => void exportReport()}>
          Export report
        </button>
      </div>

      {error && <div className="notice notice-error">{error}</div>}
      {!selected && !error && (
        <div className="notice">Pick a cell, site or district to start an evidence-based investigation.</div>
      )}
      {selected && loading && !result && <div className="notice">Loading investigation…</div>}

      {result && (
        <>
          {/* status + classifications */}
          <div className="card">
            <div className="card-head-row">
              <h3>Action status</h3>
              <span className="card-note">Last updated: {result.status.updatedAt ?? 'never'}</span>
            </div>
            <div className="inv-status-row">
              <select
                className="sel"
                value={statusDraft.status}
                onChange={(e) => setStatusDraft({ ...statusDraft, status: e.target.value })}
              >
                <option value="">—</option>
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
              <button className="btn" disabled={saving} onClick={() => void saveStatus()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div className="inv-current">
              {result.current && (
                <>
                  <span className="inv-week">{result.current.weekStart} ({weekLabel(result.current.weekStart)})</span>
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

          {/* KPI evidence strip */}
          <div className="card">
            <div className="card-head-row">
              <h3>KPI evidence — latest week vs previous</h3>
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

          {/* actual metrics chart */}
          <div className="card">
            <div className="card-head-row">
              <h3>Actual metrics — weekly history</h3>
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

          {/* diagnosis */}
          <div className="card">
            <div className="card-head-row">
              <h3>Evidence-based diagnosis</h3>
              <span className="card-note">Calibrated language — never claims root cause beyond the data (§48)</span>
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

          {/* hypotheses */}
          <div className="card">
            <div className="card-head-row">
              <h3>Alternative hypotheses</h3>
              <span className="card-note">Support scores are deterministic; descriptive, not causal</span>
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
                {(h.supporting.length > 0 || h.contradicting.length > 0) && (
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
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* before/after */}
          <div className="card">
            <div className="card-head-row">
              <h3>Before / after analysis</h3>
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
                      {w.weekStart} ({weekLabel(w.weekStart)})
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

          {/* peers */}
          <div className="card">
            <div className="card-head-row">
              <h3>Peer comparison</h3>
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

          {/* notes / events + checklist */}
          <div className="cards">
            <div className="card">
              <div className="card-head-row">
                <h3>Notes &amp; events</h3>
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
                <button className="btn" disabled={!note.trim()} onClick={() => void addNote()}>
                  Add
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
                <h3>Investigation checklist</h3>
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
              <p className="card-note">
                In-memory for this session — persisted checklist items land with the M5 hardening pass.
              </p>
            </div>
          </div>
        </>
      )}

      {/* report modal */}
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
