import { existsSync, unlinkSync } from 'node:fs'
import type { DuckDBConnection } from '@duckdb/node-api'

async function currentCatalog(conn: DuckDBConnection): Promise<string> {
  const r = await conn.runAndReadAll('SELECT current_database() AS n')
  return String(r.getRowObjects()[0]?.n ?? 'main')
}

/** Full-database backup while the workspace is open: attach a fresh file and
 *  COPY FROM DATABASE (DuckDB's documented whole-db copy). No file locks.
 *  Shared by maintenance and the pre-upgrade backup. */
export async function backupOpenDatabase(conn: DuckDBConnection, dest: string): Promise<void> {
  if (existsSync(dest)) unlinkSync(dest)
  const esc = dest.replace(/'/g, "''")
  const src = (await currentCatalog(conn)).replace(/"/g, '""')
  await conn.run(`ATTACH '${esc}' AS maintenance_backup`)
  try {
    await conn.run(`COPY FROM DATABASE "${src}" TO maintenance_backup`)
  } finally {
    try {
      await conn.run('DETACH maintenance_backup')
    } catch {
      /* ignore */
    }
  }
}
