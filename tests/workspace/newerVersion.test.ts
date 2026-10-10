import { describe, it, expect, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { DuckDBInstance } from '@duckdb/node-api'
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

  it('is not rewritten even when a write-ahead log sits next to it (review 3)', { timeout: 60000 }, async () => {
    const manager = await import('../../src/main/workspace/manager')
    ws = await openRealWorkspace('4G')
    const path = join(ws.dir, 'test.qosdb')
    await manager.closeWorkspace()
    // a newer app that crashed (or a copy taken while open) leaves a .wal behind
    const inst = await DuckDBInstance.create(path)
    const c = await inst.connect()
    await c.run(`PRAGMA disable_checkpoint_on_shutdown`)
    await c.run(`UPDATE workspace_meta SET value = '8' WHERE key = 'schema_version'`)
    c.closeSync()
    inst.closeSync()
    expect(existsSync(`${path}.wal`)).toBe(true)
    const before = { db: sha(path), wal: sha(`${path}.wal`) }

    const info = await manager.openWorkspace(path)
    expect(info.readOnlyReason).toBe('newerVersion')
    ws.conn = manager.getCurrent()!.connection
    await manager.closeWorkspace()

    expect(sha(path)).toBe(before.db)
    expect(existsSync(`${path}.wal`)).toBe(true)
    expect(sha(`${path}.wal`)).toBe(before.wal)
    await manager.openWorkspace(path, { readOnly: true }) // for cleanup
    ws.conn = manager.getCurrent()!.connection
  })

  it("an upgrade a newer app left unfinished also counts as newer (review 1)", { timeout: 60000 }, async () => {
    const manager = await import('../../src/main/workspace/manager')
    ws = await openRealWorkspace('4G')
    const path = join(ws.dir, 'test.qosdb')
    for (const [key, value] of [['upgrading_to', '8'], ['recompute_pending', '8']] as const) {
      await ws.conn.run(`DELETE FROM workspace_meta WHERE key IN ('upgrading_to', 'recompute_pending')`)
      await ws.conn.run(`INSERT INTO workspace_meta (key, value) VALUES (?, ?)`, [key, value])
      await manager.closeWorkspace()
      const info = await manager.openWorkspace(path)
      ws.conn = manager.getCurrent()!.connection
      expect(info.readOnlyReason, key).toBe('newerVersion')
      await manager.closeWorkspace()
      await manager.openWorkspace(path, { readOnly: true })
      ws.conn = manager.getCurrent()!.connection
      // reset through a raw writable handle for the next round
      await manager.closeWorkspace()
      const inst = await DuckDBInstance.create(path)
      const c = await inst.connect()
      await c.run(`DELETE FROM workspace_meta WHERE key IN ('upgrading_to', 'recompute_pending')`)
      c.closeSync()
      inst.closeSync()
      await manager.openWorkspace(path)
      ws.conn = manager.getCurrent()!.connection
    }
  })

  it('a current workspace has no read-only reason', { timeout: 60000 }, async () => {
    const manager = await import('../../src/main/workspace/manager')
    ws = await openRealWorkspace('4G')
    const info = await manager.getCurrentInfo()
    expect(info?.readOnlyReason).toBeUndefined()
  })
})
