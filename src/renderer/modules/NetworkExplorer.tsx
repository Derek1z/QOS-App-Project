import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import type { CellDetail, ExplorerLevel, ExplorerNode, ExplorerResult, Grain, Technology } from '../../../shared/api'
import Chart from '../lib/Chart'
import { cellDetailOption } from '../lib/cellCharts'

const LEVEL_LABEL: Record<ExplorerLevel, string> = {
  region: 'Region',
  district: 'District',
  site: 'Site',
  cell: 'Cell'
}

/** level -> the level listed when you drill INTO a node of this level */
const CHILD_LEVEL: Record<Exclude<ExplorerLevel, 'cell'>, ExplorerLevel> = {
  region: 'district',
  district: 'site',
  site: 'cell'
}

function healthColor(s: number | null): string {
  if (s == null) return 'var(--text-faint)'
  if (s >= 80) return 'var(--green)'
  if (s >= 65) return 'var(--accent)'
  if (s >= 50) return 'var(--warn)'
  return 'var(--danger)'
}

const fmtPct = (v: number | null): string => (v == null ? '—' : `${v.toFixed(1)}%`)
const fmtMbps = (v: number | null): string => (v == null ? '—' : `${(v / 1024).toFixed(1)} Mbps`)
const fmtG = (v: number | null): string => (v == null ? '—' : `${(v / 1024).toFixed(1)} GB`)
const fmtN = (v: number | null): string => (v == null ? '—' : Math.round(v).toLocaleString())

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

function computeCellAnalytics(detail: CellDetail, prbThreshold: number, grain: Grain, tech: Technology) {
  const points = detail.weeks
  const observed = points.length
  if (observed === 0) return null

  const breaches = points.filter((w) => w.isNc || w.breachDays > 0).length
  const breachRate = ((breaches / observed) * 100).toFixed(1)

  const prbValues = points.map((w) => w.prbAvg).filter((v): v is number => v != null)
  const avgPrb = prbValues.length > 0 ? prbValues.reduce((a, b) => a + b, 0) / prbValues.length : null
  const maxPrb = prbValues.length > 0 ? Math.max(...prbValues) : null

  const latest = points[points.length - 1]
  const currentPrb = detail.current?.prbAvg ?? latest?.prbAvg ?? avgPrb
  const delta = currentPrb != null ? currentPrb - prbThreshold : null

  let insight = ''
  let rec = ''

  if (tech === '4G') {
    if (currentPrb != null && currentPrb >= prbThreshold) {
      insight = `Capacity Saturation (${currentPrb.toFixed(1)}% vs ${prbThreshold}% SLA target): High resource block utilization is constraining user throughput.`
      rec = 'Prioritize carrier aggregation (CA) layer activation, inter-frequency load balancing, or physical antenna tilt optimization to relieve sector load.'
    } else if (latest?.availability != null && latest.availability < 98) {
      insight = `Availability Degradation (${latest.availability.toFixed(1)}%): Cell availability is sub-optimal.`
      rec = 'Verify transmission backhaul, eNodeB board alarms, and DC power backup stability.'
    } else {
      insight = 'Nominal Operations: Cell metrics remain within standard operational tolerance.'
      rec = 'Maintain standard monitoring and verify peak-hour headroom.'
    }
  } else if (tech === '3G') {
    if (currentPrb != null && currentPrb >= prbThreshold) {
      insight = `Power & CE Congestion (${currentPrb.toFixed(1)}%): High channel element / downlink carrier power utilization observed.`
      rec = 'Reallocate Channel Elements (CE) on NodeB, review soft handover parameters, and offload traffic to LTE overlay.'
    } else {
      insight = 'Nominal 3G Operations: Accessibility and retainability metrics are within threshold.'
      rec = 'Maintain regular drive test validation and neighbor list audits.'
    }
  } else {
    // 2G
    if (currentPrb != null && currentPrb >= prbThreshold) {
      insight = `TCH Channel Congestion (${currentPrb.toFixed(1)}%): High voice channel starvation causing call setup failures.`
      rec = 'Enable dynamic Half-Rate (HR) codec allocation, evaluate TRX expansion, or adjust cell handover margins.'
    } else {
      insight = 'Nominal 2G Voice Operations: TCH and SDCCH blocking within SLA margins.'
      rec = 'Perform routine frequency hopping checks and interference matrix updates.'
    }
  }

  let peakDayText = ''
  if (grain === 'daily' && points.length >= 7) {
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const daySums = new Array(7).fill(0)
    const dayCounts = new Array(7).fill(0)
    for (const p of points) {
      const d = new Date(p.weekStart).getDay()
      if (!isNaN(d) && p.prbAvg != null) {
        daySums[d] += p.prbAvg
        dayCounts[d] += 1
      }
    }
    let maxDayIdx = -1
    let maxDayAvg = -1
    for (let i = 0; i < 7; i++) {
      if (dayCounts[i] > 0) {
        const dayAvg = daySums[i] / dayCounts[i]
        if (dayAvg > maxDayAvg) {
          maxDayAvg = dayAvg
          maxDayIdx = i
        }
      }
    }
    if (maxDayIdx >= 0) {
      peakDayText = `Weekly Peak: ${daysOfWeek[maxDayIdx]}s (Avg ${maxDayAvg.toFixed(1)}%)`
    }
  }

  return {
    observed,
    breaches,
    breachRate,
    avgPrb: avgPrb != null ? `${avgPrb.toFixed(1)}%` : '—',
    maxPrb: maxPrb != null ? `${maxPrb.toFixed(1)}%` : '—',
    deltaText: delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%` : '—',
    isDeltaBad: delta != null ? delta > 0 : false,
    insight,
    rec,
    peakDayText
  }
}

export default function NetworkExplorer(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const grain = useAppStore((s) => s.grain)
  const selectedTech = useAppStore((s) => s.selectedTech)
  const togglePin = useAppStore((s) => s.togglePin)
  const isPinned = useAppStore((s) => s.isPinned)
  const setModule = useAppStore((s) => s.setModule)
  const [level, setLevel] = useState<ExplorerLevel>('region')
  const [parentId, setParentId] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const [result, setResult] = useState<ExplorerResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<CellDetail | null>(null)
  const [selectedCellNode, setSelectedCellNode] = useState<ExplorerNode | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [prbThreshold, setPrbThreshold] = useState(80)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(
    async (lvl: ExplorerLevel, pid: number | null, query: string): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const r = await window.api.analytics.explorer(lvl, pid, { q: query.trim() || undefined })
        setResult(r)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void load(level, parentId, q), q === '' ? 0 : 300)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [workspace?.path, workspace?.readOnly, level, parentId, q, load])

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDetailOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Auto reload cell detail if grain changes while drawer is open
  useEffect(() => {
    if (detailOpen && selectedCellNode) {
      void (async () => {
        setDetailLoading(true)
        try {
          const d = await window.api.analytics.cellDetail(selectedCellNode.id, grain)
          if (d) setDetail(d)
        } finally {
          setDetailLoading(false)
        }
      })()
    }
  }, [grain, selectedCellNode, detailOpen])

  function drill(node: ExplorerNode): void {
    if (level === 'cell') return
    setQ('')
    setParentId(node.id)
    setLevel(CHILD_LEVEL[level])
  }

  function jumpTo(item: { id: number; level: ExplorerLevel }): void {
    if (item.level === 'cell') return
    setQ('')
    if (item.level === 'region') {
      setLevel('district')
      setParentId(item.id)
      return
    }
    setLevel(CHILD_LEVEL[item.level])
    setParentId(item.id)
  }

  async function openDetail(node: ExplorerNode): Promise<void> {
    setSelectedCellNode(node)
    setDetailLoading(true)
    try {
      const d = await window.api.analytics.cellDetail(node.id, grain)
      if (d) {
        setDetail(d)
        setDetailOpen(true)
      }
    } finally {
      setDetailLoading(false)
    }
  }

  const nodes = result?.nodes ?? []
  const isCellLevel = level === 'cell'
  const is4G = selectedTech === '4G'
  const is3G = selectedTech === '3G'

  const analytics = detail ? computeCellAnalytics(detail, prbThreshold, grain, selectedTech) : null

  return (
    <div className="module">
      <div className="module-head">
        <h2>Network Explorer</h2>
        <span className="module-workspace">{workspace?.name}</span>
        {result && (
          <span className="module-workspace">
            {nodes.length.toLocaleString()} {LEVEL_LABEL[level].toLowerCase()}
            {result.ncCells > 0 ? `s · ${result.ncCells.toLocaleString()} NC` : 's'} · {result.totalCells.toLocaleString()} cells
          </span>
        )}
      </div>

      <div className="row-actions filter-row">
        <nav className="crumbs" aria-label="Hierarchy">
          <button className={`crumb${level === 'region' ? ' crumb-current' : ''}`} onClick={() => { setQ(''); setLevel('region'); setParentId(null) }}>
            Network
          </button>
          {(result?.breadcrumb ?? []).map((b, i) => (
            <span key={`${b.level}-${b.id}`} className="crumb-sep">
              <span className="crumb-arrow">›</span>
              <button className="crumb" onClick={() => jumpTo(b)}>
                {b.name}
              </button>
              {i === (result?.breadcrumb?.length ?? 0) - 1 && <span className="crumb-live"> · {LEVEL_LABEL[level]}s</span>}
            </span>
          ))}
        </nav>
        <input
          className="input"
          placeholder={`Search ${LEVEL_LABEL[level].toLowerCase()}s…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error && <div className="notice notice-error">{error}</div>}
      {loading && !result && <div className="notice">Loading {LEVEL_LABEL[level].toLowerCase()}s…</div>}
      {!loading && !error && nodes.length === 0 && (
        <div className="notice">
          {q ? 'No matches — try a different search.' : 'Nothing here yet — import data first.'}
        </div>
      )}

      {nodes.length > 0 && (
        <div className="card">
          <div className="preview-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{LEVEL_LABEL[level]}</th>
                  <th>Health</th>
                  <th>NC</th>
                  {isCellLevel && (
                    <>
                      <th>Lifecycle</th>
                      <th>Severity</th>
                      <th>Priority</th>
                    </>
                  )}
                  <th>{is4G ? 'PRB' : is3G ? '3G Util' : 'TCH Cong'}</th>
                  <th>Speed</th>
                  {is4G && (
                    <>
                      <th>Users</th>
                      <th>Vol</th>
                    </>
                  )}
                  <th>Avail</th>
                  {!is4G && <th>Breach Count</th>}
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr
                    key={`${level}-${n.id}`}
                    className={isCellLevel ? 'cell-row' : 'node-row'}
                    onClick={() => void (isCellLevel ? openDetail(n) : drill(n))}
                    title={isCellLevel ? 'Open cell detail' : `Drill into ${n.name}`}
                  >
                    <td>
                      <span className="node-name">
                        {!isCellLevel && <span className="node-chevron">›</span>}
                        {n.name}
                      </span>
                    </td>
                    <td>
                      <div className="health-cell">
                        <span style={{ color: healthColor(n.healthScore), fontWeight: 700 }}>{n.healthScore ?? '—'}</span>
                        {n.healthScore != null && (
                          <div className="health-bar">
                            <div
                              className="health-fill"
                              style={{ width: `${n.healthScore}%`, background: healthColor(n.healthScore) }}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      {n.ncCells > 0 ? (
                        <span className="nc-count" style={{ color: 'var(--danger)' }}>
                          {n.ncCells}
                          {n.cells > 1 ? ` / ${n.cells}` : ''}
                        </span>
                      ) : (
                        <span className="cell-dim">0{n.cells > 1 ? ` / ${n.cells}` : ''}</span>
                      )}
                    </td>
                    {isCellLevel && (
                      <>
                        <td>
                          <Chip
                            text={n.lifecycle ?? '—'}
                            tone={n.lifecycle === 'Persistent NC' ? 'bad' : n.lifecycle === 'Recurring NC' ? 'warn' : n.lifecycle === 'New NC' ? 'ok' : 'dim'}
                          />
                        </td>
                        <td>
                          <Chip text={n.severity ?? '—'} tone={n.severity === 'Critical' ? 'bad' : n.severity === 'High' ? 'warn' : 'dim'} />
                        </td>
                        <td>
                          {n.priorityScore != null ? (
                            <span style={{ color: BAND_COLOR[n.priorityBand ?? 'Low'] ?? 'var(--text)', fontWeight: 700 }}>
                              {n.priorityScore}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </>
                    )}
                    <td>{fmtPct(n.prbAvg)}</td>
                    <td>{fmtMbps(n.throughputKbps)}</td>
                    {is4G && (
                      <>
                        <td>{fmtN(n.users)}</td>
                        <td>{fmtG(n.volumeMb)}</td>
                      </>
                    )}
                    <td>{fmtPct(n.availability)}</td>
                    {!is4G && <td>{n.ncCells > 0 ? n.ncCells : '0'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="card-note">
            {isCellLevel
              ? 'Click a cell to open its detail view. Health rolls up from cell health history; KPIs reflect the latest grain period.'
              : `Click a ${LEVEL_LABEL[level].toLowerCase()} to drill into its ${CHILD_LEVEL[level].toLowerCase()}s. Health rolls up from cell health history.`}
          </p>
        </div>
      )}

      {detailOpen && detail && (
        <div className="drawer-overlay" onClick={() => setDetailOpen(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <div className="drawer-title">{detail.cellName}</div>
                <div className="drawer-sub">{[detail.site, detail.district, detail.region].filter(Boolean).join(' · ') || '—'}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  className={`btn btn-sm ${isPinned(`cell:${selectedCellNode?.id}`) ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ border: '1px solid var(--border)' }}
                  onClick={() => {
                    if (selectedCellNode) {
                      togglePin({
                        id: `cell:${selectedCellNode.id}`,
                        type: 'cell',
                        name: detail.cellName,
                        detail: detail.site ?? undefined
                      })
                    }
                  }}
                >
                  {isPinned(`cell:${selectedCellNode?.id}`) ? '⭐ Pinned' : '☆ Pin'}
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ border: '1px solid var(--border)' }}
                  title="Open in Simulation Lab"
                  onClick={() => {
                    setDetailOpen(false)
                    setModule('simulation-lab')
                  }}
                >
                  🧪 Simulate
                </button>
                <button className="btn btn-sm" onClick={() => setDetailOpen(false)}>✕</button>
              </div>
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

            {detailLoading ? (
              <p className="card-note">Loading {grain} data…</p>
            ) : detail.weeks.length > 0 ? (
              <Chart option={cellDetailOption(detail, prbThreshold, grain, selectedTech)} height={480} />
            ) : (
              <p className="card-note">No {grain} history for this cell yet.</p>
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

            {/* Deep Cell Analytics & Diagnostics */}
            {analytics && (
              <div className="drawer-analytics-section">
                <div className="drawer-analytics-grid">
                  <div className="drawer-stat-card">
                    <span className="drawer-stat-label">Observed {grain === 'daily' ? 'Days' : grain === 'monthly' ? 'Months' : 'Weeks'}</span>
                    <span className="drawer-stat-val">{analytics.observed}</span>
                  </div>
                  <div className="drawer-stat-card">
                    <span className="drawer-stat-label">Breach Count</span>
                    <span className="drawer-stat-val" style={{ color: 'var(--danger)' }}>{analytics.breaches}</span>
                  </div>
                  <div className="drawer-stat-card">
                    <span className="drawer-stat-label">Breach Rate</span>
                    <span className="drawer-stat-val">{analytics.breachRate}%</span>
                  </div>
                  <div className="drawer-stat-card">
                    <span className="drawer-stat-label">Peak Metric</span>
                    <span className="drawer-stat-val">{analytics.maxPrb}</span>
                  </div>
                </div>

                <div className="drawer-insight-box">
                  <div className="drawer-insight-header">
                    <span>⚡</span>
                    <span>Automated Diagnostic & Root Cause</span>
                  </div>
                  <div className="drawer-insight-text">
                    {analytics.insight}
                    {analytics.peakDayText && <span style={{ display: 'block', marginTop: 3, fontWeight: 600, color: 'var(--text)' }}>{analytics.peakDayText}</span>}
                  </div>
                </div>

                <div className="drawer-rec-box">
                  <div className="drawer-rec-header">
                    <span>🔧</span>
                    <span>Engineering Recommendation</span>
                  </div>
                  <div className="drawer-rec-text">{analytics.rec}</div>
                </div>
              </div>
            )}

            <p className="card-note" style={{ marginTop: 4 }}>
              {grain === 'daily'
                ? `Daily history (day-by-day observations). ${is4G ? 'PRB' : is3G ? 'Utilization' : 'TCH'} threshold: ${prbThreshold}%.`
                : grain === 'monthly'
                ? `Monthly history. ${is4G ? 'PRB' : is3G ? 'Utilization' : 'TCH'} threshold: ${prbThreshold}%.`
                : `Weekly history (ISO weeks). ${is4G ? 'PRB' : is3G ? 'Utilization' : 'TCH'} threshold: ${prbThreshold}%; strip marks NC state (N new · R recurring · P persistent · C recovering).`}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

