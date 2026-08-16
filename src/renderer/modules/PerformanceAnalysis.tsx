import { useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { useAppStore } from '../store'
import type { CorrelationRow, MetricDistribution, PerformanceResult, PerfMetric } from '../../../shared/api'
import Chart from '../lib/Chart'
import { distributionOption, scatterOption, formatMetric, QUADRANTS } from '../lib/perfCharts'
import { weekLabel } from '../lib/overviewCharts'

const METRIC_OPTIONS: Array<{ id: PerfMetric; label: string }> = [
  { id: 'prb', label: 'PRB utilization' },
  { id: 'throughput', label: 'DL throughput' },
  { id: 'users', label: 'Connected users' },
  { id: 'volume', label: 'Data volume' },
  { id: 'availability', label: 'Availability' }
]

const CORR_METRICS: PerfMetric[] = ['prb', 'throughput', 'users', 'volume', 'availability']
const CORR_SHORT: Record<PerfMetric, string> = {
  prb: 'PRB',
  throughput: 'Speed',
  users: 'Users',
  volume: 'Volume',
  availability: 'Avail'
}

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

export default function PerformanceAnalysis(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const [result, setResult] = useState<PerformanceResult | null>(null)
  const [metric, setMetric] = useState<PerfMetric>('prb')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const p = await window.api.analytics.performance()
        if (alive) setResult(p)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [workspace?.path, workspace?.readOnly])

  const dist: MetricDistribution | null = useMemo(
    () => result?.distributions.find((d) => d.metric === metric) ?? null,
    [result, metric]
  )

  const distOption: EChartsOption | null = useMemo(
    () => (dist ? distributionOption(dist) : null),
    [dist]
  )
  const scatOption: EChartsOption | null = useMemo(
    () => (result && result.scatter.length > 0 ? scatterOption(result) : null),
    [result]
  )

  const corrOf = (a: PerfMetric, b: PerfMetric): number | null => {
    if (!result) return null
    const row: CorrelationRow | undefined = result.correlations.find(
      (c) => (c.a === a && c.b === b) || (c.a === b && c.b === a)
    )
    return row?.pearson ?? null
  }

  const quadrantCounts = useMemo(() => {
    const counts: Record<string, number> = { congested: 0, busy: 0, quiet: 0, healthy: 0 }
    for (const s of result?.scatter ?? []) counts[s.quadrant]++
    return counts
  }, [result])

  return (
    <div className="module">
      <div className="module-head">
        <h2>Performance Analysis</h2>
        <span className="module-workspace">{workspace?.name}</span>
        {result && (
          <span className="module-workspace">
            {result.totalCells.toLocaleString()} cells · week {result.weekStart} ({weekLabel(result.weekStart)})
          </span>
        )}
      </div>

      {error && <div className="notice notice-error">{error}</div>}
      {loading && !result && <div className="notice">Loading performance metrics…</div>}
      {!loading && !error && !result && (
        <div className="notice">No weekly aggregates yet — import data first.</div>
      )}

      {result && dist && (
        <div className="card">
          <div className="card-head-row">
            <h3>Metric distributions</h3>
            <div className="seg">
              {METRIC_OPTIONS.map((m) => (
                <button
                  key={m.id}
                  className={`seg-btn${metric === m.id ? ' active' : ''}`}
                  onClick={() => setMetric(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="perf-stats">
            <Stat label="Cells" value={dist.n.toLocaleString()} />
            <Stat label="Min" value={formatMetric(dist, dist.min)} />
            <Stat label="P50 (median)" value={formatMetric(dist, dist.p50)} />
            <Stat label="P90" value={formatMetric(dist, dist.p90)} />
            <Stat label="Max" value={formatMetric(dist, dist.max)} />
            <Stat label="Mean" value={formatMetric(dist, dist.mean)} />
          </div>
          <Chart option={distOption} height={280} />
          <p className="card-note">
            Percentile curve for {dist.label.toLowerCase()} across all cells in the week. P50/P90 dashed marks; hover
            for the band each point represents.
          </p>
        </div>
      )}

      {result && (
        <div className="card">
          <div className="card-head-row">
            <h3>PRB vs throughput — quadrant bands</h3>
            <span className="card-note">
              congested {quadrantCounts.congested} · busy {quadrantCounts.busy} · quiet {quadrantCounts.quiet} ·
              healthy {quadrantCounts.healthy}
            </span>
          </div>
          <Chart option={scatOption} height={360} />
          <div className="quad-legend">
            {QUADRANTS.map((q) => (
              <span key={q.id} className="quad-item">
                <span className="quad-dot" style={{ background: q.color }} />
                {q.label}
              </span>
            ))}
          </div>
          <p className="card-note">
            Split at the active ruleset PRB threshold ({result.prbThreshold}%, dashed red) and median throughput (
            {result.throughputMedianKbps != null
              ? `${(result.throughputMedianKbps / 1024).toFixed(1)} Mbps`
              : '—'}
            , dashed blue). Congested cells (high PRB, below-median speed) are the operational priority.
          </p>
        </div>
      )}

      {result && result.correlations.length > 0 && (
        <div className="card">
          <div className="card-head-row">
            <h3>Metric correlations</h3>
            <span className="card-note">
              Pearson r over {result.correlations[0].n.toLocaleString()} cell-weeks
            </span>
          </div>
          <div className="preview-scroll">
            <table className="data-table corr-table">
              <thead>
                <tr>
                  <th />
                  {CORR_METRICS.map((m) => (
                    <th key={m}>{CORR_SHORT[m]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CORR_METRICS.map((a) => (
                  <tr key={a}>
                    <th>{CORR_SHORT[a]}</th>
                    {CORR_METRICS.map((b) => {
                      if (a === b) {
                        return (
                          <td key={b} className="corr-diag">
                            —
                          </td>
                        )
                      }
                      const v = corrOf(a, b)
                      return (
                        <td
                          key={b}
                          className="corr-cell"
                          style={{ background: corrColor(v) }}
                          title={
                            v == null
                              ? 'Insufficient data'
                              : `Pearson r = ${v.toFixed(2)} between ${CORR_SHORT[a]} and ${CORR_SHORT[b]}`
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
            Correlation is <b>descriptive, not causal</b> — a strong r here means the two metrics move together across
            cells, not that one drives the other.
          </p>
        </div>
      )}
    </div>
  )
}
