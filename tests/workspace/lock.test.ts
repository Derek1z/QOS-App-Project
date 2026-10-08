import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireLock, releaseLock, lockPath } from '../../src/main/workspace/lock'

/** The lock is the only thing standing between the import worker and the
 *  main process reopening the workspace: a live foreign pid in the lock file
 *  refuses the open ("This workspace is open in another instance"). */
describe('workspace lock', () => {
  let dir: string
  let ws: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qos-lock-'))
    ws = join(dir, 'w.qosdb')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('writes our pid', () => {
    expect(acquireLock(ws)).toBe(true)
    expect(readFileSync(lockPath(ws), 'utf8')).toBe(String(process.pid))
    releaseLock(ws)
    expect(existsSync(lockPath(ws))).toBe(false)
  })

  it('refuses while another live process holds it, until that process releases it', () => {
    // the parent process is alive and is not us: stands in for the worker
    writeFileSync(lockPath(ws), String(process.ppid))
    expect(acquireLock(ws)).toBe(false)
    releaseLock(ws)
    expect(acquireLock(ws)).toBe(true)
  })

  it('reclaims a lock whose pid is dead', () => {
    // pid_max on Linux is at most 2^22; this pid cannot be alive
    writeFileSync(lockPath(ws), String(2 ** 22 + 1))
    expect(acquireLock(ws)).toBe(true)
    expect(readFileSync(lockPath(ws), 'utf8')).toBe(String(process.pid))
  })
})
