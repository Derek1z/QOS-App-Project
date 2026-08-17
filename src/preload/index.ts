import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ActionStatus, Api, CompareMetric, CompareScope, ComparisonType, CreateSnapshotOpts,
  ExplorerLevel, ForecastOpts, HealthScope, ImportProgress, InvestigationScope, MaintenanceAction,
  MappingConfig, PriorityMode, PriorityCenterOpts, ReportChartConfig, ReportOpts, ReportSectionId, ReportType, RulesPatch,
  KpiDefPatch, Technology
} from '../../shared/api'

const api: Api = {
  files: {
    path: (file) => webUtils.getPathForFile(file)
  },
  imports: {
    analyze: (paths) => ipcRenderer.invoke('import:analyze', paths),
    preview: (id: string, mapping: MappingConfig) => ipcRenderer.invoke('import:preview', id, mapping),
    run: (id: string, mapping: MappingConfig) => ipcRenderer.invoke('import:run', id, mapping),
    history: () => ipcRenderer.invoke('import:history'),
    coverage: () => ipcRenderer.invoke('import:coverage'),
    quality: () => ipcRenderer.invoke('import:quality'),
    onProgress: (cb: (p: ImportProgress) => void) => {
      const l = (_e: Electron.IpcRendererEvent, p: ImportProgress) => cb(p)
      ipcRenderer.on('import:progress', l)
      return () => ipcRenderer.removeListener('import:progress', l)
    },
    archive: () => ipcRenderer.invoke('import:archive'),
    purgeArchive: () => ipcRenderer.invoke('import:purgeArchive'),
    exportCsv: (sourcePath: string) => ipcRenderer.invoke('import:exportCsv', sourcePath)
  },
  workspace: {
    listRecent: () => ipcRenderer.invoke('workspace:listRecent'),
    pickOpen: () => ipcRenderer.invoke('workspace:pickOpen'),
    pickDirectory: () => ipcRenderer.invoke('workspace:pickDirectory'),
    create: (dir, name, technology) => ipcRenderer.invoke('workspace:create', dir, name, technology),
    open: (path, opts) => ipcRenderer.invoke('workspace:open', path, opts),
    isLocked: (path: string) => ipcRenderer.invoke('workspace:isLocked', path),
    close: () => ipcRenderer.invoke('workspace:close'),
    info: () => ipcRenderer.invoke('workspace:info'),
    setTechnology: (technology) => ipcRenderer.invoke('workspace:setTechnology', technology),
    onChanged: (cb) => {
      const listener = () => cb()
      ipcRenderer.on('workspace:changed', listener)
      return () => ipcRenderer.removeListener('workspace:changed', listener)
    },
    snapshots: () => ipcRenderer.invoke('workspace:snapshots'),
    createSnapshot: (name: string, opts?: CreateSnapshotOpts) =>
      ipcRenderer.invoke('workspace:snapshotCreate', name, opts),
    restoreSnapshot: (id: number) => ipcRenderer.invoke('workspace:snapshotRestore', id),
    removeSnapshot: (id: number) => ipcRenderer.invoke('workspace:snapshotRemove', id),
    compareSnapshots: (aId: number, bId: number) =>
      ipcRenderer.invoke('workspace:snapshotCompare', aId, bId)
  },
  maintenance: {
    run: (action: MaintenanceAction) => ipcRenderer.invoke('maintenance:run', action),
    getSchedule: () => ipcRenderer.invoke('maintenance:getSchedule'),
    setSchedule: (patch) => ipcRenderer.invoke('maintenance:setSchedule', patch),
    runScheduled: () => ipcRenderer.invoke('maintenance:runScheduled'),
    scheduleHistory: (limit?: number) => ipcRenderer.invoke('maintenance:scheduleHistory', limit)
  },
  analytics: {
    summary: () => ipcRenderer.invoke('analytics:summary'),
    ncLifecycle: () => ipcRenderer.invoke('analytics:ncLifecycle'),
    ncMovement: (limit?: number) => ipcRenderer.invoke('analytics:ncMovement', limit),
    priorityQueue: (mode: PriorityMode, limit?: number) =>
      ipcRenderer.invoke('analytics:priorityQueue', mode, limit),
    health: () => ipcRenderer.invoke('analytics:health'),
    kpiOverview: (limit?: number) => ipcRenderer.invoke('analytics:kpiOverview', limit),
    healthMatrix: (
      scope: HealthScope,
      opts?: { weeks?: number; limit?: number; sort?: 'worst' | 'name' }
    ) => ipcRenderer.invoke('analytics:healthMatrix', scope, opts),
    cellIntelligence: (opts) => ipcRenderer.invoke('analytics:cellIntelligence', opts),
    cellDetail: (cellId: number) => ipcRenderer.invoke('analytics:cellDetail', cellId),
    performance: () => ipcRenderer.invoke('analytics:performance'),
    comparison: (opts?: {
      type?: ComparisonType
      scope?: CompareScope
      metric?: CompareMetric
    }) => ipcRenderer.invoke('analytics:comparison', opts),
    explorer: (level: ExplorerLevel, parentId?: number | null, opts?: { q?: string }) =>
      ipcRenderer.invoke('analytics:explorer', level, parentId, opts),
    priorityCenter: (opts?: PriorityCenterOpts) =>
      ipcRenderer.invoke('analytics:priorityCenter', opts),
    forecast: (opts?: ForecastOpts) => ipcRenderer.invoke('analytics:forecast', opts),
    regionMap: () => ipcRenderer.invoke('analytics:regionMap'),
    regionDistricts: (regionId: number) => ipcRenderer.invoke('analytics:regionDistricts', regionId)
  },
  rules: {
    get: () => ipcRenderer.invoke('rules:get'),
    update: (patch: RulesPatch) => ipcRenderer.invoke('rules:update', patch)
  },
  kpis: {
    list: (technology?: Technology) => ipcRenderer.invoke('kpis:list', technology),
    save: (patch: KpiDefPatch) => ipcRenderer.invoke('kpis:save', patch),
    remove: (kpiId: number) => ipcRenderer.invoke('kpis:remove', kpiId),
    discover: (headers: string[], technology?: Technology) =>
      ipcRenderer.invoke('kpis:discover', headers, technology),
    seed: (technology?: Technology) => ipcRenderer.invoke('kpis:seed', technology)
  },
  investigation: {
    search: (scope: InvestigationScope, q?: string) => ipcRenderer.invoke('investigation:search', scope, q),
    get: (scope: InvestigationScope, entityId: number, opts?: { interventionWeek?: string }) =>
      ipcRenderer.invoke('investigation:get', scope, entityId, opts),
    setStatus: (
      scope: InvestigationScope,
      entityId: number,
      patch: {
        status?: ActionStatus | null
        owner?: string | null
        externalTicket?: string | null
        targetReviewDate?: string | null
      }
    ) => ipcRenderer.invoke('investigation:setStatus', scope, entityId, patch),
    addNote: (scope: InvestigationScope, entityId: number, note: string) =>
      ipcRenderer.invoke('investigation:addNote', scope, entityId, note),
    exportReport: (scope: InvestigationScope, entityId: number) =>
      ipcRenderer.invoke('investigation:exportReport', scope, entityId)
  },
  reports: {
    generate: (opts?: ReportOpts) => ipcRenderer.invoke('reports:generate', opts),
    definitions: () => ipcRenderer.invoke('reports:definitions'),
    saveDefinition: (
      name: string,
      type: ReportType,
      sections: ReportSectionId[],
      schedule?: string | null,
      charts?: ReportChartConfig
    ) => ipcRenderer.invoke('reports:saveDefinition', name, type, sections, schedule ?? null, charts),
    due: () => ipcRenderer.invoke('reports:due'),
    history: () => ipcRenderer.invoke('reports:history'),
    reveal: (path: string) => ipcRenderer.invoke('reports:reveal', path)
  },
  appState: {
    get: () => ipcRenderer.invoke('appState:get'),
    set: (patch) => ipcRenderer.invoke('appState:set', patch)
  }
}

contextBridge.exposeInMainWorld('api', api)
