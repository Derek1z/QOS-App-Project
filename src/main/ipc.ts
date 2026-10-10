import { ipcMain, dialog, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { assertTrustedSender } from './security'
import * as ws from './workspace/manager'
import * as appState from './services/appState'
import {
  getSummary, getNcLifecycle, getNcMovement, getPriorityQueue, getHealth, getHealthMatrix,
  getCellIntelligence, getCellDetail, getPerformance, getComparison, getExplorer,
  getPriorityCenter, getRulesCurrent, updateRulesCurrent,
  getRegionMap, getRegionDistricts, getKpiOverview, getExecutiveOverview
} from './services/queryService'
import { generateSyntheticMultiTechData } from './services/syntheticGenerator'
import { getForecast } from './services/forecastService'
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
  ReportChartConfig, ReportSectionId, ReportType, RulesPatch, Severity, Trend, SyntheticDataConfig
} from '../../shared/api'
import { dirs } from './paths'
import {
  analyzeFiles, previewImport, runImport, geoStats, importHistory, importCoverage, importQuality,
  rawArchive, purgeRawArchive, isImportBusy
} from './import/importer'
import { isExcelPath, excelToCsvFile } from './import/excel'
import { inspectExcelSheets } from './import/excelSheetParser'
import {
  createSnapshot, listSnapshots, restoreSnapshot, removeSnapshot, compareSnapshots
} from './services/snapshotService'
import { runMaintenance } from './services/maintenanceService'
import {
  getSchedule, setSchedule, runScheduled, scheduleHistory, maybeRunScheduled
} from './services/maintenanceScheduler'
import {
  seedCurrent, listCurrent, removeCurrent, discoverCurrent
} from './services/kpiService'
import { saveKpiTargetsCurrent, resetKpiTargetsCurrent } from './services/targetService'
import { scheduleForecastRefresh, forecastStatus, onForecastProgress } from './forecast/scheduler'
import {
  listDerivedKpis, saveDerivedKpi, detectDerivedKpiSuggestions
} from './services/derivedKpiService'
import { lockedByOther } from './workspace/lock'
import { existsSync } from 'node:fs'
import type {
  CreateSnapshotOpts, MaintenanceAction, MappingConfig, KpiDefPatch, Technology, DerivedKPI
} from '../../shared/api'

export const WORKSPACE_CHANGED = 'workspace:changed'

export function broadcastWorkspaceChanged(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) win.webContents.send(WORKSPACE_CHANGED)
}

/** A change that can alter which forecasts are stored (targets, restore,
 *  rebuild): queue the background recompute and pass the result through. */
function afterForecastInput<T>(result: T): T {
  scheduleForecastRefresh()
  return result
}

/** Every channel is registered through here (Electron hardening spec §4.1):
 *  a call is answered only when it comes from the main frame of the app page. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handle(channel: string, fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    assertTrustedSender(e, channel)
    return fn(e, ...args)
  })
}

export function registerIpc(win: () => BrowserWindow | null): void {
  handle('workspace:listRecent', () => appState.load().recentWorkspaces)

  handle('workspace:isLocked', (_e, path: string) => lockedByOther(path))

  handle('workspace:pickOpen', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Open 2G/3G/4G QoS Workspace',
      properties: ['openFile'],
      filters: [{ name: 'QoS Workspaces', extensions: ['qosdb'] }],
      defaultPath: appState.load().lastWorkspaceDir ?? dirs.workspaces
    })
    return res.canceled ? null : res.filePaths[0]
  })

  handle('workspace:pickDirectory', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose Folder for New Workspace',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: appState.load().lastWorkspaceDir ?? dirs.workspaces
    })
    return res.canceled ? null : res.filePaths[0]
  })

  handle('workspace:create', async (_e, dir: string, name: string, technology?: string) => {
    const info = await ws.createWorkspace(dir, name, technology)
    scheduleForecastRefresh()
    return info
  })
  handle('workspace:open', async (_e, path: string, opts?: { readOnly?: boolean }) => {
    const info = await ws.openWorkspace(path, opts)
    if (!opts?.readOnly) {
      // spec §9: expired raw copies are purged whenever a workspace opens writable
      void purgeRawArchive().catch(() => undefined)
      // §58: run a due scheduled-maintenance pass on open (settings-gated)
      void maybeRunScheduled().catch(() => undefined)
      // stored forecasts: build them for old workspaces, redo an unfinished run
      scheduleForecastRefresh()
    }
    return info
  })
  handle('workspace:close', () => ws.closeWorkspace())
  handle('workspace:info', () => ws.getCurrentInfo())
  handle('workspace:findRecent', (_e, technology: Technology, excludePath?: string) =>
    appState.findRecentWorkspace(technology, excludePath, appState.load().recentWorkspaces, existsSync))

  handle('kpis:list', (_e, technology?: Technology) => listCurrent(technology))
  handle('kpis:save', async (_e, patch: KpiDefPatch) => afterForecastInput((await saveKpiTargetsCurrent([patch]))[0]))
  handle('kpis:saveTargets', (_e, patches: KpiDefPatch[]) => saveKpiTargetsCurrent(patches).then(afterForecastInput))
  handle('kpis:remove', (_e, kpiId: number) => removeCurrent(kpiId))
  handle('kpis:discover', (_e, headers: string[], technology?: Technology) =>
    discoverCurrent(headers, technology))
  handle('kpis:seed', (_e, technology?: Technology) => seedCurrent(technology))
  handle('kpis:resetDefaults', (_e, technology?: Technology) => resetKpiTargetsCurrent(technology).then(afterForecastInput))

  handle('derived:list', (_e, technology?: Technology) => {
    const w = ws.getCurrent()
    if (!w) return []
    return listDerivedKpis(w.connection, technology)
  })
  handle('derived:save', (_e, def: DerivedKPI) => {
    const w = ws.getCurrent()
    if (!w) throw new Error('No workspace is open')
    return saveDerivedKpi(w.connection, def)
  })
  handle('derived:detect', (_e, headers: string[], technology?: Technology) =>
    detectDerivedKpiSuggestions(headers, technology))

  handle('analytics:summary', (_e, opts?: { period?: string; grain?: string }) =>
    getSummary(opts as { period?: PeriodId; grain?: Grain } | undefined))
  handle('analytics:executiveOverview', (_e, opts?: { period?: PeriodId; grain?: Grain }) => getExecutiveOverview(opts))
  handle('synthetic:generate', (_e, config?: SyntheticDataConfig) => generateSyntheticMultiTechData(config))
  handle('analytics:ncLifecycle', (_e, grain?: string) => getNcLifecycle((grain as Grain) ?? 'weekly'))
  handle('analytics:ncMovement', (_e, limit?: number, grain?: string, technology?: Technology) =>
    getNcMovement(limit, (grain as Grain) ?? 'weekly', technology)
  )
  handle('analytics:priorityQueue', (_e, mode: PriorityMode, limit?: number) =>
    getPriorityQueue(mode, limit)
  )
  handle('analytics:health', (_e, grain?: string) =>
    getHealth((grain as Grain) ?? 'weekly'))
  handle('analytics:kpiOverview', (_e, limit?: number, grain?: string) => getKpiOverview(limit, (grain as Grain) ?? 'weekly'))
  handle(
    'analytics:healthMatrix',
    (_e, scope: HealthScope, opts?: { weeks?: number; limit?: number; sort?: 'worst' | 'name' }) =>
      getHealthMatrix(scope, opts)
  )
  handle(
    'analytics:cellIntelligence',
    (_e, opts?: {
      search?: string
      lifecycle?: Lifecycle | ''
      trend?: Trend | ''
      severity?: Severity | ''
      minPriority?: number
      limit?: number
      offset?: number
      technology?: Technology
    }) => getCellIntelligence(opts)
  )
  handle('analytics:cellDetail', (_e, cellId: number, grain?: Grain, technology?: Technology) =>
    getCellDetail(cellId, grain, technology)
  )
  handle('analytics:performance', (_e, opts?: { grain?: Grain; period?: PeriodId; technology?: Technology }) => getPerformance(opts))
  handle(
    'analytics:comparison',
    (_e, opts?: { type?: ComparisonType; scope?: CompareScope; metric?: CompareMetric; grain?: Grain; period?: PeriodId; technology?: Technology }) =>
      getComparison(opts)
  )
  handle(
    'analytics:explorer',
    (_e, level: ExplorerLevel, parentId?: number | null, opts?: { q?: string }) =>
      getExplorer(level, parentId ?? null, opts)
  )
  handle('analytics:priorityCenter', (_e, opts?: PriorityCenterOpts) => getPriorityCenter(opts))
  handle('analytics:forecast', (_e, opts?: ForecastOpts) => getForecast(opts))
  handle('forecast:status', () => forecastStatus())
  // background recompute progress, at most one event per 250 ms (plus the last)
  let lastSent = 0
  let trailing: ReturnType<typeof setTimeout> | null = null
  onForecastProgress((s) => {
    const send = (): void => {
      lastSent = Date.now()
      const w = win()
      if (w && !w.isDestroyed()) w.webContents.send('forecast:progress', forecastStatus())
    }
    if (trailing) clearTimeout(trailing)
    if (!s.running || Date.now() - lastSent >= 250) send()
    else trailing = setTimeout(send, 250)
  })
  handle('analytics:regionMap', (_e, technology?: Technology, grain?: Grain, period?: PeriodId) =>
    getRegionMap(technology, grain, period)
  )
  handle('analytics:regionDistricts', (_e, regionId: number, technology?: Technology, grain?: Grain, period?: PeriodId) =>
    getRegionDistricts(regionId, technology, grain, period)
  )

  handle('investigation:search', (_e, scope: InvestigationScope, q?: string, technology?: Technology) =>
    searchEntities(scope, q, technology)
  )
  handle(
    'investigation:get',
    (_e, scope: InvestigationScope, entityId: number, opts?: { interventionWeek?: string; grain?: Grain; period?: PeriodId; technology?: Technology }) =>
      getInvestigation(scope, entityId, opts)
  )
  handle(
    'investigation:setStatus',
    (_e, scope: InvestigationScope, entityId: number, patch: {
      status?: ActionStatus | null
      owner?: string | null
      externalTicket?: string | null
      targetReviewDate?: string | null
    }) => setInvestigationStatus(scope, entityId, patch)
  )
  handle('investigation:addNote', (_e, scope: InvestigationScope, entityId: number, note: string) =>
    addInvestigationNote(scope, entityId, note)
  )
  handle('investigation:exportReport', (_e, scope: InvestigationScope, entityId: number) =>
    exportInvestigationReport(scope, entityId)
  )

  handle('reports:generate', (_e, opts?: ReportOpts) => generateReportPack(opts))
  handle('reports:definitions', () => listReportDefinitions())
  handle('reports:saveDefinition', (_e, name: string, type: ReportType, sections: ReportSectionId[], schedule?: string | null, charts?: unknown) =>
    saveReportDefinition(name, type, sections, schedule ?? null, charts as ReportChartConfig)
  )
  handle('reports:history', () => listReportHistory())
  handle('reports:due', () => checkDueReports())
  handle('reports:reveal', (_e, path: string) => revealReport(path))

  handle('rules:get', () => getRulesCurrent())
  handle('rules:update', (_e, patch: RulesPatch) => updateRulesCurrent(patch))

  handle('appState:get', () => appState.load())
  handle('appState:set', (_e, patch: Partial<appState.AppState>) => appState.patch(patch))

  handle('import:analyze', (_e, paths: string[]) =>
    analyzeFiles(paths, (p) => {
      const w = win()
      if (w && !w.isDestroyed()) w.webContents.send('import:progress', p)
    })
  )
  handle('import:preview', (_e, id: string, mapping: MappingConfig) => previewImport(id, mapping))
  handle('import:run', (_e, id: string, mapping: MappingConfig) =>
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
  handle('import:history', () => importHistory())
  handle('import:coverage', () => importCoverage())
  handle('import:quality', () => importQuality())
  handle('import:archive', () => rawArchive())
  handle('import:purgeArchive', () => purgeRawArchive())

  handle('import:inspect-excel', (_e, filePath: string) => inspectExcelSheets(filePath))
  handle('import:geoStats', (_e, id: string, mapping: MappingConfig) =>
    geoStats(id, mapping))
  handle('import:exportCsv', async (_e, sourcePath: string) => {
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

  handle('workspace:snapshots', () => listSnapshots())
  handle('workspace:snapshotCreate', (_e, name: string, opts?: CreateSnapshotOpts) =>
    createSnapshot(name, opts)
  )
  handle('workspace:snapshotRestore', (_e, id: number) => restoreSnapshot(id).then(afterForecastInput))
  handle('workspace:snapshotRemove', (_e, id: number) => removeSnapshot(id))
  handle('workspace:snapshotCompare', (_e, aId: number, bId: number) =>
    compareSnapshots(aId, bId)
  )

  handle('maintenance:run', (_e, action: MaintenanceAction) => runMaintenance(action))
  handle('maintenance:getSchedule', () => getSchedule())
  handle('maintenance:setSchedule', (_e, patch) => setSchedule(patch))
  handle('maintenance:runScheduled', () => runScheduled())
  handle('maintenance:scheduleHistory', (_e, limit?: number) => scheduleHistory(limit))
  void win
}
