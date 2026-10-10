import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { openRealWorkspace, insertCells, setSchemaVersion, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'

/** One-time correction of workspaces whose technology was switched in the
 *  past (spec §4.4): on the first writable open, a workspace whose KPI rows
 *  are ≥ 90% one technology takes that technology, once. */

const D0 = '2026-07-06'

/** `n3g` days of a good 3G KPI and `n4g` days of a good 4G KPI for cell 1,
 *  plus PRB 95 on every day (a breach only a 4G workspace counts). */
async function seed(ws: RealWorkspace, n3g: number, n4g: number): Promise<void> {
  await insertCells(ws.conn, ['CELL'])
  const n = Math.max(n3g, n4g)
  const range = (k: number): string =>
    `range(DATE '${D0}', DATE '${D0}' + INTERVAL ${k} DAY, INTERVAL 1 DAY) r(d)`
  await ws.conn.run(
    `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
       dl_throughput_kbps, availability_pct, source_import_id)
     SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), 1, 95, 100, 10, 20000, 99.9, 1 FROM ${range(n)}`
  )
  const kpiRows = async (k: number, tech: string, key: string, value: number): Promise<void> => {
    if (k === 0) return
    await ws.conn.run(
      `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), 1, k.kpi_id, ${value}
       FROM ${range(k)}, kpi_defs k WHERE k.technology = '${tech}' AND k.kpi_key = '${key}'`
    )
  }
  await kpiRows(n3g, '3G', 'call_setup_success_3g', 99)
  await kpiRows(n4g, '4G', 'prb_utilization', 50)
  await recomputeAllAggregates(ws.conn)
  await refreshAllIntelligence(ws.conn)
  // a workspace from before this change: no marker, version before step 6
  await ws.conn.run(`DELETE FROM workspace_meta WHERE key = 'tech_checked'`)
  await setSchemaVersion(ws.conn, 5)
}

async function meta(ws: RealWorkspace, key: string): Promise<string | null> {
  const v = (await ws.conn.runAndReadAll(`SELECT value FROM workspace_meta WHERE key = ?`, [key])).getRowObjects()[0]?.value
  return v == null ? null : String(v)
}

async function ncDays(ws: RealWorkspace): Promise<number> {
  const v = (await ws.conn.runAndReadAll(
    `SELECT count(*) AS n FROM cell_nc_lifecycle WHERE grain = 'daily' AND is_nc`
  )).getRowObjects()[0]?.n
  return Number(v)
}

async function reopen(ws: RealWorkspace, readOnly = false): Promise<{ technology: string }> {
  const manager = await import('../../src/main/workspace/manager')
  await manager.closeWorkspace()
  const info = await manager.openWorkspace(join(ws.dir, 'test.qosdb'), { readOnly })
  ws.conn = manager.getCurrent()!.connection
  return info
}

describe('one-time technology correction on open', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('a new workspace is at the latest version, so it is never corrected', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('4G')
    expect(await meta(ws, 'schema_version')).toBe('7')
  })

  it('infers the technology holding ≥ 90% of KPI rows, else null', { timeout: 60000 }, async () => {
    const { inferWorkspaceTechnology } = await import('../../src/main/workspace/manager')
    ws = await openRealWorkspace('4G')
    expect(await inferWorkspaceTechnology(ws.conn)).toBeNull() // no KPI rows
    await seed(ws, 19, 1)
    expect(await inferWorkspaceTechnology(ws.conn)).toBe('3G')
  })

  it('a 4G workspace whose KPI rows are 95% 3G is corrected once, with aggregates recomputed', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await seed(ws, 19, 1)
    expect(await ncDays(ws)).toBe(19) // PRB 95 counts in a 4G workspace

    const info = await reopen(ws)
    expect(info.technology).toBe('3G')
    expect(await meta(ws, 'technology')).toBe('3G')
    expect(await meta(ws, 'schema_version')).toBe('7')
    expect(await ncDays(ws)).toBe(0) // PRB no longer counts; the 3G KPI is good
    const recent = (await import('../../src/main/services/appState')).load().recentWorkspaces[0]
    expect(recent.technology).toBe('3G')

    // with the marker set, a second open neither corrects nor recomputes
    await ws.conn.run(`UPDATE workspace_meta SET value = '4G' WHERE key = 'technology'`)
    // (a recompute under 4G would restore the 19 PRB NC days)
    await ws.conn.run(`UPDATE cell_nc_lifecycle SET is_nc = false WHERE grain = 'daily'`)
    const again = await reopen(ws)
    expect(again.technology).toBe('4G')
    expect(await ncDays(ws)).toBe(0)
  })

  it('a 60/40 split keeps the stored technology', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await seed(ws, 12, 8)
    const info = await reopen(ws)
    expect(info.technology).toBe('4G')
    expect(await meta(ws, 'schema_version')).toBe('7')
  })

  it('no KPI rows keeps the stored technology', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await ws.conn.run(`DELETE FROM workspace_meta WHERE key = 'tech_checked'`)
    await setSchemaVersion(ws.conn, 5)
    const info = await reopen(ws)
    expect(info.technology).toBe('4G')
  })

  it('a read-only open never corrects or writes (Review Focus 3)', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    await seed(ws, 19, 1)
    const info = await reopen(ws, true)
    expect(info.technology).toBe('4G')
    expect(await meta(ws, 'schema_version')).toBe('5')
    expect(await ncDays(ws)).toBe(19)
  })
})
