import { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import type {
  NcLifecycleResult, PriorityRow, HealthResult, PriorityMode, Lifecycle, Trend, Severity
} from '../../../shared/api'
import { PRIORITY_MODES } from '../../../shared/api'

const LIFECYCLE_ORDER: Lifecycle[] = ['Persistent NC', 'Recurring NC', 'New NC', 'Recovering', 'Healthy']
const TREND_ORDER: Trend[] = ['Worsening', 'Stable', 'Improving']
const SEVERITY_ORDER: Severity[] = ['Critical', 'High', 'Watch', 'Normal']

const MODE_LABELS: Record<PriorityMode, string> = {
  balanced: 'Balanced',
  customer: 'Customer Impact',
  congestion: 'Congestion Severity',
  persistence: 'Persistence',
  deterioration: 'Rapid Deterioration'
}

const BAND_COLOR: Record<string, string> = {
  Critical: 'var(--danger)',
  High: 'var(--warn)',
  Medium: 'var(--accent)',
  Watch: 'var(--text-dim)',
  Low: 'var(--text-faint)'
}

function DistBar({ label, value, max, color }: { label: string; value: number; max: number; color?: string }): React.JSX.Element {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="dist-row">
      <span className="dist-label">{label}</span>
      <div className="dist-track">
        <div className="dist-fill" style={{ width: `${pct}%`, background: color ?? 'var(--accent)' }} />
      </div>
      <span className="dist-value">{value}</span>
    </div>
  )
}

function Chip({ text, tone }: { text: string; tone?: 'ok' | 'warn' | 'bad' | 'dim' }): React.JSX.Element {
  return <span className={`chip chip-${tone ?? 'dim'}`}>{text}</span>
}

export default function NcIntelligence(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const summary = useAppStore((s) => s.summary)
  const [nc, setNc] = useState<NcLifecycleResult | null>(null)
  const [priority, setPriority] = useState<PriorityRow[]>([])
  const [health, setHealth] = useState<HealthResult | null>(null)
  const [mode, setMode] = useState<PriorityMode>('balanced')
  const [fLifecycle, setFLifecycle] = useState('')
  const [fTrend, setFTrend] = useState('')
  const [fSeverity, setFSeverity] = useState('')
  const [fQ, setFQ] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [ncRes, prioRes, healthRes] = await Promise.all([
          window.api.analytics.ncLifecycle(),
          window.api.analytics.priorityQueue(mode, 10),
          window.api.analytics.health()
        ])
        if (!alive) return
        setNc(ncRes)
        setPriority(prioRes)
        setHealth(healthRes)
      } catch {
        /* workspace may have closed mid-flight */
      }
    })()
    return () => {
      alive = false
    }
  }, [workspace?.path, workspace?.readOnly, mode])

  const critical = nc ? nc.bySeverity.Critical : 0
  const latestHealth = health && health.network.length > 0 ? health.network[health.network.length - 1] : null

  const [page, setPage] = useState(1)
  const pageSize = 50

  useEffect(() => {
    setPage(1)
  }, [fLifecycle, fTrend, fSeverity, fQ])

  const cells = (nc?.cells ?? []).filter(
    (c) =>
      (!fLifecycle || c.lifecycle === fLifecycle) &&
      (!fTrend || c.trend === fTrend) &&
      (!fSeverity || c.severity === fSeverity) &&
      (!fQ || c.cellName.toLowerCase().includes(fQ.toLowerCase()) || (c.site ?? '').toLowerCase().includes(fQ.toLowerCase()))
  )

  const totalPages = Math.max(1, Math.ceil(cells.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRows = cells.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const startIdx = cells.length > 0 ? (currentPage - 1) * pageSize + 1 : 0
  const endIdx = Math.min(cells.length, currentPage * pageSize)

  return (
    <div className="module">
      <div className="module-head">
        <h2>NC Intelligence</h2>
        <span className="module-workspace">{workspace?.name}</span>
        {nc?.weekStart && <span className="badge badge-ok">Week of {nc.weekStart}</span>}
        {summary?.rulesetVersion != null && (
          <span className="badge">Ruleset v{summary.rulesetVersion}</span>
        )}
      </div>

      <div className="kpi-strip">
        <div className="kpi">
          <div className="kpi-value">{nc?.totalCells.toLocaleString() ?? '—'}</div>
          <div className="kpi-label">Cells observed</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{nc?.ncCells.toLocaleString() ?? '—'}</div>
          <div className="kpi-label">Weekly NC cells</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{nc?.ncRate != null ? `${nc.ncRate}%` : '—'}</div>
          <div className="kpi-label">Weekly NC rate</div>
        </div>
        <div className="kpi">
          <div className="kpi-value" style={{ color: critical > 0 ? 'var(--danger)' : undefined }}>
            {critical}
          </div>
          <div className="kpi-label">Critical</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{latestHealth ? Math.round(latestHealth.score) : '—'}</div>
          <div className="kpi-label">Network health</div>
        </div>
      </div>

      <div className="cards nc-cards">
        <div className="card">
          <h3>Lifecycle</h3>
          {nc ? (
            LIFECYCLE_ORDER.map((l) => (
              <DistBar key={l} label={l} value={nc.byLifecycle[l]} max={nc.totalCells} />
            ))
          ) : (
            <p className="card-note">No classifications yet — import data first.</p>
          )}
        </div>
        <div className="card">
          <h3>Trend</h3>
          {nc ? (
            TREND_ORDER.map((t) => (
              <DistBar
                key={t}
                label={t}
                value={nc.byTrend[t]}
                max={nc.totalCells}
                color={t === 'Worsening' ? 'var(--danger)' : t === 'Improving' ? 'var(--green)' : undefined}
              />
            ))
          ) : (
            <p className="card-note">No classifications yet — import data first.</p>
          )}
        </div>
        <div className="card">
          <h3>Severity</h3>
          {nc ? (
            SEVERITY_ORDER.map((s) => (
              <DistBar
                key={s}
                label={s}
                value={nc.bySeverity[s]}
                max={nc.totalCells}
                color={s === 'Critical' ? 'var(--danger)' : s === 'High' ? 'var(--warn)' : s === 'Watch' ? 'var(--accent)' : undefined}
              />
            ))
          ) : (
            <p className="card-note">No classifications yet — import data first.</p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="file-head">
          <h3>Classified cell directory ({cells.length.toLocaleString()})</h3>
          <span className="card-note">
            {cells.length > 0
              ? `Showing ${startIdx}–${endIdx} of ${cells.length.toLocaleString()} cells (Page ${currentPage} of ${totalPages})`
              : '0 cells'}
          </span>
        </div>
        <div className="row-actions filter-row">
          <select className="sel" value={fLifecycle} onChange={(e) => setFLifecycle(e.target.value)}>
            <option value="">All lifecycles</option>
            {LIFECYCLE_ORDER.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <select className="sel" value={fTrend} onChange={(e) => setFTrend(e.target.value)}>
            <option value="">All trends</option>
            {TREND_ORDER.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select className="sel" value={fSeverity} onChange={(e) => setFSeverity(e.target.value)}>
            <option value="">All severities</option>
            {SEVERITY_ORDER.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Search cell / site…"
            value={fQ}
            onChange={(e) => setFQ(e.target.value)}
          />
        </div>
        {cells.length === 0 ? (
          <p className="card-note">No cells match the current filters.</p>
        ) : (
          <>
            <div className="preview-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cell</th>
                    <th>Site</th>
                    <th>District</th>
                    <th>PRB avg</th>
                    <th>Breach days</th>
                    <th>Lifecycle</th>
                    <th>Trend</th>
                    <th>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((c) => (
                    <tr key={c.cellId}>
                      <td>{c.cellName}</td>
                      <td>{c.site ?? '—'}</td>
                      <td>{c.district ?? '—'}</td>
                      <td>{c.prbAvg != null ? `${c.prbAvg.toFixed(1)}%` : '—'}</td>
                      <td>{c.breachDays}</td>
                      <td>
                        <Chip
                          text={c.lifecycle}
                          tone={c.lifecycle === 'Persistent NC' ? 'bad' : c.lifecycle === 'Recurring NC' ? 'warn' : c.lifecycle === 'New NC' ? 'ok' : 'dim'}
                        />
                      </td>
                      <td>
                        <Chip text={c.trend} tone={c.trend === 'Worsening' ? 'bad' : c.trend === 'Improving' ? 'ok' : 'dim'} />
                      </td>
                      <td>
                        <Chip text={c.severity} tone={c.severity === 'Critical' ? 'bad' : c.severity === 'High' ? 'warn' : 'dim'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="file-head" style={{ marginTop: '0.75rem', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  className="btn btn-sm"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ← Previous
                </button>
                <span className="card-note" style={{ alignSelf: 'center' }}>
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  className="btn btn-sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <div className="file-head">
          <h3>Top priority cells</h3>
          <select className="sel" value={mode} onChange={(e) => setMode(e.target.value as PriorityMode)}>
            {PRIORITY_MODES.map((m) => (
              <option key={m} value={m}>{MODE_LABELS[m]}</option>
            ))}
          </select>
        </div>
        {priority.length === 0 ? (
          <p className="card-note">No priority scores yet — import data first.</p>
        ) : (
          <div className="preview-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Cell</th>
                  <th>Score</th>
                  <th>Band</th>
                  <th>PRB</th>
                  <th>Persist.</th>
                  <th>Users</th>
                  <th>Traffic</th>
                  <th>Thrpt</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {priority.map((p, i) => (
                  <tr key={`${p.cellId}-${p.mode}`}>
                    <td>{i + 1}</td>
                    <td>{p.cellName}</td>
                    <td style={{ fontWeight: 700 }}>{p.score}</td>
                    <td>
                      <span style={{ color: BAND_COLOR[p.band] ?? 'var(--text)' }}>{p.band}</span>
                    </td>
                    <td>{Math.round(p.components.prbSeverity)}</td>
                    <td>{Math.round(p.components.persistence)}</td>
                    <td>{Math.round(p.components.userImpact)}</td>
                    <td>{Math.round(p.components.trafficImpact)}</td>
                    <td>{Math.round(p.components.throughputDegradation)}</td>
                    <td>{Math.round(p.components.worseningTrend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="card-note">
          Transparent 0–100 score: PRB severity, persistence, user/traffic impact, throughput degradation,
          worsening trend. The full queue with action workflow arrives with the Priority Center (M4).
        </p>
      </div>
    </div>
  )
}
