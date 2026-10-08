import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store'
import type {
  ActionStatus, InvestigationScope, PriorityBand, PriorityCenterRow,
  PriorityCenterResult, Technology
} from '../../../shared/api'

const STATUSES: ActionStatus[] = [
  'Unreviewed',
  'Investigating',
  'Escalated',
  'Optimization in progress',
  'Monitoring',
  'Resolved',
  'Deferred'
]
const BANDS: PriorityBand[] = ['Critical', 'High', 'Medium', 'Watch', 'Low']

export default function PriorityCenter(): React.JSX.Element {
  const selectedTech = useAppStore((s) => s.selectedTech ?? '4G')
  const setSelectedTech = useAppStore((s) => s.setSelectedTech)
  const setModule = useAppStore((s) => s.setModule)
  const setInvestigationTarget = useAppStore((s) => s.setInvestigationTarget)
  const storeGrain = useAppStore((s) => s.grain)
  const setStoreGrain = useAppStore((s) => s.setGrain)

  const [tech, setTech] = useState<Technology>(selectedTech)
  const [scope, setScope] = useState<InvestigationScope>('cell')
  const [status, setStatus] = useState<ActionStatus | 'unset' | ''>('')
  const [band, setBand] = useState<PriorityBand | ''>('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'priority' | 'due' | 'name'>('priority')
  const [result, setResult] = useState<PriorityCenterResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [, setError] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (selectedTech && selectedTech !== tech) {
      setTech(selectedTech)
    }
  }, [selectedTech])

  const load = useCallback(
    async (): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const r = await window.api.analytics.priorityCenter({
          scope,
          status: status || undefined,
          band: band || undefined,
          search: search.trim() || undefined,
          sort,
          limit: 50,
          offset: 0
        })
        setResult(r)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [scope, status, band, search, sort, tech]
  )

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      void load()
    }, search === '' ? 0 : 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [load, search, storeGrain, tech])

  const handleInvestigate = (row: PriorityCenterRow) => {
    setInvestigationTarget({
      id: row.id,
      name: row.name,
      scope: row.scope || scope,
      path: row.path ?? []
    })
    setModule('investigation')
  }

  const criticalCount = result?.rows.filter((r) => r.priorityBand === 'Critical').length ?? 0
  const highCount = result?.rows.filter((r) => r.priorityBand === 'High').length ?? 0
  const totalCount = result?.total ?? 0

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
          {/* Technology Selector */}
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

          {/* Scope Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Scope:
            </span>
            <div style={{ display: 'inline-flex', background: 'var(--bg-3)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              {[
                { id: 'cell', label: 'Cell' },
                { id: 'site', label: 'Site' },
                { id: 'district', label: 'District' }
              ].map((s) => (
                <button
                  key={s.id}
                  onClick={() => setScope(s.id as InvestigationScope)}
                  style={{
                    padding: '5px 14px',
                    fontSize: '12px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    background: scope === s.id ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                    color: scope === s.id ? '#818cf8' : 'var(--text-dim)'
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Granularity Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Grain:
            </span>
            <div style={{ display: 'inline-flex', background: 'var(--bg-3)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              {['daily', 'weekly'].map((g) => (
                <button
                  key={g}
                  onClick={() => setStoreGrain(g as any)}
                  style={{
                    padding: '5px 14px',
                    fontSize: '12px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    background: storeGrain === g ? 'var(--accent)' : 'transparent',
                    color: storeGrain === g ? '#ffffff' : 'var(--text-dim)'
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={() => setModule('investigation')}
          style={{
            padding: '8px 16px',
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
          🔬 Direct Cell Investigation
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
                strokeDasharray="88, 100"
                strokeWidth="3.5"
                strokeLinecap="round"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <span style={{ position: 'absolute', fontSize: '18px', fontWeight: 800, color: '#f87171' }}>{totalCount}</span>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 800,
                  background: 'rgba(99, 102, 241, 0.15)',
                  color: '#818cf8',
                  border: '1px solid rgba(99, 102, 241, 0.3)'
                }}
              >
                {tech} {scope.toUpperCase()}
              </span>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                Smart Priority Remediation Action Queue
              </h2>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px', margin: '4px 0 0 0' }}>
              Automated composite risk score queue · {criticalCount} Critical P1, {highCount} High P2 Priority items needing immediate action.
            </p>
          </div>
        </div>
      </div>

      {/* Priority Action Queue Table */}
      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <input
              type="text"
              placeholder={`Search ${scope} name...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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
              <button
                onClick={() => setBand('')}
                style={{
                  padding: '4px 12px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  background: band === '' ? 'var(--accent)' : 'transparent',
                  color: band === '' ? '#ffffff' : 'var(--text-dim)'
                }}
              >
                All Bands
              </button>
              {BANDS.map((b) => (
                <button
                  key={b}
                  onClick={() => setBand(b)}
                  style={{
                    padding: '4px 12px',
                    fontSize: '11px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    background: band === b ? 'var(--accent)' : 'transparent',
                    color: band === b ? '#ffffff' : 'var(--text-dim)'
                  }}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
            Showing {result?.rows.length ?? 0} prioritized entities
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-3)', borderBottom: '1px solid var(--border)', color: 'var(--text-dim)', textTransform: 'uppercase', fontSize: '11px' }}>
                <th style={{ padding: '10px 14px' }}>Rank & Entity Name</th>
                <th style={{ padding: '10px 14px' }}>Priority Band</th>
                <th style={{ padding: '10px 14px' }}>Composite Risk</th>
                <th style={{ padding: '10px 14px' }}>Status</th>
                <th style={{ padding: '10px 14px' }}>Owner / Ticket</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {!result || result.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-dim)' }}>
                    {loading ? 'Loading priority queue...' : 'No priority entities found for active filters.'}
                  </td>
                </tr>
              ) : (
                result.rows.map((row, idx) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 14px', fontWeight: 700, color: '#f8fafc' }}>
                      <span style={{ color: 'var(--text-dim)', fontSize: '11px', marginRight: '8px' }}>#{idx + 1}</span>
                      {row.name}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          background: row.priorityBand === 'Critical' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                          color: row.priorityBand === 'Critical' ? '#f87171' : '#fbbf24',
                          border: '1px solid rgba(239, 68, 68, 0.3)'
                        }}
                      >
                        {row.priorityBand || 'Normal'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ flex: 1, height: '6px', background: 'var(--bg-3)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${Math.min(100, row.priorityScore ?? 0)}%`,
                              height: '100%',
                              background: (row.priorityScore ?? 0) > 75 ? '#f87171' : '#fbbf24'
                            }}
                          />
                        </div>
                        <span style={{ fontWeight: 800, fontSize: '12px', color: '#f8fafc' }}>{Math.round(row.priorityScore ?? 0)}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-dim)' }}>
                      {row.status || 'Unreviewed'}
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-dim)' }}>
                      {row.owner || '—'} {row.externalTicket ? `(${row.externalTicket})` : ''}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                      <button
                        onClick={() => handleInvestigate(row)}
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
