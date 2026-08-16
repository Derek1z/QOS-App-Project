import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useAppStore } from '../store'
import type {
  ActionStatus, InvestigationScope, PriorityBand, PriorityCenterRow,
  PriorityCenterResult
} from '../../../shared/api'

const STATUSES: ActionStatus[] = [
  'Unreviewed',
  'Investigating',
  'Escalated',
  'Optimization in progress',
  'Monitoring',
  'Resolved',
  'Deferred'
]
const BANDS: PriorityBand[] = ['Critical', 'High', 'Medium', 'Watch', 'Low']

const bandTone = (b: PriorityBand | null): string =>
  b === 'Critical' ? 'bad' : b === 'High' ? 'warn' : b === 'Medium' ? 'ok' : 'dim'

function statusTone(s: ActionStatus | null): string {
  switch (s) {
    case 'Unreviewed': return 'dim'
    case 'Investigating': return 'warn'
    case 'Escalated': return 'bad'
    case 'Optimization in progress': return 'ok'
    case 'Monitoring': return 'ok'
    case 'Resolved': return 'ok'
    case 'Deferred': return 'dim'
    default: return 'dim'
  }
}

function Chip({ text, tone }: { text: string; tone: string }): ReactElement {
  return <span className={`chip chip-${tone}`}>{text}</span>
}

function fmtScore(s: number | null): string {
  return s == null ? '—' : String(Math.round(s))
}

export default function PriorityCenter(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const setModule = useAppStore((s) => s.setModule)
  const setInvestigationTarget = useAppStore((s) => s.setInvestigationTarget)

  const [scope, setScope] = useState<InvestigationScope>('cell')
  const [status, setStatus] = useState<ActionStatus | 'unset' | ''>('')
  const [band, setBand] = useState<PriorityBand | ''>('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'priority' | 'due' | 'name'>('priority')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [result, setResult] = useState<PriorityCenterResult | null>(null)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkMsg, setBulkMsg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const PAGE = 100

  const load = useCallback(
    async (ofs: number): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const r = await window.api.analytics.priorityCenter({
          scope,
          status: status || undefined,
          band: band || undefined,
          search: search.trim() || undefined,
          sort,
          overdueOnly,
          limit: PAGE,
          offset: ofs
        })
        setResult(r)
        setOffset(ofs)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [scope, status, band, search, sort, overdueOnly]
  )

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      void load(0)
    }, search === '' ? 0 : 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [load, search])

  useEffect(() => {
    setSelected(new Set())
  }, [scope, status, band, sort, overdueOnly])

  const rows = useMemo(() => result?.rows ?? [], [result])
  const total = result?.total ?? 0
  const byStatus = result?.byStatus ?? {}
  const overdue = result?.overdue ?? 0

  function toggle(id: number): void {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function applyBulk(): Promise<void> {
    if (!bulkStatus || selected.size === 0) return
    const newStatus = bulkStatus === '__unset' ? null : (bulkStatus as ActionStatus)
    for (const id of selected) {
      const row = rows.find((r) => r.id === id)
      if (!row) continue
      await window.api.investigation.setStatus(row.scope, row.id, {
        status: newStatus,
        owner: newStatus == null ? null : row.owner,
        externalTicket: newStatus == null ? null : row.externalTicket,
        targetReviewDate: newStatus == null ? null : row.targetReviewDate
      })
    }
    setBulkMsg(`${selected.size} row${selected.size === 1 ? '' : 's'} updated → ${newStatus ?? 'Unset'}`)
    setSelected(new Set())
    await load(offset)
  }

  function openInvestigation(row: PriorityCenterRow): void {
    setInvestigationTarget({ scope: row.scope, id: row.id, name: row.name, path: row.path })
    setModule('investigation')
  }

  const selCount = selected.size
  const allShownSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))

  return (
    <div className="module">
      <div className="module-head">
        <h2>Priority Center</h2>
        <span className="module-workspace">{workspace?.name}</span>
        <span className="module-workspace">{total.toLocaleString()} entities · {overdue} overdue</span>
      </div>

      {/* controls */}
      <div className="row-actions filter-row">
        <div className="seg">
          {(['cell', 'site', 'district'] as InvestigationScope[]).map((s) => (
            <button
              key={s}
              className={`seg-btn${scope === s ? ' active' : ''}`}
              onClick={() => setScope(s)}
            >
              {s === 'cell' ? 'Cells' : s === 'site' ? 'Sites' : 'Districts'}
            </button>
          ))}
        </div>
        <input
          className="input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder="Search name, site, district, region…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ActionStatus | 'unset' | '')}>
          <option value="">All statuses</option>
          <option value="unset">Unset</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="input" value={band} onChange={(e) => setBand(e.target.value as PriorityBand | '')}>
          <option value="">All bands</option>
          {BANDS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as 'priority' | 'due' | 'name')}>
          <option value="priority">Sort: priority</option>
          <option value="due">Sort: due date</option>
          <option value="name">Sort: name</option>
        </select>
        <label className="pc-toggle" title="Only rows past their target review date">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          Overdue only
        </label>
      </div>

      {error && <div className="status-error">{error}</div>}
      {loading && <div className="status-dim">Loading…</div>}

      {/* status rollup */}
      <div className="pc-rollup">
        <span className="pc-rollup-total">{total.toLocaleString()} matching</span>
        <button
          className={`pc-rollup-chip${status === 'unset' ? ' active' : ''}`}
          onClick={() => setStatus(status === 'unset' ? '' : 'unset')}
        >
          Unset {byStatus['unset'] ?? 0}
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            className={`pc-rollup-chip${status === s ? ' active' : ''}`}
            onClick={() => setStatus(status === s ? '' : s)}
          >
            {s} {byStatus[s] ?? 0}
          </button>
        ))}
        <span className={`pc-overdue${overdue > 0 ? ' has' : ''}`}>⚠ {overdue} overdue</span>
      </div>

      {/* bulk bar */}
      <div className="pc-bulk">
        <label className="pc-toggle">
          <input
            type="checkbox"
            checked={allShownSelected}
            onChange={(e) => {
              const next = new Set(selected)
              if (e.target.checked) rows.forEach((r) => next.add(r.id))
              else rows.forEach((r) => next.delete(r.id))
              setSelected(next)
            }}
          />
          {selCount > 0 ? `${selCount} selected` : 'Select shown'}
        </label>
        <select className="input" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
          <option value="">Bulk set status…</option>
          <option value="__unset">Unset (clear)</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button className="btn" disabled={!bulkStatus || selCount === 0} onClick={() => void applyBulk()}>
          Apply
        </button>
        {bulkMsg && <span className="pc-bulk-msg">{bulkMsg}</span>}
      </div>

      {/* queue table */}
      <div className="card">
        <div className="table-wrap">
          <table className="data-table pc-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Priority</th>
                <th>Entity</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Ticket</th>
                <th>Review due</th>
                <th className="num">NC</th>
                <th className="num">Cells</th>
                <th className="num">PRB</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const overdueRow = r.overdue
                return (
                  <tr
                    key={`${r.scope}-${r.id}`}
                    className="pc-row"
                    onClick={() => toggle(r.id)}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td>
                      <span className={`pc-score${r.priorityScore == null ? ' none' : r.priorityScore >= 75 ? ' hot' : r.priorityScore >= 50 ? ' mid' : ''}`}>
                        {fmtScore(r.priorityScore)}
                      </span>{' '}
                      <Chip text={r.priorityBand ?? '—'} tone={bandTone(r.priorityBand)} />
                    </td>
                    <td>
                      <div className="pc-name">{r.name}</div>
                      <div className="pc-path">{r.path.slice(0, -1).join(' › ')}</div>
                    </td>
                    <td><Chip text={r.status ?? 'Unset'} tone={statusTone(r.status)} /></td>
                    <td className="pc-owner">{r.owner ?? '—'}</td>
                    <td className="pc-owner">{r.externalTicket ?? '—'}</td>
                    <td className={overdueRow ? 'pc-due overdue' : 'pc-due'}>
                      {r.targetReviewDate ? r.targetReviewDate.slice(0, 10) : '—'}
                      {overdueRow && <span className="pc-flag"> overdue</span>}
                    </td>
                    <td className="num">{r.ncCells}</td>
                    <td className="num">{r.cells}</td>
                    <td className="num">{r.prbAvg == null ? '—' : `${r.prbAvg.toFixed(0)}%`}</td>
                    <td>
                      <button
                        className="btn btn-sm"
                        title="Open in Investigation Workspace"
                        onClick={(e) => {
                          e.stopPropagation()
                          openInvestigation(r)
                        }}
                      >
                        →
                      </button>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="pc-empty">
                    No entities match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pc-footer">
          <span>
            Showing {rows.length > 0 ? offset + 1 : 0}–{offset + rows.length} of {total.toLocaleString()}
          </span>
          {offset + rows.length < total && (
            <button className="btn btn-sm" onClick={() => void load(offset + rows.length)}>
              Show more
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
