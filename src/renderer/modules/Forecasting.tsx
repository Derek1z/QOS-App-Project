import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { useAppStore } from '../store'
import type {
  EntityOption, ForecastHorizon, ForecastMetric, ForecastResult, ForecastRisk,
  ForecastScope, ForecastSeries, Technology
} from '../../../shared/api'
import { DEFAULT_HORIZON, PERIOD_NOUN } from '../../../shared/forecast'
import Chart from '../lib/Chart'
import { forecastChartOption, rcaSunburstChartOption, fmtFc } from '../lib/forecastCharts'

const TECHS: Technology[] = ['4G', '3G', '2G']

const SCOPES: Array<{ id: ForecastScope; label: string }> = [
  { id: 'network', label: 'Network' },
  { id: 'region', label: 'Region' },
  { id: 'district', label: 'District' },
  { id: 'site', label: 'Site' },
  { id: 'cell', label: 'Cell' }
]

const riskTone = (r: ForecastRisk | null): string =>
  r === 'Already Breached' ? 'bad' : r === 'Likely Breach' ? 'bad' : r === 'At Risk' ? 'warn' : r === 'Watch' ? 'warn' : r === 'Withheld' || r == null ? 'dim' : 'ok'

/** The forecast value at the selected horizon (the last forecast point). */
const horizonValue = (s: ForecastSeries | null): number | null => {
  const pts = s?.points.filter((p) => p.kind === 'forecast') ?? []
  return pts.length > 0 ? pts[pts.length - 1].value : null
}

function rcaClass(cat?: string): string {
  if (!cat) return 'rca-normal'
  if (cat.includes('Capacity')) return 'rca-capacity'
  if (cat.includes('RF') || cat.includes('Interference')) return 'rca-rf'
  if (cat.includes('Hardware') || cat.includes('VSWR')) return 'rca-hardware'
  if (cat.includes('Parameter') || cat.includes('Handover')) return 'rca-parameter'
  if (cat.includes('Traffic')) return 'rca-traffic'
  return 'rca-normal'
}

function rcaIcon(cat?: string): string {
  if (!cat) return '●'
  if (cat.includes('Capacity')) return '⚡'
  if (cat.includes('RF') || cat.includes('Interference')) return '📡'
  if (cat.includes('Hardware') || cat.includes('VSWR')) return '🔌'
  if (cat.includes('Parameter') || cat.includes('Handover')) return '⚙️'
  if (cat.includes('Traffic')) return '👥'
  return '✓'
}

function Chip({ text, tone }: { text: string; tone: string }): React.JSX.Element {
  return <span className={`chip chip-${tone}`}>{text}</span>
}

async function searchOptions(scope: ForecastScope, q: string): Promise<EntityOption[]> {
  if (scope === 'network') return []
  if (scope === 'region') {
    const r = await window.api.analytics.explorer('region', null, { q: q.trim() || undefined })
    return r.nodes.slice(0, 50).map((n) => ({ id: n.id, name: n.name, path: [n.name] }))
  }
  const results = await window.api.investigation.search(scope, q.trim() || undefined)
  return results.slice(0, 50)
}

export default function Forecasting(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const grain = useAppStore((s) => s.grain)
  const period = useAppStore((s) => s.period)

  const selectedTech = useAppStore((s) => s.selectedTech)
  const setSelectedTech = useAppStore((s) => s.setSelectedTech)

  const [tech, setTech] = useState<Technology>(selectedTech || '4G')
  const [scope, setScope] = useState<ForecastScope>('network')
  const [entity, setEntity] = useState<EntityOption | null>(null)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<EntityOption[]>([])
  // '' lets the service pick the default KPI (one with a target, NC KPIs first)
  const [metric, setMetric] = useState<ForecastMetric>('')
  const [horizon, setHorizon] = useState<ForecastHorizon>(DEFAULT_HORIZON[grain])
  const [result, setResult] = useState<ForecastResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedFilter, setSelectedFilter] = useState<string>('')
  const [showAll, setShowAll] = useState(25)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null)
  const [tableSearch, setTableSearch] = useState('')

  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reqSeq = useRef(0)

  // KPI keys differ per technology; horizons differ per grain
  useEffect(() => {
    setMetric('')
  }, [tech])
  useEffect(() => {
    setHorizon(DEFAULT_HORIZON[grain])
  }, [grain])

  // Sync selected technology
  useEffect(() => {
    if (selectedTech && selectedTech !== tech) {
      setTech(selectedTech)
    }
  }, [selectedTech])

  const load = useCallback(async (): Promise<void> => {
    if (scope !== 'network' && !entity) {
      setResult(null)
      setLoading(false)
      return
    }
    const currentReq = ++reqSeq.current
    setLoading(true)
    setError(null)
    try {
      const r = await window.api.analytics.forecast({
        scope,
        entityId: scope === 'network' ? null : entity?.id ?? null,
        metric: metric || undefined,
        horizon,
        grain,
        technology: tech
      })
      if (currentReq === reqSeq.current) {
        setResult(r)
        setShowAll(25)
      }
    } catch (e) {
      if (currentReq === reqSeq.current) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (currentReq === reqSeq.current) {
        setLoading(false)
      }
    }
  }, [scope, entity, metric, horizon, grain, tech])

  useEffect(() => {
    void load()
  }, [load, workspace?.path])

  const changeScope = async (newScope: ForecastScope) => {
    setScope(newScope)
    setQuery('')
    if (newScope === 'network') {
      setEntity(null)
      setOptions([])
    } else {
      try {
        const opts = await searchOptions(newScope, '')
        setOptions(opts)
        if (opts.length > 0) {
          setEntity(opts[0])
        } else {
          setEntity(null)
        }
      } catch (err) {
        console.error('Failed to load scope entities:', err)
        setEntity(null)
      }
    }
  }

  // entity search (debounced), non-network scopes only
  useEffect(() => {
    if (scope === 'network') {
      setOptions([])
      setQuery('')
      setEntity(null)
      setPickerOpen(false)
      return
    }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      void (async () => {
        try {
          const opts = await searchOptions(scope, query)
          setOptions(opts)
          if (!entity && opts.length > 0) {
            setEntity(opts[0])
          }
        } catch {
          setOptions([])
        }
      })()
    }, query === '' ? 0 : 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [scope, query])

  function pick(ent: EntityOption): void {
    setEntity(ent)
    setQuery('')
    setPickerOpen(false)
  }

  const selSeries = result?.series ?? null

  const lineChartOption: EChartsOption | null = useMemo(
    () => (selSeries ? forecastChartOption(selSeries) : null),
    [selSeries]
  )

  const sunburstOption: EChartsOption | null = useMemo(() => {
    if (!result) return null
    return rcaSunburstChartOption(
      result.riskCounts,
      result.rcaCounts ?? {},
      selectedFilter
    )
  }, [result, selectedFilter])

  const handleSunburstClick = useCallback((params: any) => {
    if (params && params.name) {
      const clickedName = String(params.name)
      if (clickedName === 'Normal Stable' || clickedName === 'Operating Norm') {
        setSelectedFilter((prev) => (prev === 'Stable' ? '' : 'Stable'))
      } else if (clickedName === 'At-Risk / Breached') {
        setSelectedFilter((prev) => (prev === 'At Risk' ? '' : 'At Risk'))
      } else {
        setSelectedFilter((prev) => (prev === clickedName ? '' : clickedName))
      }
    }
  }, [])

  const chartEvents = useMemo(() => ({
    click: handleSunburstClick
  }), [handleSunburstClick])

  const riskRows = useMemo(() => {
    let rows = result?.riskRows ?? []
    if (selectedFilter) {
      rows = rows.filter((r) => r.risk === selectedFilter || r.hint?.category === selectedFilter)
    }
    if (tableSearch.trim()) {
      const q = tableSearch.trim().toLowerCase()
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.path.some((p) => p.toLowerCase().includes(q)))
    }
    return rows
  }, [result, selectedFilter, tableSearch])

  return (
    <div className="module" style={{ maxWidth: '100%', overflowX: 'hidden' }}>
      {/* Module Header */}
      <div className="module-head">
        <div>
          <h2>Predictive Early-Warning &amp; RCA Forecasting</h2>
          <span className="module-workspace">Backtested forecasts of imported KPIs</span>
        </div>
        {result && (
          <span className="module-workspace" style={{ color: 'var(--accent)' }}>
            {tech} · {result.entity.path.join(' › ')} · as of {result.asOf ?? 'no complete ' + PERIOD_NOUN[grain].one}
          </span>
        )}
      </div>

      {/* Top Filter Controls */}
      <div className="fc-top-nav">
        {/* Technology Switcher */}
        <div className="fc-tabs">
          {TECHS.map((t) => (
            <button
              key={t}
              className={`fc-tab-btn${tech === t ? ' active' : ''}`}
              onClick={() => {
                setSelectedTech(t)
                setTech(t)
              }}
            >
              {t} {t === '4G' ? 'LTE' : t === '3G' ? 'UMTS' : 'GSM'}
            </button>
          ))}
        </div>

        {/* Scope Selector */}
        <div className="seg">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              className={`seg-btn${scope === s.id ? ' active' : ''}`}
              onClick={() => void changeScope(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Entity Search Bar */}
        {scope !== 'network' && (
          <div className="fc-picker">
            <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
              <input
                className="input"
                style={{ width: '100%', paddingRight: entity ? '30px' : '10px' }}
                placeholder={entity ? `Current: ${entity.name}` : `Search ${scope}s…`}
                value={query}
                onFocus={() => {
                  if (blurTimer.current) clearTimeout(blurTimer.current)
                  setPickerOpen(true)
                }}
                onBlur={() => {
                  blurTimer.current = setTimeout(() => setPickerOpen(false), 220)
                }}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPickerOpen(true)
                }}
              />
              {entity && !query && (
                <button
                  type="button"
                  style={{
                    position: 'absolute',
                    right: '8px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    fontSize: '11px',
                    padding: '2px'
                  }}
                  title="Clear entity selection"
                  onClick={() => {
                    setEntity(null)
                    setQuery('')
                    setPickerOpen(true)
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {pickerOpen && options.length > 0 && (
              <div className="fc-options">
                {options.map((o) => (
                  <button
                    key={`${scope}-${o.id}`}
                    type="button"
                    className="fc-option"
                    style={{
                      background: entity?.id === o.id ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                      borderLeft: entity?.id === o.id ? '3px solid var(--accent)' : '3px solid transparent'
                    }}
                    onMouseDown={() => pick(o)}
                  >
                    <span className="fc-option-name" style={{ color: entity?.id === o.id ? 'var(--accent)' : 'var(--text)' }}>
                      {o.name}
                    </span>
                    {o.path.length > 0 && <span className="fc-option-path">{o.path.join(' › ')}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Horizon Switcher */}
        <div className="seg">
          {(result?.horizons ?? []).map((h) => (
            <button
              key={h.horizon}
              className={`seg-btn${(result?.horizon ?? horizon) === h.horizon ? ' active' : ''}`}
              disabled={!h.available}
              title={h.reason ?? undefined}
              onClick={() => setHorizon(h.horizon)}
            >
              {h.horizon} {h.horizon === 1 ? PERIOD_NOUN[grain].one : PERIOD_NOUN[grain].many}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="status-error">{error}</div>}
      {loading && <div className="status-dim">Forecasting…</div>}

      {!loading && scope !== 'network' && !entity && (
        <div className="notice notice-dim fc-pick-hint">
          Pick a {scope} from the search box above to forecast it — or switch back to Network.
        </div>
      )}

      {result && (
        <>
          {/* Top Hero Dual Panel */}
          <div className="fc-hero-grid">
            {/* Left: Actual vs Forecast Line Chart */}
            <div className="fc-card">
              <div className="fc-card-head">
                <div>
                  <div className="fc-card-title">
                    <span>📈 {selSeries?.label ?? 'Core Metric'} — Actual vs. Forecast</span>
                  </div>
                  {selSeries && (
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
                      {selSeries.forecast.quality === 'Withheld'
                        ? selSeries.forecast.withheldReason
                        : <>At horizon: <b>{fmtFc(horizonValue(selSeries), selSeries.unit)}</b> · {selSeries.forecast.method} · {selSeries.forecast.quality}</>}
                    </div>
                  )}
                </div>

                {/* Metric Quick Tabs */}
                <div className="fc-tabs" style={{ flexWrap: 'wrap' }}>
                  {result.metrics.map((s) => (
                    <button
                      key={s.key}
                      className={`fc-tab-btn${result.metric === s.key ? ' active' : ''}`}
                      onClick={() => setMetric(s.key)}
                      title={s.label}
                    >
                      {s.label.replace(/^(4G|3G|2G)\s*/, '')}
                    </button>
                  ))}
                </div>
              </div>

              {selSeries && <Chart option={lineChartOption} height={290} />}
            </div>

            {/* Right: Expandable RCA & Risk Sunburst Chart */}
            <div className="fc-card">
              <div className="fc-card-head">
                <div className="fc-card-title">
                  <span>🎯 Root Cause (RCA) &amp; Risk Sunburst</span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 600 }}>
                  Interactive Drill-Down
                </span>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '4px' }}>
                Inner ring: Risk Severity · Outer ring: RCA Categories (Click slice to filter)
              </div>
              <div style={{ width: '100%', height: '290px', position: 'relative' }}>
                <Chart option={sunburstOption} height={290} onEvents={chartEvents} />
              </div>
            </div>
          </div>

          {/* At-Risk Entities & Root Cause Diagnostics Table */}
          <div className="card">
            <div className="card-head-row">
              <div>
                <h3>At-Risk Sectors &amp; Root Cause Diagnostic Action Blueprint</h3>
                <span className="card-note">
                  {riskRows.length} sectors matching current filter · Ranked by breach probability
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  className="input"
                  style={{ width: '180px', padding: '4px 10px', fontSize: '11px' }}
                  placeholder="Search sectors..."
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Active Filter Banner */}
            {selectedFilter && (
              <div className="fc-filter-banner">
                <span>
                  Drilldown Active: Filtered by <b>{selectedFilter}</b> ({riskRows.length} sectors found)
                </span>
                <button
                  className="btn btn-sm"
                  style={{ padding: '2px 8px', fontSize: '10px' }}
                  onClick={() => setSelectedFilter('')}
                >
                  Reset Filter
                </button>
              </div>
            )}

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Entity / Hierarchy</th>
                    <th className="num">Current</th>
                    <th className="num">Horizon Forecast</th>
                    <th className="num">Threshold</th>
                    <th>Risk State</th>
                    <th>RCA Diagnosis</th>
                    <th style={{ textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {riskRows.slice(0, showAll).map((r) => {
                    const isExpanded = expandedRowId === r.id
                    return (
                      <tr
                        key={`${scope}-${r.id}`}
                        style={{ cursor: 'pointer', background: isExpanded ? 'rgba(56, 189, 248, 0.05)' : undefined }}
                        onClick={() => setExpandedRowId(isExpanded ? null : r.id)}
                      >
                        <td>
                          <div className="fc-name">{r.name}</div>
                          <div className="fc-path">{r.path.join(' › ')}</div>
                          {isExpanded && (
                            <div className="fc-action-drawer">
                              <div className="fc-action-title">
                                <span>🛠️ Field Engineering Remediation Blueprint:</span>
                              </div>
                              <div>{r.hint?.action ?? r.hintNote}</div>
                              <div style={{ marginTop: '4px', color: 'var(--text-dim)' }}>
                                <i>Diagnostic summary: {r.explanation}</i>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="num">{fmtFc(r.current, selSeries?.unit ?? '')}</td>
                        <td className="num" style={{ fontWeight: 700, color: r.risk === 'Likely Breach' || r.risk === 'Already Breached' ? '#f87171' : 'var(--text)' }}>
                          {fmtFc(r.forecast, selSeries?.unit ?? '')}
                        </td>
                        <td className="num">{r.threshold == null ? '—' : fmtFc(r.threshold, selSeries?.unit ?? '')}</td>
                        <td><Chip text={r.risk ?? '—'} tone={riskTone(r.risk)} /></td>
                        <td>
                          {r.hint ? (
                            <span className={`rca-badge ${rcaClass(r.hint.category)}`}>
                              {rcaIcon(r.hint.category)} {r.hint.category}
                            </span>
                          ) : (
                            <span className="fc-path">{r.hintNote}</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ padding: '2px 8px', fontSize: '10px', background: isExpanded ? 'var(--accent)' : undefined, color: isExpanded ? '#020617' : undefined }}
                            onClick={(e) => {
                              e.stopPropagation()
                              setExpandedRowId(isExpanded ? null : r.id)
                            }}
                          >
                            {isExpanded ? 'Hide' : 'Inspect'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {riskRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="pc-empty">No entities found for the selected filter or search query.</td>
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
