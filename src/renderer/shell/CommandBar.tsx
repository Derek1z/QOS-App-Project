import { useEffect, useState } from 'react'
import { useAppStore, emit, on, type PeriodId, type Grain, type ModuleId } from '../store'
import type { Technology, Rules } from '../../../shared/api'

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
      const w = await window.api.workspace.setTechnology(tech)
      useAppStore.getState().setWorkspace(w)
      const s = await window.api.analytics.summary()
      useAppStore.getState().setSummary(s)
      emit('WORKSPACE_CHANGED')
      emit('RULESET_CHANGED')
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
        <span className="bar-workspace" title={workspace?.path}>
          {workspace ? workspace.name : 'No workspace'}
          {workspace?.readOnly && <span className="badge badge-ro">READ ONLY</span>}
        </span>
        <div className="seg tech-seg" title="Switch technology — analysis uses that technology's imported KPI columns">
          {TECHS.map((t) => (
            <button
              key={t}
              className={`seg-btn${workspace?.technology === t ? ' active' : ''}`}
              disabled={!workspace || workspace.readOnly || switching}
              onClick={() => void switchTech(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <select
          className="sel"
          value={period}
          disabled={!workspace}
          onChange={(e) => {
            setPeriod(e.target.value as PeriodId)
            emit('PERIOD_CHANGED')
          }}
        >
          {PERIODS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <div className="seg">
          {GRAINS.map((g) => (
            <button
              key={g}
              className={`seg-btn${grain === g ? ' active' : ''}`}
              disabled={!workspace}
              onClick={() => {
                setGrain(g)
                emit('GRAIN_CHANGED')
              }}
            >
              {grainLabel(g)}
            </button>
          ))}
        </div>
      </div>
      <div className="bar-right">
        {rules && (
          <>
            <button
              className="btn btn-ghost"
              title={`Active ruleset v${rules.version}: PRB utilization threshold is ${rules.prbThresholdPct}%. Click to view in Workspace.`}
              onClick={() => goTo('workspace')}
            >
              PRB ≥ {rules.prbThresholdPct}%
            </button>
            <button
              className="btn btn-ghost"
              title={`Active ruleset v${rules.version}: Weekly NC requires breach on ≥ ${rules.weeklyBreachDays} distinct day(s). Click to view in Workspace.`}
              onClick={() => goTo('workspace')}
            >
              Breach ≥ {rules.weeklyBreachDays}d
            </button>
          </>
        )}
        <button
          className="btn btn-ghost"
          disabled={!workspace}
          title="Open Comparison Lab to benchmark periods and regions"
          onClick={() => goTo('comparison-lab')}
        >
          Compare
        </button>
        <button
          className="btn btn-ghost"
          disabled={!workspace}
          title="Open Data Manager to import CSV/Excel and review quality"
          onClick={() => goTo('data-manager')}
        >
          Import
        </button>
        <button
          className="btn btn-ghost"
          disabled={!workspace}
          title="Open Reporting Center to generate Excel, PowerPoint, PDF and HTML report packs"
          onClick={() => goTo('reports')}
        >
          Export
        </button>
        <button
          className="btn btn-ghost"
          title="Open Command Palette (Ctrl+K)"
          onClick={() => useAppStore.getState().setPaletteOpen(true)}
        >
          Palette
        </button>
        <span className="kbd-hint">Ctrl K</span>
      </div>
    </header>
  )
}
