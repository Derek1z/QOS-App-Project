import { parentPort, workerData } from 'node:worker_threads'
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
  parentPort?.postMessage(msg)
}

async function main(): Promise<void> {
  const job = workerData as ImportCoreJob
  const lockHeld = acquireLock(job.workspacePath)
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
    post({ type: 'done', result })
  } catch (e) {
    closeHandles(instance, conn)
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  } finally {
    closeHandles(instance, conn)
    if (lockHeld) releaseLock(job.workspacePath)
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

void main()
