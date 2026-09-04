import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface TempWorkspace {
  path: string
  instance: DuckDBInstance
  connection: DuckDBConnection
  cleanup: () => Promise<void>
}

export async function createTempWorkspace(): Promise<TempWorkspace> {
  const tmpDir = os.tmpdir()
  const dbPath = path.join(tmpDir, `qos-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.qosdb`)
  
  const instance = await DuckDBInstance.create(dbPath)
  const connection = await instance.connect()

  const cleanup = async () => {
    try {
      await connection.close()
      // Give handles time to release
      await new Promise(res => setTimeout(res, 100))
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath)
      }
      if (fs.existsSync(`${dbPath}.wal`)) {
        fs.unlinkSync(`${dbPath}.wal`)
      }
    } catch (err) {
      // Ignore cleanup error in temp
    }
  }

  return {
    path: dbPath,
    instance,
    connection,
    cleanup
  }
}
