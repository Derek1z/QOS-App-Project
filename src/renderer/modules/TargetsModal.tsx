import { useCallback, useEffect, useState } from 'react'
import { useAppStore, emit } from '../store'
import { errMsg } from '../lib/flows'
import type { KpiDefinition, Technology, DerivedKPI, BetterDirection } from '../../../shared/api'

export interface TargetsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function TargetsModal({ isOpen, onClose }: TargetsModalProps): React.JSX.Element | null {
  const workspace = useAppStore((s) => s.workspace)
  const [activeTech, setActiveTech] = useState<Technology>(workspace?.technology ?? '4G')
  const [defs, setDefs] = useState<KpiDefinition[]>([])
  const [derivedList, setDerivedList] = useState<DerivedKPI[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Local state for editable targets
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
      setActiveTech(workspace?.technology ?? '4G')
      void load(workspace?.technology ?? '4G')
    }
  }, [isOpen, workspace?.technology, load])

  if (!isOpen) return null

  const handleTechChange = (tech: Technology) => {
    setActiveTech(tech)
    void load(tech)
  }

  const handleTargetChange = (kpiId: number, field: 'target' | 'warningThreshold' | 'criticalThreshold' | 'betterDirection', val: string) => {
    setEditedTargets((prev) => ({
      ...prev,
      [kpiId]: {
        ...prev[kpiId],
        [field]: val
      }
    }))
  }

  const handleResetDefaults = async () => {
    if (!confirm(`Reset all ${activeTech} KPI targets and thresholds to standard defaults?`)) return
    setLoading(true)
    setError(null)
    try {
      await window.api.kpis.resetDefaults(activeTech)
      await load(activeTech)
      setSuccess(`${activeTech} targets reset to baseline defaults.`)
      emit('RULESET_CHANGED')
      emit('KPIDEFS_CHANGED')
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  const handleSaveAll = async () => {
    setSaving(true)
    setError(null)
    try {
      for (const d of defs) {
        const edits = editedTargets[d.kpiId]
        if (!edits) continue

        const target = edits.target.trim() === '' ? null : Number(edits.target)
        const warningThreshold = edits.warningThreshold.trim() === '' ? null : Number(edits.warningThreshold)
        const criticalThreshold = edits.criticalThreshold.trim() === '' ? null : Number(edits.criticalThreshold)
        const worseIsHigher = edits.betterDirection === 'lower_is_better'

        await window.api.kpis.save({
          kpiId: d.kpiId,
          technology: d.technology,
          key: d.key,
          label: d.label,
          target,
          warningThreshold,
          criticalThreshold,
          betterDirection: edits.betterDirection,
          worseIsHigher
        })
      }

      setSuccess('Target thresholds saved and active across all views.')
      emit('RULESET_CHANGED')
      emit('KPIDEFS_CHANGED')
      emit('WORKSPACE_CHANGED')
      setTimeout(() => {
        setSuccess(null)
        onClose()
      }, 1200)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const handleToggleDerived = async (derived: DerivedKPI) => {
    try {
      await window.api.derived.save({
        ...derived,
        enabled: !derived.enabled
      })
      await load(activeTech)
      emit('KPIDEFS_CHANGED')
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <div className="palette-overlay" onMouseDown={onClose} style={{ zIndex: 1100 }}>
      <div
        className="palette"
        style={{
          width: '900px',
          maxWidth: '95vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 20,
          background: 'var(--surface-raised, #181c24)',
          borderRadius: 8,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)'
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Technology Targets & Thresholds</h2>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: 2 }}>
              Configure QoS compliance thresholds, warnings, and derived metrics for each technology.
            </div>
          </div>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Technology Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
          {(['2G', '3G', '4G'] as Technology[]).map((t) => (
            <button
              key={t}
              className={`btn ${activeTech === t ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontWeight: 600, minWidth: '70px' }}
              onClick={() => handleTechChange(t)}
            >
              {t} {t === workspace?.technology && '(Active)'}
            </button>
          ))}
        </div>

        {error && (
          <div className="callout callout-error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        {success && (
          <div className="callout callout-success" style={{ marginBottom: 12 }}>
            ✓ {success}
          </div>
        )}

        {/* Targets Table */}
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16, paddingRight: 4 }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-dim)' }}>Loading targets...</div>
          ) : (
            <>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
                  Standard & Imported KPIs ({defs.length})
                </div>
                <table className="data-table" style={{ width: '100%', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>KPI Name</th>
                      <th style={{ textAlign: 'left', width: '100px' }}>Category</th>
                      <th style={{ textAlign: 'center', width: '130px' }}>Direction</th>
                      <th style={{ textAlign: 'right', width: '110px' }}>Target</th>
                      <th style={{ textAlign: 'right', width: '110px' }}>Warning</th>
                      <th style={{ textAlign: 'right', width: '110px' }}>Critical</th>
                    </tr>
                  </thead>
                  <tbody>
                    {defs.map((d) => {
                      const cur = editedTargets[d.kpiId] ?? {
                        target: '',
                        warningThreshold: '',
                        criticalThreshold: '',
                        betterDirection: 'lower_is_better'
                      }
                      const isDerived = Boolean(d.isDerived || d.key.startsWith('3g_') || d.key.includes('congestion'))

                      return (
                        <tr key={d.kpiId}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{d.label}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-dim)', display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span><code>{d.key}</code></span>
                              {d.unit && <span>({d.unit})</span>}
                              {d.isCore && <span className="badge badge-tech" style={{ fontSize: '9px', padding: '1px 4px' }}>CORE</span>}
                              {isDerived && <span className="badge badge-derived" style={{ fontSize: '9px', padding: '1px 4px', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>DERIVED</span>}
                            </div>
                          </td>
                          <td>
                            <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{d.category ?? '—'}</span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <select
                              className="input"
                              style={{ padding: '2px 6px', fontSize: '11px', height: '28px' }}
                              value={cur.betterDirection}
                              onChange={(e) => handleTargetChange(d.kpiId, 'betterDirection', e.target.value)}
                            >
                              <option value="lower_is_better">≤ Lower is better</option>
                              <option value="higher_is_better">≥ Higher is better</option>
                            </select>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <input
                              className="input"
                              type="number"
                              step="any"
                              style={{ width: '100%', textAlign: 'right', padding: '2px 6px', height: '28px' }}
                              value={cur.target}
                              placeholder="—"
                              onChange={(e) => handleTargetChange(d.kpiId, 'target', e.target.value)}
                            />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <input
                              className="input"
                              type="number"
                              step="any"
                              style={{ width: '100%', textAlign: 'right', padding: '2px 6px', height: '28px' }}
                              value={cur.warningThreshold}
                              placeholder="—"
                              onChange={(e) => handleTargetChange(d.kpiId, 'warningThreshold', e.target.value)}
                            />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <input
                              className="input"
                              type="number"
                              step="any"
                              style={{ width: '100%', textAlign: 'right', padding: '2px 6px', height: '28px' }}
                              value={cur.criticalThreshold}
                              placeholder="—"
                              onChange={(e) => handleTargetChange(d.kpiId, 'criticalThreshold', e.target.value)}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Derived Formulas Section */}
              {derivedList.length > 0 && (
                <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
                    Configured Derived Formulas & Congestion Aggregations
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {derivedList.map((der) => (
                      <div
                        key={der.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 14px',
                          background: 'rgba(255,255,255,0.03)',
                          borderRadius: 6,
                          border: '1px solid var(--border)'
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                            {der.name}
                            <span className="badge badge-derived" style={{ fontSize: '9px', padding: '1px 4px', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>DERIVED KPI</span>
                            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>[{der.operation}]</span>
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: 4, fontFamily: 'monospace' }}>
                            Formula: {der.sourceKPIs.join(' + ')}
                          </div>
                          {der.description && (
                            <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: 2 }}>
                              {der.description}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={der.enabled !== false}
                              onChange={() => handleToggleDerived(der)}
                            />
                            Enabled
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <button className="btn btn-ghost" onClick={handleResetDefaults} disabled={loading || saving}>
            ↺ Reset Defaults
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSaveAll} disabled={saving || loading}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
