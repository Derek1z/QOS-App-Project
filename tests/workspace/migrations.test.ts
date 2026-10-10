import { describe, it, expect, afterEach, vi } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
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
  'NC periods relabel', 'Technology correction', 'Extra-KPI technology clean-up'
]
const MARKERS = ['targets_owner', 'nc_periods', 'tech_checked', 'extra_tech_cleaned']

async function meta(ws: RealWorkspace, key: string): Promise<string | null> {
  const v = (await ws.conn.runAndReadAll(`SELECT value FROM workspace_meta WHERE key = ?`, [key])).getRowObjects()[0]?.value
  return v == null ? null : String(v)
}
const backups = (ws: RealWorkspace): string[] => {
  const d = join(ws.dir, 'backups')
  return existsSync(d) ? readdirSync(d).filter((f) => /^test-before-v\d+-.*\.qosdb$/.test(f)) : []
}
async function reopen(ws: RealWorkspace): Promise<void> {
  const manager = await import('../../src/main/workspace/manager')
  await manager.closeWorkspace()
  await manager.openWorkspace(join(ws.dir, 'test.qosdb'))
  ws.conn = manager.getCurrent()!.connection
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
  it('is versions 1..7 with the spec names', async () => {
    const { MIGRATIONS, LATEST } = await import('../../src/main/workspace/migrations')
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(MIGRATIONS.map((m) => m.name)).toEqual(NAMES)
    expect(LATEST).toBe(7)
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
    expect(await meta(ws, 'schema_version')).toBe('7')
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
    expect(await meta(ws, 'schema_version')).toBe('7')
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
    expect(await meta(ws, 'schema_version')).toBe('7')
    expect(recomputeCalls).toBe(0)
  })

  it('schema parity: a new workspace and the same one migrated from version 0 have the same shape', { timeout: 90000 }, async () => {
    ws = await openRealWorkspace('4G')
    const fresh = await schemaShape(ws)
    await setSchemaVersion(ws.conn, '0')
    await reopen(ws)
    expect(await meta(ws, 'schema_version')).toBe('7')
    expect(await schemaShape(ws)).toEqual(fresh)
  })
})
