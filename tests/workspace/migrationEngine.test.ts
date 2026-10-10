import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import { parseSchemaVersion, readSchemaVersion, runMigrations, runReadOnlyShims, type Migration } from '../../src/main/workspace/migrations'

/** Versioned migrations spec §4.2–§4.4: the engine, driven by injected lists. */

let instance: DuckDBInstance
let conn: DuckDBConnection

beforeEach(async () => {
  instance = await DuckDBInstance.create(':memory:')
  conn = await instance.connect()
  await conn.run(`CREATE TABLE workspace_meta (key VARCHAR PRIMARY KEY, value VARCHAR)`)
})
afterEach(() => {
  conn.closeSync()
  instance.closeSync()
})

const meta = async (key: string): Promise<string | null> => {
  const v = (await conn.runAndReadAll(`SELECT value FROM workspace_meta WHERE key = ?`, [key])).getRowObjects()[0]?.value
  return v == null ? null : String(v)
}

/** Steps 1..n that log their version; `asks` lists those returning true. */
function steps(n: number, log: number[], asks: number[] = [], extra: Partial<Record<number, Partial<Migration>>> = {}): Migration[] {
  return Array.from({ length: n }, (_, i) => {
    const version = i + 1
    return {
      version,
      name: `step ${version}`,
      up: async () => {
        log.push(version)
        return asks.includes(version)
      },
      ...extra[version]
    }
  })
}

const opts = (calls: { backup: number; recompute: number }, over: { backup?: () => Promise<string>; recompute?: () => Promise<void> } = {}) => ({
  backup: over.backup ?? (async () => { calls.backup++; return '/b/test-before-v9.qosdb' }),
  recompute: over.recompute ?? (async () => { calls.recompute++ })
})

describe('parseSchemaVersion', () => {
  it('reads non-negative integer strings, everything else is 0', () => {
    expect(parseSchemaVersion('7')).toBe(7)
    expect(parseSchemaVersion('0')).toBe(0)
    expect(parseSchemaVersion('1.0.0')).toBe(0)
    expect(parseSchemaVersion(null)).toBe(0)
    expect(parseSchemaVersion('-1')).toBe(0)
    expect(parseSchemaVersion('abc')).toBe(0)
  })
})

describe('runMigrations', () => {
  it('does nothing when the workspace is current', async () => {
    const log: number[] = []
    const calls = { backup: 0, recompute: 0 }
    const r = await runMigrations(conn, steps(3, log), 3, opts(calls))
    expect(r).toEqual({ ran: [], backupPath: null, recomputed: false })
    expect(log).toEqual([])
    expect(calls).toEqual({ backup: 0, recompute: 0 })
  })

  it('backs up once, then runs the pending steps in order and records each version', async () => {
    const log: number[] = []
    const calls = { backup: 0, recompute: 0 }
    const order: string[] = []
    const r = await runMigrations(conn, steps(3, log), 0, opts(calls, {
      backup: async () => { order.push('backup'); calls.backup++; return '/b/x.qosdb' }
    }))
    expect(order).toEqual(['backup'])
    expect(calls.backup).toBe(1)
    expect(r.ran).toEqual([1, 2, 3])
    expect(r.backupPath).toBe('/b/x.qosdb')
    expect(await meta('schema_version')).toBe('3')
    expect(await readSchemaVersion(conn)).toBe(3)
  })

  it('holds versions while a recompute is outstanding and recomputes once at the end', async () => {
    const log: number[] = []
    const calls = { backup: 0, recompute: 0 }
    let seenDuringStep3: string | null = 'unset'
    const list = steps(4, log, [2, 3], { 3: { up: async () => { log.push(3); seenDuringStep3 = await meta('schema_version'); return true } } })
    const r = await runMigrations(conn, list, 0, opts(calls))
    expect(calls.recompute).toBe(1)
    expect(seenDuringStep3).toBe('1')
    expect(r.recomputed).toBe(true)
    expect(await meta('schema_version')).toBe('4')
    expect(await meta('recompute_pending')).toBeNull()
  })

  it('stops at a failing step with the step and the backup in the message', async () => {
    const log: number[] = []
    const calls = { backup: 0, recompute: 0 }
    const list = steps(3, log, [], { 2: { up: async () => { throw new Error('boom') } } })
    await expect(runMigrations(conn, list, 0, opts(calls))).rejects.toThrow(
      'Upgrading this workspace failed at step 2 (step 2). A copy from before the upgrade is in /b/test-before-v9.qosdb.'
    )
    expect(log).toEqual([1])
    expect(await meta('schema_version')).toBe('1')
  })

  it('runs no step when the backup cannot be written', async () => {
    const log: number[] = []
    const calls = { backup: 0, recompute: 0 }
    const r = runMigrations(conn, steps(2, log), 0, opts(calls, { backup: async () => { throw new Error('ENOSPC') } }))
    await expect(r).rejects.toThrow(/backup/i)
    expect(log).toEqual([])
  })

  it('completes an interrupted recompute on the next run, even when no step reports a change', async () => {
    const log: number[] = []
    const calls = { backup: 0, recompute: 0 }
    let fail = true
    const recompute = async (): Promise<void> => {
      calls.recompute++
      if (fail) throw new Error('killed')
    }
    await expect(runMigrations(conn, steps(2, log, [2]), 0, opts(calls, { recompute }))).rejects.toThrow(/step 2/)
    expect(await meta('recompute_pending')).not.toBeNull()
    expect(await meta('schema_version')).toBe('1')

    fail = false
    calls.recompute = 0
    const r = await runMigrations(conn, steps(2, [], []), 1, opts(calls, { recompute }))
    expect(calls.recompute).toBe(1)
    expect(r.recomputed).toBe(true)
    expect(await meta('recompute_pending')).toBeNull()
    expect(await meta('schema_version')).toBe('2')
  })

  it('finishes a pending recompute even when no step is pending', async () => {
    await conn.run(`INSERT INTO workspace_meta VALUES ('recompute_pending', '2'), ('schema_version', '2')`)
    const calls = { backup: 0, recompute: 0 }
    await runMigrations(conn, steps(2, []), 2, opts(calls))
    expect(calls).toEqual({ backup: 0, recompute: 1 })
    expect(await meta('recompute_pending')).toBeNull()
  })
})

describe('runReadOnlyShims', () => {
  it('runs the shims of the steps after the workspace version, and writes nothing', async () => {
    const ran: number[] = []
    const shim = (v: number) => ({ readOnlyShim: async () => { ran.push(v) } })
    await runReadOnlyShims(conn, steps(3, [], [], { 1: shim(1), 2: shim(2), 3: shim(3) }), 1)
    expect(ran).toEqual([2, 3])
    expect(await meta('schema_version')).toBeNull()
  })
})
