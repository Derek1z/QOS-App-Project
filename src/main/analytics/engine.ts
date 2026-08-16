import type { DuckDBConnection } from '@duckdb/node-api'
import { recomputeNcLifecycle } from './nc'
import { recomputePriority } from './priority'
import { recomputeCellHealth } from './health'

/** Derived intelligence orchestrator (spec §62, §66). After an import only the
 *  cells whose weeks changed are recomputed; a ruleset change recomputes all
 *  cells. Everything runs inside the caller's transaction. */

export async function refreshIntelligence(conn: DuckDBConnection, dateIds: number[]): Promise<void> {
  if (dateIds.length === 0) return
  const idList = dateIds.join(',')
  const r = await conn.runAndReadAll(`
    SELECT DISTINCT f.cell_id
    FROM fact_cell_daily f
    JOIN dim_date d ON d.date_id = f.date_id
    WHERE d.week_start IN (
      SELECT DISTINCT week_start FROM dim_date WHERE date_id IN (${idList})
    )
  `)
  const cellIds = r.getRowObjects().map((x) => Number(x.cell_id))
  if (cellIds.length === 0) return
  await recomputeNcLifecycle(conn, cellIds)
  await recomputePriority(conn, cellIds)
  await recomputeCellHealth(conn, cellIds)
}

export async function refreshAllIntelligence(conn: DuckDBConnection): Promise<void> {
  const r = await conn.runAndReadAll(`SELECT DISTINCT cell_id FROM agg_cell_weekly`)
  const cellIds = r.getRowObjects().map((x) => Number(x.cell_id))
  if (cellIds.length === 0) return
  await recomputeNcLifecycle(conn, cellIds)
  await recomputePriority(conn, cellIds)
  await recomputeCellHealth(conn, cellIds)
}
