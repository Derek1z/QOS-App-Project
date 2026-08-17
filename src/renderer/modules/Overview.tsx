import React, { useEffect, useState } from 'react'
import { useAppStore, emit, type PeriodId, type Grain } from '../store'
import type { HealthResult, NcMovementRow, PriorityRow, KpiOverviewResult, KpiTrendPoint } from '../../../shared/api'
import { techProfile } from '../lib/techProfile'
import Chart from '../lib/Chart'
import { healthLineOption, ncMovementOption, weekLabel } from '../lib/overviewCharts'
import GhanaMap from './GhanaMap'

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
const KpiSparkline = React.memo(function KpiSparkline({ trend, target }: { trend: KpiTrendPoint[]; target: number | null }): React.JSX.Element {
  if (trend.length === 0) return <span className="card-note">no weekly history</span>
  const W = 280
  const H = 34
  const pad = 4
  const values = trend.map((t) => t.value).filter((v): v is number => v != null)
  const maxV = Math.max(1, ...values, target ?? 0) * 1.05
  const minV = Math.min(0, ...values, target ?? 0)
  const span = Math.max(1, maxV - minV)
  const bw = W / trend.length
  const y = (v: number): number => H - pad - ((v - minV) / span) * (H - pad * 2)
  const bars = trend.map((t, i) => {
    const v = t.value ?? 0
    const bh = Math.max(1.5, H - pad - y(v))
    return (
      <rect
        key={t.weekStart}
        x={i * bw + bw * 0.18}
        y={y(v)}
        width={bw * 0.64}
        height={bh}
        rx={1.5}
        fill={t.breached ? 'var(--danger)' : 'var(--accent)'}
        opacity={t.breached ? 0.95 : 0.55}
      >
        <title>{`${weekLabel(t.weekStart)}: ${v == null ? '—' : v}${t.breached ? ' — breach' : ''}`}</title>
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
        stroke="var(--text-faint)"
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

type SectionKey = 'health' | 'movement' | 'other'

const SECTION_META: Array<{ key: SectionKey; label: string; icon: string }> = [
  { key: 'health', label: 'Network Health Score', icon: '🩺' },
  { key: 'movement', label: 'NC Movement', icon: '📈' },
  { key: 'other', label: 'Other Metrics', icon: '🧮' }
]

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
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({ health: true, movement: true, other: true })
  const s = summary

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        // summary is workspace-global but re-read here so the KPI strip tracks
        // the active technology's data (switching 2G/3G/4G re-seeds KPIs)
        const [sum, h, m, p, ko] = await Promise.all([
          window.api.analytics.summary({ period, grain }),
          window.api.analytics.health(grain),
          window.api.analytics.ncMovement(8),
          window.api.analytics.priorityQueue('balanced', 8),
          window.api.analytics.kpiOverview(8)
        ])
        if (!alive) return
        if (sum) setSummary(sum)
        setHealth(h)
        setMovement(m)
        setPriority(p)
        setKpiOverview(ko)
      } catch {
        /* workspace may have closed mid-flight */
      }
    })()
    return () => {
      alive = false
    }
    // technology is part of the workspace — reload when the switcher changes
    // so every card reflects the active technology's imported KPIs
  }, [workspace?.path, workspace?.readOnly, workspace?.technology, period, grain, setSummary])

  const profile = techProfile(workspace?.technology)
  const kpis: { label: string; value: string }[] = [
    { label: 'Cells', value: fmt(s?.cells, 0) },
    { label: profile.siteCountLabel, value: fmt(s?.sites, 0) },
    { label: 'Districts', value: fmt(s?.districts, 0) },
    { label: 'Regions', value: fmt(s?.regions, 0) },
    { label: 'Observed rows', value: fmt(s?.rowCount, 0) },
    { label: 'Weekly NC cells', value: fmt(s?.weeklyNcCells, 0) },
    { label: profile.utilizationLabel, value: s?.avgPrb == null ? '—' : fmt(s.avgPrb) + '%' },
    { label: 'Traffic', value: s?.totalVolumeMb == null ? '—' : fmt(s.totalVolumeMb / 1024, 1) + ' GB' },
    { label: 'Connected users', value: s?.totalUsers == null ? '—' : fmt(s.totalUsers, 0) },
    { label: 'DL throughput', value: s?.avgThroughputKbps == null ? '—' : fmt(s.avgThroughputKbps / 1024, 1) + ' Mbps' },
    { label: 'Availability', value: s?.avgAvailability == null ? '—' : fmt(s.avgAvailability, 2) + '%' },
    { label: 'Ruleset', value: s?.rulesetVersion == null ? '—' : 'v' + s.rulesetVersion }
  ]

  const network = health?.network ?? []
  const latest = network.length > 0 ? network[network.length - 1] : null
  const maxPrio = Math.max(1, ...priority.map((p) => p.score))
  const tech = workspace?.technology ?? '4G'

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

  return (
    <div className="module">
      <div className="module-head ov-module-head">
        <div className="ov-head-left">
          <h2>Executive Overview</h2>
          <span className="badge ov-tech-badge">{tech}</span>
        </div>
        <div className="ov-head-right">
          <span className="module-workspace">{workspace?.name}</span>
          <span className="module-workspace ov-grain">{grainLabel(grain)} · {periodLabel(period)}</span>
          {s?.minDate && s?.maxDate && (
            <span className="module-workspace">{s.minDate} → {s.maxDate}</span>
          )}
        </div>
      </div>

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
              <Chart option={healthLineOption(network)} height={170} />
              <p className="card-note">
                Transparent weighted score — Capacity 25%, Throughput 20%, Availability 20%,
                NC recurrence 20%, Growth pressure 15% (ruleset v{s?.rulesetVersion ?? '—'}, week{' '}
                {latest.asOf ? weekLabel(latest.asOf) : '—'}). Hover for the component breakdown;
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
          label="NC Movement"
          open={open.movement}
          onToggle={toggleSection}
        >
          {movement.length === 0 ? (
            <p className="card-note">No NC classifications yet — import data first.</p>
          ) : (
            <>
              <Chart option={ncMovementOption(movement)} height={230} />
              <p className="card-note">
                Last {movement.length} completed weeks — ISO weeks, Monday–Sunday (§19). Stacked
                areas are lifecycle counts; the dashed line is the weekly NC rate with the
                district NC threshold (10%) marked.
              </p>
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
          <div className="cards">
            <div className="card">
              <div className="file-head">
                <h3>Top Priorities</h3>
                <span className="badge">Balanced</span>
              </div>
              {priority.length === 0 ? (
                <p className="card-note">No priority scores yet — import data first.</p>
              ) : (
                <div className="prio-list">
                  {priority.map((p, i) => (
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
                <h3>KPI Watch — {kpiOverview?.technology ?? tech}</h3>
                {kpiOverview?.weekStart && (
                  <span className="badge">{weekLabel(kpiOverview.weekStart)}</span>
                )}
              </div>
              {!kpiOverview || (kpiOverview.kpis.length === 0 && kpiOverview.worstCells.length === 0) ? (
                <p className="card-note">
                  No imported KPI breaches for {kpiOverview?.technology ?? tech} yet —
                  map extra columns to KPIs in Data Manager and import data.
                </p>
              ) : (
                <>
                  {kpiOverview.kpis.length > 0 && (
                    <div className="kpi-breach-list">
                      {kpiOverview.kpis.slice(0, 5).map((k) => (
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
                          <KpiSparkline trend={k.trend} target={k.target} />
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
                    Breaches of the {kpiOverview?.technology ?? tech} technology's editable KPI
                    targets — click any cell to investigate.
                  </p>
                </>
              )}
            </div>

            <GhanaMap />
          </div>
        </OverviewSection>
      </div>
    </div>
  )
}
