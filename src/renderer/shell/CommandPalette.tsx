import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, emit, type PeriodId, type Grain } from '../store'
import { ALL_MODULES } from '../modules'
import { openWorkspaceFlow, createWorkspaceFlow, closeWorkspaceFlow } from '../lib/flows'

interface Cmd {
  id: string
  label: string
  keywords: string
  run: () => void
}

export default function CommandPalette(): React.JSX.Element | null {
  const open = useAppStore((s) => s.paletteOpen)
  const setOpen = useAppStore((s) => s.setPaletteOpen)
  const workspace = useAppStore((s) => s.workspace)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const commands = useMemo<Cmd[]>(() => {
    const st = useAppStore.getState()
    const cmds: Cmd[] = [
      { id: 'open', label: 'Open Workspace…', keywords: 'open locate load workspace', run: () => void openWorkspaceFlow() },
      { id: 'create', label: 'Create Workspace…', keywords: 'new create make workspace', run: () => void createWorkspaceFlow() }
    ]
    if (workspace) {
      cmds.push({ id: 'close', label: 'Close Workspace', keywords: 'close exit workspace', run: () => void closeWorkspaceFlow() })
    }
    for (const m of ALL_MODULES) {
      cmds.push({
        id: `go:${m.id}`,
        label: `Go to ${m.label}`,
        keywords: `go navigate ${m.label.toLowerCase()}`,
        run: () => {
          st.setModule(m.id)
          emit('MODULE_CHANGED')
        }
      })
    }
    const periods: Array<[string, string]> = [
      ['7d', 'Last 7 days'],
      ['4w', 'Last 4 weeks'],
      ['12w', 'Last 12 weeks'],
      ['mtd', 'Month to date'],
      ['3m', 'Last 3 months']
    ]
    for (const [id, label] of periods) {
      cmds.push({ id: `p:${id}`, label: `Period: ${label}`, keywords: `period ${label.toLowerCase()}`, run: () => { st.setPeriod(id as PeriodId); emit('PERIOD_CHANGED') } })
    }
    const grains: Array<[string, string]> = [
      ['daily', 'Daily'],
      ['weekly', 'Weekly'],
      ['monthly', 'Monthly']
    ]
    for (const [id, label] of grains) {
      cmds.push({ id: `g:${id}`, label: `Grain: ${label}`, keywords: `grain ${label.toLowerCase()}`, run: () => { st.setGrain(id as Grain); emit('GRAIN_CHANGED') } })
    }
    return cmds
  }, [workspace])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => (c.label + ' ' + c.keywords).toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  if (!open) return null

  const run = (cmd: Cmd) => {
    setOpen(false)
    cmd.run()
  }

  return (
    <div className="palette-overlay" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSel(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((s) => Math.min(s + 1, filtered.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(s - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const c = filtered[sel]
              if (c) run(c)
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
        />
        <div className="palette-list">
          {filtered.length === 0 && <div className="palette-empty">No matching commands</div>}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              className={`palette-item${i === sel ? ' selected' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => run(c)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="palette-footer">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}
