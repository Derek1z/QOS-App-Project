import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import type { DuckDBConnection } from '@duckdb/node-api'
import type { Technology } from '../../shared/api'

export interface RealWorkspace {
  dir: string
  conn: DuckDBConnection
  cleanup: () => Promise<void>
}

/** A real .qosdb created through the workspace manager (schema, KPI seeds,
 *  ruleset v1 — the same path the app uses) in a throwaway folder. The
 *  portable root points there too, so app_state.json and backups never touch
 *  the project folder. Query services read it via getCurrent(). */
export async function openRealWorkspace(technology: Technology = '4G'): Promise<RealWorkspace> {
  const dir = mkdtempSync(join(os.tmpdir(), 'qos-ws-test-'))
  process.env.PORTABLE_EXECUTABLE_DIR = dir
  const ws = await import('../../src/main/workspace/manager')
  await ws.createWorkspace(dir, 'test', technology)
  return {
    dir,
    conn: ws.getCurrent()!.connection,
    cleanup: async () => {
      await ws.closeWorkspace()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/** One region/district/site holding cells with ids 1..n in the given order. */
export async function insertCells(conn: DuckDBConnection, names: string[]): Promise<void> {
  await conn.run(`INSERT INTO dim_region VALUES (1, 'Region 1')`)
  await conn.run(`INSERT INTO dim_district VALUES (1, 'District 1', 1)`)
  await conn.run(`INSERT INTO dim_site VALUES (1, 'Site 1', 1)`)
  for (let i = 0; i < names.length; i++) {
    await conn.run(`INSERT INTO dim_cell VALUES (?, ?, 1, 1, 1)`, [i + 1, names[i]])
  }
}

/** Simulate a workspace written by an older (or newer) app: set its schema
 *  version directly (versioned migrations spec §4.2). */
export async function setSchemaVersion(conn: DuckDBConnection, v: number | string): Promise<void> {
  await conn.run(
    `INSERT INTO workspace_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [String(v)]
  )
}
