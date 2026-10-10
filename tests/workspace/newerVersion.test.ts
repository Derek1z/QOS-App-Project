import { describe, it, expect, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { openRealWorkspace, setSchemaVersion, type RealWorkspace } from '../helpers/realWorkspace'

/** Versioned migrations spec §4.3 item 2, §4.4, §4.6: a workspace saved by a
 *  newer app opens read-only and is not touched. */

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')
const listBackups = (dir: string): string[] => (existsSync(join(dir, 'backups')) ? readdirSync(join(dir, 'backups')).sort() : [])

describe('a workspace saved by a newer app', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('opens read-only with the reason, and its file is not changed', { timeout: 60000 }, async () => {
    const manager = await import('../../src/main/workspace/manager')
    ws = await openRealWorkspace('4G')
    const path = join(ws.dir, 'test.qosdb')
    await setSchemaVersion(ws.conn, 8)
    await manager.closeWorkspace()
    const before = { hash: sha(path), backups: listBackups(ws.dir) }

    const info = await manager.openWorkspace(path)
    expect(info.readOnly).toBe(true)
    expect(info.readOnlyReason).toBe('newerVersion')
    ws.conn = manager.getCurrent()!.connection
    await manager.closeWorkspace()

    expect(sha(path)).toBe(before.hash)
    expect(listBackups(ws.dir)).toEqual(before.backups)

    const ro = await manager.openWorkspace(path, { readOnly: true })
    expect(ro.readOnlyReason).toBe('newerVersion')
    ws.conn = manager.getCurrent()!.connection
  })

  it('a current workspace has no read-only reason', { timeout: 60000 }, async () => {
    const manager = await import('../../src/main/workspace/manager')
    ws = await openRealWorkspace('4G')
    const info = await manager.getCurrentInfo()
    expect(info?.readOnlyReason).toBeUndefined()
  })
})
