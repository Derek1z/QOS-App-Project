import { openSync, writeSync, closeSync, readFileSync, unlinkSync, existsSync } from 'node:fs'

/**
 * Per-workspace lock file (spec §8): one writable instance per workspace.
 * Shared by the workspace manager (main) and the import worker so the lock
 * stays held while the main handle is closed for a background import.
 */
export function lockPath(path: string): string {
  return `${path}.lock`
}

export function acquireLock(path: string): boolean {
  const lp = lockPath(path)
  try {
    const fd = openSync(lp, 'wx')
    try {
      writeSync(fd, String(process.pid))
    } finally {
      closeSync(fd)
    }
    return true
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code !== 'EEXIST') return false
    // Existing lock: stale if its pid is no longer alive.
    let pid = NaN
    try {
      pid = parseInt(readFileSync(lp, 'utf8'), 10)
    } catch {
      /* unreadable -> treat as stale */
    }
    if (Number.isFinite(pid) && pid !== process.pid) {
      try {
        process.kill(pid, 0)
        return false // another live process holds the workspace
      } catch {
        /* pid not alive -> stale */
      }
    }
    try {
      unlinkSync(lp)
    } catch {
      /* ignore */
    }
    return acquireLock(path)
  }
}

/** Another live process holds the workspace (a lock of our own pid, a dead
 *  pid or an unreadable lock file does not count). */
export function lockedByOther(path: string): { locked: boolean; pid?: number } {
  const lp = lockPath(path)
  if (!existsSync(lp)) return { locked: false }
  let pid = NaN
  try {
    pid = parseInt(readFileSync(lp, 'utf8'), 10)
  } catch {
    return { locked: false }
  }
  if (!Number.isFinite(pid) || pid === process.pid) return { locked: false }
  try {
    process.kill(pid, 0)
    return { locked: true, pid }
  } catch {
    return { locked: false }
  }
}

export function releaseLock(path: string): void {
  try {
    unlinkSync(lockPath(path))
  } catch {
    /* ignore */
  }
}
