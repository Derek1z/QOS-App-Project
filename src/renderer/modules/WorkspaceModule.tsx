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
    prb: '',
    tchCongestion: '',
    sdcchCongestion: '',
    cssr: '',
    callDrop: '',
    dataAccess: '',
    dataFailure: '',
    dailyBreach: '',
    weeklyBreach: '',
    monthlyBreach: '',
    persistentWeeks: '',
    chronicWeeks: '',
    persistentDays: '',
    chronicDays: '',
    persistentMonths: '',
    chronicMonths: '',
    district: '',
    notes: ''
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
          prb: String(r.prbThresholdPct ?? 80),
          tchCongestion: String(r.tchCongestionThresholdPct ?? 2.0),
          sdcchCongestion: String(r.sdcchCongestionThresholdPct ?? 2.0),
          cssr: String(r.cssrThresholdPct ?? 98.5),
          callDrop: String(r.callDropThresholdPct ?? 1.5),
          dataAccess: String(r.dataAccessThresholdPct ?? 98.0),
          dataFailure: String(r.dataServiceFailureThresholdPct ?? 1.0),
          dailyBreach: String(r.dailyMinKpiBreaches ?? 1),
          weeklyBreach: String(r.weeklyBreachDays ?? 1),
          monthlyBreach: String(r.monthlyBreachDays ?? 3),
          persistentWeeks: String(r.persistentWeeks ?? 3),
          chronicWeeks: String(r.chronicWeeks ?? 7),
          persistentDays: String(r.persistentDays ?? 7),
          chronicDays: String(r.chronicDays ?? 21),
          persistentMonths: String(r.persistentMonths ?? 2),
          chronicMonths: String(r.chronicMonths ?? 3),
          district: String(r.districtNcThresholdPct ?? 10),
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
        tchCongestionThresholdPct: Number(rulesForm.tchCongestion),
        sdcchCongestionThresholdPct: Number(rulesForm.sdcchCongestion),
        cssrThresholdPct: Number(rulesForm.cssr),
        callDropThresholdPct: Number(rulesForm.callDrop),
        dataAccessThresholdPct: Number(rulesForm.dataAccess),
        dataServiceFailureThresholdPct: Number(rulesForm.dataFailure),
        dailyMinKpiBreaches: Number(rulesForm.dailyBreach || 1),
        weeklyBreachDays: Number(rulesForm.weeklyBreach),
        monthlyBreachDays: Number(rulesForm.monthlyBreach),
        persistentWeeks: Number(rulesForm.persistentWeeks),
        chronicWeeks: Number(rulesForm.chronicWeeks),
        persistentDays: Number(rulesForm.persistentDays),
        chronicDays: Number(rulesForm.chronicDays),
        persistentMonths: Number(rulesForm.persistentMonths),
        chronicMonths: Number(rulesForm.chronicMonths),
        districtNcThresholdPct: Number(rulesForm.district),
        notes: rulesForm.notes.trim() || undefined
      })
      setRules(updated)
      setRulesForm({
        prb: String(updated.prbThresholdPct),
        tchCongestion: String(updated.tchCongestionThresholdPct ?? 2.0),
        sdcchCongestion: String(updated.sdcchCongestionThresholdPct ?? 2.0),
        cssr: String(updated.cssrThresholdPct ?? 98.5),
        callDrop: String(updated.callDropThresholdPct ?? 1.5),
        dataAccess: String(updated.dataAccessThresholdPct ?? 98.0),
        dataFailure: String(updated.dataServiceFailureThresholdPct ?? 1.0),
        dailyBreach: String(updated.dailyMinKpiBreaches ?? 1),
        weeklyBreach: String(updated.weeklyBreachDays ?? 1),
        monthlyBreach: String(updated.monthlyBreachDays ?? 3),
        persistentWeeks: String(updated.persistentWeeks ?? 3),
        chronicWeeks: String(updated.chronicWeeks ?? 7),
        persistentDays: String(updated.persistentDays ?? 7),
        chronicDays: String(updated.chronicDays ?? 21),
        persistentMonths: String(updated.persistentMonths ?? 2),
        chronicMonths: String(updated.chronicMonths ?? 3),
        district: String(updated.districtNcThresholdPct ?? 10),
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
        <h2>Workspace & Threshold Governance</h2>
        <span className="module-workspace">{workspace?.name ?? 'No workspace'}</span>
        {workspace?.readOnly && <span className="badge badge-ro">READ ONLY</span>}
      </div>

      {workspace && (
        <div className="card">
          <div className="file-head">
            <h3>Workspace Overview</h3>
            <span className="badge">{workspace.technology ?? '4G'}</span>
          </div>
          <table className="meta-table">
            <tbody>
              <tr>
                <td>Path</td>
                <td>
                  <code>{workspace.path}</code>
                </td>
              </tr>
              <tr>
                <td>Database size</td>
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
        <div className="card rules-card">
          <div className="file-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h3>Ruleset v{rules.version} — Thresholds & Governance</h3>
              <span className="badge">Version {rules.version}</span>
            </div>
            {rules.createdAt && <span className="card-note">Created {new Date(rules.createdAt).toLocaleString()}</span>}
          </div>
          <p className="card-note" style={{ marginBottom: 16 }}>
            Centralized multi-technology and multi-grain thresholds. Modifying parameters creates an immutable new ruleset version, automatically recomputes derived intelligence across daily, weekly, and monthly grains, and records an audit log entry.
          </p>

          {/* Section 1: Radio KPI Compliance Targets */}
          <div className="rules-section">
            <div className="rules-section-header">
              <span className="rules-section-title">📶 1. Radio KPI Compliance Targets (2G / 3G / 4G)</span>
              <span className="rules-section-subtitle">Core performance benchmarks per cellular generation</span>
            </div>
            <div className="rules-grid">
              <NumField
                label="4G DL PRB Threshold % (Max)"
                value={rulesForm.prb}
                onChange={(v) => setRulesForm((f) => ({ ...f, prb: v }))}
                step={1}
                min={0}
                max={100}
              />
              <NumField
                label="4G Data Service Failure DSAF % (Max)"
                value={rulesForm.dataFailure}
                onChange={(v) => setRulesForm((f) => ({ ...f, dataFailure: v }))}
                step={0.1}
                min={0}
                max={100}
              />
              <NumField
                label="3G Data Access Success DASR % (Min)"
                value={rulesForm.dataAccess}
                onChange={(v) => setRulesForm((f) => ({ ...f, dataAccess: v }))}
                step={0.1}
                min={0}
                max={100}
              />
              <NumField
                label="2G TCH Congestion % (Max)"
                value={rulesForm.tchCongestion}
                onChange={(v) => setRulesForm((f) => ({ ...f, tchCongestion: v }))}
                step={0.1}
                min={0}
                max={100}
              />
              <NumField
                label="2G SDCCH Congestion % (Max)"
                value={rulesForm.sdcchCongestion}
                onChange={(v) => setRulesForm((f) => ({ ...f, sdcchCongestion: v }))}
                step={0.1}
                min={0}
                max={100}
              />
              <NumField
                label="Call Setup Success (CSSR) Target % (Min)"
                value={rulesForm.cssr}
                onChange={(v) => setRulesForm((f) => ({ ...f, cssr: v }))}
                step={0.1}
                min={0}
                max={100}
              />
              <NumField
                label="Call Drop Rate (CDR) Threshold % (Max)"
                value={rulesForm.callDrop}
                onChange={(v) => setRulesForm((f) => ({ ...f, callDrop: v }))}
                step={0.1}
                min={0}
                max={100}
              />
            </div>
          </div>

          {/* Section 2: NC Grain Qualification Criteria */}
          <div className="rules-section">
            <div className="rules-section-header">
              <span className="rules-section-title">🎯 2. Non-Compliance (NC) Qualification Criteria</span>
              <span className="rules-section-subtitle">Defines the minimum breach criteria required for a cell to qualify as NC in each analytical grain</span>
            </div>
            <div className="rules-grid-3">
              <div className="rules-grain-box">
                <div className="rules-grain-box-head">
                  <span className="badge">📅 Daily Grain</span>
                  <span className="card-note">Observation Day</span>
                </div>
                <NumField
                  label="Min Core KPI Breaches (1–5)"
                  value={rulesForm.dailyBreach}
                  onChange={(v) => setRulesForm((f) => ({ ...f, dailyBreach: v }))}
                  min={1}
                  max={5}
                />
                <div className="card-note" style={{ marginTop: 2 }}>
                  Cell qualifies as Daily NC if ≥ {rulesForm.dailyBreach || 1} core KPI target(s) fail on that date.
                </div>
              </div>

              <div className="rules-grain-box">
                <div className="rules-grain-box-head">
                  <span className="badge badge-accent">📊 Weekly Grain</span>
                  <span className="card-note">7-Day Calendar Week</span>
                </div>
                <NumField
                  label="Min Breach Days per Week (1–7)"
                  value={rulesForm.weeklyBreach}
                  onChange={(v) => setRulesForm((f) => ({ ...f, weeklyBreach: v }))}
                  min={1}
                  max={7}
                />
                <div className="card-note" style={{ marginTop: 2 }}>
                  Cell qualifies as Weekly NC if it breaches on ≥ {rulesForm.weeklyBreach || 1} day(s) in the week.
                </div>
              </div>

              <div className="rules-grain-box">
                <div className="rules-grain-box-head">
                  <span className="badge">🗓️ Monthly Grain</span>
                  <span className="card-note">Calendar Month</span>
                </div>
                <NumField
                  label="Min Breach Days per Month (1–31)"
                  value={rulesForm.monthlyBreach}
                  onChange={(v) => setRulesForm((f) => ({ ...f, monthlyBreach: v }))}
                  min={1}
                  max={31}
                />
                <div className="card-note" style={{ marginTop: 2 }}>
                  Cell qualifies as Monthly NC if it breaches on ≥ {rulesForm.monthlyBreach || 3} day(s) in the month.
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Lifecycle Escalation Streaks Matrix */}
          <div className="rules-section">
            <div className="rules-section-header">
              <span className="rules-section-title">⏳ 3. Lifecycle Escalation Streaks Matrix</span>
              <span className="rules-section-subtitle">Consecutive NC periods required to escalate from New NC → Persistent NC → Chronic NC</span>
            </div>
            <div className="rules-grid-3">
              <div className="rules-grain-box">
                <div className="rules-grain-box-head">
                  <span className="badge badge-accent">📊 Weekly Streaks</span>
                  <span className="card-note">Consecutive Weeks</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <NumField
                    label="Persistent NC Streak (≥ Weeks)"
                    value={rulesForm.persistentWeeks}
                    onChange={(v) => setRulesForm((f) => ({ ...f, persistentWeeks: v }))}
                    min={1}
                    max={26}
                  />
                  <NumField
                    label="Chronic NC Streak (≥ Weeks)"
                    value={rulesForm.chronicWeeks}
                    onChange={(v) => setRulesForm((f) => ({ ...f, chronicWeeks: v }))}
                    min={2}
                    max={52}
                  />
                </div>
              </div>

              <div className="rules-grain-box">
                <div className="rules-grain-box-head">
                  <span className="badge">📅 Daily Streaks</span>
                  <span className="card-note">Consecutive Days</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <NumField
                    label="Persistent NC Streak (≥ Days)"
                    value={rulesForm.persistentDays}
                    onChange={(v) => setRulesForm((f) => ({ ...f, persistentDays: v }))}
                    min={1}
                    max={90}
                  />
                  <NumField
                    label="Chronic NC Streak (≥ Days)"
                    value={rulesForm.chronicDays}
                    onChange={(v) => setRulesForm((f) => ({ ...f, chronicDays: v }))}
                    min={2}
                    max={180}
                  />
                </div>
              </div>

              <div className="rules-grain-box">
                <div className="rules-grain-box-head">
                  <span className="badge">🗓️ Monthly Streaks</span>
                  <span className="card-note">Consecutive Months</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <NumField
                    label="Persistent NC Streak (≥ Months)"
                    value={rulesForm.persistentMonths}
                    onChange={(v) => setRulesForm((f) => ({ ...f, persistentMonths: v }))}
                    min={1}
                    max={12}
                  />
                  <NumField
                    label="Chronic NC Streak (≥ Months)"
                    value={rulesForm.chronicMonths}
                    onChange={(v) => setRulesForm((f) => ({ ...f, chronicMonths: v }))}
                    min={2}
                    max={24}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Governance & Cluster Thresholds */}
          <div className="rules-section">
            <div className="rules-section-header">
              <span className="rules-section-title">🗺️ 4. Governance & Cluster Thresholds</span>
              <span className="rules-section-subtitle">Cluster escalation triggers and ruleset change audit</span>
            </div>
            <div className="rules-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <NumField
                label="District NC Alarm Threshold %"
                value={rulesForm.district}
                onChange={(v) => setRulesForm((f) => ({ ...f, district: v }))}
                step={0.5}
                min={0}
                max={100}
              />
            </div>
          </div>

          <div className="row-actions" style={{ marginTop: 12 }}>
            <input
              className="input rules-notes"
              style={{ flex: 1 }}
              placeholder="Notes for this ruleset version (e.g., 'Aligned 3-grain breach rules and persistent streak criteria')…"
              value={rulesForm.notes}
              onChange={(e) => setRulesForm((f) => ({ ...f, notes: e.target.value }))}
            />
            {!workspace.readOnly && (
              <button className="btn btn-primary" disabled={busy || rulesSaving} onClick={() => void saveRules()}>
                {rulesSaving ? 'Saving…' : 'Save as v' + (rules.version + 1)}
              </button>
            )}
          </div>
          {rulesError && <div className="notice notice-error" style={{ marginTop: 10 }}>{rulesError}</div>}
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
