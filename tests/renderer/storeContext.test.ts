import { describe, it, expect } from 'vitest'
import { useAppStore } from '../../src/renderer/store'
import type { Technology, WorkspaceInfo } from '../../shared/api'

describe('Universal Context Store', () => {
  it('initializes with default technology and context', () => {
    const store = useAppStore.getState()
    expect(store.technologyId).toBeDefined()
    expect(store.grain).toBeDefined()
  })

  it('technology follows the open workspace and resets primary context when it changes', () => {
    const ws = (technology: Technology): WorkspaceInfo =>
      ({ path: `/w/${technology}.qosdb`, name: technology, technology, readOnly: false } as unknown as WorkspaceInfo)
    useAppStore.getState().setWorkspace(ws('3G'))
    useAppStore.getState().setPrimaryKpiId(7)
    expect(useAppStore.getState().technologyId).toBe(3)
    expect(useAppStore.getState().primaryKpiId).toBe(7)

    useAppStore.getState().setWorkspace(ws('2G'))
    expect(useAppStore.getState().technologyId).toBe(2)
    expect(useAppStore.getState().selectedTech).toBe('2G')
    expect(useAppStore.getState().primaryKpiId).toBeNull()
  })

  it('updates primaryKpiId and grain', () => {
    useAppStore.getState().setPrimaryKpiId(101)
    expect(useAppStore.getState().primaryKpiId).toBe(101)

    useAppStore.getState().setGrain('weekly')
    expect(useAppStore.getState().grain).toBe('weekly')
  })
})
