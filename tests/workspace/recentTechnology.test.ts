import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, type RealWorkspace } from '../helpers/realWorkspace'
import { findRecentWorkspace } from '../../src/main/services/appState'
import type { RecentWorkspace } from '../../shared/api'

/** Fixed workspace technology (spec §4.1, §4.3): recent workspaces remember
 *  their technology, and the switch finds the most recent existing one. */
const r = (path: string, technology?: RecentWorkspace['technology']): RecentWorkspace =>
  ({ path, name: path, lastOpened: '2026-10-08T00:00:00Z', ...(technology ? { technology } : {}) })

describe('most recent workspace of a technology', () => {
  const recent = [r('/w/4g-a.qosdb', '4G'), r('/w/3g-old-format.qosdb'), r('/w/3g-gone.qosdb', '3G'), r('/w/3g-b.qosdb', '3G'), r('/w/3g-c.qosdb', '3G')]
  const exists = (p: string): boolean => p !== '/w/3g-gone.qosdb'

  it('picks the most recent existing one, skipping missing files and entries without a technology (Review Focus 2)', () => {
    expect(findRecentWorkspace('3G', '/w/4g-a.qosdb', recent, exists)).toBe('/w/3g-b.qosdb')
  })
  it('skips the open workspace', () => {
    expect(findRecentWorkspace('3G', '/w/3g-b.qosdb', recent, exists)).toBe('/w/3g-c.qosdb')
  })
  it('returns null when none matches', () => {
    expect(findRecentWorkspace('2G', undefined, recent, exists)).toBeNull()
  })
})

describe('recent workspaces record their technology', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('creating and reopening a workspace records its technology', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    const appState = await import('../../src/main/services/appState')
    const mgr = await import('../../src/main/workspace/manager')
    const path = mgr.getCurrent()!.path
    expect(appState.load().recentWorkspaces.find((x) => x.path === path)?.technology).toBe('3G')
    await mgr.closeWorkspace()
    await mgr.openWorkspace(path)
    ws.conn = mgr.getCurrent()!.connection
    expect(appState.load().recentWorkspaces[0]).toMatchObject({ path, technology: '3G' })
  })

  it('the technology setter no longer exists', async () => {
    const mgr = await import('../../src/main/workspace/manager')
    expect((mgr as Record<string, unknown>).setWorkspaceTechnology).toBeUndefined()
  })
})
