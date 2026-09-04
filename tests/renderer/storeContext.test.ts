import { describe, it, expect } from 'vitest'
import { useAppStore } from '../../src/renderer/store'

describe('Universal Context Store', () => {
  it('initializes with default technology and context', () => {
    const store = useAppStore.getState()
    expect(store.technologyId).toBeDefined()
    expect(store.grain).toBeDefined()
  })

  it('updates technologyId and resets primary context when changed', () => {
    useAppStore.getState().setTechnologyId(3) // 3G
    expect(useAppStore.getState().technologyId).toBe(3)
    
    useAppStore.getState().setTechnologyId(2) // 2G
    expect(useAppStore.getState().technologyId).toBe(2)
  })

  it('updates primaryKpiId and grain', () => {
    useAppStore.getState().setPrimaryKpiId(101)
    expect(useAppStore.getState().primaryKpiId).toBe(101)

    useAppStore.getState().setGrain('weekly')
    expect(useAppStore.getState().grain).toBe('weekly')
  })
})
