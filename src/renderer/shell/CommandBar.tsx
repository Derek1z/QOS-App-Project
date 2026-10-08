import { useEffect, useState } from 'react'
import { useAppStore, emit, on, type PeriodId, type Grain, type ModuleId } from '../store'
import { openWorkspaceFlow } from '../lib/flows'
import type { Technology, Rules } from '../../../shared/api'
import TargetsModal from '../modules/TargetsModal'

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: '7d', label: 'Last 7 days' },
  { id: '4w', label: 'Last 4 weeks' },
  { id: '12w', label: 'Last 12 weeks' },
  { id: 'mtd', label: 'Month to date' },
  { id: '3m', label: 'Last 3 months' }
]

const TECHS: Technology[] = ['2G', '3G', '4G']

const GRAINS: Grain[] = ['daily', 'weekly', 'monthly']

function grainLabel(g: Grain): string {
  return g === 'weekly' ? 'Week' : g.charAt(0).toUpperCase() + g.slice(1)
}

export default function CommandBar(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const period = useAppStore((s) => s.period)
  const grain = useAppStore((s) => s.grain)
  const setPeriod = useAppStore((s) => s.setPeriod)
  const setGrain = useAppStore((s) => s.setGrain)
  const [switching, setSwitching] = useState(false)
  const [rules, setRules] = useState<Rules | null>(null)
  const [targetsOpen, setTargetsOpen] = useState(false)

  useEffect(() => {
    const offTargets = on('OPEN_TARGETS_MODAL', () => setTargetsOpen(true))
    return () => offTargets()
  }, [])

  useEffect(() => {
    if (!workspace) {
      setRules(null)
      return
    }
    let alive = true
    const loadRules = async () => {
      try {
        const r = await window.api.rules.get()
        if (alive) setRules(r)
      } catch {
        if (alive) setRules(null)
      }
    }
    void loadRules()
    const off = on('RULESET_CHANGED', () => void loadRules())
    return () => {
      alive = false
      off()
    }
  }, [workspace?.path])

  async function switchTech(tech: Technology): Promise<void> {
    if (!workspace || workspace.technology === tech || switching) return
    setSwitching(true)
    try {
      // interim until the switch flow (plan Task 3): open that technology's workspace
      const path = await window.api.workspace.findRecent(tech, workspace.path)
      if (path) await openWorkspaceFlow(path)
      else useAppStore.getState().setError(`No ${tech} workspace yet — create one from the workspace menu.`)
    } catch (e) {
      useAppStore.getState().setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSwitching(false)
    }
  }

  function goTo(m: ModuleId): void {
    useAppStore.getState().setModule(m)
    emit('MODULE_CHANGED')
  }

  return (
    <header className="bar">
      <div className="bar-left">
        <span className="bar-workspace" title={workspace?.path} style={{ fontWeight: 600, fontSize: '0.95rem' }}>
          {workspace ? workspace.name : 'QoS Network Intelligence Workstation v2.0'}
          {workspace?.readOnly && <span className="badge badge-ro">READ ONLY</span>}
        </span>
      </div>
      <div className="bar-right">
        <button
          className="btn btn-ghost"
          disabled={!workspace}
          title="Open Technology Targets & Thresholds Panel"
          onClick={() => setTargetsOpen(true)}
        >
          🎯 Targets
        </button>
        <button
          className="btn btn-ghost"
          disabled={!workspace}
          title="Open Data Manager to import CSV/Excel and review quality"
          onClick={() => goTo('data-manager')}
        >
          📥 Import Data
        </button>
        <button
          className="btn btn-ghost"
          disabled={!workspace}
          title="Open Reporting Center to generate Excel, PowerPoint, PDF and HTML report packs"
          onClick={() => goTo('reports')}
        >
          📊 Export Packs
        </button>
        <button
          className="btn btn-ghost"
          title="Open Command Palette (Ctrl+K)"
          onClick={() => useAppStore.getState().setPaletteOpen(true)}
        >
          🔍 Palette
        </button>
        <span className="kbd-hint">Ctrl K</span>
      </div>
      <TargetsModal isOpen={targetsOpen} onClose={() => setTargetsOpen(false)} />
    </header>
  )
}
