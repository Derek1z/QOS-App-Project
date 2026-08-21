import { useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { useAppStore } from '../store'
import type { CorrelationRow, MetricDistribution, PerformanceResult, Technology } from '../../../shared/api'
import Chart from '../lib/Chart'
import {
  distributionOption,
  configurableScatterOption,
  formatMetric,
  type MetricMeta,
  type DynamicQuadrant
} from '../lib/perfCharts'
import { formatTimeLabel } from '../lib/overviewCharts'

/** Correlated strength → translucent fill (green positive, red negative). */
function corrColor(v: number | null): string {
  if (v == null) return 'transparent'
  const t = Math.min(1, Math.abs(v))
  return v >= 0
    ? `rgba(52, 211, 153, ${0.12 + t * 0.68})`
    : `rgba(248, 113, 113, ${0.12 + t * 0.68})`
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="perf-stat">
      <span className="perf-stat-value">{value}</span>
      <span className="perf-stat-label">{label}</span>
    </div>
  )
}

const DEFAULT_SCATTER_PAIRS: Record<Technology, { x: string; y: string }> = {
  '2G': { x: 'gprs_throughput', y: 'call_drop_rate_2g' },
  '3G': { x: 'peak_hour_traffic_utilization_3g', y: 'call_drop_rate_3g' },
  '4G': { x: 'prb_utilization', y: 'dl_throughput' }
}

export default function PerformanceAnalysis(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const grain = useAppStore((s) => s.grain)
  const period = useAppStore((s) => s.period)
  const selectedTech = useAppStore((s) => s.selectedTech)
  const setSelectedTech = useAppStore((s) => s.setSelectedTech)

  const [result, setResult] = useState<PerformanceResult | null>(null)
  const [metricKey, setMetricKey] = useState<string>('')
  const [xMetricKey, setXMetricKey] = useState<string>('')
  const [yMetricKey, setYMetricKey] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const p = await window.api.analytics.performance({ grain, period, technology: selectedTech })
        if (alive) {
          setResult(p)
          // Set initial default metrics for distributions and scatter
          if (p.distributions.length > 0) {
            setMetricKey((prev) => (p.distributions.some((d) => d.metric === prev) ? prev : p.distributions[0].metric))
          }
          const defPair = DEFAULT_SCATTER_PAIRS[selectedTech] || { x: 'prb_utilization', y: 'dl_throughput' }
          const availKeys = p.distributions.map((d) => d.metric)
          const extraKeys = p.distributions.filter((d) => !d.isCore).map((d) => d.metric)
          const coreKeys = p.distributions.filter((d) => d.isCore).map((d) => d.metric)

          // Try to default to an Extra KPI on X-Axis and a Core KPI on Y-Axis
          let validX = defPair.x
          if (!availKeys.includes(validX)) {
            validX = extraKeys[0] || availKeys[0] || 'prb'
          }
          let validY = defPair.y
          if (!availKeys.includes(validY)) {
            validY = coreKeys[0] || availKeys[1] || availKeys[0] || 'throughput'
          }

          setXMetricKey((prev) => (availKeys.includes(prev) ? prev : validX))
          setYMetricKey((prev) => (availKeys.includes(prev) ? prev : validY))
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
  }, [workspace?.path, workspace?.readOnly, grain, period, selectedTech])

  // Active distribution
  const dist: MetricDistribution | null = useMemo(() => {
    if (!result || result.distributions.length === 0) return null
    return result.distributions.find((d) => d.metric === metricKey) ?? result.distributions[0]
  }, [result, metricKey])

  const distOption: EChartsOption | null = useMemo(
    () => (dist ? distributionOption(dist) : null),
    [dist]
  )

  // Configurable Scatter & Grouped Metrics
  const availableMetrics: Array<MetricMeta & { isCore?: boolean }> = useMemo(() => {
    if (!result) return []
    return result.distributions.map((d) => ({
      id: d.metric,
      label: d.label,
      unit: d.unit,
      target: d.target,
      worseIsHigher: d.worseIsHigher,
      isCore: d.isCore
    }))
  }, [result])

  const coreMetrics = useMemo(() => availableMetrics.filter((m) => m.isCore), [availableMetrics])
  const extraMetrics = useMemo(() => availableMetrics.filter((m) => !m.isCore), [availableMetrics])

  const xMeta = useMemo(
    () => availableMetrics.find((m) => m.id === xMetricKey) ?? availableMetrics[0] ?? { id: 'prb', label: 'PRB', unit: '%' },
    [availableMetrics, xMetricKey]
  )
  const yMeta = useMemo(
    () => availableMetrics.find((m) => m.id === yMetricKey) ?? availableMetrics[1] ?? availableMetrics[0] ?? { id: 'throughput', label: 'Throughput', unit: 'kbps' },
    [availableMetrics, yMetricKey]
  )

  const { scatOption, quadrantCounts, quadrants } = useMemo(() => {
    if (!result || result.scatter.length === 0 || !xMeta || !yMeta) {
      return { scatOption: null, quadrantCounts: {}, quadrants: [] as DynamicQuadrant[] }
    }
    const { option, quadrantCounts: counts, quadrants: quads } = configurableScatterOption(result.scatter, xMeta, yMeta)
    return { scatOption: option, quadrantCounts: counts, quadrants: quads }
  }, [result, xMeta, yMeta])

  const swapAxes = () => {
    const tmp = xMetricKey
    setXMetricKey(yMetricKey)
    setYMetricKey(tmp)
  }

  // Presets for rapid Extra vs Core comparison
  const analysisPresets: Array<{ label: string; x: string; y: string }> = useMemo(() => {
    const availKeys = availableMetrics.map((m) => m.id)
    const list: Array<{ label: string; x: string; y: string }> = []
    if (selectedTech === '3G') {
      const p3 = [
        { label: '📊 Peak Util vs Drop Rate', x: 'peak_hour_traffic_utilization_3g', y: 'call_drop_rate_3g' },
        { label: '⚡ CE Util vs Drop Rate', x: 'ce_utilization', y: 'call_drop_rate_3g' },
        { label: '🚀 HSDPA Speed vs Data Access', x: 'hsdpa_throughput', y: 'data_access_success_3g' },
        { label: '📡 Cell Avail vs CSSR', x: 'availability_3g', y: 'call_setup_success_3g' },
        { label: '💾 Volume vs Data Access', x: 'data_volume', y: 'data_access_success_3g' }
      ]
      for (const p of p3) {
        if (availKeys.includes(p.x) && availKeys.includes(p.y)) list.push(p)
      }
    } else if (selectedTech === '2G') {
      const p2 = [
        { label: '🚀 EDGE Speed vs Drop Rate', x: 'gprs_throughput', y: 'call_drop_rate_2g' },
        { label: '📡 TCH Avail vs CSSR', x: 'tch_availability', y: 'call_setup_success_2g' },
        { label: '👥 Users vs TCH Congestion', x: 'connected_users', y: 'tch_congestion' },
        { label: '💾 Traffic vs SDCCH Congestion', x: 'gprs_traffic', y: 'sdcch_congestion' }
      ]
      for (const p of p2) {
        if (availKeys.includes(p.x) && availKeys.includes(p.y)) list.push(p)
      }
    } else {
      const p4 = [
        { label: '📊 PRB Util vs Speed', x: 'prb_utilization', y: 'dl_throughput' },
        { label: '👥 Users vs Drop Rate', x: 'connected_users', y: 'call_drop_rate_4g' },
        { label: '📡 Cell Avail vs CSSR', x: 'availability', y: 'call_setup_success_4g' },
        { label: '💾 Volume vs Data Failure', x: 'data_volume', y: 'data_service_failure_4g' }
      ]
      for (const p of p4) {
        if (availKeys.includes(p.x) && availKeys.includes(p.y)) list.push(p)
      }
    }
    return list
  }, [availableMetrics, selectedTech])

  // Correlations
  const corrKeys = useMemo(() => {
    if (!result) return []
    const set = new Set<string>()
    for (const c of result.correlations) {
      set.add(c.a)
      set.add(c.b)
    }
    return Array.from(set)
  }, [result])

  const corrLabel = (key: string): string => {
    const found = result?.distributions.find((d) => d.metric === key)
    if (found) return found.label
    const cRow = result?.correlations.find((c) => (c.a === key ? c.aLabel : c.b === key ? c.bLabel : null))
    return cRow ? (cRow.a === key ? cRow.aLabel ?? key : cRow.bLabel ?? key) : key
  }

  const corrOf = (a: string, b: string): number | null => {
    if (!result) return null
    const row: CorrelationRow | undefined = result.correlations.find(
      (c) => (c.a === a && c.b === b) || (c.a === b && c.b === a)
    )
    return row?.pearson ?? null
  }

  return (
    <div className="module">
      <div className="module-head" style={{ flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0 }}>Performance Analysis Lab</h2>
          <span className="card-note">
            Extra & supporting driver KPI distributions, cross-metric scatter quadrants & Pearson correlation matrix
          </span>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div className="seg">
            {(['2G', '3G', '4G'] as Technology[]).map((t) => (
              <button
                key={t}
                className={`seg-btn${selectedTech === t ? ' active' : ''}`}
                onClick={() => setSelectedTech(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {result && (
            <span className="module-workspace" style={{ padding: '4px 10px' }}>
              {result.totalCells.toLocaleString()} cells · {formatTimeLabel(result.weekStart, grain)}
            </span>
          )}
        </div>
      </div>

      {error && <div className="notice notice-error">{error}</div>}
      {loading && !result && <div className="notice">Loading performance metrics…</div>}
      {!loading && !error && !result && (
        <div className="notice">No aggregates yet — import data first.</div>
      )}

      {/* 1. Metric Distributions */}
      {result && dist && (
        <div className="card glass-card">
          <div className="card-head-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <h3 style={{ margin: 0 }}>
                1. {selectedTech} Metric Distributions ({dist.label})
                <span
                  style={{
                    marginLeft: '8px',
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: dist.isCore ? 'rgba(56, 189, 248, 0.15)' : 'rgba(168, 85, 247, 0.15)',
                    color: dist.isCore ? '#38bdf8' : '#c084fc',
                    border: dist.isCore ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(168, 85, 247, 0.3)'
                  }}
                >
                  {dist.isCore ? 'Core KPI' : 'Extra / Supporting Driver KPI'}
                </span>
              </h3>
              <span className="card-note">Percentile curve ($P_0 \dots P_{100}$) with empirical median (P50) and critical threshold (P90)</span>
            </div>
            <div className="seg" style={{ flexWrap: 'wrap', gap: '4px' }}>
              {/* Extra KPIs first, followed by Core KPIs */}
              {result.distributions
                .slice()
                .sort((a, b) => (a.isCore === b.isCore ? a.label.localeCompare(b.label) : a.isCore ? 1 : -1))
                .map((d) => (
                  <button
                    key={d.metric}
                    className={`seg-btn${metricKey === d.metric ? ' active' : ''}`}
                    onClick={() => setMetricKey(d.metric)}
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                  >
                    {!d.isCore ? '⚡ ' : '🎯 '}
                    {d.label}
                  </button>
                ))}
            </div>
          </div>
          <div className="perf-stats">
            <Stat label="Observed Cells" value={dist.n.toLocaleString()} />
            <Stat label="Min" value={formatMetric(dist, dist.min)} />
            <Stat label="P50 (Median)" value={formatMetric(dist, dist.p50)} />
            <Stat label="P90" value={formatMetric(dist, dist.p90)} />
            <Stat label="Max" value={formatMetric(dist, dist.max)} />
            <Stat label="Mean (Avg)" value={formatMetric(dist, dist.mean)} />
          </div>
          <Chart option={distOption} height={280} />
          <p className="card-note">
            Percentile distribution for <b>{dist.label}</b> across all {selectedTech} cells in the selected period.
            {dist.target != null ? ` Target standard is ${dist.target}${dist.unit || ''} (solid line).` : ''}
          </p>
        </div>
      )}

      {/* 2. Configurable Extra/Supporting KPI Scatter Plot */}
      {result && scatOption && (
        <div className="card glass-card">
          <div className="card-head-row" style={{ flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3 style={{ margin: 0 }}>2. Extra / Driver KPI vs Core KPI Scatter & Quadrant Lab</h3>
              <span className="card-note">
                Analyze root-cause drivers (Extra KPIs) against compliance outcomes (Core KPIs) or explore extra-vs-extra relationships
              </span>
            </div>

            {/* Axis Configuration Controls */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: 600 }}>X-AXIS:</span>
                <select
                  value={xMetricKey}
                  onChange={(e) => setXMetricKey(e.target.value)}
                  className="filter-select"
                  style={{ minWidth: '180px', padding: '4px 8px', fontSize: '12px' }}
                >
                  {extraMetrics.length > 0 && (
                    <optgroup label="⚡ Extra / Supporting Diagnostic KPIs">
                      {extraMetrics.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} ({m.unit || 'val'})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {coreMetrics.length > 0 && (
                    <optgroup label="🎯 Core Compliance KPIs">
                      {coreMetrics.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} ({m.unit || 'val'})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <button
                className="btn"
                onClick={swapAxes}
                title="Swap X and Y axes"
                style={{ padding: '4px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                ⇄ Swap
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: 600 }}>Y-AXIS:</span>
                <select
                  value={yMetricKey}
                  onChange={(e) => setYMetricKey(e.target.value)}
                  className="filter-select"
                  style={{ minWidth: '180px', padding: '4px 8px', fontSize: '12px' }}
                >
                  {coreMetrics.length > 0 && (
                    <optgroup label="🎯 Core Compliance KPIs">
                      {coreMetrics.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} ({m.unit || 'val'})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {extraMetrics.length > 0 && (
                    <optgroup label="⚡ Extra / Supporting Diagnostic KPIs">
                      {extraMetrics.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} ({m.unit || 'val'})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            </div>
          </div>

          {/* Quick Analysis Presets */}
          {analysisPresets.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: 600 }}>QUICK PRESETS:</span>
              {analysisPresets.map((p) => {
                const isActive = xMetricKey === p.x && yMetricKey === p.y
                return (
                  <button
                    key={p.label}
                    className={`btn${isActive ? ' btn-primary' : ''}`}
                    onClick={() => {
                      setXMetricKey(p.x)
                      setYMetricKey(p.y)
                    }}
                    style={{ padding: '2px 8px', fontSize: '11px' }}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          )}

          <Chart option={scatOption} height={380} />

          {/* Dynamic 4-Quadrant Summary Badges */}
          <div className="quad-legend" style={{ flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            {quadrants.map((q) => {
              const count = quadrantCounts[q.id] ?? 0
              const pct = result.scatter.length > 0 ? ((count / result.scatter.length) * 100).toFixed(1) : '0.0'
              return (
                <span
                  key={q.id}
                  className="quad-item"
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border)'
                  }}
                >
                  <span className="quad-dot" style={{ background: q.color }} />
                  <b>{count} cells</b> ({pct}%) · {q.label}
                </span>
              )
            })}
          </div>

          <p className="card-note">
            Cells are classified into 4 quadrants against engineering thresholds for <b>{xMeta.label}</b> and{' '}
            <b>{yMeta.label}</b>. Cells in the dual-breach quadrant (red) represent immediate operational optimization priorities.
          </p>
        </div>
      )}

      {/* 3. Technology Pearson Correlation Matrix */}
      {result && corrKeys.length > 1 && (
        <div className="card glass-card">
          <div className="card-head-row">
            <div>
              <h3 style={{ margin: 0 }}>3. {selectedTech} Cross-KPI Pearson Correlation Matrix</h3>
              <span className="card-note">
                Calculates linear dependence ($r \in [-1, +1]$) across all active {selectedTech} Extra and Core KPIs
              </span>
            </div>
          </div>
          <div className="preview-scroll" style={{ marginTop: '12px' }}>
            <table className="data-table corr-table">
              <thead>
                <tr>
                  <th style={{ minWidth: '140px' }}>Metric</th>
                  {corrKeys.map((m) => (
                    <th key={m} style={{ minWidth: '90px', textAlign: 'center' }}>
                      {corrLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corrKeys.map((a) => (
                  <tr key={a}>
                    <th style={{ fontWeight: 600, color: 'var(--text)' }}>{corrLabel(a)}</th>
                    {corrKeys.map((b) => {
                      if (a === b) {
                        return (
                          <td key={b} className="corr-diag" style={{ textAlign: 'center', opacity: 0.4 }}>
                            1.00
                          </td>
                        )
                      }
                      const v = corrOf(a, b)
                      return (
                        <td
                          key={b}
                          className="corr-cell"
                          style={{ background: corrColor(v), textAlign: 'center', fontWeight: 600 }}
                          title={
                            v == null
                              ? 'Insufficient paired samples'
                              : `Pearson r = ${v.toFixed(2)} between ${corrLabel(a)} and ${corrLabel(b)}`
                          }
                        >
                          {v == null ? '—' : v.toFixed(2)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="card-note">
            Color intensity indicates relationship strength (green for positive correlation, red for inverse correlation).
          </p>
        </div>
      )}
    </div>
  )
}
