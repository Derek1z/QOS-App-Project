import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import type {
  CellIntelligenceResult, CellDetail, Technology, CellIntelligenceRow
} from '../../../shared/api'
import Chart from '../lib/Chart'
import { cellDetailOption } from '../lib/cellCharts'

export default function CellIntelligence(): React.JSX.Element {
  const grain = useAppStore((s) => s.grain)
  const selectedTech = useAppStore((s) => s.selectedTech)
  const setSelectedTech = useAppStore((s) => s.setSelectedTech)
  const setModule = useAppStore((s) => s.setModule)
  const setInvestigationTarget = useAppStore((s) => s.setInvestigationTarget)

  const [tech, setTech] = useState<Technology>(selectedTech || '4G')
  const [data, setData] = useState<CellIntelligenceResult>({ total: 0, rows: [] })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [fSeverity, setFSeverity] = useState<string>('all')
  const [detail, setDetail] = useState<CellDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (selectedTech && selectedTech !== tech) {
      setTech(selectedTech)
    }
  }, [selectedTech])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.api.analytics.cellIntelligence({
        search: search.trim() || undefined,
        severity: fSeverity !== 'all' ? (fSeverity as any) : undefined,
        technology: tech,
        limit: 50,
        offset: 0
      })
      setData(res)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [search, fSeverity, tech])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      void load()
    }, search === '' ? 0 : 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [load, search, grain, tech])

  const openCellDetail = async (row: CellIntelligenceRow) => {
    setDetailOpen(true)
    setDetailLoading(true)
    try {
      const det = await window.api.analytics.cellDetail(row.cellId, grain, tech)
      setDetail(det)
    } catch {
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleInvestigate = (row: CellIntelligenceRow) => {
    setInvestigationTarget({
      id: row.cellId,
      name: row.cellName,
      scope: 'cell',
      path: [row.region || '', row.district || '', row.site || ''].filter(Boolean)
    })
    setModule('investigation')
  }

  const chartOption = detail ? cellDetailOption(detail, 80, grain, tech) : null

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

          {/* Search Input */}
          <input
            type="text"
            placeholder={`Search ${tech} cell name, ID or BTS site...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              background: 'var(--bg-3)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '6px 14px',
              fontSize: '12px',
              width: '260px'
            }}
          />

          {/* Severity Filter Pills */}
          <div style={{ display: 'inline-flex', background: 'var(--bg-3)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            {['all', 'critical', 'high', 'watch', 'normal'].map((sev) => (
              <button
                key={sev}
                onClick={() => setFSeverity(sev)}
                style={{
                  padding: '4px 12px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  background: fSeverity === sev ? 'var(--accent)' : 'transparent',
                  color: fSeverity === sev ? '#ffffff' : 'var(--text-dim)'
                }}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>

        <div style={{ fontSize: '12px', color: 'var(--text-dim)', fontWeight: 600 }}>
          Total Cells: <strong style={{ color: '#f8fafc' }}>{data.total}</strong>
        </div>
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
              <path stroke="var(--bg-3)" strokeWidth="3.5" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              <path stroke="#38bdf8" strokeDasharray="90, 100" strokeWidth="3.5" strokeLinecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            </svg>
            <span style={{ position: 'absolute', fontSize: '18px', fontWeight: 800, color: '#f8fafc' }}>{data.total}</span>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                {tech}
              </span>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                Cell Telemetry & Sector Health Intelligence
              </h2>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px', margin: '4px 0 0 0' }}>
              Granularity: <strong style={{ color: 'var(--text)' }}>{grain}</strong> grain · Showing {data.rows.length} sector cells matching filters.
            </p>
          </div>
        </div>
      </div>

      {/* Cell Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
        {data.rows.length === 0 ? (
          <div style={{ background: 'var(--bg-card)', padding: '40px', textAlign: 'center', borderRadius: '16px', border: '1px solid var(--border)', color: 'var(--text-dim)', gridColumn: '1 / -1' }}>
            {loading ? 'Loading cells...' : 'No cells found.'}
          </div>
        ) : (
          data.rows.map((cell) => (
            <div key={cell.cellId} style={{ background: 'var(--bg-card)', padding: '18px 20px', borderRadius: '14px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 800, color: '#f8fafc' }}>{cell.cellName}</span>
                  <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', background: cell.severity === 'Critical' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)', color: cell.severity === 'Critical' ? '#f87171' : '#fbbf24', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                    {cell.severity || 'Normal'}
                  </span>
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Site: {cell.site || '—'}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '2px' }}>
                  {tech === '4G' ? 'PRB Utilization' : 'Peak Traffic Util'}: <strong style={{ color: '#f87171' }}>{cell.prbAvg != null ? `${cell.prbAvg.toFixed(1)}%` : '—'}</strong>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => void openCellDetail(cell)}
                  style={{ flex: 1, padding: '6px 12px', fontSize: '11px', fontWeight: 700, background: 'var(--bg-3)', color: '#f8fafc', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer' }}
                >
                  📊 View Telemetry
                </button>
                <button
                  onClick={() => handleInvestigate(cell)}
                  style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 700, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '6px', cursor: 'pointer' }}
                >
                  🔬 Investigate
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Cell Detail Modal */}
      {detailOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '24px' }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '20px', padding: '28px', maxWidth: '720px', width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>📊 Cell Telemetry: {detail?.cellName || 'Loading...'}</h3>
              <button onClick={() => setDetailOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: '20px', cursor: 'pointer' }}>✕</button>
            </div>
            {detailLoading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)' }}>Loading cell telemetry...</div>
            ) : chartOption ? (
              <Chart option={chartOption} height={320} />
            ) : (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)' }}>No chart telemetry available.</div>
            )}
            <button onClick={() => setDetailOpen(false)} style={{ width: '100%', padding: '12px', background: 'var(--bg-3)', color: '#fff', border: '1px solid var(--border)', borderRadius: '10px', fontWeight: 700, cursor: 'pointer', marginTop: '20px' }}>
              Close Telemetry
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
