import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { useAppStore } from '../store'
import type {
  EntityOption, ForecastHorizon, ForecastMetric, ForecastResult, ForecastRisk,
  ForecastScope
} from '../../../shared/api'
import Chart from '../lib/Chart'
import { forecastChartOption, fmtFc } from '../lib/forecastCharts'

const SCOPES: Array<{ id: ForecastScope; label: string }> = [
  { id: 'network', label: 'Network' },
  { id: 'region', label: 'Region' },
  { id: 'district', label: 'District' },
  { id: 'site', label: 'Site' },
  { id: 'cell', label: 'Cell' }
]

const METRICS: Array<{ id: ForecastMetric; label: string }> = [
  { id: 'prb', label: 'PRB' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'users', label: 'Users' },
  { id: 'throughput', label: 'Throughput' },
  { id: 'availability', label: 'Availability' }
]

const HORIZONS: Array<{ id: ForecastHorizon; label: string }> = [
  { id: '1w', label: 'Next week' },
  { id: '2w', label: '2 weeks' },
  { id: '4w', label: '4 weeks' },
  { id: '6w', label: '6 weeks' }
]

const RISK_ORDER: ForecastRisk[] = ['Already Breached', 'Likely Breach', 'At Risk', 'Watch', 'Stable']

const riskTone = (r: ForecastRisk): string =>
  r === 'Already Breached' ? 'bad' : r === 'Likely Breach' ? 'bad' : r === 'At Risk' ? 'warn' : r === 'Watch' ? 'warn' : 'ok'

function Chip({ text, tone }: { text: string; tone: string }): React.JSX.Element {
  return <span className={`chip chip-${tone}`}>{text}</span>
}

async function searchOptions(scope: ForecastScope, q: string): Promise<EntityOption[]> {
  if (scope === 'network') return []
  if (scope === 'region') {
    const r = await window.api.analytics.explorer('region', null, { q: q.trim() || undefined })
    return r.nodes.map((n) => ({ id: n.id, name: n.name, path: [n.name] }))
  }
  return window.api.investigation.search(scope, q.trim() || undefined)
}

export default function Forecasting(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const [scope, setScope] = useState<ForecastScope>('network')
  const [entity, setEntity] = useState<EntityOption | null>(null)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<EntityOption[]>([])
  const [metric, setMetric] = useState<ForecastMetric>('prb')
  const [horizon, setHorizon] = useState<ForecastHorizon>('4w')
  const [result, setResult] = useState<ForecastResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [riskFilter, setRiskFilter] = useState<ForecastRisk | ''>('')
  const [showAll, setShowAll] = useState(25)
  const [pickerOpen, setPickerOpen] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (): Promise<void> => {
    // non-network scopes need an entity before a forecast can exist
    if (scope !== 'network' && !entity) {
      setResult(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const r = await window.api.analytics.forecast({
        scope,
        entityId: scope === 'network' ? null : entity?.id ?? null,
        metric,
        horizon
      })
      setResult(r)
      setShowAll(25)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [scope, entity, metric, horizon])

  useEffect(() => {
    void load()
  }, [load, workspace?.path])

  // entity search (debounced), non-network scopes only; the dropdown only
  // opens while the input is focused, so picking an entity closes it
  useEffect(() => {
    if (scope === 'network') {
      setOptions([])
      setQuery('')
      setEntity(null)
      setPickerOpen(false)
      return
    }
    if (query === '' && !pickerOpen) {
      setOptions([])
      return
    }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      void (async () => {
        try {
          setOptions(await searchOptions(scope, query))
        } catch {
          setOptions([])
        }
      })()
    }, query === '' ? 0 : 300)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [scope, query, pickerOpen])

  useEffect(() => {
    setRiskFilter('')
  }, [metric, horizon, scope, entity])

  function pick(ent: EntityOption): void {
    setEntity(ent)
    setQuery('')
    setOptions([])
    setPickerOpen(false)
  }

  const selSeries = useMemo(
    () => result?.series.find((s) => s.metric === metric) ?? null,
    [result, metric]
  )
  const option: EChartsOption | null = useMemo(
    () => (selSeries ? forecastChartOption(selSeries) : null),
    [selSeries]
  )

  const riskRows = useMemo(() => {
    const rows = result?.riskRows ?? []
    return riskFilter ? rows.filter((r) => r.risk === riskFilter) : rows
  }, [result, riskFilter])

  const riskCounts = result?.riskCounts ?? { Stable: 0, Watch: 0, 'At Risk': 0, 'Likely Breach': 0, 'Already Breached': 0 }

  return (
    <div className="module">
      <div className="module-head">
        <h2>Forecasting &amp; Early Warning</h2>
        <span className="module-workspace">{workspace?.name}</span>
        {result && (
          <span className="module-workspace">
            {result.entity.path.join(' › ')} · as of {result.asOf}
          </span>
        )}
      </div>

      {/* controls */}
      <div className="row-actions filter-row">
        <div className="seg">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              className={`seg-btn${scope === s.id ? ' active' : ''}`}
              onClick={() => {
                setScope(s.id)
                setEntity(null)
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        {scope !== 'network' && (
          <div className="fc-picker">
            <input
              className="input"
              placeholder={entity ? entity.name : `Search ${scope}s… (or select below)`}
              value={query}
              onFocus={() => {
                if (blurTimer.current) clearTimeout(blurTimer.current)
                setPickerOpen(true)
              }}
              onBlur={() => {
                blurTimer.current = setTimeout(() => setPickerOpen(false), 150)
              }}
              onChange={(e) => setQuery(e.target.value)}
            />
            {pickerOpen && options.length > 0 && (
              <div className="fc-options">
                {options.slice(0, 12).map((o) => (
                  <button key={`${scope}-${o.id}`} className="fc-option" onClick={() => pick(o)}>
                    <span className="fc-option-name">{o.name}</span>
                    <span className="fc-option-path">{o.path.join(' › ')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="seg">
          {METRICS.map((m) => (
            <button
              key={m.id}
              className={`seg-btn${metric === m.id ? ' active' : ''}`}
              onClick={() => setMetric(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="seg">
          {HORIZONS.map((h) => (
            <button
              key={h.id}
              className={`seg-btn${horizon === h.id ? ' active' : ''}`}
              onClick={() => setHorizon(h.id)}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="status-error">{error}</div>}
      {loading && <div className="status-dim">Loading…</div>}
      {!loading && scope !== 'network' && !entity && (
        <div className="notice notice-dim fc-pick-hint">
          Pick a {scope} from the search box above to forecast it — or switch back to Network.
        </div>
      )}

      {result && (
        <>
      {/* risk strip */}
      <div className="fc-risk-strip">
        <span className="fc-risk-head">
          Early-warning risk · {result.entity.name}:{' '}
          <b className={`fc-risk-entity fc-risk-${result.risk.toLowerCase().replace(/ /g, '-')}`}>{result.risk}</b>
        </span>
        {RISK_ORDER.map((r) => (
          <button
            key={r}
            className={`fc-risk-chip${riskFilter === r ? ' active' : ''}`}
            onClick={() => setRiskFilter(riskFilter === r ? '' : r)}
          >
            <span className={`fc-dot fc-dot-${riskTone(r)}`}></span>
            {r} <b>{riskCounts[r] ?? 0}</b>
          </button>
        ))}
        <span className="fc-risk-note">{result.riskExplanation}</span>
      </div>

      {/* forecast chart + summary */}
      <div className="card">
        <div className="card-head-row">
          <h3>{selSeries?.label ?? '—'} — actual vs forecast</h3>
          {selSeries?.forecast.next != null && (
            <span className="card-note">
              next {selSeries.label.toLowerCase()} ≈ <b>{fmtFc(selSeries.forecast.next, selSeries.unit)}</b>
              {selSeries.forecast.confidence != null && ` · confidence ${selSeries.forecast.confidence}%`}
            </span>
          )}
        </div>
        {selSeries ? (
          <>
            <Chart option={option} height={300} />
            <div className="fc-metric-row">
              {result?.series.map((s) => {
                const fc = s.forecast
                return (
                  <div
                    key={s.metric}
                    className={`fc-metric-card${metric === s.metric ? ' active' : ''}`}
                    onClick={() => setMetric(s.metric)}
                    title={fc.explanation}
                  >
                    <div className="fc-metric-label">{s.label}</div>
                    <div className="fc-metric-next">{fmtFc(fc.next, s.unit)}</div>
                    <div className="fc-metric-sub">
                      {fc.quality === 'suppressed' ? 'suppressed' : `method ${fc.method}`}
                      {' · '}{fc.quality}
                    </div>
                    {fc.next != null && fc.lower != null && fc.upper != null && (
                      <div className="fc-metric-band">
                        {fmtFc(fc.lower, s.unit)} – {fmtFc(fc.upper, s.unit)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div className="pc-empty">No forecast data for this scope.</div>
        )}
      </div>

      {/* risk table */}
      <div className="card">
        <div className="card-head-row">
          <h3>At-risk entities — {metric === 'prb' ? 'PRB' : metric === 'traffic' ? 'traffic' : metric === 'users' ? 'users' : metric === 'throughput' ? 'throughput' : 'availability'}</h3>
          <span className="card-note">
            {result?.totalEntities.toLocaleString() ?? '—'} entities · worst first
          </span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Entity</th>
                <th className="num">Current</th>
                <th className="num">Forecast</th>
                <th className="num">Threshold</th>
                <th>Risk</th>
                <th>Explanation</th>
              </tr>
            </thead>
            <tbody>
              {riskRows.slice(0, showAll).map((r) => (
                <tr key={`${scope}-${r.id}`}>
                  <td>
                    <div className="fc-name">{r.name}</div>
                    <div className="fc-path">{r.path.join(' › ')}</div>
                  </td>
                  <td className="num">{fmtFc(r.current, selSeries?.unit ?? '')}</td>
                  <td className="num">{fmtFc(r.forecast, selSeries?.unit ?? '')}</td>
                  <td className="num">{r.threshold == null ? '—' : fmtFc(r.threshold, selSeries?.unit ?? '')}</td>
                  <td><Chip text={r.risk} tone={riskTone(r.risk)} /></td>
                  <td className="fc-explain">{r.explanation}</td>
                </tr>
              ))}
              {riskRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="pc-empty">No entities in this risk state.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {riskRows.length > showAll && (
          <div className="pc-footer">
            <span>Showing {Math.min(showAll, riskRows.length)} of {riskRows.length}</span>
            <button className="btn btn-sm" onClick={() => setShowAll(showAll + 25)}>Show more</button>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  )
}
