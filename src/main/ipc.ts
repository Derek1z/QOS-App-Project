import { ipcMain, dialog, type BrowserWindow } from 'electron'
import * as ws from './workspace/manager'
import * as appState from './services/appState'
import {
  getSummary, getNcLifecycle, getNcMovement, getPriorityQueue, getHealth, getHealthMatrix,
  getCellIntelligence, getCellDetail, getPerformance, getComparison, getExplorer,
  getPriorityCenter, getForecast, getRulesCurrent, updateRulesCurrent,
  getRegionMap, getRegionDistricts, getKpiOverview
} from './services/queryService'
import {
  searchEntities, getInvestigation, setInvestigationStatus, addInvestigationNote,
  exportInvestigationReport
} from './services/investigationService'
import {
  generateReportPack, listReportDefinitions, saveReportDefinition,
  listReportHistory, checkDueReports, revealReport
} from './services/reportingService'
import type {
  ActionStatus, CompareMetric, CompareScope, ComparisonType, ExplorerLevel, ForecastOpts,
  Grain, HealthScope, InvestigationScope, Lifecycle, PeriodId, PriorityMode, PriorityCenterOpts, ReportOpts,
  ReportChartConfig, ReportSectionId, ReportType, RulesPatch, Severity, Trend
} from '../../shared/api'
import { dirs } from './paths'
import {
  analyzeFiles, previewImport, runImport, geoStats, importHistory, importCoverage, importQuality,
  rawArchive, purgeRawArchive, isImportBusy
} from './import/importer'
import { isExcelPath, excelToCsvFile } from './import/excel'
import {
  createSnapshot, listSnapshots, restoreSnapshot, removeSnapshot, compareSnapshots
} from './services/snapshotService'
import { runMaintenance } from './services/maintenanceService'
import {
  getSchedule, setSchedule, runScheduled, scheduleHistory, maybeRunScheduled
} from './services/maintenanceScheduler'
import {
  seedCurrent, listCurrent, saveCurrent, removeCurrent, discoverCurrent
} from './services/kpiService'
import { lockPath } from './workspace/lock'
import { existsSync, readFileSync } from 'node:fs'
import type {
  CreateSnapshotOpts, MaintenanceAction, MappingConfig, KpiDefPatch, Technology
} from '../../shared/api'

export const WORKSPACE_CHANGED = 'workspace:changed'

export function broadcastWorkspaceChanged(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) win.webContents.send(WORKSPACE_CHANGED)
}

export function registerIpc(win: () => BrowserWindow | null): void {
  ipcMain.handle('workspace:listRecent', () => appState.load().recentWorkspaces)

  ipcMain.handle('workspace:isLocked', (_e, path: string) => {
    const lp = lockPath(path)
    if (!existsSync(lp)) return { locked: false }
    let pid = NaN
    try {
      pid = parseInt(readFileSync(lp, 'utf8'), 10)
    } catch {
      /* unreadable -> treat as unlocked */
    }
    if (!Number.isFinite(pid) || pid === process.pid) return { locked: false }
    try {
      process.kill(pid, 0)
      return { locked: true, pid }
    } catch {
      return { locked: false } // stale lock from a dead process
    }
  })

  ipcMain.handle('workspace:pickOpen', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Open 2G/3G/4G QoS Workspace',
      properties: ['openFile'],
      filters: [{ name: 'QoS Workspaces', extensions: ['qosdb'] }],
      defaultPath: appState.load().lastWorkspaceDir ?? dirs.workspaces
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('workspace:pickDirectory', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose Folder for New Workspace',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: appState.load().lastWorkspaceDir ?? dirs.workspaces
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('workspace:create', (_e, dir: string, name: string, technology?: string) => ws.createWorkspace(dir, name, technology))
  ipcMain.handle('workspace:open', async (_e, path: string, opts?: { readOnly?: boolean }) => {
    const info = await ws.openWorkspace(path, opts)
    if (!opts?.readOnly) {
      // spec §9: expired raw copies are purged whenever a workspace opens writable
      void purgeRawArchive().catch(() => undefined)
      // §58: run a due scheduled-maintenance pass on open (settings-gated)
      void maybeRunScheduled().catch(() => undefined)
    }
    return info
  })
  ipcMain.handle('workspace:close', () => ws.closeWorkspace())
  ipcMain.handle('workspace:info', () => ws.getCurrentInfo())
  ipcMain.handle('workspace:setTechnology', (_e, technology: Technology) =>
    ws.setWorkspaceTechnology(technology))

  ipcMain.handle('kpis:list', (_e, technology?: Technology) => listCurrent(technology))
  ipcMain.handle('kpis:save', (_e, patch: KpiDefPatch) => saveCurrent(patch))
  ipcMain.handle('kpis:remove', (_e, kpiId: number) => removeCurrent(kpiId))
  ipcMain.handle('kpis:discover', (_e, headers: string[], technology?: Technology) =>
    discoverCurrent(headers, technology))
  ipcMain.handle('kpis:seed', (_e, technology?: Technology) => seedCurrent(technology))

  ipcMain.handle('analytics:summary', (_e, opts?: { period?: string; grain?: string }) =>
    getSummary(opts as { period?: PeriodId; grain?: Grain } | undefined))
  ipcMain.handle('analytics:ncLifecycle', () => getNcLifecycle())
  ipcMain.handle('analytics:ncMovement', (_e, limit?: number) => getNcMovement(limit))
  ipcMain.handle('analytics:priorityQueue', (_e, mode: PriorityMode, limit?: number) =>
    getPriorityQueue(mode, limit)
  )
  ipcMain.handle('analytics:health', (_e, grain?: string) =>
    getHealth((grain as Grain) ?? 'weekly'))
  ipcMain.handle('analytics:kpiOverview', (_e, limit?: number) => getKpiOverview(limit))
  ipcMain.handle(
    'analytics:healthMatrix',
    (_e, scope: HealthScope, opts?: { weeks?: number; limit?: number; sort?: 'worst' | 'name' }) =>
      getHealthMatrix(scope, opts)
  )
  ipcMain.handle(
    'analytics:cellIntelligence',
    (_e, opts?: {
      search?: string
      lifecycle?: Lifecycle | ''
      trend?: Trend | ''
      severity?: Severity | ''
      minPriority?: number
      limit?: number
      offset?: number
    }) => getCellIntelligence(opts)
  )
  ipcMain.handle('analytics:cellDetail', (_e, cellId: number) => getCellDetail(cellId))
  ipcMain.handle('analytics:performance', () => getPerformance())
  ipcMain.handle(
    'analytics:comparison',
    (_e, opts?: { type?: ComparisonType; scope?: CompareScope; metric?: CompareMetric }) =>
      getComparison(opts)
  )
  ipcMain.handle(
    'analytics:explorer',
    (_e, level: ExplorerLevel, parentId?: number | null, opts?: { q?: string }) =>
      getExplorer(level, parentId ?? null, opts)
  )
  ipcMain.handle('analytics:priorityCenter', (_e, opts?: PriorityCenterOpts) => getPriorityCenter(opts))
  ipcMain.handle('analytics:forecast', (_e, opts?: ForecastOpts) => getForecast(opts))
  ipcMain.handle('analytics:regionMap', () => getRegionMap())
  ipcMain.handle('analytics:regionDistricts', (_e, regionId: number) => getRegionDistricts(regionId))

  ipcMain.handle('investigation:search', (_e, scope: InvestigationScope, q?: string) => searchEntities(scope, q))
  ipcMain.handle(
    'investigation:get',
    (_e, scope: InvestigationScope, entityId: number, opts?: { interventionWeek?: string }) =>
      getInvestigation(scope, entityId, opts)
  )
  ipcMain.handle(
    'investigation:setStatus',
    (_e, scope: InvestigationScope, entityId: number, patch: {
      status?: ActionStatus | null
      owner?: string | null
      externalTicket?: string | null
      targetReviewDate?: string | null
    }) => setInvestigationStatus(scope, entityId, patch)
  )
  ipcMain.handle('investigation:addNote', (_e, scope: InvestigationScope, entityId: number, note: string) =>
    addInvestigationNote(scope, entityId, note)
  )
  ipcMain.handle('investigation:exportReport', (_e, scope: InvestigationScope, entityId: number) =>
    exportInvestigationReport(scope, entityId)
  )

  ipcMain.handle('reports:generate', (_e, opts?: ReportOpts) => generateReportPack(opts))
  ipcMain.handle('reports:definitions', () => listReportDefinitions())
  ipcMain.handle('reports:saveDefinition', (_e, name: string, type: ReportType, sections: ReportSectionId[], schedule?: string | null, charts?: unknown) =>
    saveReportDefinition(name, type, sections, schedule ?? null, charts as ReportChartConfig)
  )
  ipcMain.handle('reports:history', () => listReportHistory())
  ipcMain.handle('reports:due', () => checkDueReports())
  ipcMain.handle('reports:reveal', (_e, path: string) => revealReport(path))

  ipcMain.handle('rules:get', () => getRulesCurrent())
  ipcMain.handle('rules:update', (_e, patch: RulesPatch) => updateRulesCurrent(patch))

  ipcMain.handle('appState:get', () => appState.load())
  ipcMain.handle('appState:set', (_e, patch: Partial<appState.AppState>) => appState.patch(patch))

  ipcMain.handle('import:analyze', (_e, paths: string[]) =>
    analyzeFiles(paths, (p) => {
      const w = win()
      if (w && !w.isDestroyed()) w.webContents.send('import:progress', p)
    })
  )
  ipcMain.handle('import:preview', (_e, id: string, mapping: MappingConfig) => previewImport(id, mapping))
  ipcMain.handle('import:run', (_e, id: string, mapping: MappingConfig) =>
    runImport(id, mapping, {
      onProgress: (p) => {
        const w = win()
        if (w && !w.isDestroyed()) w.webContents.send('import:progress', p)
      }
    }).then((res) => {
      // the worker mutated the workspace on its own connection; the main handle
      // was reopened by runImport, so tell every view to refresh
      broadcastWorkspaceChanged(win())
      return res
    })
  )
  ipcMain.handle('import:history', () => importHistory())
  ipcMain.handle('import:coverage', () => importCoverage())
  ipcMain.handle('import:quality', () => importQuality())
  ipcMain.handle('import:archive', () => rawArchive())
  ipcMain.handle('import:purgeArchive', () => purgeRawArchive())

  ipcMain.handle('import:geoStats', (_e, id: string, mapping: MappingConfig) =>
    geoStats(id, mapping))
  ipcMain.handle('import:exportCsv', async (_e, sourcePath: string) => {
    if (!isExcelPath(sourcePath)) throw new Error('Not an Excel workbook: ' + sourcePath)
    if (!existsSync(sourcePath)) throw new Error('File no longer exists: ' + sourcePath)
    const res = await dialog.showSaveDialog({
      title: 'Export workbook as CSV',
      defaultPath: sourcePath.replace(/\.(xlsx|xls)$/i, '') + '.csv',
      filters: [{ name: 'CSV files', extensions: ['csv'] }]
    })
    if (res.canceled || !res.filePath) return null
    await excelToCsvFile(sourcePath, res.filePath)
    return { path: res.filePath }
  })

  ipcMain.handle('workspace:snapshots', () => listSnapshots())
  ipcMain.handle('workspace:snapshotCreate', (_e, name: string, opts?: CreateSnapshotOpts) =>
    createSnapshot(name, opts)
  )
  ipcMain.handle('workspace:snapshotRestore', (_e, id: number) => restoreSnapshot(id))
  ipcMain.handle('workspace:snapshotRemove', (_e, id: number) => removeSnapshot(id))
  ipcMain.handle('workspace:snapshotCompare', (_e, aId: number, bId: number) =>
    compareSnapshots(aId, bId)
  )

  ipcMain.handle('maintenance:run', (_e, action: MaintenanceAction) => runMaintenance(action))
  ipcMain.handle('maintenance:getSchedule', () => getSchedule())
  ipcMain.handle('maintenance:setSchedule', (_e, patch) => setSchedule(patch))
  ipcMain.handle('maintenance:runScheduled', () => runScheduled())
  ipcMain.handle('maintenance:scheduleHistory', (_e, limit?: number) => scheduleHistory(limit))
  void win
}
