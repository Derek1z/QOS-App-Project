import { create } from 'zustand'
import type { WorkspaceInfo, Summary, RecentWorkspace, Technology } from '../../shared/api'

export type CreateWorkspaceChoice = { name: string; tech: Technology }

export type ModuleId =
  | 'overview'
  | 'explorer'
  | 'cell-intelligence'
  | 'performance'
  | 'nc-intelligence'
  | 'health-matrix'
  | 'comparison-lab'
  | 'investigation'
  | 'priority-center'
  | 'forecasting'
  | 'reports'
  | 'data-manager'
  | 'workspace'
  | 'kpi-definitions'

export type PeriodId = '7d' | '4w' | '12w' | 'mtd' | '3m'
export type Grain = 'daily' | 'weekly' | 'monthly'

interface AppStore {
  module: ModuleId
  workspace: WorkspaceInfo | null
  summary: Summary | null
  recent: RecentWorkspace[]
  period: PeriodId
  grain: Grain
  paletteOpen: boolean
  busy: boolean
  error: string | null
  investigationTarget: { scope: 'cell' | 'site' | 'district'; id: number; name: string; path: string[] } | null
  setModule(m: ModuleId): void
  setWorkspace(w: WorkspaceInfo | null): void
  setSummary(s: Summary | null): void
  setRecent(r: RecentWorkspace[]): void
  setPeriod(p: PeriodId): void
  setGrain(g: Grain): void
  setPaletteOpen(v: boolean): void
  setBusy(v: boolean): void
  setError(e: string | null): void
  setInvestigationTarget(t: { scope: 'cell' | 'site' | 'district'; id: number; name: string; path: string[] } | null): void
  createPrompt: { defaultName: string; defaultTech?: Technology; resolve: (c: CreateWorkspaceChoice | null) => void } | null
  openCreatePrompt(defaultName: string, defaultTech: Technology | undefined, resolve: (c: CreateWorkspaceChoice | null) => void): void
  answerCreatePrompt(c: CreateWorkspaceChoice | null): void
}

export const useAppStore = create<AppStore>((set) => ({
  module: 'overview',
  workspace: null,
  summary: null,
  recent: [],
  period: '4w',
  grain: 'weekly',
  paletteOpen: false,
  busy: false,
  error: null,
  investigationTarget: null,
  setModule: (module) => set({ module }),
  setWorkspace: (workspace) => set({ workspace }),
  setSummary: (summary) => set({ summary }),
  setRecent: (recent) => set({ recent }),
  setPeriod: (period) => set({ period }),
  setGrain: (grain) => set({ grain }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  setInvestigationTarget: (investigationTarget) => set({ investigationTarget }),
  createPrompt: null,
  openCreatePrompt: (defaultName, defaultTech, resolve) =>
    set({ createPrompt: { defaultName, defaultTech, resolve } }),
  answerCreatePrompt: (c) => {
    set((s) => {
      s.createPrompt?.resolve(c)
      return { createPrompt: null }
    })
  }
}))

// --- event bus (spec §72): modules coordinate via events, not tight coupling ---
export type BusEvent =
  | 'FILTER_CHANGED'
  | 'PERIOD_CHANGED'
  | 'GRAIN_CHANGED'
  | 'MODULE_CHANGED'
  | 'WORKSPACE_CHANGED'
  | 'RULESET_CHANGED'
  | 'IMPORT_COMPLETE'

const bus = new EventTarget()

export function emit(type: BusEvent, detail?: unknown): void {
  bus.dispatchEvent(new CustomEvent(type, { detail }))
}

export function on(type: BusEvent, cb: () => void): () => void {
  const fn = () => cb()
  bus.addEventListener(type, fn)
  return () => bus.removeEventListener(type, fn)
}
