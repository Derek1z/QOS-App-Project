import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openRealWorkspace, type RealWorkspace } from '../helpers/realWorkspace'
import { lockPath } from '../../src/main/workspace/lock'

/** Final review finding 6: opening a workspace that another instance holds
 *  fails without closing the one that is open (a tech tab is one click). */
describe('opening a workspace locked by another instance', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('keeps the current workspace open', { timeout: 60000 }, async () => {
    const manager = await import('../../src/main/workspace/manager')
    ws = await openRealWorkspace('4G')
    const a = join(ws.dir, 'test.qosdb')
    const b = (await manager.createWorkspace(ws.dir, 'other', '3G')).path
    await manager.closeWorkspace()
    await manager.openWorkspace(a)
    // the parent process is alive and is not us: a live foreign lock
    writeFileSync(lockPath(b), String(process.ppid))
    await expect(manager.openWorkspace(b)).rejects.toThrow(/another instance/)
    expect(manager.getCurrent()?.path).toBe(a)
    ws.conn = manager.getCurrent()!.connection
  })
})
