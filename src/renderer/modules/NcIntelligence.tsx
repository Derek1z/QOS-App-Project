import React, { useEffect, useState, useMemo } from 'react'
import { useAppStore } from '../store'
import type {
  NcLifecycleResult, NcLifecycleRow, PriorityRow, HealthResult, PriorityMode, Grain, Technology,
  CellIntelligenceResult, CellIntelligenceRow, CellKpiValue
} from '../../../shared/api'
import { LIFECYCLES, NC_LIFECYCLES, LIFECYCLE_STYLE, type Lifecycle } from '../../../shared/lifecycle'

function renderBreachedKpis(kpis: CellKpiValue[] | undefined, fallbackScore: number, tech: Technology): React.JSX.Element {
  const breached = (kpis ?? []).filter((k) => k.breached)
  if (breached.length > 0) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
        {breached.slice(0, 3).map((k) => {
          const valStr = k.value != null ? (Math.abs(k.value) >= 100 ? Math.round(k.value).toLocaleString() : k.value.toFixed(1)) : '—'
          const tgtStr = k.target != null ? (Math.abs(k.target) >= 100 ? Math.round(k.target).toLocaleString() : k.target.toString()) : '—'
          const sign = k.worseIsHigher ? '>' : '<'
          const shortLabel = k.label
            .replace('Congestion Rate (BH)', 'Cong (BH)')
            .replace('Call Connection Success Rate', 'CSSR')
            .replace('Call Setup Success Rate', 'CSSR')
            .replace('Call Drop Rate', 'CDR')
            .replace('Data Access Success Rate', 'DASR')
            .replace('Average Timing Advance', 'Avg TA')
          return (
            <span
              key={k.key}
              title={`${k.label}: ${valStr}${k.unit} (${sign} target ${tgtStr}${k.unit})`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 8px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#fca5a5',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                whiteSpace: 'nowrap'
              }}
            >
              <strong style={{ color: '#f87171' }}>{shortLabel}:</strong>
              <span>{valStr}{k.unit}</span>
              <span style={{ color: 'var(--text-dim)', fontSize: '10px' }}>({sign}{tgtStr}{k.unit})</span>
            </span>
          )
        })}
        {breached.length > 3 && (
          <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 600 }}>
            +{breached.length - 3} more
          </span>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <span
        style={{
          padding: '2px 8px',
          borderRadius: '6px',
          fontSize: '11px',
          fontWeight: 600,
          background: fallbackScore > 75 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
          color: fallbackScore > 75 ? '#fca5a5' : '#fde68a',
          border: '1px solid rgba(239, 68, 68, 0.25)'
        }}
      >
        {tech} Target Breach · Score {Math.round(fallbackScore)}
      </span>
    </div>
  )
}

function renderLifecycleBadge(lifecycle?: string, breachDays?: number): React.JSX.Element {
  const lc = (LIFECYCLES as readonly string[]).includes(lifecycle ?? '') ? (lifecycle as Lifecycle) : 'Healthy'
  const { bg, color, border } = LIFECYCLE_STYLE[lc]
  const streakStr = breachDays != null && breachDays > 0 ? `${breachDays} bad day${breachDays === 1 ? '' : 's'}` : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
      <span
        style={{
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '10px',
          fontWeight: 800,
          textTransform: 'uppercase',
          background: bg,
          color,
          border: `1px solid ${border}`
        }}
      >
        {lc}
      </span>
      {streakStr && (
        <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 600 }}>
          ⏱ {streakStr}
        </span>
      )}
    </div>
  )
}

function renderSeverityBand(band: string, score: number, severity?: string): React.JSX.Element {
  const isCrit = band === 'Critical' || severity === 'Critical'
  const isHigh = band === 'High' || severity === 'High'
  const badgeBg = isCrit ? 'rgba(239, 68, 68, 0.2)' : isHigh ? 'rgba(245, 158, 11, 0.2)' : 'rgba(56, 189, 248, 0.2)'
  const badgeColor = isCrit ? '#f87171' : isHigh ? '#fbbf24' : '#38bdf8'
  const badgeBorder = isCrit ? 'rgba(239, 68, 68, 0.35)' : isHigh ? 'rgba(245, 158, 11, 0.35)' : 'rgba(56, 189, 248, 0.35)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '10px',
            fontWeight: 800,
            textTransform: 'uppercase',
            background: badgeBg,
            color: badgeColor,
            border: `1px solid ${badgeBorder}`
          }}
        >
          {severity || band}
        </span>
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#f8fafc' }}>
          {band}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '90px' }}>
        <div style={{ flex: 1, height: '5px', background: 'var(--bg-3)', borderRadius: '3px', overflow: 'hidden' }}>
          <div
            style={{
              width: `${Math.min(100, score)}%`,
              height: '100%',
              background: score > 75 ? '#f87171' : score > 50 ? '#fbbf24' : '#38bdf8'
            }}
          />
        </div>
        <span style={{ fontWeight: 800, fontSize: '11px', color: 'var(--text)' }}>{Math.round(score)}</span>
      </div>
    </div>
  )
}

export default function NcIntelligence(): React.JSX.Element {
  const storeGrain = useAppStore((s) => s.grain)
  const setStoreGrain = useAppStore((s) => s.setGrain)
  const selectedTech = useAppStore((s) => s.selectedTech)
  const setSelectedTech = useAppStore((s) => s.setSelectedTech)
  const setModule = useAppStore((s) => s.setModule)
  const setInvestigationTarget = useAppStore((s) => s.setInvestigationTarget)

  const [grain, setGrain] = useState<Grain>(storeGrain ?? 'weekly')
  const [tech, setTech] = useState<Technology>(selectedTech || '4G')
  const [nc, setNc] = useState<NcLifecycleResult | null>(null)
  const [priority, setPriority] = useState<PriorityRow[]>([])
  const [cellIntel, setCellIntel] = useState<CellIntelligenceResult | null>(null)
  const [, setHealth] = useState<HealthResult | null>(null)
  const [mode, setMode] = useState<PriorityMode>('balanced')
  const [fBand, setFBand] = useState<string>('all')
  const [fQ, setFQ] = useState('')

  useEffect(() => {
    if (selectedTech && selectedTech !== tech) {
      setTech(selectedTech)
    }
  }, [selectedTech])

  useEffect(() => {
    if (storeGrain && storeGrain !== grain) {
      setGrain(storeGrain)
    }
  }, [storeGrain])

  const handleGrainChange = (newGrain: Grain) => {
    setGrain(newGrain)
    setStoreGrain(newGrain)
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [ncRes, prioRes, healthRes, intelRes] = await Promise.all([
          window.api.analytics.ncLifecycle(grain),
          window.api.analytics.priorityQueue(mode, 50),
          window.api.analytics.health(),
          window.api.analytics.cellIntelligence({ limit: 150, technology: tech })
        ])
        if (!alive) return
        setNc(ncRes)
        setPriority(prioRes)
        setHealth(healthRes)
        setCellIntel(intelRes)
      } catch {
        /* workspace closed mid-flight */
      }
    })()
    return () => { alive = false }
  }, [grain, mode, tech])

  const intelMap = useMemo(() => {
    const m = new Map<number, CellIntelligenceRow>()
    if (cellIntel?.rows) {
      for (const r of cellIntel.rows) m.set(r.cellId, r)
    }
    return m
  }, [cellIntel])

  const ncMap = useMemo(() => {
    const m = new Map<number, NcLifecycleRow>()
    if (nc?.cells) {
      for (const c of nc.cells) m.set(c.cellId, c)
    }
    return m
  }, [nc])

  const filteredPriority = useMemo(() => {
    return priority.filter((p) => {
      if (fBand !== 'all' && p.band.toLowerCase() !== fBand.toLowerCase()) return false
      const intel = intelMap.get(p.cellId)
      const site = p.site || intel?.site || ''
      const district = p.district || intel?.district || ''
      const region = p.region || intel?.region || ''
      if (fQ) {
        const q = fQ.toLowerCase()
        if (
          !p.cellName.toLowerCase().includes(q) &&
          !site.toLowerCase().includes(q) &&
          !district.toLowerCase().includes(q) &&
          !region.toLowerCase().includes(q)
        ) {
          return false
        }
      }
      return true
    })
  }, [priority, fBand, fQ, intelMap])

  const handleInvestigate = (p: PriorityRow) => {
    const intel = intelMap.get(p.cellId)
    const ncCell = ncMap.get(p.cellId)
    const region = p.region || intel?.region || ncCell?.region || ''
    const district = p.district || intel?.district || ncCell?.district || ''
    const site = p.site || intel?.site || ncCell?.site || ''
    setInvestigationTarget({
      id: p.cellId,
      name: p.cellName,
      scope: 'cell',
      path: [region, district, site, p.cellName].filter(Boolean)
    })
    setModule('investigation')
  }

  const count = (l: Lifecycle): number => nc?.byLifecycle[l] ?? 0
  const persistentCount = count('Persistent NC') + count('Chronic NC')
  const newCount = count('New NC')
  const recurringCount = count('Recurring NC') + count('Intermittent NC')
  const recoveringCount = count('Recovering')
  const totalBreaches = NC_LIFECYCLES.reduce((s, l) => s + count(l), 0)
  const periodWord = grain === 'monthly' ? 'month' : grain === 'daily' ? 'day' : 'week'

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1400px', margin: '0 auto', color: 'var(--text)' }}>
      {/* Executive Control Bar */}
      <div
        style={{
          background: 'var(--bg-card)',
          padding: '14px 20px',
          borderRadius: '12px',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {/* Technology Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Technology:
            </span>
            <div style={{ display: 'inline-flex', background: 'var(--bg-3)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              {(['2G', '3G', '4G'] as Technology[]).map((t) => (
                <button
                  key={t}
                  onClick={() => void setSelectedTech(t)}
                  style={{
                    padding: '5px 16px',
                    fontSize: '12px',
                    fontWeight: 800,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    background: tech === t ? 'linear-gradient(135deg, #059669, #10b981)' : 'transparent',
                    color: tech === t ? '#ffffff' : 'var(--text-dim)',
                    boxShadow: tech === t ? '0 2px 6px rgba(16, 185, 129, 0.3)' : 'none'
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Granularity Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Granularity:
            </span>
            <div style={{ display: 'inline-flex', background: 'var(--bg-3)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              {[
                { id: 'daily', label: 'Daily' },
                { id: 'weekly', label: 'Weekly' }
              ].map((g) => (
                <button
                  key={g.id}
                  onClick={() => handleGrainChange(g.id as Grain)}
                  style={{
                    padding: '5px 16px',
                    fontSize: '12px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    background: grain === g.id ? 'var(--accent)' : 'transparent',
                    color: grain === g.id ? '#ffffff' : 'var(--text-dim)'
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* Priority Mode Select */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Priority Model:
            </span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as PriorityMode)}
              style={{
                background: 'var(--bg-3)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '5px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <option value="balanced">Balanced Quality & Impact</option>
              <option value="customer">Customer Traffic Impact</option>
              <option value="congestion">Capacity Severity</option>
              <option value="persistence">Chronic Persistence</option>
            </select>
          </div>
        </div>

        <button
          onClick={() => setModule('priority-center')}
          style={{
            padding: '6px 14px',
            background: 'var(--bg-3)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          🎯 Open Smart Priority Queue
        </button>
      </div>

      {/* Main Executive Banner Card */}
      <div
        style={{
          background: 'var(--bg-card)',
          padding: '20px 24px',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '20px',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ position: 'relative', width: '80px', height: '80px', minWidth: '80px', minHeight: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="80" height="80" viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)', width: '80px', height: '80px' }}>
              <path
                stroke="var(--bg-3)"
                strokeWidth="3.5"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                stroke="#f87171"
                strokeDasharray="78, 100"
                strokeWidth="3.5"
                strokeLinecap="round"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <span style={{ position: 'absolute', fontSize: '18px', fontWeight: 800, color: '#f87171' }}>{totalBreaches}</span>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 800,
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#f87171',
                  border: '1px solid rgba(239, 68, 68, 0.3)'
                }}
              >
                {tech}
              </span>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                Non-Compliance & Breach Classification Analytics
              </h2>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px', margin: '4px 0 0 0' }}>
              Active scope: <strong style={{ color: 'var(--text)' }}>{grain}</strong> grain · {persistentCount} Persistent/Chronic, {recurringCount} Recurring/Intermittent, {newCount} New, {recoveringCount} Recovering
              {nc?.periodComplete === false ? ` (partial ${periodWord} — no complete ${periodWord} yet)` : ''}
            </p>
          </div>
        </div>

        <button
          onClick={() => setModule('investigation')}
          style={{
            padding: '10px 20px',
            fontSize: '12px',
            fontWeight: 700,
            background: 'linear-gradient(135deg, #059669, #10b981)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
          }}
        >
          🔬 Deep-Dive Cell Investigation
        </button>
      </div>

      {/* 4 Breach Lifecycle Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
        <div style={{ background: 'var(--bg-card)', padding: '18px 20px', borderRadius: '14px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            🔴 Persistent / Chronic Breaches
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#f8fafc', margin: '6px 0' }}>
            {persistentCount} <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)' }}>cells</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Consecutive threshold violations</div>
        </div>

        <div style={{ background: 'var(--bg-card)', padding: '18px 20px', borderRadius: '14px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            🟠 Recurring / Intermittent Breaches
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#f8fafc', margin: '6px 0' }}>
            {recurringCount} <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)' }}>cells</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Intermittent breach pattern</div>
        </div>

        <div style={{ background: 'var(--bg-card)', padding: '18px 20px', borderRadius: '14px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#eab308', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            🟡 New NCs
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#f8fafc', margin: '6px 0' }}>
            {newCount} <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)' }}>cells</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>First breach in active window</div>
        </div>

        <div style={{ background: 'var(--bg-card)', padding: '18px 20px', borderRadius: '14px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#06b6d4', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            🔵 Recovering Cells
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#f8fafc', margin: '6px 0' }}>
            {recoveringCount} <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)' }}>cells</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Improving toward compliance</div>
        </div>
      </div>

      {/* Worst Performer Cell Ranking Table */}
      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>Worst Performer Cell Ranking</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', margin: '4px 0 0 0' }}>
              Prioritized by composite multi-factor risk score
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Search Filter */}
            <input
              type="text"
              placeholder="Filter cell or site..."
              value={fQ}
              onChange={(e) => setFQ(e.target.value)}
              style={{
                background: 'var(--bg-3)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12px'
              }}
            />

            {/* Band Filters */}
            <div style={{ display: 'inline-flex', background: 'var(--bg-3)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              {['all', 'critical', 'high', 'medium', 'watch'].map((b) => (
                <button
                  key={b}
                  onClick={() => setFBand(b)}
                  style={{
                    padding: '4px 12px',
                    fontSize: '11px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    background: fBand === b ? 'var(--accent)' : 'transparent',
                    color: fBand === b ? '#ffffff' : 'var(--text-dim)'
                  }}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-3)', borderBottom: '1px solid var(--border)', color: 'var(--text-dim)', textTransform: 'uppercase', fontSize: '11px' }}>
                <th style={{ padding: '12px 14px' }}>Rank & Cell Name</th>
                <th style={{ padding: '12px 14px' }}>Site / District / Region</th>
                <th style={{ padding: '12px 14px' }}>NC Lifecycle & Streak</th>
                <th style={{ padding: '12px 14px' }}>Severity & Risk Score</th>
                <th style={{ padding: '12px 14px' }}>Breaching KPIs vs Targets</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredPriority.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-dim)' }}>
                    No non-compliant cells matching active filters.
                  </td>
                </tr>
              ) : (
                filteredPriority.map((p, idx) => {
                  const intel = intelMap.get(p.cellId)
                  const ncCell = ncMap.get(p.cellId)
                  const siteName = p.site || intel?.site || ncCell?.site || '—'
                  const districtName = p.district || intel?.district || ncCell?.district || '—'
                  const regionName = p.region || intel?.region || ncCell?.region || '—'

                  return (
                    <tr key={p.cellId} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s ease' }}>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ color: 'var(--text-dim)', fontSize: '11px', fontWeight: 700, minWidth: '22px' }}>
                            #{idx + 1}
                          </span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ fontWeight: 800, color: '#f8fafc', fontSize: '13px' }}>
                              {p.cellName}
                            </span>
                            <span
                              style={{
                                display: 'inline-flex',
                                width: 'fit-content',
                                padding: '1px 6px',
                                fontSize: '10px',
                                fontWeight: 800,
                                borderRadius: '4px',
                                background: 'var(--bg-3)',
                                color: 'var(--text-dim)',
                                border: '1px solid var(--border)'
                              }}
                            >
                              {tech}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontWeight: 700, color: '#f8fafc' }}>{siteName}</span>
                          <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                            {districtName} · {regionName}
                          </span>
                        </div>
                      </td>

                      <td style={{ padding: '12px 14px' }}>
                        {renderLifecycleBadge(intel?.lifecycle || ncCell?.lifecycle, intel?.breachDays ?? ncCell?.breachDays)}
                      </td>

                      <td style={{ padding: '12px 14px' }}>
                        {renderSeverityBand(p.band, p.score, intel?.severity || ncCell?.severity)}
                      </td>

                      <td style={{ padding: '12px 14px', maxWidth: '340px' }}>
                        {renderBreachedKpis(intel?.kpis, p.components.kpiBreach || p.score, tech)}
                      </td>

                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        <button
                          onClick={() => handleInvestigate(p)}
                          style={{
                            padding: '6px 14px',
                            fontSize: '11px',
                            fontWeight: 800,
                            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.3))',
                            color: '#34d399',
                            border: '1px solid rgba(16, 185, 129, 0.4)',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            boxShadow: '0 2px 6px rgba(16, 185, 129, 0.15)',
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.35), rgba(5, 150, 105, 0.5))'
                            e.currentTarget.style.transform = 'translateY(-1px)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.3))'
                            e.currentTarget.style.transform = 'translateY(0)'
                          }}
                        >
                          🎯 Investigate
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
