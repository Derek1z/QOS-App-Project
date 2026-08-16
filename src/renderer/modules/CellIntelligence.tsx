import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import type {
  CellIntelligenceRow, CellIntelligenceResult, CellDetail, Lifecycle, Trend, Severity
} from '../../../shared/api'
import Chart from '../lib/Chart'
import { cellDetailOption } from '../lib/cellCharts'

const LIFECYCLES: Lifecycle[] = ['Persistent NC', 'Recurring NC', 'New NC', 'Recovering', 'Healthy']
const TRENDS: Trend[] = ['Worsening', 'Stable', 'Improving']
const SEVERITIES: Severity[] = ['Critical', 'High', 'Watch', 'Normal']
const PRIORITY_FLOORS = [
  { value: 0, label: 'Any priority' },
  { value: 75, label: '≥ 75 (High+)' },
  { value: 50, label: '≥ 50 (Medium+)' },
  { value: 25, label: '≥ 25 (Watch+)' }
]

function Chip({ text, tone }: { text: string; tone?: 'ok' | 'warn' | 'bad' | 'dim' }): React.JSX.Element {
  return <span className={`chip chip-${tone ?? 'dim'}`}>{text}</span>
}

const BAND_COLOR: Record<string, string> = {
  Critical: 'var(--danger)',
  High: 'var(--warn)',
  Medium: 'var(--accent)',
  Watch: 'var(--text-dim)',
  Low: 'var(--text-faint)'
}

export default function CellIntelligence(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const [data, setData] = useState<CellIntelligenceResult>({ total: 0, rows: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [fLifecycle, setFLifecycle] = useState('')
  const [fTrend, setFTrend] = useState('')
  const [fSeverity, setFSeverity] = useState('')
  const [fPriority, setFPriority] = useState(0)
  const [detail, setDetail] = useState<CellDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [prbThreshold, setPrbThreshold] = useState(80)
  const [detailLoading, setDetailLoading] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pageSize = 100

  const load = useCallback(
    async (offset: number, append: boolean): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const res = await window.api.analytics.cellIntelligence({
          search: search.trim() || undefined,
          lifecycle: (fLifecycle || undefined) as Lifecycle | undefined,
          trend: (fTrend || undefined) as Trend | undefined,
          severity: (fSeverity || undefined) as Severity | undefined,
          minPriority: fPriority || undefined,
          limit: pageSize,
          offset
        })
        setData((prev) => ({
          total: res.total,
          rows: append ? [...prev.rows, ...res.rows] : res.rows
        }))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [search, fLifecycle, fTrend, fSeverity, fPriority]
  )

  // reset to page 0 on any filter change (search debounced) or tech switch
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void load(0, false), search === '' ? 0 : 350)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [search, fLifecycle, fTrend, fSeverity, fPriority, workspace?.technology, workspace?.path, load])

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

  async function openDetail(row: CellIntelligenceRow): Promise<void> {
    setDetailLoading(true)
    try {
      const d = await window.api.analytics.cellDetail(row.cellId)
      if (d) {
        setDetail(d)
        setDetailOpen(true)
      }
    } finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDetailOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hasMore = data.rows.length < data.total
  const loadedAny = data.rows.length > 0 || loading

  return (
    <div className="module">
      <div className="module-head">
        <h2>Cell Intelligence</h2>
        <span className="module-workspace">{workspace?.name}</span>
        {data.total > 0 && <span className="module-workspace">{data.total.toLocaleString()} cells · latest week</span>}
      </div>

      <div className="row-actions filter-row">
        <input
          className="input"
          placeholder="Search cell / site / district…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="sel" value={fLifecycle} onChange={(e) => setFLifecycle(e.target.value)}>
          <option value="">All lifecycles</option>
          {LIFECYCLES.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select className="sel" value={fTrend} onChange={(e) => setFTrend(e.target.value)}>
          <option value="">All trends</option>
          {TRENDS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select className="sel" value={fSeverity} onChange={(e) => setFSeverity(e.target.value)}>
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="sel" value={fPriority} onChange={(e) => setFPriority(Number(e.target.value))}>
          {PRIORITY_FLOORS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {(search || fLifecycle || fTrend || fSeverity || fPriority > 0) && (
          <button
            className="btn"
            onClick={() => {
              setSearch('')
              setFLifecycle('')
              setFTrend('')
              setFSeverity('')
              setFPriority(0)
            }}
          >
            Reset
          </button>
        )}
      </div>

      {error && <div className="notice notice-error">{error}</div>}
      {!loadedAny && !error && (
        <div className="notice">No cell classifications yet — import data first.</div>
      )}

      {data.rows.length > 0 && (
        <div className="card">
          <div className="preview-scroll cell-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cell</th>
                  <th>Site</th>
                  <th>District</th>
                  <th>Lifecycle</th>
                  <th>Trend</th>
                  <th>Severity</th>
                  {workspace?.technology === '4G' && (
                    <>
                      <th>PRB avg</th>
                      <th>Breach</th>
                    </>
                  )}
                  <th>Priority</th>
                  {data.rows[0]?.kpis.map((k) => (
                    <th key={k.key} title={`${k.label} target ${k.target ?? '—'}`}>
                      {k.label}
                      {k.breached && ' ⚠'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.cellId} className="cell-row" onClick={() => void openDetail(r)}>
                    <td>{r.cellName}</td>
                    <td>{r.site ?? '—'}</td>
                    <td>{r.district ?? '—'}</td>
                    <td>
                      <Chip
                        text={r.lifecycle}
                        tone={r.lifecycle === 'Persistent NC' ? 'bad' : r.lifecycle === 'Recurring NC' ? 'warn' : r.lifecycle === 'New NC' ? 'ok' : 'dim'}
                      />
                    </td>
                    <td>
                      <Chip text={r.trend} tone={r.trend === 'Worsening' ? 'bad' : r.trend === 'Improving' ? 'ok' : 'dim'} />
                    </td>
                    <td>
                      <Chip text={r.severity} tone={r.severity === 'Critical' ? 'bad' : r.severity === 'High' ? 'warn' : 'dim'} />
                    </td>
                    {workspace?.technology === '4G' && (
                      <>
                        <td>{r.prbAvg != null ? `${r.prbAvg.toFixed(1)}%` : '—'}</td>
                        <td>{r.breachDays}</td>
                      </>
                    )}
                    <td>
                      {r.priorityScore != null ? (
                        <span style={{ color: BAND_COLOR[r.priorityBand ?? 'Low'] ?? 'var(--text)', fontWeight: 700 }}>
                          {r.priorityScore}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    {r.kpis.map((k) => (
                      <td key={k.key}>
                        {k.value != null ? (
                          <span className={k.breached ? 'kpi-breached' : ''} title={k.breached ? `Breaches ${k.target}` : k.target != null ? `Within ${k.target}` : undefined}>
                            {Number(k.value).toFixed(1)}
                            {k.unit ? ` ${k.unit}` : ''}
                            {k.breached && ' ⚠'}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-actions">
            <span className="card-note">
              Showing {data.rows.length.toLocaleString()} of {data.total.toLocaleString()}
            </span>
            {hasMore && (
              <button className="btn" disabled={loading} onClick={() => void load(data.rows.length, true)}>
                {loading ? 'Loading…' : 'Show more'}
              </button>
            )}
          </div>
        </div>
      )}

      {detailOpen && detail && (
        <div className="drawer-overlay" onClick={() => setDetailOpen(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <div className="drawer-title">{detail.cellName}</div>
                <div className="drawer-sub">
                  {[detail.site, detail.district, detail.region].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <button className="btn" onClick={() => setDetailOpen(false)}>✕</button>
            </div>

            {detail.current && (
              <div className="drawer-current">
                <Chip
                  text={detail.current.lifecycle}
                  tone={detail.current.lifecycle === 'Persistent NC' ? 'bad' : detail.current.lifecycle === 'Recurring NC' ? 'warn' : detail.current.lifecycle === 'New NC' ? 'ok' : 'dim'}
                />
                <Chip text={detail.current.trend} tone={detail.current.trend === 'Worsening' ? 'bad' : detail.current.trend === 'Improving' ? 'ok' : 'dim'} />
                <Chip text={detail.current.severity} tone={detail.current.severity === 'Critical' ? 'bad' : detail.current.severity === 'High' ? 'warn' : 'dim'} />
                {detail.current.priorityScore != null && (
                  <span className="drawer-prio" style={{ color: BAND_COLOR[detail.current.priorityBand ?? 'Low'] }}>
                    Priority {detail.current.priorityScore} · {detail.current.priorityBand}
                  </span>
                )}
              </div>
            )}

            {detail.kpis.length > 0 && (
              <div className="card drawer-kpis">
                <div className="drawer-sub">Per-technology KPIs (latest week)</div>
                <div className="kpi-grid">
                  {detail.kpis.map((k) => (
                    <div key={k.key} className={`kpi-cell${k.breached ? ' kpi-breached' : ''}`}>
                      <span className="kpi-grid-label">{k.label}</span>
                      <span className="kpi-grid-value">
                        {k.value != null ? `${Number(k.value).toFixed(1)}${k.unit ? ` ${k.unit}` : ''}` : '—'}
                        {k.breached && ' ⚠'}
                      </span>
                      <span className="kpi-grid-target">
                        target {k.target ?? '—'} · {k.worseIsHigher ? '↑ worse' : '↓ worse'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detailLoading ? (
              <p className="card-note">Loading…</p>
            ) : detail.weeks.length > 0 ? (
              <Chart option={cellDetailOption(detail, prbThreshold)} height={490} />
            ) : (
              <p className="card-note">No weekly history for this cell yet.</p>
            )}

            {detail.weeks.length > 0 && (
              <div className="week-strip">
                {detail.weeks.map((w) => (
                  <span
                    key={w.weekStart}
                    className={`week-cell${w.isNc ? ' week-nc' : ''}`}
                    title={`${w.weekStart}: ${w.lifecycle} · ${w.severity}`}
                  >
                    {w.lifecycle === 'Persistent NC' ? 'P' : w.lifecycle === 'Recurring NC' ? 'R' : w.lifecycle === 'New NC' ? 'N' : w.lifecycle === 'Recovering' ? 'C' : '·'}
                  </span>
                ))}
              </div>
            )}
            <p className="card-note">
              Weekly history (ISO weeks, Monday–Sunday). The PRB grid shows the ruleset threshold
              ({prbThreshold}%); the strip marks each week's NC state (N new · R recurring ·
              P persistent · C recovering). Hover the charts for synchronized values.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
