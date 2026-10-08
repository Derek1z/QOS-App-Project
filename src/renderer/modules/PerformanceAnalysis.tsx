import React, { useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { useAppStore } from '../store'
import type {
  CorrelationRow,
  MetricDistribution,
  PerformanceResult,
  Technology,
  Grain,
  PeriodId
} from '../../../shared/api'
import Chart from '../lib/Chart'
import {
  distributionOption,
  configurableScatterOption,
  formatMetric,
  formatMetricVal,
  type MetricMeta,
  type DynamicQuadrant
} from '../lib/perfCharts'
import { formatTimeLabel } from '../lib/overviewCharts'

/** Correlated strength → translucent fill (green positive, red negative). */
function corrColor(v: number | null): string {
  if (v == null) return 'transparent'
  const t = Math.min(1, Math.abs(v))
  return v >= 0
    ? `rgba(52, 211, 153, ${0.12 + t * 0.55})`
    : `rgba(248, 113, 113, ${0.12 + t * 0.55})`
}

const DEFAULT_SCATTER_BY_TECH: Record<Technology, { x: string; y: string }> = {
  '2G': { x: 'tch_congestion', y: 'call_drop_rate_2g' },
  '3G': { x: 'peak_hour_traffic_utilization_3g', y: 'call_drop_rate_3g' },
  '4G': { x: 'prb_utilization', y: 'dl_throughput' }
}

export default function PerformanceAnalysis(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const grain = useAppStore((s) => s.grain)
  const setGrain = useAppStore((s) => s.setGrain)
  const period = useAppStore((s) => s.period)
  const setPeriod = useAppStore((s) => s.setPeriod)
  const technologyId = useAppStore((s) => s.technologyId)
  const selectedTech = useAppStore((s) => s.selectedTech)
  const setSelectedTech = useAppStore((s) => s.setSelectedTech)

  const [result, setResult] = useState<PerformanceResult | null>(null)
  const [metricKey, setMetricKey] = useState<string>('')
  const [xMetricKey, setXMetricKey] = useState<string>('')
  const [yMetricKey, setYMetricKey] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // the technology tabs open that technology's workspace (spec §4.2)
  const handleTechChange = (tech: Technology) => void setSelectedTech(tech)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const p = await window.api.analytics.performance({ grain, period, technology: selectedTech })
        if (alive) {
          setResult(p)
          if (p.distributions.length > 0) {
            setMetricKey((prev) => (p.distributions.some((d) => d.metric === prev) ? prev : p.distributions[0].metric))
          }
          const defPair = DEFAULT_SCATTER_BY_TECH[selectedTech] || { x: 'prb_utilization', y: 'dl_throughput' }
          const availKeys = p.distributions.map((d) => d.metric)
          const extraKeys = p.distributions.filter((d) => !d.isCore).map((d) => d.metric)
          const coreKeys = p.distributions.filter((d) => d.isCore).map((d) => d.metric)

          let validX = defPair.x
          if (!availKeys.includes(validX)) {
            validX = extraKeys[0] || availKeys[0] || ''
          }
          let validY = defPair.y
          if (!availKeys.includes(validY)) {
            validY = coreKeys[0] || availKeys[1] || availKeys[0] || ''
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
    () =>
      availableMetrics.find((m) => m.id === xMetricKey) ??
      availableMetrics[0] ?? {
        id: selectedTech === '2G' ? 'tch_congestion' : selectedTech === '3G' ? 'peak_hour_traffic_utilization_3g' : 'prb_utilization',
        label: selectedTech === '2G' ? 'TCH Congestion' : selectedTech === '3G' ? 'Peak Traffic Util' : 'PRB Utilization',
        unit: '%'
      },
    [availableMetrics, xMetricKey, selectedTech]
  )

  const yMeta = useMemo(
    () =>
      availableMetrics.find((m) => m.id === yMetricKey) ??
      availableMetrics[1] ??
      availableMetrics[0] ?? {
        id: selectedTech === '2G' ? 'call_drop_rate_2g' : selectedTech === '3G' ? 'call_drop_rate_3g' : 'dl_throughput',
        label: selectedTech === '2G' ? '2G Call Drop Rate' : selectedTech === '3G' ? '3G Call Drop Rate' : 'DL User Speed',
        unit: selectedTech === '4G' ? 'kbps' : '%'
      },
    [availableMetrics, yMetricKey, selectedTech]
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

  // Presets tailored to active technology
  const analysisPresets: Array<{ label: string; x: string; y: string }> = useMemo(() => {
    const availKeys = availableMetrics.map((m) => m.id)
    const list: Array<{ label: string; x: string; y: string }> = []
    if (selectedTech === '2G') {
      const p2 = [
        { label: '📊 TCH Congestion vs Drop Rate', x: 'tch_congestion', y: 'call_drop_rate_2g' },
        { label: '⚡ SDCCH Congestion vs Voice CSSR', x: 'sdcch_congestion', y: 'call_setup_success_2g' },
        { label: '👥 Voice Traffic Load vs TCH Congestion', x: 'voice_traffic_erl', y: 'tch_congestion' },
        { label: '🚀 EDGE Speed vs Data Volume', x: 'gprs_throughput', y: 'data_volume' }
      ]
      for (const p of p2) {
        if (availKeys.includes(p.x) && availKeys.includes(p.y)) list.push(p)
      }
    } else if (selectedTech === '3G') {
      const p3 = [
        { label: '📊 Peak Traffic Util vs Drop Rate', x: 'peak_hour_traffic_utilization_3g', y: 'call_drop_rate_3g' },
        { label: '⚡ CE Utilization vs Drop Rate', x: 'ce_utilization', y: 'call_drop_rate_3g' },
        { label: '🚀 HSDPA Speed vs DASR', x: 'hsdpa_throughput', y: 'data_access_success_3g' },
        { label: '📡 3G Availability vs CSSR', x: 'availability_3g', y: 'call_setup_success_3g' },
        { label: '💾 Data Volume vs CE Util', x: 'data_volume', y: 'ce_utilization' }
      ]
      for (const p of p3) {
        if (availKeys.includes(p.x) && availKeys.includes(p.y)) list.push(p)
      }
    } else {
      const p4 = [
        { label: '📊 PRB Util vs DL User Speed', x: 'prb_utilization', y: 'dl_throughput' },
        { label: '👥 Connected Users vs Drop Rate', x: 'connected_users', y: 'call_drop_rate_4g' },
        { label: '📡 4G Availability vs CSSR', x: 'availability', y: 'call_setup_success_4g' },
        { label: '💾 Data Volume vs DSAF Failure', x: 'data_volume', y: 'data_service_failure_4g' }
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

  // Top scorecards metrics
  const totalCells = result?.totalCells ?? 0
  const criticalQuadrantCount = quadrantCounts['critical'] ?? 0
  const criticalQuadrantPct = totalCells > 0 ? ((criticalQuadrantCount / totalCells) * 100).toFixed(1) : '0.0'

  const highestCorr = useMemo(() => {
    if (!result || result.correlations.length === 0) return null
    let max = result.correlations[0]
    for (const c of result.correlations) {
      if (c.pearson != null && Math.abs(c.pearson) > Math.abs(max.pearson ?? 0)) {
        max = c
      }
    }
    return max
  }, [result])

  return (
    <div
      style={{
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        maxWidth: '1500px',
        margin: '0 auto',
        color: 'var(--text)'
      }}
    >
      {/* 1. Header Control Bar */}
      <div
        style={{
          background: 'var(--bg-card)',
          padding: '16px 22px',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '14px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '22px'
            }}
          >
            🔬
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                {selectedTech} Performance & Root-Cause Analytics Lab
              </h2>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '3px 9px',
                  borderRadius: '6px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#34d399',
                  border: '1px solid rgba(16, 185, 129, 0.3)'
                }}
              >
                {selectedTech} Architecture
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', margin: '2px 0 0 0' }}>
              Multi-Grain Quantile Curves, 4-Quadrant Diagnostic Scatter, and Cross-KPI Pearson Correlation Matrix
            </p>
          </div>
        </div>

        {/* Global Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Technology Selector */}
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-3)',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid var(--border)'
            }}
          >
            {(['2G', '3G', '4G'] as Technology[]).map((t) => (
              <button
                key={t}
                onClick={() => handleTechChange(t)}
                style={{
                  padding: '5px 14px',
                  fontSize: '11px',
                  fontWeight: 800,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  background: selectedTech === t ? 'linear-gradient(135deg, #059669, #10b981)' : 'transparent',
                  color: selectedTech === t ? '#ffffff' : 'var(--text-dim)',
                  boxShadow: selectedTech === t ? '0 2px 6px rgba(16, 185, 129, 0.3)' : 'none'
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Granularity Selector */}
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-3)',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid var(--border)'
            }}
          >
            {(['daily', 'weekly'] as Grain[]).map((g) => (
              <button
                key={g}
                onClick={() => setGrain(g)}
                style={{
                  padding: '5px 14px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  background: grain === g ? 'var(--accent)' : 'transparent',
                  color: grain === g ? '#0f172a' : 'var(--text-dim)'
                }}
              >
                {g === 'daily' ? 'Daily' : 'Weekly'}
              </button>
            ))}
          </div>

          {/* Period Range Selector */}
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-3)',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid var(--border)'
            }}
          >
            {[
              { id: '4w', label: '4W' },
              { id: '12w', label: '12W' }
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id as PeriodId)}
                style={{
                  padding: '5px 12px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  background: period === p.id ? 'var(--accent)' : 'transparent',
                  color: period === p.id ? '#0f172a' : 'var(--text-dim)'
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Top Executive Scorecards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
        {/* Scope Inventory */}
        <div
          style={{
            background: 'var(--bg-card)',
            padding: '20px',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}
        >
          <div>
            <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Analyzed Scope ({selectedTech})
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#f8fafc', margin: '6px 0' }}>
              {totalCells.toLocaleString()} <span style={{ fontSize: '14px', fontWeight: 600, color: '#34d399' }}>cells</span>
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
            Period: <strong style={{ color: '#f8fafc' }}>{result ? formatTimeLabel(result.weekStart, grain) : '—'}</strong> ({grain})
          </div>
        </div>

        {/* Selected Focus Metric Status */}
        <div
          style={{
            background: 'var(--bg-card)',
            padding: '20px',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}
        >
          <div>
            <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Focus Metric Median (P50)
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#38bdf8', margin: '6px 0' }}>
              {dist ? formatMetric(dist, dist.p50) : '—'}
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
            Active KPI: <strong style={{ color: '#f8fafc' }}>{dist?.label ?? 'None'}</strong>
            {dist?.target != null ? ` (Target: ${dist.target}${dist.unit || ''})` : ''}
          </div>
        </div>

        {/* Dual-Breach High-Risk Cells */}
        <div
          style={{
            background: 'var(--bg-card)',
            padding: '20px',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}
        >
          <div>
            <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Dual-Breach Critical Cells
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: criticalQuadrantCount > 0 ? '#f87171' : '#34d399', margin: '6px 0' }}>
              {criticalQuadrantCount.toLocaleString()} <span style={{ fontSize: '14px', fontWeight: 600 }}>({criticalQuadrantPct}%)</span>
            </div>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: '4px',
                background: criticalQuadrantCount > 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                color: criticalQuadrantCount > 0 ? '#f87171' : '#34d399',
                border: criticalQuadrantCount > 0 ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)'
              }}
            >
              {criticalQuadrantCount > 0 ? `${criticalQuadrantCount} cells in high-risk quadrant` : 'No dual-breach anomalies'}
            </span>
          </div>
        </div>

        {/* Strongest Pearson Linear Driver */}
        <div
          style={{
            background: 'var(--bg-card)',
            padding: '20px',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}
        >
          <div>
            <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Peak Cross-Metric Correlation
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: highestCorr ? corrColor(highestCorr.pearson).replace('rgba(', 'rgb(').replace(/,[^,]+\)$/, ')') : '#94a3b8', margin: '6px 0' }}>
              {highestCorr?.pearson != null ? (highestCorr.pearson > 0 ? `+${highestCorr.pearson.toFixed(2)}` : highestCorr.pearson.toFixed(2)) : '—'}
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {highestCorr ? `${corrLabel(highestCorr.a)} ↔ ${corrLabel(highestCorr.b)}` : 'Correlation matrix computing'}
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '12px',
            padding: '12px 16px',
            color: '#f87171',
            fontSize: '13px'
          }}
        >
          <strong>Notice:</strong> {error}
        </div>
      )}

      {loading && !result && (
        <div
          style={{
            background: 'var(--bg-card)',
            padding: '60px 20px',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            textAlign: 'center',
            color: 'var(--text-dim)'
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
            Computing {selectedTech} Distributions & Scatter Telemetry...
          </div>
        </div>
      )}

      {/* 3. Multi-Metric Quantile Distribution Studio */}
      {result && dist && (
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            padding: '22px',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                  1. {selectedTech} Metric Quantile Distribution Studio ({dist.label})
                </h3>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: dist.isCore ? 'rgba(56, 189, 248, 0.15)' : 'rgba(168, 85, 247, 0.15)',
                    color: dist.isCore ? '#38bdf8' : '#c084fc',
                    border: dist.isCore ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(168, 85, 247, 0.3)'
                  }}
                >
                  {dist.isCore ? 'Core Compliance KPI' : 'Supporting Diagnostic KPI'}
                </span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-dim)', margin: '3px 0 0 0' }}>
                Empirical percentile curve ($P_0 \dots P_{100}$) with median ($P_{50}$) and critical tail threshold ($P_{90}$)
              </p>
            </div>

            {/* Metric Pills Selector */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {result.distributions.map((d) => (
                <button
                  key={d.metric}
                  onClick={() => setMetricKey(d.metric)}
                  style={{
                    padding: '5px 12px',
                    fontSize: '11px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: metricKey === d.metric ? '1px solid var(--accent)' : '1px solid var(--border)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    background: metricKey === d.metric ? 'var(--accent)' : 'var(--bg-3)',
                    color: metricKey === d.metric ? '#0f172a' : 'var(--text-dim)'
                  }}
                >
                  {d.isCore ? '🎯 ' : '⚡ '}
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* 6 Statistical Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
            {[
              { label: 'Observed Cells', val: dist.n.toLocaleString(), color: '#f8fafc' },
              { label: 'Min (P0)', val: formatMetric(dist, dist.min), color: '#94a3b8' },
              { label: 'Median (P50)', val: formatMetric(dist, dist.p50), color: '#34d399' },
              { label: 'Critical Tail (P90)', val: formatMetric(dist, dist.p90), color: '#f87171' },
              { label: 'Peak Max (P100)', val: formatMetric(dist, dist.max), color: '#fbbf24' },
              { label: 'Arithmetic Mean', val: formatMetric(dist, dist.mean), color: '#38bdf8' }
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  background: 'var(--bg-3)',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--border)'
                }}
              >
                <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase' }}>
                  {s.label}
                </div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: s.color, marginTop: '2px' }}>{s.val}</div>
              </div>
            ))}
          </div>

          {/* Distribution ECharts Curve */}
          <div style={{ background: 'var(--bg-3)', borderRadius: '12px', border: '1px solid var(--border)', padding: '14px' }}>
            <Chart option={distOption} height={280} />
          </div>
        </div>
      )}

      {/* 4. 4-Quadrant Diagnostic Scatter Lab */}
      {result && scatOption && (
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            padding: '22px',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                2. {selectedTech} Cross-KPI Diagnostic Scatter & 4-Quadrant Lab
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-dim)', margin: '3px 0 0 0' }}>
                Correlate operational root-cause drivers against compliance outcomes or cross-examine driver dynamics
              </p>
            </div>

            {/* Axes Dropdowns */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)' }}>X-AXIS:</span>
                <select
                  value={xMetricKey}
                  onChange={(e) => setXMetricKey(e.target.value)}
                  style={{
                    background: 'var(--bg-3)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '6px 10px',
                    fontSize: '12px',
                    fontWeight: 600,
                    outline: 'none'
                  }}
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
                    <optgroup label="⚡ Supporting Diagnostic KPIs">
                      {extraMetrics.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} ({m.unit || 'val'})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <button
                onClick={swapAxes}
                title="Swap X and Y axes"
                style={{
                  background: 'var(--bg-3)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '6px 12px',
                  color: 'var(--text)',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                ⇄ Swap
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)' }}>Y-AXIS:</span>
                <select
                  value={yMetricKey}
                  onChange={(e) => setYMetricKey(e.target.value)}
                  style={{
                    background: 'var(--bg-3)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '6px 10px',
                    fontSize: '12px',
                    fontWeight: 600,
                    outline: 'none'
                  }}
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
                    <optgroup label="⚡ Supporting Diagnostic KPIs">
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

          {/* Quick Presets Bar */}
          {analysisPresets.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                {selectedTech} Presets:
              </span>
              {analysisPresets.map((p) => {
                const isActive = xMetricKey === p.x && yMetricKey === p.y
                return (
                  <button
                    key={p.label}
                    onClick={() => {
                      setXMetricKey(p.x)
                      setYMetricKey(p.y)
                    }}
                    style={{
                      padding: '4px 10px',
                      fontSize: '11px',
                      fontWeight: 700,
                      borderRadius: '6px',
                      border: isActive ? '1px solid #38bdf8' : '1px solid var(--border)',
                      cursor: 'pointer',
                      background: isActive ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-3)',
                      color: isActive ? '#38bdf8' : 'var(--text-dim)',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          )}

          {/* Scatter Chart */}
          <div style={{ background: 'var(--bg-3)', borderRadius: '12px', border: '1px solid var(--border)', padding: '14px' }}>
            <Chart option={scatOption} height={380} />
          </div>

          {/* Dynamic 4-Quadrant Badges */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {quadrants.map((q) => {
              const count = quadrantCounts[q.id] ?? 0
              const pct = totalCells > 0 ? ((count / totalCells) * 100).toFixed(1) : '0.0'
              return (
                <div
                  key={q.id}
                  style={{
                    background: 'var(--bg-3)',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    border: `1px solid ${q.color}40`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '11.5px'
                  }}
                >
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: q.color }} />
                  <strong style={{ color: '#f8fafc' }}>{count} cells</strong>
                  <span style={{ color: 'var(--text-dim)' }}>({pct}%)</span>
                  <span style={{ color: q.color, fontWeight: 700 }}>· {q.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 5. Cross-KPI Pearson Correlation Heatmap Matrix */}
      {result && corrKeys.length > 1 && (
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            padding: '22px',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}
        >
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
              3. {selectedTech} Cross-KPI Pearson Correlation Matrix
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', margin: '3px 0 0 0' }}>
              Calculates linear dependence ($r \in [-1, +1]$) across all active {selectedTech} core compliance and supporting diagnostic KPIs
            </p>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: 'var(--bg-3)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '10px 14px', color: 'var(--text-dim)', fontWeight: 800, fontSize: '11px', textTransform: 'uppercase' }}>
                    Metric
                  </th>
                  {corrKeys.map((m) => (
                    <th
                      key={m}
                      style={{
                        padding: '10px 12px',
                        color: 'var(--text-dim)',
                        fontWeight: 800,
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        textAlign: 'center'
                      }}
                    >
                      {corrLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corrKeys.map((a, idx) => (
                  <tr
                    key={a}
                    style={{
                      background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
                    }}
                  >
                    <th style={{ padding: '10px 14px', fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap' }}>
                      {corrLabel(a)}
                    </th>
                    {corrKeys.map((b) => {
                      if (a === b) {
                        return (
                          <td
                            key={b}
                            style={{
                              textAlign: 'center',
                              padding: '10px 12px',
                              opacity: 0.35,
                              color: 'var(--text-dim)',
                              fontWeight: 700
                            }}
                          >
                            1.00
                          </td>
                        )
                      }
                      const v = corrOf(a, b)
                      const isHigh = v != null && Math.abs(v) >= 0.5
                      return (
                        <td
                          key={b}
                          style={{
                            background: corrColor(v),
                            textAlign: 'center',
                            padding: '10px 12px',
                            fontWeight: isHigh ? 800 : 600,
                            color: v == null ? 'var(--text-dim)' : v >= 0 ? '#34d399' : '#f87171'
                          }}
                          title={
                            v == null
                              ? 'Insufficient paired samples'
                              : `Pearson r = ${v.toFixed(2)} between ${corrLabel(a)} and ${corrLabel(b)}`
                          }
                        >
                          {v == null ? '—' : v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', display: 'flex', gap: '16px', alignItems: 'center' }}>
            <span>🟩 <strong>Positive correlation</strong>: Both KPIs increase together</span>
            <span>🟥 <strong>Inverse correlation</strong>: One KPI degrades as the other increases</span>
            <span>⬛ <strong>Near zero</strong>: Independent operational metrics</span>
          </div>
        </div>
      )}
    </div>
  )
}
