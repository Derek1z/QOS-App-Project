import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { openRealWorkspace, type RealWorkspace } from '../helpers/realWorkspace'

/** A close that arrives while an open is still running waits for it, so the
 *  user does not end up with a workspace open after closing it. */
describe('closing while a workspace is opening', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('leaves no workspace open', { timeout: 60000 }, async () => {
    const manager = await import('../../src/main/workspace/manager')
    ws = await openRealWorkspace('4G')
    const path = join(ws.dir, 'test.qosdb')
    await manager.closeWorkspace()

    const opening = manager.openWorkspace(path)
    const closing = manager.closeWorkspace() // clicked before the open finished
    await Promise.all([opening, closing])
    expect(manager.getCurrent()).toBeNull()

    // reopen so cleanup has a workspace to close
    await manager.openWorkspace(path)
    ws.conn = manager.getCurrent()!.connection
  })
})
