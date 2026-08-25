import { useEffect, useState, useMemo } from 'react'
import { useAppStore } from '../store'
import type {
  NcLifecycleResult, PriorityRow, HealthResult, PriorityMode, Lifecycle, Trend, Severity, Grain
} from '../../../shared/api'
import { PRIORITY_MODES } from '../../../shared/api'

const LIFECYCLE_ORDER: Lifecycle[] = ['Persistent NC', 'Recurring NC', 'New NC', 'Recovering', 'Healthy']
const TREND_ORDER: Trend[] = ['Worsening', 'Stable', 'Improving']
const SEVERITY_ORDER: Severity[] = ['Critical', 'High', 'Watch', 'Normal']

const MODE_LABELS: Record<PriorityMode, string> = {
  balanced: 'Balanced Quality & Impact',
  customer: 'Customer & Traffic Impact',
  congestion: 'Congestion & Capacity Severity',
  persistence: 'Chronic Persistence',
  deterioration: 'Rapid Deterioration'
}

const BAND_COLOR: Record<string, string> = {
  Critical: 'var(--danger)',
  High: 'var(--warn)',
  Medium: 'var(--accent)',
  Watch: 'var(--text-dim)',
  Low: 'var(--text-faint)'
}

const LIFECYCLE_COLOR: Record<Lifecycle, string> = {
  'Persistent NC': '#ef4444',
  'Chronic NC': '#dc2626',
  'Recurring NC': '#f59e0b',
  'New NC': '#eab308',
  'Recovering': '#06b6d4',
  'Healthy': '#10b981'
}

const SEVERITY_COLOR: Record<Severity, string> = {
  'Critical': '#ef4444',
  'High': '#f59e0b',
  'Watch': '#3b82f6',
  'Normal': '#10b981'
}

const TREND_COLOR: Record<Trend, string> = {
  'Worsening': '#ef4444',
  'Stable': '#94a3b8',
  'Improving': '#10b981'
}

function Chip({ text, tone }: { text: string; tone?: 'ok' | 'warn' | 'bad' | 'dim' }): React.JSX.Element {
  return <span className={`chip chip-${tone ?? 'dim'}`}>{text}</span>
}

export default function NcIntelligence(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const summary = useAppStore((s) => s.summary)
  const storeGrain = useAppStore((s) => s.grain)
  const setStoreGrain = useAppStore((s) => s.setGrain)
  const selectedTech = useAppStore((s) => s.selectedTech)
  const setModule = useAppStore((s) => s.setModule)
  const setInvestigationTarget = useAppStore((s) => s.setInvestigationTarget)

  const [grain, setGrain] = useState<Grain>(storeGrain ?? 'weekly')
  const [nc, setNc] = useState<NcLifecycleResult | null>(null)
  const [priority, setPriority] = useState<PriorityRow[]>([])
  const [health, setHealth] = useState<HealthResult | null>(null)
  const [mode, setMode] = useState<PriorityMode>('balanced')
  const [fLifecycle, setFLifecycle] = useState('')
  const [fTrend, setFTrend] = useState('')
  const [fSeverity, setFSeverity] = useState('')
  const [fQ, setFQ] = useState('')

  useEffect(() => {
    if (storeGrain && storeGrain !== grain) {
      setGrain(storeGrain)
    }
  }, [storeGrain])

  const handleGrainChange = (newGrain: Grain) => {
    setGrain(newGrain)
    setStoreGrain(newGrain)
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [ncRes, prioRes, healthRes] = await Promise.all([
          window.api.analytics.ncLifecycle(grain),
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
  }, [workspace?.path, workspace?.readOnly, mode, grain])

  const latestHealth = health && health.network.length > 0 ? health.network[health.network.length - 1] : null
  const healthScore = latestHealth ? Math.round(latestHealth.score * 10) / 10 : null

  const healthStatus = useMemo(() => {
    if (healthScore == null) return { text: 'Evaluating...', color: 'var(--text-dim)', bg: 'rgba(148, 163, 184, 0.15)' }
    if (healthScore >= 80) return { text: 'Optimal Performance', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' }
    if (healthScore >= 65) return { text: 'Guarded Health', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.15)' }
    if (healthScore >= 50) return { text: 'Degraded Compliance', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' }
    return { text: 'Critical Action Required', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' }
  }, [healthScore])

  const chronicPersistentCount = useMemo(() => {
    if (!nc) return 0
    return (nc.byLifecycle['Persistent NC'] ?? 0) + (nc.byLifecycle['Chronic NC'] ?? 0)
  }, [nc])

  const [page, setPage] = useState(1)
  const pageSize = 50

  useEffect(() => {
    setPage(1)
  }, [fLifecycle, fTrend, fSeverity, fQ])

  const cells = useMemo(() => {
    return (nc?.cells ?? []).filter(
      (c) =>
        (!fLifecycle || c.lifecycle === fLifecycle) &&
        (!fTrend || c.trend === fTrend) &&
        (!fSeverity || c.severity === fSeverity) &&
        (!fQ ||
          c.cellName.toLowerCase().includes(fQ.toLowerCase()) ||
          (c.site ?? '').toLowerCase().includes(fQ.toLowerCase()) ||
          (c.district ?? '').toLowerCase().includes(fQ.toLowerCase()))
    )
  }, [nc, fLifecycle, fTrend, fSeverity, fQ])

  const totalPages = Math.max(1, Math.ceil(cells.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRows = cells.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const startIdx = cells.length > 0 ? (currentPage - 1) * pageSize + 1 : 0
  const endIdx = Math.min(cells.length, currentPage * pageSize)

  const grainLabel = grain === 'daily' ? 'Daily' : grain === 'monthly' ? 'Monthly' : 'Weekly'
  const loadHeader = selectedTech === '4G' ? 'PRB Util' : selectedTech === '3G' ? '3G Load' : 'TCH Cong'

  const handleInvestigateCell = (c: { cellId: number; cellName: string; site?: string | null; district?: string | null; region?: string | null }) => {
    setInvestigationTarget({
      scope: 'cell',
      id: c.cellId,
      name: c.cellName,
      path: [c.region ?? '', c.district ?? '', c.site ?? '', c.cellName]
    })
    setModule('investigation')
  }

  const exportCsv = () => {
    if (cells.length === 0) return
    const headers = ['Cell Name', 'Site', 'District', 'Region', 'Load Avg (%)', 'Breach Count', 'Lifecycle', 'Trend', 'Severity']
    const rows = cells.map((c) => [
      `"${c.cellName}"`,
      `"${c.site ?? ''}"`,
      `"${c.district ?? ''}"`,
      `"${c.region ?? ''}"`,
      c.prbAvg != null ? c.prbAvg.toFixed(1) : '',
      c.breachDays,
      `"${c.lifecycle}"`,
      `"${c.trend}"`,
      `"${c.severity}"`
    ])
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `nc_directory_${grain}_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="module">
      {/* Module Navigation & Scope Controls */}
      <div className="module-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h2>Non-Compliance Mission Control</h2>
          <div className="seg" style={{ marginLeft: '6px' }}>
            {(['daily', 'weekly', 'monthly'] as Grain[]).map((g) => (
              <button
                key={g}
                className={`seg-btn${grain === g ? ' active' : ''}`}
                onClick={() => handleGrainChange(g)}
              >
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="module-workspace">{workspace?.name}</span>
          {nc?.weekStart && (
            <span className="badge badge-ok">
              {grainLabel} Period: {nc.weekStart}
            </span>
          )}
          {summary?.rulesetVersion != null && (
            <span className="badge">Ruleset v{summary.rulesetVersion}</span>
          )}
        </div>
      </div>

      {/* Hero Operational Status & Fleet Telemetry Banner */}
      <div className="nc-command-hero">
        <div className="nc-health-beacon-card">
          <div className="nc-beacon-header">
            <span className="nc-beacon-title">Fleet Compliance Index</span>
            <span className="badge" style={{ fontSize: '10px' }}>{selectedTech} Active</span>
          </div>
          <div>
            <div className="nc-health-score-display">
              <span className="nc-health-score-val" style={{ color: healthStatus.color }}>
                {healthScore != null ? healthScore : '—'}
              </span>
              <span className="nc-health-score-max">/ 100</span>
            </div>
            <div className="nc-status-badge" style={{ color: healthStatus.color, background: healthStatus.bg }}>
              <span className="nc-pulse-dot" style={{ background: healthStatus.color }} />
              {healthStatus.text}
            </div>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '8px' }}>
            Weighted heavily on non-compliance persistence, core regulatory limits, and stability trends.
          </div>
        </div>

        <div className="nc-kpi-quad">
          <div className="nc-stat-box">
            <span className="nc-stat-label">Observed Fleet</span>
            <div className="nc-stat-val">{nc?.totalCells.toLocaleString() ?? '—'}</div>
            <div className="nc-stat-sub">Active monitored sectors</div>
          </div>

          <div className="nc-stat-box" style={{ borderLeft: '3px solid var(--warn)' }}>
            <span className="nc-stat-label">Non-Compliant</span>
            <div className="nc-stat-val" style={{ color: 'var(--warn)' }}>
              {nc?.ncCells.toLocaleString() ?? '—'}
            </div>
            <div className="nc-stat-sub">
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{nc?.ncRate != null ? `${nc.ncRate}%` : '—'}</span> fleet breach rate
            </div>
          </div>

          <div className="nc-stat-box" style={{ borderLeft: '3px solid #ef4444' }}>
            <span className="nc-stat-label">Chronic &amp; Persistent</span>
            <div className="nc-stat-val" style={{ color: '#ef4444' }}>
              {chronicPersistentCount}
            </div>
            <div className="nc-stat-sub">
              {chronicPersistentCount > 0 ? '⚠️ High priority field action' : 'Zero chronic sectors'}
            </div>
          </div>

          <div className="nc-stat-box" style={{ borderLeft: '3px solid var(--danger)' }}>
            <span className="nc-stat-label">Critical Alarms</span>
            <div className="nc-stat-val" style={{ color: 'var(--danger)' }}>
              {nc ? nc.bySeverity.Critical : 0}
            </div>
            <div className="nc-stat-sub">Immediate triage queue</div>
          </div>
        </div>
      </div>

      {/* Interactive Click-to-Filter Distribution Deck */}
      <div className="nc-interactive-deck">
        {/* Lifecycle Matrix */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Lifecycle Distribution</h3>
            <span className="card-note" style={{ fontSize: '10px' }}>Click row to filter</span>
          </div>
          {nc ? (
            LIFECYCLE_ORDER.map((l) => {
              const val = nc.byLifecycle[l] ?? 0
              const pct = nc.totalCells > 0 ? Math.round((val / nc.totalCells) * 100) : 0
              const isSelected = fLifecycle === l
              return (
                <div
                  key={l}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  className={`nc-clickable-row${isSelected ? ' active' : ''}`}
                  onClick={() => setFLifecycle(isSelected ? '' : l)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setFLifecycle(isSelected ? '' : l)
                    }
                  }}
                  title={`Click to filter by ${l}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: LIFECYCLE_COLOR[l] ?? 'var(--text-dim)' }} />
                    <span style={{ fontSize: '12px', fontWeight: isSelected ? 700 : 500 }}>{l}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{pct}%</span>
                    <span style={{ fontSize: '12px', fontWeight: 700, minWidth: '28px', textAlign: 'right' }}>{val}</span>
                  </div>
                </div>
              )
            })
          ) : (
            <p className="card-note">No classifications available.</p>
          )}
        </div>

        {/* Severity Matrix */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Severity Matrix</h3>
            <span className="card-note" style={{ fontSize: '10px' }}>Click row to filter</span>
          </div>
          {nc ? (
            SEVERITY_ORDER.map((s) => {
              const val = nc.bySeverity[s] ?? 0
              const pct = nc.totalCells > 0 ? Math.round((val / nc.totalCells) * 100) : 0
              const isSelected = fSeverity === s
              return (
                <div
                  key={s}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  className={`nc-clickable-row${isSelected ? ' active' : ''}`}
                  onClick={() => setFSeverity(isSelected ? '' : s)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setFSeverity(isSelected ? '' : s)
                    }
                  }}
                  title={`Click to filter by ${s}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: SEVERITY_COLOR[s] }} />
                    <span style={{ fontSize: '12px', fontWeight: isSelected ? 700 : 500 }}>{s}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{pct}%</span>
                    <span style={{ fontSize: '12px', fontWeight: 700, minWidth: '28px', textAlign: 'right' }}>{val}</span>
                  </div>
                </div>
              )
            })
          ) : (
            <p className="card-note">No classifications available.</p>
          )}
        </div>

        {/* Trend Radar */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Trajectory Radar</h3>
            <span className="card-note" style={{ fontSize: '10px' }}>Click row to filter</span>
          </div>
          {nc ? (
            TREND_ORDER.map((t) => {
              const val = nc.byTrend[t] ?? 0
              const pct = nc.totalCells > 0 ? Math.round((val / nc.totalCells) * 100) : 0
              const isSelected = fTrend === t
              return (
                <div
                  key={t}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  className={`nc-clickable-row${isSelected ? ' active' : ''}`}
                  onClick={() => setFTrend(isSelected ? '' : t)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setFTrend(isSelected ? '' : t)
                    }
                  }}
                  title={`Click to filter by ${t}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: TREND_COLOR[t] }} />
                    <span style={{ fontSize: '12px', fontWeight: isSelected ? 700 : 500 }}>{t}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{pct}%</span>
                    <span style={{ fontSize: '12px', fontWeight: 700, minWidth: '28px', textAlign: 'right' }}>{val}</span>
                  </div>
                </div>
              )
            })
          ) : (
            <p className="card-note">No classifications available.</p>
          )}
        </div>
      </div>

      {/* Quick-Triage Action Preset Pills */}
      <div className="nc-triage-bar">
        <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-dim)', marginRight: '4px' }}>
          Quick Triage:
        </span>
        <button
          className={`nc-triage-pill${fSeverity === 'Critical' ? ' active' : ''}`}
          onClick={() => {
            setFSeverity(fSeverity === 'Critical' ? '' : 'Critical')
            setFLifecycle('')
            setFTrend('')
          }}
        >
          🔥 Critical Alarms
        </button>
        <button
          className={`nc-triage-pill${fLifecycle === 'Persistent NC' ? ' active' : ''}`}
          onClick={() => {
            setFLifecycle(fLifecycle === 'Persistent NC' ? '' : 'Persistent NC')
            setFSeverity('')
            setFTrend('')
          }}
        >
          ⏳ Persistent &amp; Chronic
        </button>
        <button
          className={`nc-triage-pill${fTrend === 'Worsening' ? ' active' : ''}`}
          onClick={() => {
            setFTrend(fTrend === 'Worsening' ? '' : 'Worsening')
            setFLifecycle('')
            setFSeverity('')
          }}
        >
          ⚠️ Worsening Trajectory
        </button>
        <button
          className={`nc-triage-pill${fLifecycle === 'Recovering' ? ' active' : ''}`}
          onClick={() => {
            setFLifecycle(fLifecycle === 'Recovering' ? '' : 'Recovering')
            setFSeverity('')
            setFTrend('')
          }}
        >
          🔄 Recovering Verification
        </button>

        {(fLifecycle || fTrend || fSeverity || fQ) && (
          <button
            className="nc-triage-pill"
            style={{ background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#f87171' }}
            onClick={() => {
              setFLifecycle('')
              setFTrend('')
              setFSeverity('')
              setFQ('')
            }}
          >
            ✕ Reset All Filters
          </button>
        )}
      </div>

      {/* Classified Sector Directory Grid */}
      <div className="card">
        <div className="file-head" style={{ marginBottom: '10px' }}>
          <div>
            <h3 style={{ margin: 0 }}>Classified Sector Directory ({cells.length.toLocaleString()})</h3>
            <span className="card-note">
              {cells.length > 0
                ? `Showing ${startIdx}–${endIdx} of ${cells.length.toLocaleString()} sectors · Page ${currentPage} of ${totalPages}`
                : '0 sectors'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="btn btn-sm" onClick={exportCsv} disabled={cells.length === 0} title="Export current filtered view to CSV">
              📥 Export CSV
            </button>
          </div>
        </div>

        {/* Dropdown Filters & Search */}
        <div className="row-actions filter-row" style={{ marginBottom: '12px' }}>
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
            placeholder="Search sector / site / district…"
            value={fQ}
            onChange={(e) => setFQ(e.target.value)}
          />
        </div>

        {cells.length === 0 ? (
          <p className="card-note">No sectors match the active triage criteria.</p>
        ) : (
          <>
            <div className="preview-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sector</th>
                    <th>Site</th>
                    <th>District</th>
                    <th>{loadHeader}</th>
                    <th>Breach Count</th>
                    <th>Lifecycle</th>
                    <th>Trend</th>
                    <th>Severity</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((c) => (
                    <tr key={c.cellId}>
                      <td style={{ fontWeight: 600 }}>{c.cellName}</td>
                      <td>{c.site ?? '—'}</td>
                      <td>{c.district ?? '—'}</td>
                      <td>{c.prbAvg != null ? `${c.prbAvg.toFixed(1)}%` : '—'}</td>
                      <td>
                        <span style={{ fontWeight: c.breachDays > 0 ? 700 : 400, color: c.breachDays > 3 ? 'var(--danger)' : undefined }}>
                          {c.breachDays}
                        </span>
                      </td>
                      <td>
                        <Chip
                          text={c.lifecycle}
                          tone={c.lifecycle === 'Persistent NC' || c.lifecycle === 'Chronic NC' ? 'bad' : c.lifecycle === 'Recurring NC' ? 'warn' : c.lifecycle === 'New NC' ? 'warn' : c.lifecycle === 'Recovering' ? 'ok' : 'dim'}
                        />
                      </td>
                      <td>
                        <Chip text={c.trend} tone={c.trend === 'Worsening' ? 'bad' : c.trend === 'Improving' ? 'ok' : 'dim'} />
                      </td>
                      <td>
                        <Chip text={c.severity} tone={c.severity === 'Critical' ? 'bad' : c.severity === 'High' ? 'warn' : c.severity === 'Watch' ? 'dim' : 'ok'} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="nc-action-btn"
                          onClick={() => handleInvestigateCell(c)}
                          title="Open full root-cause investigation workspace for this sector"
                        >
                          Investigate 🔍
                        </button>
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

      {/* Executive Prioritization Center Quick-View */}
      <div className="card">
        <div className="file-head" style={{ marginBottom: '8px' }}>
          <div>
            <h3 style={{ margin: 0 }}>Top Priority Intervention Queue</h3>
            <span className="card-note">Ranked by multi-factor risk, congestion, customer traffic, and chronic persistence</span>
          </div>
          <select className="sel" value={mode} onChange={(e) => setMode(e.target.value as PriorityMode)}>
            {PRIORITY_MODES.map((m) => (
              <option key={m} value={m}>{MODE_LABELS[m]}</option>
            ))}
          </select>
        </div>

        {priority.length === 0 ? (
          <p className="card-note">No priority rankings available.</p>
        ) : (
          <div className="preview-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Sector</th>
                  <th>Priority Score</th>
                  <th>Urgency Band</th>
                  <th>{selectedTech === '4G' ? 'PRB Util' : selectedTech === '3G' ? '3G Load' : 'TCH Cong'}</th>
                  <th>Persistence</th>
                  <th>Users Impact</th>
                  <th>Traffic Impact</th>
                  <th>Throughput</th>
                  <th>Trend</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {priority.map((p, i) => (
                  <tr key={`${p.cellId}-${p.mode}`}>
                    <td style={{ fontWeight: 700 }}>#{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{p.cellName}</td>
                    <td style={{ fontWeight: 800, color: BAND_COLOR[p.band] ?? 'var(--text)' }}>{p.score}</td>
                    <td>
                      <span className="badge" style={{ color: BAND_COLOR[p.band], borderColor: BAND_COLOR[p.band] }}>
                        {p.band}
                      </span>
                    </td>
                    <td>{Math.round(p.components.prbSeverity)}</td>
                    <td>{Math.round(p.components.persistence)}</td>
                    <td>{Math.round(p.components.userImpact)}</td>
                    <td>{Math.round(p.components.trafficImpact)}</td>
                    <td>{Math.round(p.components.throughputDegradation)}</td>
                    <td>{Math.round(p.components.worseningTrend)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="nc-action-btn"
                        onClick={() => handleInvestigateCell({ cellId: p.cellId, cellName: p.cellName })}
                        title="Investigate priority sector"
                      >
                        Investigate 🔍
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

