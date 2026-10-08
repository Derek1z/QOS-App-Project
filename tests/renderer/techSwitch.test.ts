import { describe, it, expect, vi, afterEach } from 'vitest'
import { planTechSwitch } from '../../src/renderer/lib/techSwitch'
import { useAppStore } from '../../src/renderer/store'
import type { Technology, WorkspaceInfo } from '../../shared/api'

/** The 2G/3G/4G buttons move between workspaces (spec §4.2). */

describe('planTechSwitch', () => {
  const cur = { technology: '4G' as Technology, path: '/w/4g.qosdb' }
  it('does nothing for the open workspace\'s technology', () => {
    expect(planTechSwitch('4G', cur, '/w/other-4g.qosdb')).toEqual({ kind: 'none' })
  })
  it('opens the most recent workspace of another technology', () => {
    expect(planTechSwitch('3G', cur, '/w/3g.qosdb')).toEqual({ kind: 'open', path: '/w/3g.qosdb' })
  })
  it('offers to create one when there is none', () => {
    expect(planTechSwitch('3G', cur, null)).toEqual({ kind: 'offerCreate', technology: '3G' })
  })
  it('with no workspace open, opens or offers', () => {
    expect(planTechSwitch('2G', null, '/w/2g.qosdb')).toEqual({ kind: 'open', path: '/w/2g.qosdb' })
    expect(planTechSwitch('2G', null, null)).toEqual({ kind: 'offerCreate', technology: '2G' })
  })
})

const info = (technology: Technology, path: string): WorkspaceInfo =>
  ({ path, name: path, technology, readOnly: false } as unknown as WorkspaceInfo)

/** window.api with just what the switch touches; `opened` records opens. */
function stubApi(found: string | null, confirmAnswer: boolean): { opened: string[]; created: unknown[][] } {
  const opened: string[] = []
  const created: unknown[][] = []
  let currentInfo: WorkspaceInfo | null = useAppStore.getState().workspace
  vi.stubGlobal('window', {
    confirm: () => confirmAnswer,
    api: {
      workspace: {
        findRecent: async () => found,
        open: async (p: string) => {
          opened.push(p)
          currentInfo = info('3G', p)
          return currentInfo
        },
        info: async () => currentInfo,
        pickDirectory: async () => null,
        create: async (...a: unknown[]) => { created.push(a) }
      },
      analytics: { summary: async () => null },
      appState: { get: async () => ({ recentWorkspaces: [] }) }
    }
  })
  return { opened, created }
}

describe('store technology setters switch workspaces', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a cancelled switch leaves the open workspace\'s technology selected (Review Focus 1)', async () => {
    useAppStore.getState().setWorkspace(info('4G', '/w/4g.qosdb'))
    const api = stubApi(null, false)
    const changed = await useAppStore.getState().setSelectedTech('3G')
    expect(changed).toBe(false)
    expect(useAppStore.getState().selectedTech).toBe('4G')
    expect(useAppStore.getState().technologyId).toBe(4)
    expect(api.opened).toEqual([])
  })

  it('opens the other technology\'s workspace when one exists', async () => {
    useAppStore.getState().setWorkspace(info('4G', '/w/4g.qosdb'))
    const api = stubApi('/w/3g.qosdb', false)
    const changed = await useAppStore.getState().setTechnologyId(3)
    expect(changed).toBe(true)
    expect(api.opened).toEqual(['/w/3g.qosdb'])
    expect(useAppStore.getState().workspace?.path).toBe('/w/3g.qosdb')
    expect(useAppStore.getState().selectedTech).toBe('3G')
  })

  it('a second click while a switch is running does not open twice (final review 1)', async () => {
    useAppStore.getState().setWorkspace(info('4G', '/w/4g.qosdb'))
    const api = stubApi('/w/3g.qosdb', false)
    const [first, second] = await Promise.all([
      useAppStore.getState().setSelectedTech('3G'),
      useAppStore.getState().setSelectedTech('3G')
    ])
    expect(api.opened).toEqual(['/w/3g.qosdb'])
    expect([first, second].filter(Boolean).length).toBe(1)
  })

  it('a switch that lands on another technology reports no switch (final review 7)', async () => {
    useAppStore.getState().setWorkspace(info('4G', '/w/4g.qosdb'))
    stubApi('/w/2g-really-3g.qosdb', false) // the stub opens everything as 3G
    expect(await useAppStore.getState().setSelectedTech('2G')).toBe(false)
    expect(useAppStore.getState().error).toMatch(/3G/)
  })

  it('the open workspace\'s technology does nothing', async () => {
    useAppStore.getState().setWorkspace(info('4G', '/w/4g.qosdb'))
    const api = stubApi('/w/other.qosdb', true)
    expect(await useAppStore.getState().setSelectedTech('4G')).toBe(false)
    expect(api.opened).toEqual([])
  })
})
