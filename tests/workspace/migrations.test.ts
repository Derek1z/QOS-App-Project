import { describe, it, expect, afterEach, vi } from 'vitest'
import { readdirSync, existsSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import { DuckDBInstance } from '@duckdb/node-api'
import { SCHEMA_SQL as SCHEMA_V0 } from '../fixtures/schemaV0'
import { join } from 'node:path'
import { openRealWorkspace, insertCells, setSchemaVersion, type RealWorkspace } from '../helpers/realWorkspace'

/** Versioned migrations spec §4.1, §4.3, §4.5, §6 items 1, 2, 6, 7. */

let recomputeCalls = 0
vi.mock('../../src/main/import/aggregates', async (orig) => {
  const real = await orig<typeof import('../../src/main/import/aggregates')>()
  return {
    ...real,
    recomputeAllAggregates: async (...a: Parameters<typeof real.recomputeAllAggregates>) => {
      recomputeCalls++
      return real.recomputeAllAggregates(...a)
    }
  }
})

const NAMES = [
  'Schema catch-up', 'Targets owned by kpi_defs', 'Derived-KPI tables', 'Merge duplicate dimensions',
  'NC periods relabel', 'Technology correction', 'Extra-KPI technology clean-up', 'Per-technology priority'
]
const MARKERS = ['targets_owner', 'nc_periods', 'tech_checked', 'extra_tech_cleaned']

async function meta(ws: RealWorkspace, key: string): Promise<string | null> {
  const v = (await ws.conn.runAndReadAll(`SELECT value FROM workspace_meta WHERE key = ?`, [key])).getRowObjects()[0]?.value
  return v == null ? null : String(v)
}
const backups = (ws: RealWorkspace): string[] => {
  const d = join(ws.dir, 'backups')
  return existsSync(d) ? readdirSync(d).filter((f) => /^pre-upgrade-test-v\d+-.*\.qosdb$/.test(f)) : []
}
async function reopen(ws: RealWorkspace): Promise<void> {
  const manager = await import('../../src/main/workspace/manager')
  await manager.closeWorkspace()
  await manager.openWorkspace(join(ws.dir, 'test.qosdb'))
  ws.conn = manager.getCurrent()!.connection
}
/** Tables/views, columns (type and default), indexes and non-NOT-NULL
 *  constraints, as a set (column order and nullability left out). */
async function strictShape(conn: RealWorkspace['conn']): Promise<Set<string>> {
  const q = async (sql: string): Promise<string[]> => (await conn.runAndReadAll(sql)).getRowObjects().map((r) => String(r.x))
  return new Set([
    ...(await q(`SELECT table_type || ' ' || table_name AS x FROM information_schema.tables WHERE table_schema = 'main'`)),
    ...(await q(`SELECT table_name || '.' || column_name || ':' || data_type || ' def=' || coalesce(column_default, '') AS x
                 FROM information_schema.columns WHERE table_schema = 'main'`)),
    ...(await q(`SELECT 'INDEX ' || index_name || ' ON ' || table_name AS x FROM duckdb_indexes()`)),
    ...(await q(`SELECT 'CONS ' || table_name || ' ' || constraint_type || ' ' || array_to_string(constraint_column_names, ',') AS x
                 FROM duckdb_constraints() WHERE schema_name = 'main' AND constraint_type <> 'NOT NULL'`))
  ])
}

async function schemaShape(ws: RealWorkspace): Promise<string[]> {
  const cols = (await ws.conn.runAndReadAll(
    `SELECT table_name || '.' || column_name || ':' || data_type AS c FROM information_schema.columns
     WHERE table_schema = 'main' ORDER BY 1`
  )).getRowObjects().map((r) => String(r.c))
  const tables = (await ws.conn.runAndReadAll(
    `SELECT table_type || ' ' || table_name AS t FROM information_schema.tables WHERE table_schema = 'main' ORDER BY 1`
  )).getRowObjects().map((r) => String(r.t))
  return [...tables, ...cols]
}

describe('the migration list', () => {
  it('is versions 1..8 with the spec names', async () => {
    const { MIGRATIONS, LATEST } = await import('../../src/main/workspace/migrations')
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(MIGRATIONS.map((m) => m.name)).toEqual(NAMES)
    expect(LATEST).toBe(8)
  })
})

describe('opening workspaces by version', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
    recomputeCalls = 0
  })

  it('a new workspace is at the latest version, with no backup and no old markers', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    expect(await meta(ws, 'schema_version')).toBe('8')
    expect(backups(ws)).toEqual([])
    for (const m of MARKERS) expect(await meta(ws, m), m).toBeNull()
  })

  it('a legacy workspace upgrades once: one backup, one recompute; the next open does nothing', { timeout: 90000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['CELL'])
    await ws.conn.run(`INSERT INTO dim_district VALUES (2, 'District 1', 1)`) // a duplicate for v4
    await setSchemaVersion(ws.conn, '1.0.0')
    for (const m of MARKERS) await ws.conn.run(`DELETE FROM workspace_meta WHERE key = ?`, [m])
    recomputeCalls = 0

    await reopen(ws)
    expect(await meta(ws, 'schema_version')).toBe('8')
    expect(backups(ws)).toHaveLength(1)
    expect(recomputeCalls).toBe(1)
    expect(await meta(ws, 'recompute_pending')).toBeNull()

    recomputeCalls = 0
    await reopen(ws)
    expect(backups(ws)).toHaveLength(1)
    expect(recomputeCalls).toBe(0)
  })

  it('a legacy workspace whose markers show every effect done upgrades without a recompute', { timeout: 90000 }, async () => {
    ws = await openRealWorkspace('4G')
    await setSchemaVersion(ws.conn, '1.0.0')
    await ws.conn.run(
      `INSERT INTO workspace_meta (key, value) VALUES ('targets_owner', 'kpi_defs'), ('nc_periods', '2026-10-01.2'),
         ('tech_checked', '2026-10-08'), ('extra_tech_cleaned', '2026-10-08')
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    )
    recomputeCalls = 0
    await reopen(ws)
    expect(await meta(ws, 'schema_version')).toBe('8')
    expect(recomputeCalls).toBe(0)
  })

  it('schema parity: a first-release workspace, upgraded, has the shape of a new one (both directions)', { timeout: 120000 }, async () => {
    // a real version-0 file, built from the first release's schema (git f98c3b0)
    const dir = mkdtempSync(join(os.tmpdir(), 'qos-v0-'))
    process.env.PORTABLE_EXECUTABLE_DIR = dir
    const path = join(dir, 'old.qosdb')
    const inst = await DuckDBInstance.create(path)
    const c = await inst.connect()
    for (const sql of SCHEMA_V0) await c.run(sql)
    await c.run(`INSERT INTO workspace_meta (key, value) VALUES ('schema_version', '1.0.0'), ('created_at', '2026-08-16'), ('name', 'old'), ('technology', '4G')`)
    c.closeSync()
    inst.closeSync()
    const manager = await import('../../src/main/workspace/manager')
    await manager.openWorkspace(path)
    const upgraded = await strictShape(manager.getCurrent()!.connection)
    await manager.closeWorkspace()
    ws = await openRealWorkspace('4G')
    const fresh = await strictShape(ws.conn)
    // ALTER cannot add NOT NULL, so nullability is not compared; one legacy
    // column (the PRB target moved to kpi_defs) stays in old workspaces
    const LEGACY_EXTRA = ['ruleset.prb_threshold_pct:DOUBLE def=80']
    expect([...upgraded].filter((x) => !fresh.has(x) && !LEGACY_EXTRA.includes(x)), 'only in the upgraded file').toEqual([])
    expect([...fresh].filter((x) => !upgraded.has(x)), 'only in a new workspace').toEqual([])
  })

  it('the technology correction records the pending recompute in the same step (review 2)', { timeout: 60000 }, async () => {
    const { correctTechnology, cleanExtraMetricsTech } = await import('../../src/main/workspace/migrations')
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['CELL'])
    await ws.conn.run(
      `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
       SELECT 20260706 + n, 1, k.kpi_id, 99 FROM range(10) r(n), kpi_defs k WHERE k.technology = '3G' AND k.kpi_key = 'call_setup_success_3g'`
    )
    expect(await correctTechnology(ws.conn)).toBe(true)
    expect(await meta(ws, 'recompute_pending')).not.toBeNull()

    await ws.conn.run(`DELETE FROM workspace_meta WHERE key = 'recompute_pending'`)
    await ws.conn.run(
      `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
       SELECT 20260706, 1, kpi_id, 12 FROM kpi_defs WHERE kpi_key = 'connected_users' AND technology IN ('3G', '4G')`
    )
    expect(await cleanExtraMetricsTech(ws.conn)).toBe(true)
    expect(await meta(ws, 'recompute_pending')).not.toBeNull()
  })
})
