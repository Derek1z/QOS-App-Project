import React, { useEffect, useState } from 'react'
import { emit } from '../store'
import { errMsg } from '../lib/flows'
import { NC_PERIOD_FIELDS, type NcPeriodKey } from '../../../shared/ruleDefaults'
import { NC_PERIOD_GROUPS, dailyEquivalent, formToSettings, settingsToForm } from '../lib/ncPeriodsForm'

const input: React.CSSProperties = {
  width: '64px', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: '6px', padding: '6px 8px', fontSize: '12px'
}

export default function NcPeriodsPanel(): React.JSX.Element {
  const [form, setForm] = useState<Record<NcPeriodKey, string> | null>(null)
  const [version, setVersion] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void window.api.rules.get().then((r) => {
      if (!r) return
      setForm(settingsToForm(r))
      setVersion(r.version)
    })
  }, [])

  if (!form) return <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-dim)' }}>Loading NC periods...</div>

  const { problem } = formToSettings(form)

  const save = async (): Promise<void> => {
    const { settings, problem: p } = formToSettings(form)
    if (!settings) {
      setMessage({ ok: false, text: p ?? 'Invalid settings' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const r = await window.api.rules.update(settings)
      setVersion(r.version)
      setForm(settingsToForm(r))
      setMessage({ ok: true, text: `Saved as ruleset v${r.version}. NC periods recalculated.` })
      emit('RULESET_CHANGED')
    } catch (e) {
      setMessage({ ok: false, text: errMsg(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
        Same rules for every technology. Daily values are the week values × 7. Ruleset v{version}.
      </div>
      {NC_PERIOD_GROUPS.map((g) => (
        <div key={g.title} style={{ background: 'var(--bg-3)', padding: '14px 16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text)' }}>{g.title}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', margin: '2px 0 10px' }}>{g.help}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
            {g.keys.map((k) => {
              const fld = NC_PERIOD_FIELDS[k]
              const daily = dailyEquivalent(k, Number(form[k]))
              return (
                <label key={k} style={{ fontSize: '12px', color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span>{fld.label}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="number" min={fld.min} max={fld.max} step={1} value={form[k]} style={input}
                      onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                    />
                    <span style={{ color: 'var(--text-dim)' }}>{fld.unit}</span>
                  </span>
                  {daily && Number.isFinite(Number(form[k])) && (
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>= {daily}</span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      ))}
      {(problem || message) && (
        <div style={{
          padding: '10px 12px', borderRadius: '8px', fontSize: '12px',
          color: problem || (message && !message.ok) ? '#f87171' : '#34d399',
          background: problem || (message && !message.ok) ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)'
        }}>
          {problem ?? message?.text}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => void save()} disabled={saving || problem != null}
          style={{ padding: '10px 24px', background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 800, cursor: problem ? 'not-allowed' : 'pointer', opacity: problem ? 0.5 : 1 }}
        >
          {saving ? 'Recalculating...' : 'Save NC Periods'}
        </button>
      </div>
    </div>
  )
}
