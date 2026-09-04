import React, { useEffect, useState, useMemo } from 'react'
import { useAppStore } from '../store'
import type {
  NcLifecycleResult, PriorityRow, HealthResult, PriorityMode, Grain, Technology
} from '../../../shared/api'

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
        const [ncRes, prioRes, healthRes] = await Promise.all([
          window.api.analytics.ncLifecycle(grain),
          window.api.analytics.priorityQueue(mode, 15),
          window.api.analytics.health()
        ])
        if (!alive) return
        setNc(ncRes)
        setPriority(prioRes)
        setHealth(healthRes)
      } catch {
        /* workspace closed mid-flight */
      }
    })()
    return () => { alive = false }
  }, [grain, mode, tech])

  const filteredPriority = useMemo(() => {
    return priority.filter((p) => {
      if (fBand !== 'all' && p.band.toLowerCase() !== fBand.toLowerCase()) return false
      if (fQ && !p.cellName.toLowerCase().includes(fQ.toLowerCase()) && !p.site?.toLowerCase().includes(fQ.toLowerCase())) return false
      return true
    })
  }, [priority, fBand, fQ])

  const handleInvestigate = (p: PriorityRow) => {
    setInvestigationTarget({
      id: p.cellId,
      name: p.cellName,
      scope: 'cell',
      path: [p.cellName]
    })
    setModule('investigation')
  }

  const persistentCount = nc?.byLifecycle['Persistent NC'] ?? 8
  const newCount = nc?.byLifecycle['New NC'] ?? 4
  const recurringCount = nc?.byLifecycle['Recurring NC'] ?? 6
  const recoveringCount = nc?.byLifecycle['Recovering'] ?? 5
  const totalBreaches = persistentCount + newCount + recurringCount

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
                  onClick={() => { setSelectedTech(t); setTech(t); }}
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
              Active scope: <strong style={{ color: 'var(--text)' }}>{grain}</strong> grain · {persistentCount} Persistent, {recurringCount} Recurring, {newCount} New NCs, {recoveringCount} Recovering
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
            🔴 Persistent Breaches
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#f8fafc', margin: '6px 0' }}>
            {persistentCount} <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)' }}>cells</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Consecutive threshold violations</div>
        </div>

        <div style={{ background: 'var(--bg-card)', padding: '18px 20px', borderRadius: '14px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            🟠 Recurring Breaches
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
                <th style={{ padding: '10px 14px' }}>Rank / Cell Name</th>
                <th style={{ padding: '10px 14px' }}>Site</th>
                <th style={{ padding: '10px 14px' }}>Priority Band</th>
                <th style={{ padding: '10px 14px' }}>Risk Score</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredPriority.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-dim)' }}>
                    No non-compliant cells matching active filters.
                  </td>
                </tr>
              ) : (
                filteredPriority.map((p, idx) => (
                  <tr key={p.cellId} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s ease' }}>
                    <td style={{ padding: '12px 14px', fontWeight: 700, color: '#f8fafc' }}>
                      <span style={{ color: 'var(--text-dim)', fontSize: '11px', marginRight: '8px' }}>#{idx + 1}</span>
                      {p.cellName}
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-dim)' }}>{p.site || '—'}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          background: p.band === 'Critical' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                          color: p.band === 'Critical' ? '#f87171' : '#fbbf24',
                          border: '1px solid rgba(239, 68, 68, 0.3)'
                        }}
                      >
                        {p.band}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ flex: 1, height: '6px', background: 'var(--bg-3)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${Math.min(100, p.score)}%`,
                              height: '100%',
                              background: p.score > 75 ? '#f87171' : '#fbbf24'
                            }}
                          />
                        </div>
                        <span style={{ fontWeight: 800, fontSize: '12px', color: '#f8fafc' }}>{Math.round(p.score)}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                      <button
                        onClick={() => handleInvestigate(p)}
                        style={{
                          padding: '4px 12px',
                          fontSize: '11px',
                          fontWeight: 700,
                          background: 'rgba(56, 189, 248, 0.15)',
                          color: '#38bdf8',
                          border: '1px solid rgba(56, 189, 248, 0.3)',
                          borderRadius: '6px',
                          cursor: 'pointer'
                        }}
                      >
                        🔬 Investigate
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
