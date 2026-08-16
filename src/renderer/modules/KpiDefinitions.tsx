import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../store'
import { errMsg } from '../lib/flows'
import type { KpiDefinition, Technology } from '../../../shared/api'

const TECHS: Technology[] = ['2G', '3G', '4G']
const AGGS: Array<{ id: KpiDefinition['agg']; label: string }> = [
  { id: 'avg', label: 'Average' },
  { id: 'sum', label: 'Sum' },
  { id: 'max', label: 'Max' },
  { id: 'min', label: 'Min' }
]

interface Draft {
  key: string
  label: string
  unit: string
  worseIsHigher: boolean
  target: string
  agg: KpiDefinition['agg']
  aliases: string
}

const EMPTY_DRAFT: Draft = {
  key: '',
  label: '',
  unit: '',
  worseIsHigher: true,
  target: '',
  agg: 'avg',
  aliases: ''
}

export default function KpiDefinitions(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const [tech, setTech] = useState<Technology>(workspace?.technology ?? '4G')
  const [defs, setDefs] = useState<KpiDefinition[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [seeding, setSeeding] = useState(false)

  const load = useCallback(async (t: Technology): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.api.kpis.list(t)
      setDefs(list)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setTech(workspace?.technology ?? '4G')
  }, [workspace?.path])

  useEffect(() => {
    void load(tech)
  }, [tech, load])

  function startEdit(d: KpiDefinition): void {
    setEditingId(d.kpiId)
    setDraft({
      key: d.key,
      label: d.label,
      unit: d.unit,
      worseIsHigher: d.worseIsHigher,
      target: d.target == null ? '' : String(d.target),
      agg: d.agg,
      aliases: d.sourceHeaders.join(', ')
    })
  }

  function cancelEdit(): void {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
  }

  async function save(): Promise<void> {
    if (!draft.key.trim() || !draft.label.trim()) {
      setError('Key and label are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const target = draft.target.trim() === '' ? null : Number(draft.target)
      if (draft.target.trim() !== '' && Number.isNaN(target)) {
        setError('Target must be a number')
        return
      }
      const aliases = draft.aliases
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const patch = {
        technology: tech,
        key: draft.key.trim(),
        label: draft.label.trim(),
        unit: draft.unit.trim(),
        worseIsHigher: draft.worseIsHigher,
        target,
        agg: draft.agg,
        sourceHeaders: aliases,
        active: true,
        ...(editingId != null ? { kpiId: editingId } : {})
      }
      await window.api.kpis.save(patch)
      cancelEdit()
      await load(tech)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove(d: KpiDefinition): Promise<void> {
    if (!window.confirm(`Remove KPI "${d.label}" for ${tech}? Imported values for it will no longer appear in analysis.`)) {
      return
    }
    setError(null)
    try {
      await window.api.kpis.remove(d.kpiId)
      await load(tech)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  async function seed(): Promise<void> {
    setSeeding(true)
    setError(null)
    try {
      await window.api.kpis.seed(tech)
      await load(tech)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSeeding(false)
    }
  }

  const readOnly = workspace?.readOnly ?? false

  return (
    <div className="module">
      <div className="module-head">
        <h2>KPI Definitions</h2>
        <span className="module-workspace">{workspace?.name}</span>
        <span className="badge">spec §54a</span>
        {readOnly && <span className="badge badge-ro">READ ONLY</span>}
      </div>

      <div className="tabs">
        {TECHS.map((t) => (
          <button key={t} className={`tab${tech === t ? ' active' : ''}`} onClick={() => setTech(t)}>
            {t}
            {workspace?.technology === t && <span className="tab-note"> · workspace</span>}
          </button>
        ))}
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      <div className="card">
        <div className="kpi-page-head">
          <span className="card-note">
            {tech} KPIs drive Cell Intelligence and analysis. Targets flag breaches —
            higher-worse KPIs breach above the target, lower-worse below it.
          </span>
          <button className="btn" disabled={seeding || readOnly} onClick={() => void seed()}>
            {seeding ? 'Seeding…' : 'Re-seed built-ins'}
          </button>
        </div>

        {loading ? (
          <p className="card-note">Loading…</p>
        ) : defs.length === 0 ? (
          <div className="notice">
            No {tech} KPIs defined yet — add one below or re-seed the built-in set.
          </div>
        ) : (
          <div className="preview-scroll">
            <table className="data-table kpi-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Key</th>
                  <th>Unit</th>
                  <th>Worse = higher</th>
                  <th>Target</th>
                  <th>Aggregation</th>
                  <th>Source aliases</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {defs.map((d) => (
                  <tr key={d.kpiId}>
                    <td>
                      {d.label}
                      {!d.isCustom && <span className="badge">built-in</span>}
                    </td>
                    <td><code>{d.key}</code></td>
                    <td>{d.unit || '—'}</td>
                    <td>{d.worseIsHigher ? '↑ worse' : '↓ worse'}</td>
                    <td>
                      {d.target == null ? (
                        '—'
                      ) : (
                        <span className={d.worseIsHigher ? 'target-high' : 'target-low'}>
                          {d.target}
                        </span>
                      )}
                    </td>
                    <td>{d.agg}</td>
                    <td className="map-src">{d.sourceHeaders.slice(0, 3).join(', ') || '—'}</td>
                    <td className="row-actions kpi-row-actions">
                      <button className="btn" disabled={readOnly} onClick={() => startEdit(d)}>Edit</button>
                      <button className="btn" disabled={readOnly} onClick={() => void remove(d)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="module-head">
          <h3>{editingId != null ? 'Edit KPI' : 'Add KPI'}</h3>
          <span className="card-note">{tech}</span>
        </div>
        <div className="kpi-form">
          <label className="kpi-field">
            <span>Key (machine id, e.g. tch_congestion)</span>
            <input
              className="input"
              value={draft.key}
              disabled={editingId != null}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
              placeholder="my_kpi"
            />
          </label>
          <label className="kpi-field">
            <span>Label</span>
            <input
              className="input"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="My KPI"
            />
          </label>
          <label className="kpi-field">
            <span>Unit</span>
            <input
              className="input"
              value={draft.unit}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
              placeholder="% / MB / kbps"
            />
          </label>
          <label className="kpi-field">
            <span>Target (optional)</span>
            <input
              className="input"
              value={draft.target}
              onChange={(e) => setDraft({ ...draft, target: e.target.value })}
              placeholder="e.g. 80"
            />
          </label>
          <label className="kpi-field">
            <span>Worse = higher</span>
            <select
              className="sel"
              value={draft.worseIsHigher ? '1' : '0'}
              onChange={(e) => setDraft({ ...draft, worseIsHigher: e.target.value === '1' })}
            >
              <option value="1">Yes — high values are bad</option>
              <option value="0">No — low values are bad</option>
            </select>
          </label>
          <label className="kpi-field">
            <span>Aggregation</span>
            <select
              className="sel"
              value={draft.agg}
              onChange={(e) => setDraft({ ...draft, agg: e.target.value as KpiDefinition['agg'] })}
            >
              {AGGS.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </label>
          <label className="kpi-field kpi-field-wide">
            <span>Source aliases (comma-separated, used for import auto-mapping)</span>
            <input
              className="input"
              value={draft.aliases}
              onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
              placeholder="tch congestion, tch congestion (%)"
            />
          </label>
          <div className="row-actions">
            <button className="btn btn-primary" disabled={saving || readOnly} onClick={() => void save()}>
              {saving ? 'Saving…' : editingId != null ? 'Save changes' : 'Add KPI'}
            </button>
            {editingId != null && (
              <button className="btn" onClick={cancelEdit}>Cancel</button>
            )}
          </div>
        </div>
      </div>

      <p className="card-note">
        New KPIs are active immediately for the {tech} workspace. In Data Manager, map a source column
        to a KPI to bring imported values into Cell Intelligence; the target then drives breach flags
        (and future scoring).
      </p>
    </div>
  )
}
