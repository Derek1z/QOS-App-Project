import { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import type { HealthResult, NcMovementRow, PriorityRow } from '../../../shared/api'
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

export default function Overview(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const summary = useAppStore((s) => s.summary)
  const [health, setHealth] = useState<HealthResult | null>(null)
  const [movement, setMovement] = useState<NcMovementRow[]>([])
  const [priority, setPriority] = useState<PriorityRow[]>([])
  const s = summary

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [h, m, p] = await Promise.all([
          window.api.analytics.health(),
          window.api.analytics.ncMovement(8),
          window.api.analytics.priorityQueue('balanced', 8)
        ])
        if (!alive) return
        setHealth(h)
        setMovement(m)
        setPriority(p)
      } catch {
        /* workspace may have closed mid-flight */
      }
    })()
    return () => {
      alive = false
    }
  }, [workspace?.path, workspace?.readOnly])

  const kpis: { label: string; value: string }[] = [
    { label: 'Cells', value: fmt(s?.cells, 0) },
    { label: 'Sites', value: fmt(s?.sites, 0) },
    { label: 'Districts', value: fmt(s?.districts, 0) },
    { label: 'Regions', value: fmt(s?.regions, 0) },
    { label: 'Observed rows', value: fmt(s?.rowCount, 0) },
    { label: 'Weekly NC cells', value: fmt(s?.weeklyNcCells, 0) },
    { label: 'Avg PRB', value: s?.avgPrb == null ? '—' : fmt(s.avgPrb) + '%' },
    { label: 'Traffic', value: s?.totalVolumeMb == null ? '—' : fmt(s.totalVolumeMb / 1024, 1) + ' GB' },
    { label: 'Connected users', value: s?.totalUsers == null ? '—' : fmt(s.totalUsers, 0) },
    { label: 'DL throughput', value: s?.avgThroughputKbps == null ? '—' : fmt(s.avgThroughputKbps / 1024, 1) + ' Mbps' },
    { label: 'Availability', value: s?.avgAvailability == null ? '—' : fmt(s.avgAvailability, 2) + '%' },
    { label: 'Ruleset', value: s?.rulesetVersion == null ? '—' : 'v' + s.rulesetVersion }
  ]

  const hasData = (s?.rowCount ?? 0) > 0
  const network = health?.network ?? []
  const latest = network.length > 0 ? network[network.length - 1] : null
  const maxPrio = Math.max(1, ...priority.map((p) => p.score))

  return (
    <div className="module">
      <div className="module-head">
        <h2>Executive Overview</h2>
        <span className="module-workspace">{workspace?.name}</span>
        {s?.minDate && s?.maxDate && (
          <span className="module-workspace">{s.minDate} → {s.maxDate}</span>
        )}
      </div>

      <div className="kpi-strip">
        {kpis.map((k) => (
          <div key={k.label} className="kpi">
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-label">{k.label}</div>
          </div>
        ))}
      </div>

      {!hasData && (
        <div className="notice">
          No data yet. Import a CSV from <b>Data Manager</b> or drag files onto the window — the
          analytics engine classifies every cell-week automatically.
        </div>
      )}

      <div className="cards">
        <div className="card">
          <h3>Network Health Score</h3>
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
        </div>

        <div className="card">
          <h3>NC Movement</h3>
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
        </div>

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
                <div key={p.cellId} className="prio-row">
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
            Transparent 0–100 Priority Score (PRB, persistence, users, traffic, throughput, trend).
            The full queue with action workflow arrives with the Priority Center (M4).
          </p>
        </div>

        <GhanaMap />
      </div>
    </div>
  )
}
