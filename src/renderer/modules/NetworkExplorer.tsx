import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import type { CellDetail, ExplorerLevel, ExplorerNode, ExplorerResult } from '../../../shared/api'
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

export default function NetworkExplorer(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const [level, setLevel] = useState<ExplorerLevel>('region')
  const [parentId, setParentId] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const [result, setResult] = useState<ExplorerResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<CellDetail | null>(null)
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
    setDetailLoading(true)
    try {
      const d = await window.api.analytics.cellDetail(node.id)
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
                  <th>PRB</th>
                  <th>Speed</th>
                  <th>Users</th>
                  <th>Vol</th>
                  <th>Avail</th>
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
                    <td>{fmtN(n.users)}</td>
                    <td>{fmtG(n.volumeMb)}</td>
                    <td>{fmtPct(n.availability)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="card-note">
            {isCellLevel
              ? 'Click a cell to open its detail view. Health rolls up from cell health history; KPIs are the latest week.'
              : `Click a ${LEVEL_LABEL[level].toLowerCase()} to drill into its ${CHILD_LEVEL[level].toLowerCase()}s. Health rolls up from cell health history (same methodology as the Health Matrix).`}
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
              Weekly history (ISO weeks, Monday–Sunday). PRB grid shows the ruleset threshold ({prbThreshold}%); the strip
              marks each week's NC state (N new · R recurring · P persistent · C recovering).
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
