import React, { useCallback, useEffect, useState } from 'react'
import type { SnapshotComparison, WorkspaceSnapshot } from '../../../shared/api'
import { useAppStore } from '../store'
import { refreshWorkspaceState } from '../lib/flows'
import { fmtBytes, fmtDateTime, deltaTone, snapshotNameProblem, fmtSnapValue as fmtValue } from '../lib/snapshotsView'

const card: React.CSSProperties = { background: 'var(--bg-card)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border)' }
const TONE_COLOR = { better: '#34d399', worse: '#f87171', same: 'var(--text-dim)', none: 'var(--text-dim)' } as const

/** Workspace snapshots (spec §7): point-in-time copies of the workspace file
 *  to restore from, or to measure the change between two milestones. */
export default function SnapshotsPanel(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const readOnly = workspace?.readOnly ?? true
  const [snaps, setSnaps] = useState<WorkspaceSnapshot[]>([])
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pick, setPick] = useState<number[]>([])
  const [cmp, setCmp] = useState<SnapshotComparison | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setSnaps(await window.api.workspace.snapshots())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    setPick([])
    setCmp(null)
    void load()
  }, [load, workspace?.path])

  const run = async (label: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(label)
    setError(null)
    setMessage(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const nameProblem = snapshotNameProblem(name)

  const create = (): Promise<void> =>
    run('create', async () => {
      const s = await window.api.workspace.createSnapshot(name.trim(), { reason, notes })
      setName('')
      setReason('')
      setNotes('')
      setMessage(`Snapshot "${s.name}" saved.`)
      await refreshWorkspaceState()
      await load()
    })

  const restore = (s: WorkspaceSnapshot): Promise<void> => {
    if (!window.confirm(`Restore "${s.name}" from ${fmtDateTime(s.createdAt)}?\n\nThis replaces the current data with the snapshot. A backup of the current data is saved to backups/ first.`)) {
      return Promise.resolve()
    }
    return run(`restore-${s.snapshotId}`, async () => {
      await window.api.workspace.restoreSnapshot(s.snapshotId)
      setMessage(`Restored "${s.name}". Forecasts are recomputed in the background.`)
      await refreshWorkspaceState()
      await load()
    })
  }

  const remove = (s: WorkspaceSnapshot): Promise<void> => {
    if (!window.confirm(`Delete the snapshot "${s.name}" (${fmtDateTime(s.createdAt)})? Its file is removed.`)) return Promise.resolve()
    return run(`remove-${s.snapshotId}`, async () => {
      await window.api.workspace.removeSnapshot(s.snapshotId)
      setPick((p) => p.filter((id) => id !== s.snapshotId))
      await load()
    })
  }

  const togglePick = (id: number): void => {
    setCmp(null)
    setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]))
  }

  const compare = (): Promise<void> =>
    run('compare', async () => {
      // older first, so the change reads "from A to B"
      const [a, b] = [...pick].sort((x, y) =>
        (snaps.find((s) => s.snapshotId === x)?.createdAt ?? '').localeCompare(snaps.find((s) => s.snapshotId === y)?.createdAt ?? ''))
      setCmp(await window.api.workspace.compareSnapshots(a, b))
    })

  return (
    <div style={card}>
      <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#f8fafc', margin: '0 0 4px 0' }}>Snapshots</h3>
      <p style={{ fontSize: '12px', color: 'var(--text-dim)', margin: '0 0 14px 0' }}>
        Point-in-time copies of this workspace — restore one, or compare two to measure what changed.
        {readOnly && ' This workspace is open read-only: you can list and compare, not create, restore or delete.'}
      </p>

      {!readOnly && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(160px, 1fr) minmax(200px, 2fr) auto', gap: '8px', alignItems: 'start', marginBottom: '14px' }}>
          <input className="input" placeholder="Name (required)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Snapshot name" />
          <input className="input" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Snapshot reason" />
          <input className="input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Snapshot notes" />
          <button className="btn" disabled={busy !== null || nameProblem !== null} title={nameProblem ?? undefined} onClick={() => void create()}>
            {busy === 'create' ? 'Saving…' : 'Create snapshot'}
          </button>
        </div>
      )}

      {error && <div className="status-error" style={{ marginBottom: '10px' }}>{error}</div>}
      {message && <div className="notice notice-dim" style={{ marginBottom: '10px' }}>{message}</div>}

      {snaps.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '12px' }}>No snapshots yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th title="Pick two to compare">Compare</th>
                <th>Name</th>
                <th>Created</th>
                <th className="num">Size</th>
                <th>Reason / notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {snaps.map((s) => (
                <tr key={s.snapshotId}>
                  <td>
                    <input type="checkbox" checked={pick.includes(s.snapshotId)} onChange={() => togglePick(s.snapshotId)} aria-label={`Compare ${s.name}`} />
                  </td>
                  <td style={{ fontWeight: 700 }}>{s.name}</td>
                  <td>{fmtDateTime(s.createdAt)}</td>
                  <td className="num">{fmtBytes(s.sizeBytes)}</td>
                  <td style={{ color: 'var(--text-dim)', fontSize: '12px' }}>{[s.reason, s.notes].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {!readOnly && (
                      <>
                        <button className="btn btn-sm" disabled={busy !== null} onClick={() => void restore(s)}>
                          {busy === `restore-${s.snapshotId}` ? 'Restoring…' : 'Restore'}
                        </button>{' '}
                        <button className="btn btn-sm btn-ghost" disabled={busy !== null} onClick={() => void remove(s)}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {snaps.length >= 2 && (
        <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button className="btn" disabled={pick.length !== 2 || busy !== null} onClick={() => void compare()}>
            {busy === 'compare' ? 'Comparing…' : 'Compare selected'}
          </button>
          <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{pick.length}/2 selected</span>
        </div>
      )}

      {cmp && (
        <div className="table-wrap" style={{ marginTop: '12px' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>KPI</th>
                <th className="num">{cmp.a.name} ({fmtDateTime(cmp.a.createdAt)})</th>
                <th className="num">{cmp.b.name} ({fmtDateTime(cmp.b.createdAt)})</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {cmp.kpis.map((k) => {
                const tone = deltaTone(k)
                return (
                  <tr key={k.key}>
                    <td>{k.label}</td>
                    <td className="num">{fmtValue(k.a, k.unit)}</td>
                    <td className="num">{fmtValue(k.b, k.unit)}</td>
                    <td className="num" style={{ color: TONE_COLOR[tone], fontWeight: 700 }}>
                      {k.delta == null ? '—' : `${k.delta > 0 ? '+' : ''}${fmtValue(k.delta, k.unit === '%' ? 'pp' : k.unit)}`}
                      {k.deltaPct != null && k.unit !== '%' && ` (${k.deltaPct > 0 ? '+' : ''}${k.deltaPct.toFixed(1)}%)`}
                    </td>
                  </tr>
                )
              })}
              {cmp.kpis.length === 0 && (
                <tr><td colSpan={4} className="pc-empty">No KPI values to compare in these snapshots.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
