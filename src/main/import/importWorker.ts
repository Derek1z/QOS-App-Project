import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import { acquireLock, releaseLock } from '../workspace/lock'
import { runImportCore, type ImportCoreJob } from './importCore'

interface WorkerMessage {
  type: 'progress' | 'done' | 'error'
  phase?: string
  detail?: string
  result?: unknown
  message?: string
}

function post(msg: WorkerMessage): void {
  process.parentPort.postMessage(msg)
}

/** Runs in an Electron utility process (see runInWorker in importer.ts): the
 *  job arrives as the first message on process.parentPort. */
async function main(job: ImportCoreJob): Promise<void> {
  let lockHeld = acquireLock(job.workspacePath)
  // the main process reopens as soon as it hears back, so the lock must be
  // gone before any reply (else it sees a live foreign lock and refuses)
  const release = (): void => {
    if (lockHeld) releaseLock(job.workspacePath)
    lockHeld = false
  }
  let instance: Awaited<ReturnType<typeof DuckDBInstance.create>> | null = null
  let conn: DuckDBConnection | null = null
  try {
    // the main process closed the workspace, so the file is exclusively ours
    // (Windows locks open DuckDB files) — back up before any mutation (§7, §12)
    post({ type: 'progress', phase: 'Backing up workspace' })
    mkdirSync(job.backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const backupPath = join(job.backupDir, `${job.workspaceName}-${stamp}.qosdb`)
    copyFileSync(job.workspacePath, backupPath)

    instance = await DuckDBInstance.create(job.workspacePath)
    conn = await instance.connect()
    const result = await runImportCore(
      conn,
      { ...job, backupPath },
      (phase, detail) => post({ type: 'progress', phase, detail })
    )
    closeHandles(instance, conn)
    instance = null
    conn = null
    // Windows: the file must be released before the main process reopens it —
    // only report done once the DuckDB handle is fully closed.
    release()
    post({ type: 'done', result })
  } catch (e) {
    closeHandles(instance, conn)
    instance = null
    conn = null
    release()
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  } finally {
    closeHandles(instance, conn)
    release()
  }
}

function closeHandles(
  instance: Awaited<ReturnType<typeof DuckDBInstance.create>> | null,
  conn: DuckDBConnection | null
): void {
  if (conn) {
    try {
      conn.closeSync()
    } catch {
      /* ignore */
    }
  }
  if (instance) {
    try {
      instance.closeSync()
    } catch {
      /* ignore */
    }
  }
}

process.parentPort.once('message', (e) => {
  void main(e.data as ImportCoreJob)
})
