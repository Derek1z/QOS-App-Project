import React, { useEffect, useState, useMemo } from 'react'
import { useAppStore } from '../store'
import type { CellIntelligenceRow, CellDetail, Grain } from '../../../shared/api'
import Chart from '../lib/Chart'
import type { EChartsOption } from 'echarts'
import { PALETTE, tooltipStyle, axisLabelStyle } from '../lib/Chart'

export default function SimulationLab(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const grain = useAppStore((s) => s.grain)
  const setGrain = useAppStore((s) => s.setGrain)

  const [cells, setCells] = useState<CellIntelligenceRow[]>([])
  const [selectedCellId, setSelectedCellId] = useState<number | null>(null)
  const [detail, setDetail] = useState<CellDetail | null>(null)
  const [loading, setLoading] = useState(false)

  // Simulation parameters
  const [deltaBwMHz, setDeltaBwMHz] = useState<number>(10)
  const [baseBwMHz, setBaseBwMHz] = useState<number>(10)
  const [enableCA, setEnableCA] = useState<boolean>(false)
  const [enableMimo4x4, setEnableMimo4x4] = useState<boolean>(false)
  const [offloadPct, setOffloadPct] = useState<number>(0)
  const [search, setSearch] = useState('')

  // Load worst/active cells for quick selection
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await window.api.analytics.cellIntelligence({ limit: 100 })
        if (alive && res.rows) {
          setCells(res.rows)
          if (res.rows.length > 0 && selectedCellId == null) {
            // Default to worst cell
            const worst = res.rows.find((c) => c.isNc) ?? res.rows[0]
            setSelectedCellId(worst.cellId)
          }
        }
      } catch (e) {
        console.error('Failed to load cells for simulation:', e)
      }
    })()
    return () => {
      alive = false
    }
  }, [workspace?.path])

  // Load selected cell detail
  useEffect(() => {
    if (selectedCellId == null) return
    let alive = true
    setLoading(true)
    void (async () => {
      try {
        const d = await window.api.analytics.cellDetail(selectedCellId, grain)
        if (alive) {
          setDetail(d)
        }
      } catch (e) {
        console.error('Failed to load cell detail for simulation:', e)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [selectedCellId, grain])

  // Filtered cells for dropdown
  const filteredCells = useMemo(() => {
    if (!search.trim()) return cells
    const q = search.toLowerCase()
    return cells.filter(
      (c) =>
        c.cellName.toLowerCase().includes(q) ||
        (c.district && c.district.toLowerCase().includes(q)) ||
        (c.site && c.site.toLowerCase().includes(q))
    )
  }, [cells, search])

  // Simulation calculation engine
  const simulationResults = useMemo(() => {
    if (!detail || !detail.weeks || detail.weeks.length === 0) return null

    // 1. Spectral efficiency multiplier
    let spectralGain = (baseBwMHz + deltaBwMHz) / baseBwMHz
    if (enableCA) spectralGain *= 1.25 // CA scheduling gain ~25%
    if (enableMimo4x4) spectralGain *= 1.35 // 4x4 MIMO gain ~35%

    // 2. Offload multiplier
    const offloadFactor = (100 - offloadPct) / 100

    const labels = detail.weeks.map((h) => h.weekStart)
    const basePrb = detail.weeks.map((h) => h.prbAvg ?? 0)
    const baseThr = detail.weeks.map((h) => (h.throughputKbps ? h.throughputKbps / 1000 : 0))
    const baseVol = detail.weeks.map((h) => (h.volumeMb ? h.volumeMb / 1024 : 0))

    // Simulated PRB: scaled down by spectral gain and offload
    const simPrb = basePrb.map((prb) => {
      const reduced = (prb * offloadFactor) / spectralGain
      return Math.max(0, Math.min(100, Math.round(reduced * 10) / 10))
    })

    // Simulated Throughput: scaled up by spectral gain
    const simThr = baseThr.map((thr) => {
      const boosted = thr * spectralGain
      return Math.round(boosted * 10) / 10
    })

    // Simulated Capacity Volume:
    const simVol = baseVol.map((vol) => {
      const boosted = vol * spectralGain
      return Math.round(boosted * 10) / 10
    })

    // Metrics delta summary
    const curPrb = basePrb[basePrb.length - 1] ?? 0
    const forecastedPrb = simPrb[simPrb.length - 1] ?? 0
    const prbReduction = Math.round((curPrb - forecastedPrb) * 10) / 10
    const prbReductionPct = curPrb > 0 ? Math.round((prbReduction / curPrb) * 100) : 0
    const isResolved = forecastedPrb < 80

    return {
      labels,
      basePrb,
      simPrb,
      baseThr,
      simThr,
      baseVol,
      simVol,
      curPrb,
      forecastedPrb,
      prbReduction,
      prbReductionPct,
      spectralGain: Math.round(spectralGain * 100) / 100,
      isResolved
    }
  }, [detail, deltaBwMHz, baseBwMHz, enableCA, enableMimo4x4, offloadPct])

  // Chart Option
  const chartOption: EChartsOption = useMemo(() => {
    if (!simulationResults) return {}
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        ...tooltipStyle()
      },
      legend: {
        top: 0,
        textStyle: { color: PALETTE.text, fontSize: 12 }
      },
      grid: { left: 45, right: 30, top: 40, bottom: 25 },
      xAxis: {
        type: 'category',
        data: simulationResults.labels,
        axisLabel: axisLabelStyle(),
        axisLine: { lineStyle: { color: PALETTE.border } }
      },
      yAxis: [
        {
          type: 'value',
          name: 'PRB %',
          max: 100,
          min: 0,
          axisLabel: { ...axisLabelStyle(), formatter: '{value}%' },
          splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
        }
      ],
      series: [
        {
          name: 'Baseline PRB (%)',
          type: 'line',
          data: simulationResults.basePrb,
          itemStyle: { color: '#ef4444' },
          lineStyle: { width: 2, type: 'dashed' },
          symbol: 'circle',
          symbolSize: 4
        },
        {
          name: 'Simulated PRB (%)',
          type: 'line',
          data: simulationResults.simPrb,
          itemStyle: { color: '#10b981' },
          lineStyle: { width: 3 },
          areaStyle: {
            color: 'rgba(16, 185, 129, 0.15)'
          },
          symbol: 'circle',
          symbolSize: 6,
          markLine: {
            data: [{ yAxis: 80, name: 'Target Threshold (80%)' }],
            lineStyle: { color: '#f59e0b', type: 'dashed' }
          }
        }
      ]
    }
  }, [simulationResults])

  return (
    <div className="module-container">
      {/* Header */}
      <div className="module-head" style={{ marginBottom: '16px' }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🔬</span> What-If Capacity & Spectral Simulation Lab
          </h2>
          <span className="card-note">
            Simulate LTE/UMTS Carrier Expansions, MIMO upgrades, and Traffic Offload to predict PRB & Throughput Recovery
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className="grain-toggle">
            <button className={`grain-btn ${grain === 'daily' ? 'active' : ''}`} onClick={() => setGrain('daily')}>
              Daily
            </button>
            <button className={`grain-btn ${grain === 'weekly' ? 'active' : ''}`} onClick={() => setGrain('weekly')}>
              Weekly
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '16px' }}>
        {/* Left: Target Cell Selection & Parameters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Target Cell Selector */}
          <div className="card glass-card">
            <div className="card-head">
              <span className="card-title">1. Target Sector</span>
            </div>
            <input
              type="text"
              className="search-input"
              placeholder="Filter cells, sites, districts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', marginBottom: '10px' }}
            />
            <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {filteredCells.map((c) => (
                <div
                  key={c.cellId}
                  onClick={() => setSelectedCellId(c.cellId)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '5px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    background: selectedCellId === c.cellId ? 'var(--accent)' : 'var(--bg-1)',
                    color: selectedCellId === c.cellId ? '#fff' : 'var(--text)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{c.cellName}</span>
                  <span style={{ fontSize: '11px', opacity: 0.8 }}>{c.district ?? '—'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Simulation Controls */}
          <div className="card glass-card">
            <div className="card-head">
              <span className="card-title">2. Engineering Parameters</span>
            </div>

            {/* Base Bandwidth */}
            <div className="sim-slider-row">
              <span className="sim-slider-label">Current Bandwidth</span>
              <select
                className="select"
                value={baseBwMHz}
                onChange={(e) => setBaseBwMHz(Number(e.target.value))}
                style={{ width: '100px' }}
              >
                <option value={5}>5 MHz</option>
                <option value={10}>10 MHz</option>
                <option value={15}>15 MHz</option>
                <option value={20}>20 MHz</option>
              </select>
            </div>

            {/* Added Bandwidth Slider */}
            <div className="sim-slider-row">
              <span className="sim-slider-label">Add Carrier Bandwidth</span>
              <input
                type="range"
                min={0}
                max={20}
                step={5}
                value={deltaBwMHz}
                onChange={(e) => setDeltaBwMHz(Number(e.target.value))}
                className="sim-slider-input"
              />
              <span className="sim-slider-val">+{deltaBwMHz} MHz</span>
            </div>

            {/* Traffic Offload Slider */}
            <div className="sim-slider-row">
              <span className="sim-slider-label">Traffic Offload %</span>
              <input
                type="range"
                min={0}
                max={40}
                step={5}
                value={offloadPct}
                onChange={(e) => setOffloadPct(Number(e.target.value))}
                className="sim-slider-input"
              />
              <span className="sim-slider-val">{offloadPct}%</span>
            </div>

            {/* Feature Toggles */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={enableCA}
                  onChange={(e) => setEnableCA(e.target.checked)}
                />
                <span>Enable Carrier Aggregation (CA, +45% Cap)</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={enableMimo4x4}
                  onChange={(e) => setEnableMimo4x4(e.target.checked)}
                />
                <span>MIMO Upgrade (2x2 → 4x4, +35% Cap)</span>
              </label>
            </div>
          </div>
        </div>

        {/* Right: Simulation Forecast & Impact Summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {loading && <div className="notice">Simulating spectral dynamics…</div>}

          {!loading && detail && simulationResults && (
            <>
              {/* Outcome Scorecard */}
              <div className="sim-outcome-grid">
                <div className="sim-outcome-card">
                  <span className="sim-outcome-label">Baseline PRB</span>
                  <span className="sim-outcome-val" style={{ color: 'var(--danger)' }}>
                    {simulationResults.curPrb}%
                  </span>
                </div>

                <div className="sim-outcome-card">
                  <span className="sim-outcome-label">Simulated PRB</span>
                  <span className="sim-outcome-val" style={{ color: '#10b981' }}>
                    {simulationResults.forecastedPrb}%
                  </span>
                  <span className="sim-outcome-delta" style={{ color: '#10b981' }}>
                    ↓ {simulationResults.prbReduction}% ({simulationResults.prbReductionPct}% drop)
                  </span>
                </div>

                <div className="sim-outcome-card">
                  <span className="sim-outcome-label">Spectral Capacity Gain</span>
                  <span className="sim-outcome-val" style={{ color: 'var(--accent)' }}>
                    {simulationResults.spectralGain}x
                  </span>
                  <span className="sim-outcome-delta" style={{ color: 'var(--text-dim)' }}>
                    +{(simulationResults.spectralGain - 1) * 100}% Throughput Boost
                  </span>
                </div>

                <div className="sim-outcome-card">
                  <span className="sim-outcome-label">Breach Status</span>
                  <span
                    className="sim-outcome-val"
                    style={{
                      color: simulationResults.isResolved ? 'var(--green)' : 'var(--warn)',
                      fontSize: '16px'
                    }}
                  >
                    {simulationResults.isResolved ? '✓ Compliant' : '⚠ High Utilization'}
                  </span>
                  <span className="sim-outcome-delta">
                    {simulationResults.isResolved ? 'PRB safely below 80%' : 'Requires more capacity'}
                  </span>
                </div>
              </div>

              {/* Chart */}
              <div className="card glass-card" style={{ padding: '16px' }}>
                <div className="card-head">
                  <span className="card-title">
                    PRB Congestion Recovery Projection: {detail.cellName} ({detail.site ?? '—'})
                  </span>
                </div>
                <Chart option={chartOption} height={340} />
              </div>

              {/* Actionable Engineering Recommendation */}
              <div className="drawer-rec-box">
                <div className="drawer-rec-header">
                  <span>💡</span> Recommended Field Optimization Plan
                </div>
                <div className="drawer-rec-text">
                  {simulationResults.isResolved
                    ? `Adding +${deltaBwMHz}MHz bandwidth and offloading ${offloadPct}% traffic achieves full compliance. Recommend immediate software carrier activation or antenna electrical down-tilt by 2° to offload edge traffic to neighboring microcells.`
                    : `Simulated configuration brings PRB down to ${simulationResults.forecastedPrb}%, but cell remains under high utilization. Recommend activating 4x4 MIMO and scheduling dual-carrier aggregation.`}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
