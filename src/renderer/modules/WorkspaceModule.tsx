import { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import {
  openWorkspaceFlow,
  createWorkspaceFlow,
  closeWorkspaceFlow,
  reopenReadOnlyFlow,
  refreshWorkspaceState
} from '../lib/flows'
import type { RecentWorkspace, Rules, SnapshotComparison, WorkspaceSnapshot } from '../../../shared/api'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function NumField({
  label, value, onChange, step = 1, min, max
}: {
  label: string
  value: string
  onChange: (v: string) => void
  step?: number
  min?: number
  max?: number
}): React.JSX.Element {
  return (
    <label className="rules-field">
      <span>{label}</span>
      <input
        className="input"
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

export default function WorkspaceModule(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const summary = useAppStore((s) => s.summary)
  const recent = useAppStore((s) => s.recent)
  const busy = useAppStore((s) => s.busy)
  const [name, setName] = useState('')
  const [rules, setRules] = useState<Rules | null>(null)
  const [rulesForm, setRulesForm] = useState({
    prb: '', breach: '', persistent: '', district: '', notes: ''
  })
  const [rulesError, setRulesError] = useState<string | null>(null)
  const [rulesSaving, setRulesSaving] = useState(false)
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshot[]>([])
  const [snapForm, setSnapForm] = useState({ name: '', reason: '', notes: '' })
  const [snapBusy, setSnapBusy] = useState(false)
  const [snapError, setSnapError] = useState<string | null>(null)
  const [snapNotice, setSnapNotice] = useState<string | null>(null)
  const [cmp, setCmp] = useState<SnapshotComparison | null>(null)
  const [cmpA, setCmpA] = useState<number | ''>('')
  const [cmpB, setCmpB] = useState<number | ''>('')
  const [cmpBusy, setCmpBusy] = useState(false)
  const [cmpError, setCmpError] = useState<string | null>(null)

  async function loadSnapshots(): Promise<void> {
    if (!workspace) {
      setSnapshots([])
      return
    }
    try {
      setSnapshots(await window.api.workspace.snapshots())
    } catch {
      setSnapshots([])
    }
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const r = await window.api.rules.get()
        if (!alive || !r) return
        setRules(r)
        setRulesForm({
          prb: String(r.prbThresholdPct),
          breach: String(r.weeklyBreachDays),
          persistent: String(r.persistentWeeks),
          district: String(r.districtNcThresholdPct),
          notes: r.notes ?? ''
        })
      } catch {
        /* no workspace */
      }
    })()
    return () => {
      alive = false
    }
  }, [workspace?.path, workspace?.readOnly])

  useEffect(() => {
    void loadSnapshots()
    setSnapError(null)
    setSnapNotice(null)
  }, [workspace?.path, workspace?.readOnly])

  async function createSnap(): Promise<void> {
    setSnapBusy(true)
    setSnapError(null)
    setSnapNotice(null)
    try {
      await window.api.workspace.createSnapshot(snapForm.name, {
        reason: snapForm.reason || undefined,
        notes: snapForm.notes || undefined
      })
      setSnapForm({ name: '', reason: '', notes: '' })
      setSnapNotice('Snapshot created — a clean point-in-time copy of the workspace.')
      await loadSnapshots()
    } catch (e) {
      setSnapError(e instanceof Error ? e.message : String(e))
    } finally {
      setSnapBusy(false)
    }
  }

  async function restoreSnap(s: WorkspaceSnapshot): Promise<void> {
    if (!window.confirm(
      `Restore workspace from snapshot "${s.name}"?\n\n` +
      'The current workspace is replaced by the snapshot (a pre-restore backup is ' +
      'written to backups/ first). This cannot be undone from the UI.'
    )) return
    setSnapBusy(true)
    setSnapError(null)
    setSnapNotice(null)
    try {
      await window.api.workspace.restoreSnapshot(s.snapshotId)
      await refreshWorkspaceState()
      setSnapNotice(`Restored from snapshot "${s.name}" — a pre-restore backup was saved to backups/.`)
      await loadSnapshots()
    } catch (e) {
      setSnapError(e instanceof Error ? e.message : String(e))
    } finally {
      setSnapBusy(false)
    }
  }

  async function removeSnap(s: WorkspaceSnapshot): Promise<void> {
    if (!window.confirm(`Delete snapshot "${s.name}"? The snapshot file is removed permanently.`)) return
    setSnapBusy(true)
    setSnapError(null)
    setSnapNotice(null)
    try {
      await window.api.workspace.removeSnapshot(s.snapshotId)
      setSnapNotice(`Snapshot "${s.name}" deleted.`)
      await loadSnapshots()
    } catch (e) {
      setSnapError(e instanceof Error ? e.message : String(e))
    } finally {
      setSnapBusy(false)
    }
  }

  function cmpDelta(k: SnapshotComparison['kpis'][number]): string {
    if (k.delta == null) return '—'
    const sign = k.delta > 0 ? '+' : k.delta < 0 ? '' : ''
    const unit = k.deltaPct != null && Math.abs(k.deltaPct) >= 0.05 ? ` (${sign}${k.deltaPct.toFixed(1)}%)` : ''
    return `${k.delta > 0 ? '▲' : k.delta < 0 ? '▼' : '▬'} ${k.delta.toLocaleString()}${unit}`
  }

  async function runCompare(): Promise<void> {
    if (cmpA === '' || cmpB === '' || cmpA === cmpB) {
      setCmpError('Pick two different snapshots to compare.')
      return
    }
    setCmpBusy(true)
    setCmpError(null)
    setCmp(null)
    try {
      setCmp(await window.api.workspace.compareSnapshots(cmpA, cmpB))
    } catch (e) {
      setCmpError(e instanceof Error ? e.message : String(e))
    } finally {
      setCmpBusy(false)
    }
  }

  async function saveRules(): Promise<void> {
    setRulesError(null)
    setRulesSaving(true)
    try {
      const updated = await window.api.rules.update({
        prbThresholdPct: Number(rulesForm.prb),
        weeklyBreachDays: Number(rulesForm.breach),
        persistentWeeks: Number(rulesForm.persistent),
        districtNcThresholdPct: Number(rulesForm.district),
        notes: rulesForm.notes.trim() || undefined
      })
      setRules(updated)
      setRulesForm({
        prb: String(updated.prbThresholdPct),
        breach: String(updated.weeklyBreachDays),
        persistent: String(updated.persistentWeeks),
        district: String(updated.districtNcThresholdPct),
        notes: updated.notes ?? ''
      })
      await refreshWorkspaceState()
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : String(e))
    } finally {
      setRulesSaving(false)
    }
  }

  return (
    <div className="module">
      <div className="module-head">
        <h2>Workspace</h2>
      </div>

      {workspace && (
        <div className="card">
          <h3>
            {workspace.name}
            {workspace.readOnly && <span className="badge badge-ro">READ ONLY</span>}
          </h3>
          <table className="info-table">
            <tbody>
              <tr>
                <td>Path</td>
                <td>{workspace.path}</td>
              </tr>
              <tr>
                <td>File size</td>
                <td>{fmtBytes(workspace.sizeBytes)}</td>
              </tr>
              <tr>
                <td>Schema version</td>
                <td>{workspace.schemaVersion}</td>
              </tr>
              <tr>
                <td>Created</td>
                <td>{workspace.createdAt ? new Date(workspace.createdAt).toLocaleString() : '—'}</td>
              </tr>
              <tr>
                <td>Rows</td>
                <td>{summary?.rowCount.toLocaleString() ?? '—'}</td>
              </tr>
              <tr>
                <td>Date range</td>
                <td>
                  {summary?.minDate ?? '—'} → {summary?.maxDate ?? '—'}
                </td>
              </tr>
              <tr>
                <td>Dimensions</td>
                <td>
                  {summary?.regions ?? 0} regions · {summary?.districts ?? 0} districts ·{' '}
                  {summary?.sites ?? 0} sites · {summary?.cells ?? 0} cells
                </td>
              </tr>
              <tr>
                <td>Ruleset</td>
                <td>{summary?.rulesetVersion != null ? `v${summary.rulesetVersion}` : '—'}</td>
              </tr>
            </tbody>
          </table>
          <div className="row-actions">
            {!workspace.readOnly && (
              <button className="btn" disabled={busy} onClick={() => void reopenReadOnlyFlow()}>
                Reopen Read-Only
              </button>
            )}
            <button className="btn" disabled={busy} onClick={() => void closeWorkspaceFlow()}>
              Close Workspace
            </button>
          </div>
        </div>
      )}

      {workspace && rules && (
        <div className="card">
          <div className="file-head">
            <h3>Ruleset v{rules.version}</h3>
            {rules.createdAt && <span className="card-note">created {new Date(rules.createdAt).toLocaleString()}</span>}
          </div>
          <p className="card-note">
            Changing rules creates a new version, recomputes all derived intelligence and writes an
            audit event — raw facts are never altered (spec §63).
          </p>
          <div className="rules-grid">
            <NumField
              label="PRB threshold %"
              value={rulesForm.prb}
              onChange={(v) => setRulesForm((f) => ({ ...f, prb: v }))}
              step={1}
              min={0}
              max={100}
            />
            <NumField
              label="Weekly breach days"
              value={rulesForm.breach}
              onChange={(v) => setRulesForm((f) => ({ ...f, breach: v }))}
              min={1}
              max={7}
            />
            <NumField
              label="Persistent weeks"
              value={rulesForm.persistent}
              onChange={(v) => setRulesForm((f) => ({ ...f, persistent: v }))}
              min={2}
              max={12}
            />
            <NumField
              label="District NC threshold %"
              value={rulesForm.district}
              onChange={(v) => setRulesForm((f) => ({ ...f, district: v }))}
              step={0.5}
              min={0}
              max={100}
            />
          </div>
          <div className="row-actions">
            <input
              className="input rules-notes"
              placeholder="Notes for this version…"
              value={rulesForm.notes}
              onChange={(e) => setRulesForm((f) => ({ ...f, notes: e.target.value }))}
            />
            {!workspace.readOnly && (
              <button className="btn btn-primary" disabled={busy || rulesSaving} onClick={() => void saveRules()}>
                {rulesSaving ? 'Saving…' : 'Save as v' + (rules.version + 1)}
              </button>
            )}
          </div>
          {rulesError && <div className="notice notice-error">{rulesError}</div>}
        </div>
      )}

      <div className="card">
        <div className="file-head">
          <h3>Snapshots (spec §7)</h3>
          {snapshots.length > 0 && (
            <span className="card-note">
              {snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <p className="card-note">
          Point-in-time copies for analytical milestones (before a PRB threshold change,
          month-end, before an optimization campaign). Restoring replaces the workspace — a
          pre-restore backup is always written to <code>backups/</code> first.
        </p>
        {snapError && <div className="notice notice-error">{snapError}</div>}
        {snapNotice && <div className="notice">{snapNotice}</div>}
        {!workspace?.readOnly && (
          <div className="snap-form">
            <div className="row-actions">
              <input
                className="input"
                placeholder="Snapshot name (e.g. Before PRB change)"
                value={snapForm.name}
                onChange={(e) => setSnapForm((f) => ({ ...f, name: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Reason (optional)"
                value={snapForm.reason}
                onChange={(e) => setSnapForm((f) => ({ ...f, reason: e.target.value }))}
              />
              <button
                className="btn btn-primary"
                disabled={busy || snapBusy || !snapForm.name.trim()}
                onClick={() => void createSnap()}
              >
                {snapBusy ? 'Working…' : 'Create snapshot'}
              </button>
            </div>
            <input
              className="input snap-notes"
              placeholder="Notes (optional)…"
              value={snapForm.notes}
              onChange={(e) => setSnapForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        )}
        {snapshots.length === 0 ? (
          <p className="card-note">No snapshots yet — create one to mark a milestone.</p>
        ) : (
          <>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Created</th>
                  <th>Size</th>
                  <th>Reason</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.snapshotId}>
                    <td>
                      <b>{s.name}</b>
                      {s.notes && <div className="card-note">{s.notes}</div>}
                    </td>
                    <td>{new Date(s.createdAt).toLocaleString()}</td>
                    <td>{fmtBytes(s.sizeBytes)}</td>
                    <td className="card-note">{s.reason ?? '—'}</td>
                    <td className="row-actions">
                      {!workspace?.readOnly && (
                        <button className="btn" disabled={busy || snapBusy} onClick={() => void restoreSnap(s)}>
                          Restore
                        </button>
                      )}
                      {!workspace?.readOnly && (
                        <button className="btn" disabled={busy || snapBusy} onClick={() => void removeSnap(s)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="snap-compare">
              <span className="rc-label">Compare two snapshots (A → B):</span>
              <select
                className="input"
                value={cmpA}
                onChange={(e) => setCmpA(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="">Snapshot A…</option>
                {snapshots.map((s) => (
                  <option key={s.snapshotId} value={s.snapshotId}>{s.name}</option>
                ))}
              </select>
              <select
                className="input"
                value={cmpB}
                onChange={(e) => setCmpB(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="">Snapshot B…</option>
                {snapshots.map((s) => (
                  <option key={s.snapshotId} value={s.snapshotId}>{s.name}</option>
                ))}
              </select>
              <button className="btn" disabled={snapBusy || cmpBusy} onClick={() => void runCompare()}>
                {cmpBusy ? 'Comparing…' : 'Compare'}
              </button>
            </div>
            {cmpError && <div className="notice notice-error">{cmpError}</div>}
            {cmp && (
              <table className="data-table snap-cmp-table">
                <thead>
                  <tr>
                    <th>KPI</th>
                    <th>A · {cmp.a.name}</th>
                    <th>B · {cmp.b.name}</th>
                    <th>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {cmp.kpis.map((k) => {
                    const help = k.delta == null ? '' : k.delta === 0 ? 'neutral' : (k.delta > 0) === k.worseIsHigher ? 'bad' : 'good'
                    return (
                      <tr key={k.key}>
                        <td>{k.label}</td>
                        <td>{k.a == null ? '—' : `${k.a.toLocaleString()}${k.unit === '%' || k.unit === 'kbps' || k.unit === 'MB' ? ` ${k.unit}` : ''}`}</td>
                        <td>{k.b == null ? '—' : `${k.b.toLocaleString()}${k.unit === '%' || k.unit === 'kbps' || k.unit === 'MB' ? ` ${k.unit}` : ''}`}</td>
                        <td className={`snap-delta snap-delta-${help}`}>{cmpDelta(k)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h3>Create workspace</h3>
        <div className="row-actions">
          <input
            className="input"
            placeholder="Workspace name (e.g. MTN_4G)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={busy || !name.trim()}
            onClick={() => void createWorkspaceFlow(name)}
          >
            Choose folder &amp; create
          </button>
        </div>
        <p className="card-note">
          Creates a new <code>.qosdb</code> DuckDB workspace in the folder you pick. The whole app
          folder stays portable.
        </p>
      </div>

      <div className="card">
        <h3>Open workspace</h3>
        <div className="row-actions">
          <button className="btn" disabled={busy} onClick={() => void openWorkspaceFlow()}>
            Locate Workspace…
          </button>
        </div>
        {recent.length > 0 && (
          <div className="recent-list">
            <div className="recent-title">Recent</div>
            {recent.map((r: RecentWorkspace) => (
              <button
                key={r.path}
                className="recent-item"
                onClick={() => void openWorkspaceFlow(r.path)}
              >
                <span className="recent-name">{r.name}</span>
                <span className="recent-path">{r.path}</span>
                <span className="recent-when">{new Date(r.lastOpened).toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
