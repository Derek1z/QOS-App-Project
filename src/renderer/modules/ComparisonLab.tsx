import { useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { useAppStore } from '../store'
import type {
  CompareMetric, CompareScope, CompareSort, CompareView, ComparisonKpi,
  ComparisonResult, ComparisonType
} from '../../../shared/api'
import Chart from '../lib/Chart'
import { formatCompare, rankingOption, rankRows } from '../lib/comparisonCharts'
import { formatTimeLabel } from '../lib/overviewCharts'

const TYPES: Array<{ id: ComparisonType; label: string }> = [
  { id: 'period', label: 'Period vs Period' },
  { id: 'region', label: 'Region vs Region' }
]

const SCOPES: Array<{ id: CompareScope; label: string }> = [
  { id: 'cell', label: 'Cell' },
  { id: 'site', label: 'Site' },
  { id: 'district', label: 'District' },
  { id: 'region', label: 'Region' }
]

const METRICS: Array<{ id: CompareMetric; label: string }> = [
  { id: 'prb', label: 'PRB' },
  { id: 'throughput', label: 'Speed' },
  { id: 'users', label: 'Users' },
  { id: 'volume', label: 'Volume' },
  { id: 'availability', label: 'Avail.' },
  { id: 'nc', label: 'NC' }
]

const VIEWS: Array<{ id: CompareView; label: string }> = [
  { id: 'actual', label: 'Actual' },
  { id: 'indexed', label: 'Indexed' },
  { id: 'delta', label: 'Delta' }
]

const SORTS: Array<{ id: CompareSort; label: string }> = [
  { id: 'worst', label: 'Worst change first' },
  { id: 'best', label: 'Best change first' },
  { id: 'name', label: 'Name A–Z' }
]

const TRANSITION_LABEL: Record<string, string> = {
  nc: 'Still NC',
  new: 'New NC',
  recovered: 'Recovered',
  ok: 'Not NC'
}

function Chip({ text, tone }: { text: string; tone?: 'ok' | 'warn' | 'bad' | 'dim' }): React.JSX.Element {
  return <span className={`chip chip-${tone ?? 'dim'}`}>{text}</span>
}

function KpiCard({ k, mode }: { k: ComparisonKpi; mode: ComparisonType }): React.JSX.Element {
  const better = k.delta == null ? null : k.worseIsHigher ? k.delta < 0 : k.delta > 0
  const toneClass = better === null ? '' : better ? 'kpi-delta-good' : 'kpi-delta-bad'
  const arrow = k.delta == null ? '' : k.delta >= 0 ? '▲' : '▼'
  return (
    <div className="kpi cmp-kpi" title={k.label}>
      <div className="kpi-value">{formatCompare(k.metric, k.current)}</div>
      <div className="kpi-label">{k.label}</div>
      {mode === 'period' ? (
        <div className="cmp-kpi-sub">
          <span className="cmp-kpi-prev">was {formatCompare(k.metric, k.previous)}</span>
          {k.delta != null && (
            <span className={`cmp-kpi-delta ${toneClass}`}>
              {arrow} {formatCompare(k.metric, k.delta)}
              {k.deltaPct != null ? ` (${k.deltaPct >= 0 ? '+' : ''}${k.deltaPct}%)` : ''}
            </span>
          )}
        </div>
      ) : (
        <div className="cmp-kpi-sub">
          <span className="cmp-kpi-prev">
            network · best {formatCompare(k.metric, k.best)} · worst {formatCompare(k.metric, k.worst)}
          </span>
        </div>
      )}
    </div>
  )
}

export default function ComparisonLab(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const grain = useAppStore((s) => s.grain)
  const period = useAppStore((s) => s.period)
  const [type, setType] = useState<ComparisonType>('period')
  const [scope, setScope] = useState<CompareScope>('cell')
  const [metric, setMetric] = useState<CompareMetric>('prb')
  const [view, setView] = useState<CompareView>('delta')
  const [sort, setSort] = useState<CompareSort>('worst')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 50
  const [result, setResult] = useState<ComparisonResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const r = await window.api.analytics.comparison({ type, scope, metric, grain, period })
        if (alive) {
          setResult(r)
          setPage(1)
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [workspace?.path, workspace?.readOnly, type, scope, metric, grain, period])

  const ranked = useMemo(() => (result ? rankRows(result, sort) : []), [result, sort])
  const chartRows = ranked.slice(0, 15)
  const option: EChartsOption | null = useMemo(
    () => (result && chartRows.length > 0 ? rankingOption(result, chartRows, view) : null),
    [result, chartRows, view]
  )

  const filtered = useMemo(() => {
    if (!search.trim()) return ranked
    const q = search.trim().toLowerCase()
    return ranked.filter((r) => r.name.toLowerCase().includes(q))
  }, [ranked, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedRows = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize]
  )

  return (
    <div className="module">
      <div className="module-head">
        <h2>Comparison Lab</h2>
        <span className="module-workspace">{workspace?.name}</span>
        {result && (
          <span className="module-workspace">
            {result.aLabel} ({formatTimeLabel(result.aLabel, grain)}) vs {result.bLabel}
            {result.type === 'region' ? '' : ` (${formatTimeLabel(result.bLabel, grain)})`} · {result.totalRows.toLocaleString()}{' '}
            {result.scope === 'cell' ? 'cells' : result.scope === 'site' ? 'sites' : result.scope === 'district' ? 'districts' : 'regions'}
          </span>
        )}
      </div>

      <div className="row-actions filter-row">
        <div className="seg">
          {TYPES.map((t) => (
            <button
              key={t.id}
              className={`seg-btn${type === t.id ? ' active' : ''}`}
              onClick={() => { setType(t.id); setPage(1) }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {type === 'period' && (
          <div className="seg">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                className={`seg-btn${scope === s.id ? ' active' : ''}`}
                onClick={() => { setScope(s.id); setPage(1) }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        <div className="seg">
          {METRICS.map((m) => (
            <button
              key={m.id}
              className={`seg-btn${metric === m.id ? ' active' : ''}`}
              onClick={() => { setMetric(m.id); setPage(1) }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="seg">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`seg-btn${view === v.id ? ' active' : ''}`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <select className="sel" value={sort} onChange={(e) => { setSort(e.target.value as CompareSort); setPage(1) }}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {error && <div className="notice notice-error">{error}</div>}
      {loading && !result && <div className="notice">Loading comparison…</div>}
      {!loading && !error && !result && (
        <div className="notice">No {grain} aggregates yet — import data first.</div>
      )}

      {result && (
        <>
          <div className="kpi-strip">
            {result.kpis.map((k) => (
              <KpiCard key={k.metric} k={k} mode={result.type} />
            ))}
          </div>

          <div className="card">
            <div className="card-head-row">
              <h3>
                Difference ranking —{' '}
                {metric === 'nc' ? 'NC cells' : METRICS.find((m) => m.id === metric)?.label}
              </h3>
              <span className="card-note">
                {type === 'period'
                  ? `${result.aLabel} vs ${result.bLabel}`
                  : `${result.aLabel} regions vs network average`}
                {view === 'indexed' ? ' · baseline = 100' : view === 'delta' ? ' · no-change line at 0' : ''}
              </span>
            </div>
            <Chart option={option} height={Math.max(220, Math.min(560, chartRows.length * 26 + 40))} />
            {chartRows.length === 0 && <p className="card-note">No comparable entities in this selection.</p>}
            <p className="card-note">
              Top {chartRows.length} of {result.totalRows.toLocaleString()} ranked by the selected sort. Hover for
              values; delta bars are green when the change is an improvement for the metric and red when it is a
              deterioration.
            </p>
          </div>

          <div className="card">
            <div className="card-head-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h3>Ranking table</h3>
                <span className="card-note">
                  Showing {filtered.length === 0 ? '0' : `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)}`} of {filtered.length.toLocaleString()} entities
                  {search && ` (filtered from ${result.totalRows.toLocaleString()})`}
                </span>
              </div>
              <input
                className="input"
                style={{ width: 240 }}
                placeholder={`Search ${scope}…`}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              />
            </div>
            <div className="preview-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>
                      {scope === 'cell' ? 'Cell' : scope === 'site' ? 'Site' : scope === 'district' ? 'District' : 'Region'}
                    </th>
                    <th>{result.aLabel}</th>
                    <th>{result.bLabel}</th>
                    <th>Δ</th>
                    <th>Δ%</th>
                    <th>NC</th>
                    <th>Cells</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((r, idx) => {
                    const i = (currentPage - 1) * pageSize + idx
                    const worseIsHigher = result.kpis.find((k) => k.metric === result.metric)?.worseIsHigher ?? false
                    return (
                      <tr key={`${r.id}-${r.name}`}>
                        <td className="cell-dim">{i + 1}</td>
                        <td>{r.name}</td>
                        <td>{formatCompare(result.metric, r.current)}</td>
                        <td>{formatCompare(result.metric, r.previous)}</td>
                        <td
                          className={r.delta == null ? 'cell-dim' : ''}
                          style={
                            r.delta == null
                              ? undefined
                              : { color: (worseIsHigher ? r.delta > 0 : r.delta < 0) ? 'var(--danger)' : 'var(--green)' }
                          }
                        >
                          {r.delta == null ? '—' : `${r.delta >= 0 ? '+' : ''}${formatCompare(result.metric, r.delta)}`}
                        </td>
                        <td className="cell-dim">
                          {r.deltaPct == null ? '—' : `${r.deltaPct >= 0 ? '+' : ''}${r.deltaPct}%`}
                        </td>
                        <td>
                          {r.transition ? (
                            <Chip
                              text={TRANSITION_LABEL[r.transition] ?? r.transition}
                              tone={r.transition === 'nc' ? 'bad' : r.transition === 'new' ? 'warn' : r.transition === 'recovered' ? 'ok' : 'dim'}
                            />
                          ) : (
                            <span>{r.ncCells}</span>
                          )}
                        </td>
                        <td className="cell-dim">{r.cells}</td>
                      </tr>
                    )
                  })}
                  {pagedRows.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-dim)' }}>
                        {search ? 'No matching entities found.' : 'No rows to display.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="table-pagination" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <span className="card-note">Page {currentPage} of {totalPages}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    ← Previous
                  </button>
                  <button className="btn" disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
