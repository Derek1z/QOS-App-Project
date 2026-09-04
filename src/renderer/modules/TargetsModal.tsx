import React, { useCallback, useEffect, useState } from 'react'
import { useAppStore, emit } from '../store'
import { errMsg } from '../lib/flows'
import type { KpiDefinition, Technology, DerivedKPI, BetterDirection } from '../../../shared/api'

export interface TargetsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function TargetsModal({ isOpen, onClose }: TargetsModalProps): React.JSX.Element | null {
  const selectedTech = useAppStore((s) => s.selectedTech)
  const setSelectedTech = useAppStore((s) => s.setSelectedTech)
  const [activeTech, setActiveTech] = useState<Technology>(selectedTech || '4G')
  const [defs, setDefs] = useState<KpiDefinition[]>([])
  const [, setDerivedList] = useState<DerivedKPI[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [editedTargets, setEditedTargets] = useState<Record<number, {
    target: string
    warningThreshold: string
    criticalThreshold: string
    betterDirection: BetterDirection
  }>>({})

  const load = useCallback(async (tech: Technology) => {
    setLoading(true)
    setError(null)
    try {
      const [kpiList, derived] = await Promise.all([
        window.api.kpis.list(tech),
        window.api.derived.list(tech)
      ])
      setDefs(kpiList)
      setDerivedList(derived)

      const initialTargets: Record<number, {
        target: string
        warningThreshold: string
        criticalThreshold: string
        betterDirection: BetterDirection
      }> = {}

      for (const d of kpiList) {
        initialTargets[d.kpiId] = {
          target: d.target == null ? '' : String(d.target),
          warningThreshold: d.warningThreshold == null ? '' : String(d.warningThreshold),
          criticalThreshold: d.criticalThreshold == null ? '' : String(d.criticalThreshold),
          betterDirection: d.betterDirection ?? (d.worseIsHigher ? 'lower_is_better' : 'higher_is_better')
        }
      }
      setEditedTargets(initialTargets)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      const techToLoad = selectedTech || '4G'
      setActiveTech(techToLoad)
      void load(techToLoad)
    }
  }, [isOpen, selectedTech, load])

  const handleTechChange = (t: Technology) => {
    setActiveTech(t)
    setSelectedTech(t)
    void load(t)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      for (const d of defs) {
        const edited = editedTargets[d.kpiId]
        if (!edited) continue
        const numTarget = edited.target.trim() === '' ? null : Number(edited.target)
        const numWarn = edited.warningThreshold.trim() === '' ? null : Number(edited.warningThreshold)
        const numCrit = edited.criticalThreshold.trim() === '' ? null : Number(edited.criticalThreshold)

        await window.api.kpis.save({
          ...d,
          target: numTarget,
          warningThreshold: numWarn,
          criticalThreshold: numCrit,
          betterDirection: edited.betterDirection
        })
      }
      setSuccess(`Successfully updated targets for ${activeTech}!`)
      emit('WORKSPACE_CHANGED')
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.8)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '24px' }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '20px', padding: '28px', maxWidth: '780px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>🎯 Technology Targets & Threshold Governance</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', margin: '4px 0 0 0' }}>Configure KPI target limits and severity thresholds</p>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: '20px', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Tech Pills */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {(['2G', '3G', '4G'] as Technology[]).map((t) => (
            <button
              key={t}
              onClick={() => handleTechChange(t)}
              style={{
                padding: '6px 18px',
                fontSize: '12px',
                fontWeight: 800,
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                background: activeTech === t ? 'linear-gradient(135deg, #059669, #10b981)' : 'var(--bg-3)',
                color: activeTech === t ? '#ffffff' : 'var(--text-dim)'
              }}
            >
              {t} {t === selectedTech && '(Active)'}
            </button>
          ))}
        </div>

        {error && <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', borderRadius: '8px', marginBottom: '16px', fontSize: '12px' }}>{error}</div>}
        {success && <div style={{ padding: '12px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', borderRadius: '8px', marginBottom: '16px', fontSize: '12px' }}>{success}</div>}

        {/* Form List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-dim)' }}>Loading targets...</div>
          ) : (
            defs.map((def) => {
              const edited = editedTargets[def.kpiId] || { target: '', warningThreshold: '', criticalThreshold: '', betterDirection: 'higher_is_better' }
              return (
                <div key={def.kpiId} style={{ background: 'var(--bg-3)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: '#f8fafc' }}>{def.label}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Unit: {def.unit || '—'}</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>Target</label>
                      <input
                        type="text"
                        value={edited.target}
                        onChange={(e) => setEditedTargets({ ...editedTargets, [def.kpiId]: { ...edited, target: e.target.value } })}
                        style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>Warning Threshold</label>
                      <input
                        type="text"
                        value={edited.warningThreshold}
                        onChange={(e) => setEditedTargets({ ...editedTargets, [def.kpiId]: { ...edited, warningThreshold: e.target.value } })}
                        style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>Critical Threshold</label>
                      <input
                        type="text"
                        value={edited.criticalThreshold}
                        onChange={(e) => setEditedTargets({ ...editedTargets, [def.kpiId]: { ...edited, criticalThreshold: e.target.value } })}
                        style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px' }}
                      />
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', background: 'var(--bg-3)', color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>Close</button>
          <button onClick={() => void handleSave()} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)' }}>
            {saving ? 'Saving...' : 'Save Targets'}
          </button>
        </div>
      </div>
    </div>
  )
}
