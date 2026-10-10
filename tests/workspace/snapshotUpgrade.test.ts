import { describe, it, expect, afterEach } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { openRealWorkspace, type RealWorkspace } from '../helpers/realWorkspace'

/** Versioned migrations plan, Review Focus 5 (final review 7): restoring a
 *  snapshot taken by an older app upgrades it on the reopen. */
describe('restoring an older snapshot', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('brings it to the latest version, after a pre-upgrade backup', { timeout: 90000 }, async () => {
    const manager = await import('../../src/main/workspace/manager')
    const snapshots = await import('../../src/main/services/snapshotService')
    ws = await openRealWorkspace('4G')
    const snap = await snapshots.createSnapshot('before')
    // make the snapshot file look like an older app's (schema version 0)
    const inst = await DuckDBInstance.create(snap.path)
    const c = await inst.connect()
    await c.run(`UPDATE workspace_meta SET value = '1.0.0' WHERE key = 'schema_version'`)
    c.closeSync()
    inst.closeSync()

    await snapshots.restoreSnapshot(snap.snapshotId)
    ws.conn = manager.getCurrent()!.connection
    const v = (await ws.conn.runAndReadAll(`SELECT value FROM workspace_meta WHERE key = 'schema_version'`)).getRowObjects()[0]?.value
    expect(String(v)).toBe('7')
    const backups = join(ws.dir, 'backups')
    expect(existsSync(backups) ? readdirSync(backups).filter((f) => /^pre-upgrade-test-v7-/.test(f)) : []).toHaveLength(1)
  })
})
