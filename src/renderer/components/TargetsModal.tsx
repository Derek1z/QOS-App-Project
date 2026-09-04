import React, { useEffect, useState } from 'react'
import { useAppStore, emit } from '../store'
import type { Technology } from '../../../shared/api'

export interface KpiTargetItem {
  id: string
  name: string
  target: number
  warning: number
  critical: number
  direction: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER'
}

const DEFAULT_DAILY_TARGETS: Record<number, KpiTargetItem[]> = {
  2: [
    { id: '2g_tch_cong', name: '2G TCH Congestion (%)', target: 1.0, warning: 1.5, critical: 3.0, direction: 'LOWER_IS_BETTER' },
    { id: '2g_sdcch_cong', name: '2G SDCCH Congestion (%)', target: 0.5, warning: 1.0, critical: 2.0, direction: 'LOWER_IS_BETTER' },
    { id: '2g_cssr', name: '2G Call Connection Success Rate (%)', target: 98.0, warning: 96.0, critical: 92.0, direction: 'HIGHER_IS_BETTER' },
    { id: '2g_cdr', name: '2G Call Drop Rate (%)', target: 1.5, warning: 2.0, critical: 3.5, direction: 'LOWER_IS_BETTER' }
  ],
  3: [
    { id: '3g_cssr', name: '3G Call Connection Success Rate (%)', target: 98.0, warning: 96.0, critical: 92.0, direction: 'HIGHER_IS_BETTER' },
    { id: '3g_cdr', name: '3G Call Drop Rate (%)', target: 2.0, warning: 2.5, critical: 4.0, direction: 'LOWER_IS_BETTER' },
    { id: '3g_dasr', name: '3G Data Access Success Rate (%)', target: 97.0, warning: 95.0, critical: 90.0, direction: 'HIGHER_IS_BETTER' },
    { id: '3g_dl_power_congestion', name: '3G DL Power Congestion', target: 50.0, warning: 75.0, critical: 120.0, direction: 'LOWER_IS_BETTER' },
    { id: '3g_ul_ce_congestion', name: '3G UL CE Congestion', target: 30.0, warning: 50.0, critical: 80.0, direction: 'LOWER_IS_BETTER' }
  ],
  4: [
    { id: '4g_cssr', name: '4G Call Connection Success Rate (%)', target: 98.5, warning: 97.0, critical: 93.0, direction: 'HIGHER_IS_BETTER' },
    { id: '4g_cdr', name: '4G Call Drop Rate (%)', target: 1.0, warning: 1.5, critical: 3.0, direction: 'LOWER_IS_BETTER' },
    { id: '4g_data_access_fail', name: '4G Data Service Access Failure Rate (%)', target: 1.5, warning: 2.0, critical: 4.0, direction: 'LOWER_IS_BETTER' },
    { id: '4g_prb_utilization', name: '4G Peak Hour PRB Utilization (%)', target: 80.0, warning: 85.0, critical: 92.0, direction: 'LOWER_IS_BETTER' }
  ]
}

const DEFAULT_WEEKLY_TARGETS: Record<number, KpiTargetItem[]> = {
  2: [
    { id: '2g_tch_cong', name: '2G TCH Congestion (%)', target: 0.8, warning: 1.2, critical: 2.5, direction: 'LOWER_IS_BETTER' },
    { id: '2g_sdcch_cong', name: '2G SDCCH Congestion (%)', target: 0.4, warning: 0.8, critical: 1.5, direction: 'LOWER_IS_BETTER' },
    { id: '2g_cssr', name: '2G Call Connection Success Rate (%)', target: 98.5, warning: 96.5, critical: 93.0, direction: 'HIGHER_IS_BETTER' },
    { id: '2g_cdr', name: '2G Call Drop Rate (%)', target: 1.2, warning: 1.8, critical: 3.0, direction: 'LOWER_IS_BETTER' }
  ],
  3: [
    { id: '3g_cssr', name: '3G Call Connection Success Rate (%)', target: 98.5, warning: 96.5, critical: 93.0, direction: 'HIGHER_IS_BETTER' },
    { id: '3g_cdr', name: '3G Call Drop Rate (%)', target: 1.8, warning: 2.2, critical: 3.5, direction: 'LOWER_IS_BETTER' },
    { id: '3g_dasr', name: '3G Data Access Success Rate (%)', target: 97.5, warning: 95.5, critical: 91.0, direction: 'HIGHER_IS_BETTER' },
    { id: '3g_dl_power_congestion', name: '3G DL Power Congestion', target: 40.0, warning: 60.0, critical: 100.0, direction: 'LOWER_IS_BETTER' },
    { id: '3g_ul_ce_congestion', name: '3G UL CE Congestion', target: 25.0, warning: 40.0, critical: 70.0, direction: 'LOWER_IS_BETTER' }
  ],
  4: [
    { id: '4g_cssr', name: '4G Call Connection Success Rate (%)', target: 99.0, warning: 97.5, critical: 94.0, direction: 'HIGHER_IS_BETTER' },
    { id: '4g_cdr', name: '4G Call Drop Rate (%)', target: 0.8, warning: 1.2, critical: 2.5, direction: 'LOWER_IS_BETTER' },
    { id: '4g_data_access_fail', name: '4G Data Service Access Failure Rate (%)', target: 1.2, warning: 1.8, critical: 3.5, direction: 'LOWER_IS_BETTER' },
    { id: '4g_prb_utilization', name: '4G Peak Hour PRB Utilization (%)', target: 75.0, warning: 82.0, critical: 90.0, direction: 'LOWER_IS_BETTER' }
  ]
}

export interface TargetsModalProps {
  isOpen?: boolean
  onClose?: () => void
}

export const TargetsModal: React.FC<TargetsModalProps> = ({ isOpen, onClose }) => {
  const store = useAppStore()
  const visible = isOpen !== undefined ? isOpen : store.targetsModalOpen
  const close = onClose || (() => store.setTargetsModalOpen(false))
  const technologyId = store.technologyId || 4
  const techLabel = technologyId === 2 ? '2G' : technologyId === 3 ? '3G' : '4G'

  const [ruleGrain, setRuleGrain] = useState<'daily' | 'weekly'>('daily')
  const [dailyItems, setDailyItems] = useState<KpiTargetItem[]>(() => DEFAULT_DAILY_TARGETS[technologyId] || [])
  const [weeklyItems, setWeeklyItems] = useState<KpiTargetItem[]>(() => DEFAULT_WEEKLY_TARGETS[technologyId] || [])
  const [minBreachDays, setMinBreachDays] = useState(3)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)

  useEffect(() => {
    setDailyItems(DEFAULT_DAILY_TARGETS[technologyId] || [])
    setWeeklyItems(DEFAULT_WEEKLY_TARGETS[technologyId] || [])
  }, [technologyId])

  if (!visible) return null

  const activeItems = ruleGrain === 'daily' ? dailyItems : weeklyItems
  const setActiveItems = ruleGrain === 'daily' ? setDailyItems : setWeeklyItems

  const handleValueChange = (id: string, field: 'target' | 'warning' | 'critical', val: number) => {
    setActiveItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: val } : item))
    )
  }

  const handleDirectionChange = (id: string, dir: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER') => {
    setActiveItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, direction: dir } : item))
    )
  }

  const handleReset = () => {
    if (ruleGrain === 'daily') {
      setDailyItems(DEFAULT_DAILY_TARGETS[technologyId] || [])
    } else {
      setWeeklyItems(DEFAULT_WEEKLY_TARGETS[technologyId] || [])
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const prbItem = activeItems.find((i) => i.id.includes('prb'))
      const prbVal = prbItem ? prbItem.warning : 80

      await window.api.rules.update({
        prbThresholdPct: prbVal,
        weeklyBreachDays: minBreachDays
      })
      emit('RULESET_CHANGED')
      setSavedMsg(true)
      setTimeout(() => {
        setSavedMsg(false)
        close()
      }, 800)
    } catch {
      close()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      <div
        style={{
          background: 'var(--bg-card, #0f172a)',
          border: '1px solid var(--border, #334155)',
          borderRadius: '16px',
          maxWidth: '780px',
          width: '100%',
          padding: '24px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
          color: 'var(--text, #f8fafc)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 800,
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#34d399',
                  border: '1px solid rgba(16, 185, 129, 0.3)'
                }}
              >
                {techLabel} Technology
              </span>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>
                Editable KPI Breach Rules &amp; Target Thresholds
              </h2>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-dim, #94a3b8)', margin: '4px 0 0 0' }}>
              Configure baseline target, warning, and critical thresholds for both Daily and Weekly analysis grains.
            </p>
          </div>
          <button
            onClick={close}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              fontSize: '18px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            ✕
          </button>
        </div>

        {/* Grain Tabs (Daily vs Weekly) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'inline-flex', background: 'var(--bg-3, #1e293b)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <button
              onClick={() => setRuleGrain('daily')}
              style={{
                padding: '6px 18px',
                fontSize: '12px',
                fontWeight: 700,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: ruleGrain === 'daily' ? 'linear-gradient(135deg, #059669, #10b981)' : 'transparent',
                color: ruleGrain === 'daily' ? '#ffffff' : 'var(--text-dim)'
              }}
            >
              📅 Daily Breach Rules
            </button>
            <button
              onClick={() => setRuleGrain('weekly')}
              style={{
                padding: '6px 18px',
                fontSize: '12px',
                fontWeight: 700,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: ruleGrain === 'weekly' ? 'linear-gradient(135deg, #0284c7, #38bdf8)' : 'transparent',
                color: ruleGrain === 'weekly' ? '#ffffff' : 'var(--text-dim)'
              }}
            >
              📆 Weekly Breach Rules
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-dim)' }}>
            <span>Consecutive Breach Days for NC:</span>
            <input
              type="number"
              min="1"
              max="7"
              value={minBreachDays}
              onChange={(e) => setMinBreachDays(parseInt(e.target.value) || 3)}
              style={{
                width: '54px',
                background: 'var(--bg-3)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '3px 8px',
                color: 'var(--text)',
                fontSize: '12px',
                fontWeight: 700
              }}
            />
          </div>
        </div>

        {/* Editable Threshold Table */}
        <div style={{ maxHeight: '42vh', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-dim)' }}>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>KPI Name</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>Target (Green)</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>Warning (Yellow)</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>Critical (Red Breach)</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>Direction</th>
              </tr>
            </thead>
            <tbody>
              {activeItems.map((item) => (
                <tr key={item.id} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                  <td style={{ padding: '10px', fontWeight: 600 }}>{item.name}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <input
                      type="number"
                      step="0.1"
                      value={item.target}
                      onChange={(e) => handleValueChange(item.id, 'target', parseFloat(e.target.value) || 0)}
                      style={{
                        width: '74px',
                        background: 'var(--bg-3)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        color: '#34d399',
                        fontWeight: 700,
                        fontSize: '12px'
                      }}
                    />
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <input
                      type="number"
                      step="0.1"
                      value={item.warning}
                      onChange={(e) => handleValueChange(item.id, 'warning', parseFloat(e.target.value) || 0)}
                      style={{
                        width: '74px',
                        background: 'var(--bg-3)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        color: '#fbbf24',
                        fontWeight: 700,
                        fontSize: '12px'
                      }}
                    />
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <input
                      type="number"
                      step="0.1"
                      value={item.critical}
                      onChange={(e) => handleValueChange(item.id, 'critical', parseFloat(e.target.value) || 0)}
                      style={{
                        width: '74px',
                        background: 'var(--bg-3)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        color: '#f87171',
                        fontWeight: 700,
                        fontSize: '12px'
                      }}
                    />
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <select
                      value={item.direction}
                      onChange={(e) => handleDirectionChange(item.id, e.target.value as any)}
                      style={{
                        background: 'var(--bg-3)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        color: 'var(--text)',
                        fontSize: '11.5px'
                      }}
                    >
                      <option value="LOWER_IS_BETTER">Lower is better (≤)</option>
                      <option value="HIGHER_IS_BETTER">Higher is better (≥)</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
          <button
            onClick={handleReset}
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-dim)',
              background: 'var(--bg-3)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Reset Defaults
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {savedMsg && <span style={{ color: '#34d399', fontSize: '12px', fontWeight: 700 }}>✓ Saved!</span>}
            <button
              onClick={close}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-dim)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              style={{
                padding: '7px 20px',
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
              {saving ? 'Saving Rules…' : `Save ${ruleGrain === 'daily' ? 'Daily' : 'Weekly'} Thresholds`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TargetsModal
