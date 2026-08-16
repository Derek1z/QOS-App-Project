import { useEffect, useState } from 'react'
import { useAppStore } from './store'
import { refreshWorkspaceState } from './lib/flows'
import Nav from './shell/Nav'
import CommandBar from './shell/CommandBar'
import CommandPalette from './shell/CommandPalette'
import StatusBar from './shell/StatusBar'
import type { DueReport } from '../../shared/api'
import Overview from './modules/Overview'
import WorkspaceModule from './modules/WorkspaceModule'
import ModulePlaceholder from './modules/ModulePlaceholder'
import Welcome from './modules/Welcome'
import CreateWorkspaceModal from './modules/CreateWorkspaceModal'
import DataManager from './modules/DataManager'
import NcIntelligence from './modules/NcIntelligence'
import HealthMatrix from './modules/HealthMatrix'
import CellIntelligence from './modules/CellIntelligence'
import PerformanceAnalysis from './modules/PerformanceAnalysis'
import ComparisonLab from './modules/ComparisonLab'
import NetworkExplorer from './modules/NetworkExplorer'
import InvestigationWorkspace from './modules/InvestigationWorkspace'
import PriorityCenter from './modules/PriorityCenter'
import Forecasting from './modules/Forecasting'
import ReportingCenter from './modules/ReportingCenter'
import KpiDefinitions from './modules/KpiDefinitions'

export default function App(): React.JSX.Element {
  const module = useAppStore((s) => s.module)
  const workspace = useAppStore((s) => s.workspace)
  const [due, setDue] = useState<DueReport[]>([])
  const [dueHidden, setDueHidden] = useState(false)

  // due-report check on open (spec §56): schedules are app-local; surface
  // definitions whose next run is due and offer generation
  useEffect(() => {
    if (!workspace) {
      setDue([])
      setDueHidden(false)
      return
    }
    let alive = true
    void window.api.reports
      .due()
      .then((d) => {
        if (alive) setDue(d)
      })
      .catch(() => {
        if (alive) setDue([])
      })
    return () => {
      alive = false
    }
  }, [workspace?.path, workspace?.readOnly])

  async function generateDue(d: DueReport): Promise<void> {
    try {
      await window.api.reports.generate({ definitionId: d.definitionId })
      setDue(await window.api.reports.due())
    } catch {
      /* keep the banner so the user can retry */
    }
  }

  useEffect(() => {
    void refreshWorkspaceState()
    const off = window.api.workspace.onChanged(() => void refreshWorkspaceState())
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const st = useAppStore.getState()
        st.setPaletteOpen(!st.paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      off()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div className="app">
      <Nav />
      <CommandBar />
      <main className="main">
        {workspace && due.length > 0 && !dueHidden && (
          <div className="notice rc-due-banner">
            <div className="rc-due-head">
              <span className="rc-due-title">
                📋 {due.length} due report{due.length > 1 ? 's' : ''} — app-local schedule (spec §56)
              </span>
              <button className="btn btn-sm" onClick={() => setDueHidden(true)}>
                Dismiss
              </button>
            </div>
            {due.map((d) => (
              <div key={d.definitionId} className="rc-due-row">
                <span className="rc-due-name">{d.name}</span>
                <span className="rc-due-meta">
                  {d.type} · {d.schedule}
                  {d.overdueDays > 0 ? ` · overdue ${d.overdueDays}d (due ${d.nextDue})` : ` · due ${d.nextDue}`}
                </span>
                <button className="btn btn-sm" onClick={() => void generateDue(d)}>
                  Generate now
                </button>
              </div>
            ))}
          </div>
        )}
        {!workspace ? (
          <Welcome />
        ) : module === 'overview' ? (
          <Overview />
        ) : module === 'workspace' ? (
          <WorkspaceModule />
        ) : module === 'data-manager' ? (
          <DataManager />
        ) : module === 'nc-intelligence' ? (
          <NcIntelligence />
        ) : module === 'health-matrix' ? (
          <HealthMatrix />
        ) : module === 'cell-intelligence' ? (
          <CellIntelligence />
        ) : module === 'performance' ? (
          <PerformanceAnalysis />
        ) : module === 'comparison-lab' ? (
          <ComparisonLab />
        ) : module === 'explorer' ? (
          <NetworkExplorer />
        ) : module === 'investigation' ? (
          <InvestigationWorkspace />
        ) : module === 'priority-center' ? (
          <PriorityCenter />
        ) : module === 'forecasting' ? (
          <Forecasting />
        ) : module === 'reports' ? (
          <ReportingCenter />
        ) : module === 'kpi-definitions' ? (
          <KpiDefinitions />
        ) : (
          <ModulePlaceholder />
        )}
      </main>
      <StatusBar />
      <CommandPalette />
      <CreateWorkspaceModal />
    </div>
  )
}
