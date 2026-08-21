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
  | 'simulation-lab'
  | 'investigation'
  | 'priority-center'
  | 'forecasting'
  | 'reports'
  | 'data-manager'
  | 'workspace'
  | 'kpi-definitions'

export interface PinnedItem {
  id: string
  type: 'cell' | 'district' | 'kpi'
  name: string
  detail?: string
}

function loadPinned(): PinnedItem[] {
  try {
    const raw = localStorage.getItem('qos_pinned_watchlist')
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

import type { PeriodId, Grain } from '../../shared/api'

export type { PeriodId, Grain } from '../../shared/api'

interface AppStore {
  module: ModuleId
  workspace: WorkspaceInfo | null
  selectedTech: Technology
  summary: Summary | null
  recent: RecentWorkspace[]
  period: PeriodId
  grain: Grain
  paletteOpen: boolean
  busy: boolean
  error: string | null
  pinned: PinnedItem[]
  compareCellIds: [number, number] | null
  investigationTarget: { scope: 'cell' | 'site' | 'district' | 'region'; id: number; name: string; path: string[] } | null
  setModule(m: ModuleId): void
  setWorkspace(w: WorkspaceInfo | null): void
  setSelectedTech(t: Technology): void
  setSummary(s: Summary | null): void
  setRecent(r: RecentWorkspace[]): void
  setPeriod(p: PeriodId): void
  setGrain(g: Grain): void
  setPaletteOpen(v: boolean): void
  setBusy(v: boolean): void
  setError(e: string | null): void
  togglePin(item: PinnedItem): void
  isPinned(id: string): boolean
  setCompareCellIds(ids: [number, number] | null): void
  setInvestigationTarget(t: { scope: 'cell' | 'site' | 'district' | 'region'; id: number; name: string; path: string[] } | null): void
  createPrompt: { defaultName: string; defaultTech?: Technology; resolve: (c: CreateWorkspaceChoice | null) => void } | null
  openCreatePrompt(defaultName: string, defaultTech: Technology | undefined, resolve: (c: CreateWorkspaceChoice | null) => void): void
  answerCreatePrompt(c: CreateWorkspaceChoice | null): void
}

export const useAppStore = create<AppStore>((set, get) => ({
  module: 'overview',
  workspace: null,
  selectedTech: '4G',
  summary: null,
  recent: [],
  period: '4w',
  grain: 'weekly',
  paletteOpen: false,
  busy: false,
  error: null,
  pinned: loadPinned(),
  compareCellIds: null,
  investigationTarget: null,
  setModule: (module) => set({ module }),
  setWorkspace: (workspace) => set({ workspace, selectedTech: workspace?.technology ?? '4G' }),
  setSelectedTech: (selectedTech) => set({ selectedTech }),
  setSummary: (summary) => set({ summary }),
  setRecent: (recent) => set({ recent }),
  setPeriod: (period) => set({ period }),
  setGrain: (grain) => set({ grain }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  togglePin: (item) => {
    set((state) => {
      const exists = state.pinned.some((p) => p.id === item.id)
      const next = exists ? state.pinned.filter((p) => p.id !== item.id) : [...state.pinned, item]
      try {
        localStorage.setItem('qos_pinned_watchlist', JSON.stringify(next))
      } catch {}
      return { pinned: next }
    })
  },
  isPinned: (id) => get().pinned.some((p) => p.id === id),
  setCompareCellIds: (compareCellIds) => set({ compareCellIds }),
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
  | 'TECH_CHANGED'
  | 'MODULE_CHANGED'
  | 'WORKSPACE_CHANGED'
  | 'RULESET_CHANGED'
  | 'IMPORT_COMPLETE'
  | 'KPIDEFS_CHANGED'
  | 'OPEN_TARGETS_MODAL'

const bus = new EventTarget()

export function emit(type: BusEvent, detail?: unknown): void {
  bus.dispatchEvent(new CustomEvent(type, { detail }))
}

export function on(type: BusEvent, cb: () => void): () => void {
  const fn = () => cb()
  bus.addEventListener(type, fn)
  return () => bus.removeEventListener(type, fn)
}
