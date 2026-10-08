import React, { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../store'
import type { KpiDefinition, Technology } from '../../../shared/api'

const TECHS: Technology[] = ['2G', '3G', '4G']

export default function KpiDefinitions(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const selectedTech = useAppStore((s) => s.selectedTech)
  const [tech, setTech] = useState<Technology>(selectedTech || '4G')
  const [defs, setDefs] = useState<KpiDefinition[]>([])
  const [loading, setLoading] = useState(false)
  const [, setError] = useState<string | null>(null)

  useEffect(() => {
    if (selectedTech && selectedTech !== tech) {
      setTech(selectedTech)
    }
  }, [selectedTech])

  const load = useCallback(async (t: Technology): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.api.kpis.list(t)
      setDefs(list)
    } catch {
      /* handle err */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(tech)
  }, [tech, load])

  const readOnly = workspace?.readOnly ?? false

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
              {TECHS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTech(t)}
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
        </div>

        {readOnly && (
          <span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 800, background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
            READ ONLY WORKSPACE
          </span>
        )}
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
              <path stroke="#10b981" strokeDasharray="100, 100" strokeWidth="3.5" strokeLinecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            </svg>
            <span style={{ position: 'absolute', fontSize: '18px', fontWeight: 800, color: '#f8fafc' }}>{defs.length}</span>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                {tech}
              </span>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                KPI Registry & Derived Formula Governance
              </h2>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px', margin: '4px 0 0 0' }}>
              Configured KPI metrics: <strong style={{ color: '#f8fafc' }}>{defs.length}</strong> active definitions for {tech} technology.
            </p>
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
        {defs.length === 0 ? (
          <div style={{ background: 'var(--bg-card)', padding: '40px', textAlign: 'center', borderRadius: '16px', border: '1px solid var(--border)', color: 'var(--text-dim)', gridColumn: '1 / -1' }}>
            {loading ? 'Loading KPI definitions...' : 'No KPI definitions configured for this technology.'}
          </div>
        ) : (
          defs.map((def) => (
            <div key={def.kpiId} style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '15px', fontWeight: 800, color: '#f8fafc' }}>{def.label}</span>
                  {def.isCore && (
                    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 800, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                      CORE KPI
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '8px' }}>Category: {def.category}</div>
                <div style={{ fontSize: '12px', color: 'var(--text)' }}>Unit: <code>{def.unit || '—'}</code></div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderTop: '1px solid var(--border)', paddingTop: '10px', fontSize: '11px', color: 'var(--text-dim)' }}>
                <div>Target: <strong style={{ color: '#34d399' }}>{def.target != null ? String(def.target) : 'Not set'}</strong></div>
                <div>Warning Threshold: <strong style={{ color: '#fbbf24' }}>{def.warningThreshold != null ? String(def.warningThreshold) : 'Not set'}</strong></div>
                <div>Critical Threshold: <strong style={{ color: '#f87171' }}>{def.criticalThreshold != null ? String(def.criticalThreshold) : 'Not set'}</strong></div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
