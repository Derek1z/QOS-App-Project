import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api, ImportProgress, ForecastStatus } from '../../shared/api'

/** Request/response wrapper for one IPC channel. It forwards every argument:
 *  TypeScript accepts a wrapper that declares fewer parameters than the Api
 *  contract, which is how the technology/grain arguments of regionMap,
 *  regionDistricts, cellDetail and ncMovement were silently dropped. */
const call = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: Api = {
  files: {
    path: (file) => webUtils.getPathForFile(file)
  },
  imports: {
    analyze: call('import:analyze'),
    preview: call('import:preview'),
    run: call('import:run'),
    history: call('import:history'),
    coverage: call('import:coverage'),
    quality: call('import:quality'),
    onProgress: (cb: (p: ImportProgress) => void) => {
      const l = (_e: Electron.IpcRendererEvent, p: ImportProgress) => cb(p)
      ipcRenderer.on('import:progress', l)
      return () => ipcRenderer.removeListener('import:progress', l)
    },
    archive: call('import:archive'),
    purgeArchive: call('import:purgeArchive'),
    exportCsv: call('import:exportCsv'),
    geoStats: call('import:geoStats'),
    inspectExcel: call('import:inspect-excel')
  },
  workspace: {
    listRecent: call('workspace:listRecent'),
    pickOpen: call('workspace:pickOpen'),
    pickDirectory: call('workspace:pickDirectory'),
    create: call('workspace:create'),
    open: call('workspace:open'),
    isLocked: call('workspace:isLocked'),
    close: call('workspace:close'),
    info: call('workspace:info'),
    setTechnology: call('workspace:setTechnology'),
    onChanged: (cb) => {
      const listener = () => cb()
      ipcRenderer.on('workspace:changed', listener)
      return () => ipcRenderer.removeListener('workspace:changed', listener)
    },
    snapshots: call('workspace:snapshots'),
    createSnapshot: call('workspace:snapshotCreate'),
    restoreSnapshot: call('workspace:snapshotRestore'),
    removeSnapshot: call('workspace:snapshotRemove'),
    compareSnapshots: call('workspace:snapshotCompare')
  },
  maintenance: {
    run: call('maintenance:run'),
    getSchedule: call('maintenance:getSchedule'),
    setSchedule: call('maintenance:setSchedule'),
    runScheduled: call('maintenance:runScheduled'),
    scheduleHistory: call('maintenance:scheduleHistory')
  },
  analytics: {
    summary: call('analytics:summary'),
    ncLifecycle: call('analytics:ncLifecycle'),
    ncMovement: call('analytics:ncMovement'),
    priorityQueue: call('analytics:priorityQueue'),
    health: call('analytics:health'),
    kpiOverview: call('analytics:kpiOverview'),
    healthMatrix: call('analytics:healthMatrix'),
    cellIntelligence: call('analytics:cellIntelligence'),
    cellDetail: call('analytics:cellDetail'),
    performance: call('analytics:performance'),
    comparison: call('analytics:comparison'),
    explorer: call('analytics:explorer'),
    priorityCenter: call('analytics:priorityCenter'),
    forecast: call('analytics:forecast'),
    forecastStatus: call('forecast:status'),
    onForecastProgress: (cb: (s: ForecastStatus) => void) => {
      const l = (_e: Electron.IpcRendererEvent, s: ForecastStatus) => cb(s)
      ipcRenderer.on('forecast:progress', l)
      return () => ipcRenderer.removeListener('forecast:progress', l)
    },
    executiveOverview: call('analytics:executiveOverview'),
    regionMap: call('analytics:regionMap'),
    regionDistricts: call('analytics:regionDistricts')
  },
  synthetic: {
    generate: call('synthetic:generate')
  },
  rules: {
    get: call('rules:get'),
    update: call('rules:update')
  },
  kpis: {
    list: call('kpis:list'),
    save: call('kpis:save'),
    saveTargets: call('kpis:saveTargets'),
    remove: call('kpis:remove'),
    discover: call('kpis:discover'),
    seed: call('kpis:seed'),
    resetDefaults: call('kpis:resetDefaults')
  },
  derived: {
    list: call('derived:list'),
    save: call('derived:save'),
    detect: call('derived:detect')
  },
  investigation: {
    search: call('investigation:search'),
    get: call('investigation:get'),
    setStatus: call('investigation:setStatus'),
    addNote: call('investigation:addNote'),
    exportReport: call('investigation:exportReport')
  },
  reports: {
    generate: call('reports:generate'),
    definitions: call('reports:definitions'),
    saveDefinition: call('reports:saveDefinition'),
    due: call('reports:due'),
    history: call('reports:history'),
    reveal: call('reports:reveal')
  },
  appState: {
    get: call('appState:get'),
    set: call('appState:set')
  }
}

contextBridge.exposeInMainWorld('api', api)
