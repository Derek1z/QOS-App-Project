import React, { useEffect, useState } from 'react'
import { useAppStore, emit, on, type PeriodId, type Grain } from '../store'
import type {
  HealthResult, NcMovementRow, PriorityRow, KpiOverviewResult, KpiTrendPoint,
  ExecutiveOverviewResult, DynamicKpiCardData, Technology, NcLifecycleResult, Lifecycle, Severity
} from '../../../shared/api'
import { techProfile, fmtCompactNumber, fmtCompactVolume, fmtCompactRate } from '../lib/techProfile'
import Chart from '../lib/Chart'
import { healthLineOption, ncMovementOption, coreKpiNcRateOption, formatTimeLabel } from '../lib/overviewCharts'
import GhanaMap from './GhanaMap'
import TargetsModal from './TargetsModal'

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

const BAND_COLOR: Record<string, string> = {
  Critical: 'var(--danger)',
  High: 'var(--warn)',
  Medium: 'var(--accent)',
  Watch: 'var(--text-dim)',
  Low: 'var(--text-faint)'
}

const LIFECYCLE_ORDER: Lifecycle[] = ['Healthy', 'New NC', 'Recurring NC', 'Persistent NC', 'Chronic NC', 'Recovering']
const LIFECYCLE_COLOR: Record<Lifecycle, string> = {
  Healthy: 'var(--green, #10b981)',
  'New NC': 'var(--amber, #f59e0b)',
  'Recurring NC': '#a855f7',
  'Persistent NC': '#f97316',
  'Chronic NC': 'var(--danger, #ef4444)',
  Recovering: 'var(--accent, #3b82f6)'
}

const SEVERITY_ORDER: Severity[] = ['Critical', 'High', 'Watch', 'Normal']
const SEV_COLOR: Record<Severity, string> = {
  Critical: 'var(--danger, #ef4444)',
  High: 'var(--warn, #f59e0b)',
  Watch: '#38bdf8',
  Normal: 'var(--green, #10b981)'
}

function HealthGauge({ score }: { score: number | null }): React.JSX.Element {
  const s = score ?? 0
  const color = s >= 80 ? 'var(--green)' : s >= 65 ? 'var(--accent)' : s >= 50 ? 'var(--warn)' : 'var(--danger)'
  return (
    <div className="health-gauge">
      <div className="health-ring" style={{ background: `conic-gradient(${color} ${Math.round(s) * 3.6}deg, var(--bg-3) 0deg)` }}>
        <div className="health-ring-inner">
          <span className="health-value">{Math.round(s)}</span>
          <span className="health-unit">/ 100</span>
        </div>
      </div>
    </div>
  )
}

/** Compact sparkline of a KPI's weekly value history — breach weeks in red,
 *  dashed line at the target. Pure SVG, no chart library overhead. */
const KpiSparkline = React.memo(function KpiSparkline({
  trend,
  target,
  worseIsHigher = true,
  grain = 'weekly'
}: {
  trend: KpiTrendPoint[]
  target: number | null
  worseIsHigher?: boolean
  grain?: Grain
}): React.JSX.Element | null {
  if (!trend || trend.length === 0) return null
  const W = 110
  const H = 24
  const pad = 2
  const values = trend.map((t) => t.value ?? 0)
  const maxV = Math.max(1, ...values, target ?? 0) * 1.05
  const minV = Math.min(0, ...values, target ?? 0)
  const span = Math.max(1, maxV - minV)
  const bw = W / trend.length
  const y = (v: number): number => H - pad - ((v - minV) / span) * (H - pad * 2)
  const bars = trend.map((t, i) => {
    const v = t.value ?? 0
    const bh = Math.max(1.5, H - pad - y(v))
    const breached = t.breached ?? (target != null ? (worseIsHigher ? v > target : v < target) : false)
    return (
      <rect
        key={t.weekStart || i}
        x={i * bw + bw * 0.15}
        y={y(v)}
        width={bw * 0.7}
        height={bh}
        rx={1.5}
        fill={breached ? 'var(--danger, #ef4444)' : 'var(--accent, #3b82f6)'}
        opacity={breached ? 0.95 : 0.6}
      >
        <title>{`${formatTimeLabel(t.weekStart, grain)}: ${v == null ? '—' : v}${breached ? ' — breach' : ''}`}</title>
      </rect>
    )
  })
  const targetLine =
    target != null && target >= minV && target <= maxV ? (
      <line
        x1={0}
        x2={W}
        y1={y(target)}
        y2={y(target)}
        stroke="var(--text-faint, #64748b)"
        strokeWidth={1}
        strokeDasharray="3 3"
      >
        <title>{`target ${target}`}</title>
      </line>
    ) : null
  return (
    <svg className="kpi-sparkline" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {targetLine}
      {bars}
    </svg>
  )
})

function CompBar({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="comp-row">
      <span className="comp-label">{label}</span>
      <div className="dist-track">
        <div className="dist-fill" style={{ width: `${Math.round(value)}%` }} />
      </div>
      <span className="comp-value">{Math.round(value)}</span>
    </div>
  )
}

type SectionKey = 'techCards' | 'health' | 'movement' | 'other'

const GRAIN_LABEL: Record<Grain, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }
const PERIOD_LABEL: Record<PeriodId, string> = {
  '7d': 'Last 7 days', '4w': 'Last 4 weeks', '12w': 'Last 12 weeks', mtd: 'Month to date', '3m': 'Last 3 months'
}
function grainLabel(g: Grain): string {
  return GRAIN_LABEL[g]
}
function periodLabel(p: PeriodId): string {
  return PERIOD_LABEL[p]
}

export default function Overview(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const period = useAppStore((s) => s.period)
  const grain = useAppStore((s) => s.grain)
  const summary = useAppStore((s) => s.summary)
  const setSummary = useAppStore((s) => s.setSummary)
  const [health, setHealth] = useState<HealthResult | null>(null)
  const [movement, setMovement] = useState<NcMovementRow[]>([])
  const [priority, setPriority] = useState<PriorityRow[]>([])
  const [kpiOverview, setKpiOverview] = useState<KpiOverviewResult | null>(null)
  const [execOverview, setExecOverview] = useState<ExecutiveOverviewResult | null>(null)
  const [ncLifecycle, setNcLifecycle] = useState<NcLifecycleResult | null>(null)
  const selectedTech = useAppStore((s) => s.selectedTech)
  const setSelectedTech = useAppStore((s) => s.setSelectedTech)
  const pinned = useAppStore((s) => s.pinned)
  const togglePin = useAppStore((s) => s.togglePin)
  const isPinned = useAppStore((s) => s.isPinned)
  const [targetsOpen, setTargetsOpen] = useState(false)
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({ techCards: true, health: true, movement: true, other: true })
  const [movementMode, setMovementMode] = useState<'lifecycle' | 'core_kpis'>('lifecycle')
  const [activeKpiFilters, setActiveKpiFilters] = useState<string[]>([])
  const s = summary

  const loadData = async () => {
    try {
      const movementLimit = grain === 'daily' ? 30 : grain === 'monthly' ? 6 : 8
      const [sum, h, m, p, ko, eo, ncl] = await Promise.all([
        window.api.analytics.summary({ period, grain }),
        window.api.analytics.health(grain),
        window.api.analytics.ncMovement(movementLimit, grain, selectedTech),
        window.api.analytics.priorityQueue('balanced', 8),
        window.api.analytics.kpiOverview(8, grain),
        window.api.analytics.executiveOverview({ period, grain }),
        window.api.analytics.ncLifecycle(grain)
      ])
      if (sum) setSummary(sum)
      setHealth(h)
      setMovement(m)
      setPriority(p)
      setKpiOverview(ko)
      setExecOverview(eo)
      setNcLifecycle(ncl)
    } catch {
      /* workspace may have closed mid-flight */
    }
  }

  useEffect(() => {
    setSelectedTech(workspace?.technology ?? '4G')
  }, [workspace?.technology])

  useEffect(() => {
    let alive = true
    void (async () => {
      await loadData()
    })()
    const offRules = on('RULESET_CHANGED', () => void loadData())
    const offKpi = on('KPIDEFS_CHANGED', () => void loadData())
    return () => {
      alive = false
      offRules()
      offKpi()
    }
  }, [workspace?.path, workspace?.readOnly, workspace?.technology, selectedTech, period, grain, setSummary])

  const profile = techProfile(selectedTech)
  const currentTechHealth = execOverview?.technologies.find((t) => t.technology === selectedTech) ?? execOverview?.technologies[0]
  const dynamicKpiCards = currentTechHealth?.availableKpiCards ?? execOverview?.availableKpiCards ?? []
  const ncLabel = grain === 'daily' ? 'Daily NC cells' : grain === 'monthly' ? 'Monthly NC cells' : 'Weekly NC cells'

  const kpis: { label: string; value: string; title?: string }[] = [
    { label: 'Cells', value: fmtCompactNumber(s?.cells) },
    { label: profile.siteCountLabel, value: fmtCompactNumber(s?.sites) },
    { label: 'Districts', value: fmtCompactNumber(s?.districts) },
    { label: 'Regions', value: fmtCompactNumber(s?.regions) },
    { label: 'Observed rows', value: fmtCompactNumber(s?.rowCount) },
    { label: ncLabel, value: fmtCompactNumber(s?.weeklyNcCells) }
  ]

  if (dynamicKpiCards && dynamicKpiCards.length > 0) {
    for (const card of dynamicKpiCards.slice(0, 6)) {
      let formattedVal = card.formattedValue
      if (card.formattedValue === 'Data unavailable' || card.currentValue == null) {
        formattedVal = '—'
      } else if (card.unit === 'MB' || card.unit?.toLowerCase() === 'data volume') {
        formattedVal = fmtCompactVolume(card.currentValue)
      } else if (card.unit === 'kbps' || card.unit?.toLowerCase().includes('throughput')) {
        formattedVal = fmtCompactRate(card.currentValue)
      } else if (card.unit === '%') {
        formattedVal = `${card.currentValue.toFixed(1)}%`
      } else if (card.currentValue >= 1000) {
        formattedVal = fmtCompactNumber(card.currentValue)
      }
      kpis.push({
        label: card.label,
        value: formattedVal,
        title: card.target != null ? `${card.label}: ${formattedVal} (target: ${card.target})` : card.label
      })
    }
  } else {
    if (selectedTech === '4G') {
      kpis.push(
        { label: profile.utilizationLabel, value: s?.avgPrb == null ? '—' : fmt(s.avgPrb) + '%' },
        { label: 'Data volume', value: fmtCompactVolume(s?.totalVolumeMb) },
        { label: 'Connected users', value: fmtCompactNumber(s?.totalUsers) },
        { label: 'DL throughput', value: fmtCompactRate(s?.avgThroughputKbps) },
        { label: 'Availability', value: s?.avgAvailability == null ? '—' : fmt(s.avgAvailability, 2) + '%' }
      )
    } else if (selectedTech === '3G') {
      kpis.push(
        { label: profile.utilizationLabel, value: s?.avgPrb == null ? '—' : fmt(s.avgPrb) + '%' },
        { label: 'HSDPA Throughput', value: fmtCompactRate(s?.avgThroughputKbps) },
        { label: 'Cell Availability', value: s?.avgAvailability == null ? '—' : fmt(s.avgAvailability, 2) + '%' }
      )
    } else {
      kpis.push(
        { label: profile.utilizationLabel, value: s?.avgPrb == null ? '—' : fmt(s.avgPrb) + '%' },
        { label: 'TCH Availability', value: s?.avgAvailability == null ? '—' : fmt(s.avgAvailability, 2) + '%' }
      )
    }
  }

  kpis.push({ label: 'Ruleset', value: s?.rulesetVersion == null ? '—' : 'v' + s.rulesetVersion })

  const network = health?.network ?? []
  const latest = network.length > 0 ? network[network.length - 1] : null
  const maxPrio = Math.max(1, ...priority.map((p) => p.score))

  function toggleSection(id: SectionKey): void {
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function openInvestigation(cellId: number, cellName: string, site?: string | null, district?: string | null, region?: string | null): void {
    const path = [region, district, site, cellName].filter((p): p is string => Boolean(p))
    useAppStore.getState().setInvestigationTarget({ scope: 'cell', id: cellId, name: cellName, path })
    useAppStore.getState().setModule('investigation')
    emit('MODULE_CHANGED')
  }

  function openPriorityCenter(): void {
    useAppStore.getState().setModule('priority-center')
    emit('MODULE_CHANGED')
  }

  const meterRadius = 26
  const meterCirc = 2 * Math.PI * meterRadius
  const meterScore = currentTechHealth?.healthScore ?? 85
  const meterOffset = meterCirc - (Math.min(100, Math.max(0, meterScore)) / 100) * meterCirc
  const meterColor = meterScore >= 80 ? 'var(--green, #10b981)' : meterScore >= 60 ? 'var(--amber, #f59e0b)' : 'var(--danger, #ef4444)'

  return (
    <div className="module">
      {/* Top Bar Header */}
      <div className="module-head ov-module-head">
        <div className="ov-head-left" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2>Executive Overview</h2>
          <div className="seg-control" style={{ height: '28px' }}>
            {(['2G', '3G', '4G'] as Technology[]).map((t) => (
              <button
                key={t}
                className={`seg-btn${selectedTech === t ? ' active' : ''}`}
                onClick={() => setSelectedTech(t)}
                title={`View ${t} Network Health & Available KPIs`}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            className="btn btn-sm btn-ghost"
            style={{ fontWeight: 600, border: '1px solid var(--border)' }}
            onClick={() => setTargetsOpen(true)}
            title="Configure Technology KPI Targets & Thresholds"
          >
            🎯 Targets
          </button>
        </div>
        <div className="ov-head-right">
          <span className="module-workspace">{workspace?.name}</span>
          <span className="module-workspace ov-grain">{grainLabel(grain)} · {periodLabel(period)}</span>
          {s?.minDate && s?.maxDate && (
            <span className="module-workspace">{s.minDate} → {s.maxDate}</span>
          )}
        </div>
      </div>

      {/* Customizable Pinned Watchlist */}
      {pinned.length > 0 && (
        <div className="pinned-watchlist-section glass-card">
          <div className="pinned-watchlist-head">
            <div className="pinned-watchlist-title">
              <span>⭐</span> Pinned Executive Watchlist ({pinned.length})
            </div>
            <span className="card-note">1-Click Quick Drill-Down</span>
          </div>
          <div className="pinned-chip-grid">
            {pinned.map((item) => (
              <div
                key={item.id}
                className="pinned-entity-chip"
                onClick={() => {
                  if (item.type === 'cell') {
                    const cId = Number(item.id.replace('cell:', ''))
                    if (!isNaN(cId)) openInvestigation(cId, item.name)
                  }
                }}
              >
                <span>{item.type === 'cell' ? '📱' : item.type === 'district' ? '📍' : '📊'}</span>
                <span style={{ fontWeight: 600 }}>{item.name}</span>
                {item.detail && <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>({item.detail})</span>}
                <button
                  className="pin-btn pinned"
                  title="Unpin from watchlist"
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePin(item)
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Selected Technology Health Card Banner */}
      {currentTechHealth && (
        <div className="active-domain-health-banner glass-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <div className="radial-health-wrap">
              <svg className="radial-meter-svg" viewBox="0 0 68 68">
                <circle className="radial-meter-bg" cx="34" cy="34" r={meterRadius} />
                <circle
                  className="radial-meter-progress"
                  cx="34"
                  cy="34"
                  r={meterRadius}
                  strokeDasharray={meterCirc}
                  strokeDashoffset={meterOffset}
                  stroke={meterColor}
                />
              </svg>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="badge badge-tech" style={{ fontSize: '13px', padding: '3px 8px' }}>
                    {currentTechHealth.technology}
                  </span>
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>
                    {currentTechHealth.technology} Health Score: {currentTechHealth.healthScore}/100
                  </h3>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '2px' }}>
                  {currentTechHealth.cellCount} Total Cells · {currentTechHealth.ncCellCount} Non-Compliant ({currentTechHealth.compliancePct}% Compliant)
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn btn-sm btn-primary" onClick={() => setTargetsOpen(true)}>
              Edit {currentTechHealth.technology} Targets
            </button>
          </div>
        </div>
      )}

      {/* Executive Problem Summary Banner */}
      {execOverview?.problemSummary && (
        <div className="executive-problem-summary glass-card" style={{ marginBottom: 16 }}>
          <div className="problem-header">
            <div>
              <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>Executive Summary</span>
              <span style={{ fontSize: '12.5px', color: 'var(--text-dim)', marginLeft: '12px' }}>
                Overall Network Health: <b>{execOverview.overallHealthScore}/100</b>
                {execOverview.overallHealthDelta != null && (
                  <span style={{ color: execOverview.overallHealthDelta >= 0 ? 'var(--green)' : 'var(--danger)', marginLeft: '6px' }}>
                    ({execOverview.overallHealthDelta >= 0 ? '+' : ''}{execOverview.overallHealthDelta})
                  </span>
                )}
              </span>
            </div>
            <div className="problem-badges">
              {execOverview.problemSummary.chronicCellCount > 0 && (
                <span className="problem-badge-chronic pulse-badge-critical">
                  🔥 {execOverview.problemSummary.chronicCellCount} Chronic Cells (7+ wks)
                </span>
              )}
              {execOverview.problemSummary.persistentCellCount > 0 && (
                <span className="problem-badge-persistent pulse-badge-warning">
                  ⚠️ {execOverview.problemSummary.persistentCellCount} Persistent NC
                </span>
              )}
              {execOverview.problemSummary.criticalCellCount > 0 && (
                <span className="problem-badge-critical pulse-badge-critical">
                  🚨 {execOverview.problemSummary.criticalCellCount} Critical Severity
                </span>
              )}
            </div>
          </div>
          {execOverview.problemSummary.keyRecommendations.length > 0 && (
            <ul className="problem-recs">
              {execOverview.problemSummary.keyRecommendations.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Dynamic Available KPI Cards Grid */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>
            {selectedTech} Available Key Performance Indicators ({dynamicKpiCards.length})
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
            Prioritized by: Core KPIs → Configured Derived → Other Imported
          </span>
        </div>

        {dynamicKpiCards.length === 0 ? (
          <div className="card glass-card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)' }}>
            No KPI data available for {selectedTech} in the current dataset. Import {selectedTech} data in Data Manager.
          </div>
        ) : (
          <div className="dynamic-kpi-grid">
            {dynamicKpiCards.map((k) => (
              <div key={k.key} className="dynamic-kpi-card glass-card">
                <div className="dynamic-kpi-header">
                  <div>
                    <div className="dynamic-kpi-name">
                      {k.label}
                      {k.isDerived && (
                        <span className="badge badge-derived" style={{ fontSize: '9px', padding: '1px 5px' }}>
                          DERIVED KPI
                        </span>
                      )}
                      {k.isCore && (
                        <span className="badge badge-tech" style={{ fontSize: '9px', padding: '1px 5px' }}>
                          CORE
                        </span>
                      )}
                    </div>
                    <div className="dynamic-kpi-target">
                      Target: {k.betterDirection === 'lower_is_better' ? '≤' : '≥'} {k.target != null ? `${k.target} ${k.unit}` : '—'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      className={`pin-btn ${isPinned(`kpi:${k.key}`) ? 'pinned' : ''}`}
                      title={isPinned(`kpi:${k.key}`) ? 'Unpin from Watchlist' : 'Pin to Watchlist'}
                      onClick={() => togglePin({ id: `kpi:${k.key}`, type: 'kpi', name: k.label, detail: `${k.formattedValue}` })}
                    >
                      ⭐
                    </button>
                    <span className={`badge badge-compliance-${k.complianceStatus}`}>
                      {k.complianceStatus === 'compliant' && '✓ Compliant'}
                      {k.complianceStatus === 'warning' && '⚠ Warning'}
                      {k.complianceStatus === 'non_compliant' && '✕ Non-Compliant'}
                      {k.complianceStatus === 'unavailable' && '— Unavailable'}
                    </span>
                  </div>
                </div>

                <div className="dynamic-kpi-main">
                  <div className="dynamic-kpi-val" style={{
                    color: k.complianceStatus === 'non_compliant'
                      ? 'var(--danger, #ef4444)'
                      : k.complianceStatus === 'warning'
                      ? 'var(--amber, #f59e0b)'
                      : k.currentValue != null
                      ? 'var(--text)'
                      : 'var(--text-dim)'
                  }}>
                    {k.formattedValue}
                  </div>
                  <div className="dynamic-kpi-trend">
                    {k.trend === 'improving' && (
                      <span style={{ color: 'var(--green, #34d399)' }}>
                        {k.delta != null && k.delta < 0 ? '↓' : '↑'} Improving
                      </span>
                    )}
                    {k.trend === 'worsening' && (
                      <span style={{ color: 'var(--danger, #ef4444)' }}>
                        {k.delta != null && k.delta < 0 ? '↓' : '↑'} Worsening
                      </span>
                    )}
                    {k.trend === 'stable' && (
                      <span style={{ color: 'var(--text-dim)' }}>
                        {k.delta != null && Math.abs(k.delta) >= 0.01 ? (k.delta > 0 ? '↑ Increase' : '↓ Decrease') : '→ Stable'}
                      </span>
                    )}
                    {k.delta != null && (
                      <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginLeft: '4px' }}>
                        ({k.delta >= 0 ? '+' : ''}{k.delta})
                      </span>
                    )}
                  </div>
                </div>

                <div className="dynamic-kpi-footer">
                  <div className="dynamic-kpi-nc-stat">
                    <span>Non-compliant: <b>{k.nonCompliantCellCount}</b> cells ({k.nonCompliantCellPct ?? 0}%)</span>
                    {k.persistentNcCount > 0 && (
                      <span style={{ color: 'var(--amber, #f59e0b)', fontWeight: 600 }}>
                        {k.persistentNcCount} persistent
                      </span>
                    )}
                  </div>
                  {k.sparkline && k.sparkline.length > 1 && (
                    <div style={{ marginTop: '6px' }}>
                      <KpiSparkline
                        trend={k.sparkline.map((v, i) => ({
                          weekStart: k.sparklineDates?.[i] ?? `W${i + 1}`,
                          value: v,
                          breached: k.target != null ? (k.worseIsHigher ? v > k.target : v < k.target) : false
                        }))}
                        target={k.target}
                        worseIsHigher={k.worseIsHigher}
                        grain={grain}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* KPI Strip */}
      <div className="kpi-strip">
        {kpis.map((k) => (
          <div key={k.label} className="kpi">
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-label">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="ov-stack">
        <OverviewSection
          id="health"
          icon="🩺"
          label="Network Health Score"
          open={open.health}
          onToggle={toggleSection}
        >
          {latest ? (
            <>
              <div className="health-flex">
                <HealthGauge score={latest.score} />
                <div className="health-comps">
                  <CompBar label="Capacity" value={latest.capacity} />
                  <CompBar label="Throughput" value={latest.throughput} />
                  <CompBar label="Availability" value={latest.availability} />
                  <CompBar label="NC recurrence" value={latest.ncRecurrence} />
                  <CompBar label="Growth pressure" value={latest.growth} />
                </div>
              </div>
              <Chart option={healthLineOption(network, grain)} height={170} />
              <p className="card-note">
                Transparent weighted score — Capacity 25%, Throughput 20%, Availability 20%,
                NC recurrence 20%, Growth pressure 15% (ruleset v{s?.rulesetVersion ?? '—'}, {latest.asOf ? formatTimeLabel(latest.asOf, grain) : '—'}). Hover for the component breakdown;
                the dashed line marks the Watch threshold (65).
              </p>
            </>
          ) : (
            <p className="placeholder-text">—</p>
          )}
        </OverviewSection>

        <OverviewSection
          id="movement"
          icon="📈"
          label="NC Movement & Core Breach Rates"
          open={open.movement}
          onToggle={toggleSection}
        >
          {movement.length === 0 ? (
            <p className="card-note">No NC classifications yet — import data first.</p>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                <div className="seg">
                  <button
                    className={`seg-btn${movementMode === 'lifecycle' ? ' active' : ''}`}
                    onClick={() => setMovementMode('lifecycle')}
                  >
                    🧬 Lifecycle Movement
                  </button>
                  <button
                    className={`seg-btn${movementMode === 'core_kpis' ? ' active' : ''}`}
                    onClick={() => setMovementMode('core_kpis')}
                  >
                    📊 {selectedTech} Core KPI Breach Rates
                  </button>
                </div>

                {movementMode === 'core_kpis' && (
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Filter:</span>
                    {(() => {
                      const allKeys: Array<{ key: string; label: string }> = []
                      for (const m of movement) {
                        if (m.coreKpiNcRates) {
                          for (const [k, obj] of Object.entries(m.coreKpiNcRates)) {
                            if (!allKeys.some((x) => x.key === k)) {
                              allKeys.push({ key: k, label: obj.label })
                            }
                          }
                        }
                      }
                      if (allKeys.length === 0) return null
                      return allKeys.map((item) => {
                        const isSelected = activeKpiFilters.length === 0 || activeKpiFilters.includes(item.key)
                        return (
                          <button
                            key={item.key}
                            className={`chip ${isSelected ? 'chip-ok' : 'chip-dim'}`}
                            style={{ cursor: 'pointer', fontSize: '11px', border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)' }}
                            onClick={() => {
                              if (activeKpiFilters.length === 0) {
                                setActiveKpiFilters(allKeys.filter((x) => x.key !== item.key).map((x) => x.key))
                              } else if (activeKpiFilters.includes(item.key)) {
                                if (activeKpiFilters.length === 1) {
                                  setActiveKpiFilters([])
                                } else {
                                  setActiveKpiFilters(activeKpiFilters.filter((k) => k !== item.key))
                                }
                              } else {
                                const next = [...activeKpiFilters, item.key]
                                if (next.length === allKeys.length) {
                                  setActiveKpiFilters([])
                                } else {
                                  setActiveKpiFilters(next)
                                }
                              }
                            }}
                          >
                            {isSelected ? '✓ ' : ''}{item.label}
                          </button>
                        )
                      })
                    })()}
                  </div>
                )}
              </div>

              {movementMode === 'lifecycle' ? (
                <>
                  <Chart option={ncMovementOption(movement, grain)} height={230} />
                  <p className="card-note">
                    Last {movement.length} completed {grain === 'daily' ? 'days' : grain === 'monthly' ? 'months' : 'weeks'} — stacked
                    areas are lifecycle counts; the dashed line is the overall NC rate with the
                    district NC threshold (10%) marked.
                  </p>
                </>
              ) : (
                <>
                  <Chart option={coreKpiNcRateOption(movement, activeKpiFilters, grain)} height={230} />
                  <p className="card-note">
                    Historical trend of <b>{selectedTech} Core KPI Non-Compliance (Breach) Rates</b> across all observed cells.
                    Click the filter pills above to isolate individual KPI curves.
                  </p>
                </>
              )}
            </>
          )}
        </OverviewSection>

        <OverviewSection
          id="other"
          icon="🧮"
          label="Other Metrics"
          open={open.other}
          onToggle={toggleSection}
        >
          <div className="cards cards-3col">
            <div className="card">
              <div className="file-head">
                <h3>Top Priorities</h3>
                <span className="badge">Balanced</span>
              </div>
              {priority.length === 0 ? (
                <p className="card-note">No priority scores yet — import data first.</p>
              ) : (
                <div className="prio-list">
                  {priority.slice(0, 8).map((p, i) => (
                    <div
                      key={p.cellId}
                      className="prio-row"
                      style={{ cursor: 'pointer' }}
                      title={`Click to investigate ${p.cellName} (score ${p.score})`}
                      onClick={() => openInvestigation(p.cellId, p.cellName, p.site, p.district, p.region)}
                    >
                      <span className="prio-rank">{i + 1}</span>
                      <div className="prio-main">
                        <div className="prio-head">
                          <span className="prio-name">{p.cellName}</span>
                          <span className="prio-score" style={{ color: BAND_COLOR[p.band] ?? 'var(--text)' }}>
                            {p.score}
                          </span>
                        </div>
                        <div className="dist-track">
                          <div
                            className="dist-fill"
                            style={{ width: `${Math.round((p.score / maxPrio) * 100)}%`, background: BAND_COLOR[p.band] ?? 'var(--accent)' }}
                          />
                        </div>
                        <div className="prio-meta">
                          {p.site ?? '—'} · {p.district ?? '—'} · <span style={{ color: BAND_COLOR[p.band] }}>{p.band}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="card-note">
                Transparent 0–100 Priority Score (PRB, persistence, users, traffic, throughput, trend).{' '}
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                  onClick={openPriorityCenter}
                >
                  Open Priority Center
                </button>{' '}
                or click any cell to investigate.
              </p>
            </div>

            <div className="card">
              <div className="file-head">
                <h3>KPI Watch — {kpiOverview?.technology ?? selectedTech}</h3>
                {kpiOverview?.weekStart && (
                  <span className="badge">{formatTimeLabel(kpiOverview.weekStart, grain)}</span>
                )}
              </div>
              {!kpiOverview || (kpiOverview.kpis.length === 0 && kpiOverview.worstCells.length === 0) ? (
                <p className="card-note">
                  No imported KPI breaches for {kpiOverview?.technology ?? selectedTech} yet —
                  map extra columns to KPIs in Data Manager and import data.
                </p>
              ) : (
                <>
                  {kpiOverview.kpis.length > 0 && (
                    <div className="kpi-breach-list">
                      {kpiOverview.kpis.slice(0, 6).map((k) => (
                        <div key={k.key} className="kpi-breach-item">
                          <div className="kpi-breach-row">
                            <span className="prio-name">
                              {k.label}
                              {k.unit ? <span className="kpi-breach-unit"> ({k.unit})</span> : null}
                            </span>
                            <span className="kpi-breach-meta">
                              <b>{k.breachedCells}</b>/{k.observedCells} cells breached
                              {k.target != null && (
                                <span className="card-note"> target {k.target}{k.unit ? ` ${k.unit}` : ''}</span>
                              )}
                            </span>
                            <span
                              className={`badge ${k.avgSeverity != null && k.avgSeverity >= 50 ? 'badge-ro' : 'badge-warn'}`}
                            >
                              {k.avgSeverity == null ? '—' : `sev ${Math.round(k.avgSeverity)}`}
                            </span>
                          </div>
                          <KpiSparkline trend={k.trend} target={k.target} grain={grain} />
                        </div>
                      ))}
                    </div>
                  )}
                  {kpiOverview.worstCells.length > 0 && (
                    <div className="worst-cells">
                      <div className="worst-cells-title">Worst cells</div>
                      {kpiOverview.worstCells.slice(0, 5).map((c) => (
                        <div
                          key={c.cellId}
                          className="prio-row"
                          style={{ cursor: 'pointer' }}
                          title={`Click to investigate ${c.cellName}`}
                          onClick={() => openInvestigation(c.cellId, c.cellName, c.site, c.district)}
                        >
                          <span className="prio-rank">{c.breachScore == null ? '—' : Math.round(c.breachScore)}</span>
                          <div className="prio-main">
                            <div className="prio-head">
                              <span className="prio-name">{c.cellName}</span>
                              <span className="prio-score" style={{ color: 'var(--danger)' }}>
                                {c.breachedKpis} breached
                              </span>
                            </div>
                            <div className="prio-meta">
                              {c.site ?? '—'} · {c.district ?? '—'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="card-note">
                    Breaches of the {kpiOverview?.technology ?? selectedTech} technology's editable KPI
                    targets — click any cell to investigate.
                  </p>
                </>
              )}
            </div>

            <div className="card">
              <div className="file-head">
                <h3>NC Lifecycle & Severity</h3>
                <span className="badge">
                  {ncLifecycle?.ncRate != null ? `${ncLifecycle.ncRate.toFixed(1)}% NC Rate` : '—'}
                </span>
              </div>
              {!ncLifecycle || ncLifecycle.totalCells === 0 ? (
                <p className="card-note">No NC classification data yet — import cell data first.</p>
              ) : (
                <div className="nc-overview-body">
                  <div className="nc-dist-section">
                    <div className="nc-dist-title">Lifecycle Breakdown ({ncLifecycle.totalCells} cells)</div>
                    <div className="nc-bars-list">
                      {LIFECYCLE_ORDER.map((lc) => {
                        const count = ncLifecycle.byLifecycle[lc] ?? 0
                        const pct = ncLifecycle.totalCells > 0 ? (count / ncLifecycle.totalCells) * 100 : 0
                        return (
                          <div key={lc} className="nc-bar-row">
                            <span className="nc-bar-label">
                              <span className="nc-bar-dot" style={{ background: LIFECYCLE_COLOR[lc] }} />
                              {lc}
                            </span>
                            <div className="dist-track">
                              <div
                                className="dist-fill"
                                style={{ width: `${Math.round(pct)}%`, background: LIFECYCLE_COLOR[lc] }}
                              />
                            </div>
                            <span className="nc-bar-count">
                              <b>{count}</b> ({pct.toFixed(0)}%)
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div className="nc-dist-section" style={{ marginTop: '10px' }}>
                    <div className="nc-dist-title">Severity Tiers</div>
                    <div className="nc-sev-chips">
                      {SEVERITY_ORDER.map((sev) => {
                        const count = ncLifecycle.bySeverity[sev] ?? 0
                        const pct = ncLifecycle.totalCells > 0 ? (count / ncLifecycle.totalCells) * 100 : 0
                        return (
                          <div key={sev} className="nc-sev-chip" style={{ borderLeftColor: SEV_COLOR[sev] }}>
                            <div className="nc-sev-chip-head">
                              <span className="nc-sev-chip-name">{sev}</span>
                              <span className="nc-sev-chip-count" style={{ color: SEV_COLOR[sev] }}>{count}</span>
                            </div>
                            <div className="nc-sev-chip-pct">{pct.toFixed(1)}%</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <p className="card-note" style={{ marginTop: '8px' }}>
                    {ncLifecycle.byTrend.Worsening > 0 ? (
                      <span style={{ color: 'var(--danger)' }}>⚠ {ncLifecycle.byTrend.Worsening} cell(s) worsening</span>
                    ) : (
                      <span style={{ color: 'var(--green)' }}>✓ All cells stable or improving</span>
                    )}
                    {' · '}
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                      onClick={() => {
                        useAppStore.getState().setModule('cell-intelligence')
                        emit('MODULE_CHANGED')
                      }}
                    >
                      View Cell Intelligence
                    </button>
                  </p>
                </div>
              )}
            </div>

            <GhanaMap />
          </div>
        </OverviewSection>
      </div>

      <TargetsModal isOpen={targetsOpen} onClose={() => setTargetsOpen(false)} />
    </div>
  )
}

/** Collapsible subsection — clicking the header expands/collapses it. */
const OverviewSection = React.memo(function OverviewSection({
  id,
  icon,
  label,
  open,
  onToggle,
  children
}: {
  id: SectionKey
  icon: string
  label: string
  open: boolean
  onToggle: (id: SectionKey) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className={`ov-section${open ? ' open' : ''}`} id={`ov-${id}`}>
      <button className="ov-section-head" onClick={() => onToggle(id)} aria-expanded={open}>
        <span className="ov-section-icon">{icon}</span>
        <span className="ov-section-title">{label}</span>
        <span className="ov-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="ov-section-body">{children}</div>}
    </section>
  )
})
