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
import SimulationLab from './modules/SimulationLab'
import NetworkExplorer from './modules/NetworkExplorer'
import InvestigationWorkspace from './modules/InvestigationWorkspace'
import PriorityCenter from './modules/PriorityCenter'
import Forecasting from './modules/Forecasting'
import ReportingCenter from './modules/ReportingCenter'
import KpiDefinitions from './modules/KpiDefinitions'
import CellCompareModal from './components/CellCompareModal'

export default function App(): React.JSX.Element {
  const module = useAppStore((s) => s.module)
  const setModule = useAppStore((s) => s.setModule)
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
        ) : module === 'simulation-lab' || module === 'forecasting' ? (
          <div className="module" style={{ padding: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
            <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem', maxWidth: '520px' }}>
              <span style={{ fontSize: '3rem', marginBottom: '1rem', display: 'block' }}>🔒</span>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text)' }}>
                {module === 'forecasting' ? 'Forecasting & Early Warning' : 'Simulation Lab'} Temporarily Locked
              </h2>
              <p className="card-note" style={{ maxWidth: '440px', margin: '0.5rem auto 1.5rem', lineHeight: '1.5' }}>
                This module is undergoing temporary maintenance while multi-technology 2G/3G/4G validation algorithms are being updated. Access will be restored upon completion.
              </p>
              <button className="btn btn-primary" onClick={() => setModule('overview')}>
                Return to Executive Overview
              </button>
            </div>
          </div>
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
