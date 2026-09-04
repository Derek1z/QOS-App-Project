import { useEffect } from 'react'
import { useAppStore } from './store'
import { refreshWorkspaceState } from './lib/flows'
import Nav from './shell/Nav'
import CommandBar from './shell/CommandBar'
import CommandPalette from './shell/CommandPalette'
import StatusBar from './shell/StatusBar'
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
import ReportingCenter from './modules/ReportingCenter'
import KpiDefinitions from './modules/KpiDefinitions'
import CellCompareModal from './components/CellCompareModal'

export default function App(): React.JSX.Element {
  const module = useAppStore((s) => s.module)
  const workspace = useAppStore((s) => s.workspace)

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
      <CellCompareModal />
    </div>
  )
}
