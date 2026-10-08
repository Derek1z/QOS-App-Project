import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lockPath } from '../../src/main/workspace/lock'

const core = vi.hoisted(() => ({ fail: false }))

vi.mock('@duckdb/node-api', () => ({
  DuckDBInstance: {
    create: async () => ({
      connect: async () => ({ closeSync: () => undefined }),
      closeSync: () => undefined
    })
  }
}))
vi.mock('../../src/main/import/importCore', () => ({
  runImportCore: async () => {
    if (core.fail) throw new Error('boom')
    return { rowsInserted: 1 }
  }
}))

interface Msg {
  type: string
}

/** Smoke flake: runInWorker settles on the worker's 'done' and the main
 *  process reopens the workspace at once, while the worker (still alive, pid
 *  still in the lock file) had not yet released the lock. The lock must be
 *  gone by the time 'done' or 'error' is posted. */
describe('import worker releases the workspace lock before reporting', () => {
  let dir: string
  let ws: string
  let listener: ((e: { data: unknown }) => void) | null
  let posted: { msg: Msg; lockPresent: boolean }[]
  let settled: Promise<void>

  beforeEach(() => {
    vi.resetModules()
    dir = mkdtempSync(join(tmpdir(), 'qos-worker-order-'))
    ws = join(dir, 'w.qosdb')
    writeFileSync(ws, '')
    posted = []
    listener = null
    let resolve!: () => void
    settled = new Promise((r) => (resolve = r))
    ;(process as unknown as { parentPort: unknown }).parentPort = {
      once: (_: string, fn: (e: { data: unknown }) => void) => (listener = fn),
      postMessage: (msg: Msg) => {
        posted.push({ msg, lockPresent: existsSync(lockPath(ws)) })
        if (msg.type !== 'progress') resolve()
      }
    }
  })
  afterEach(() => {
    delete (process as unknown as { parentPort?: unknown }).parentPort
    rmSync(dir, { recursive: true, force: true })
  })

  async function run(): Promise<{ msg: Msg; lockPresent: boolean }> {
    await import('../../src/main/import/importWorker')
    listener!({ data: { workspacePath: ws, workspaceName: 'w', backupDir: join(dir, 'backups') } })
    await settled
    return posted.find((p) => p.msg.type !== 'progress')!
  }

  it('on done', async () => {
    core.fail = false
    const last = await run()
    expect(last.msg.type).toBe('done')
    expect(last.lockPresent).toBe(false)
  })

  it('on error', async () => {
    core.fail = true
    const last = await run()
    expect(last.msg.type).toBe('error')
    expect(last.lockPresent).toBe(false)
  })
})
