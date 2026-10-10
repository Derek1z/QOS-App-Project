import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openRealWorkspace, insertCells, setSchemaVersion, type RealWorkspace } from '../helpers/realWorkspace'
import { runImportCore } from '../../src/main/import/importCore'
import { autoMap, makeFingerprint } from '../../src/main/import/mapping'

/** kpi_defs is unique on (technology, kpi_key) and some keys (connected_users,
 *  data_volume) exist under several technologies. An imported KPI column
 *  belongs to the workspace's technology only, never to every technology that
 *  shares its key. */

const BASE = ['DATETIME', 'DISTRICT', 'REGION', 'CELL', 'BASESTATION']

/** technology:kpi_key of every fact_extra_metrics row, sorted. */
async function techKeys(ws: RealWorkspace): Promise<string[]> {
  const r = await ws.conn.runAndReadAll(
    `SELECT k.technology || ':' || k.kpi_key AS tk
     FROM fact_extra_metrics e JOIN kpi_defs k ON k.kpi_id = e.kpi_id
     ORDER BY tk`
  )
  return r.getRowObjects().map((x) => String(x.tk))
}

async function reopen(ws: RealWorkspace): Promise<void> {
  const manager = await import('../../src/main/workspace/manager')
  await manager.closeWorkspace()
  await manager.openWorkspace(join(ws.dir, 'test.qosdb'))
  ws.conn = manager.getCurrent()!.connection
}

describe('extra KPI columns are stored under the workspace technology', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('a column mapped to connected_users in a 2G workspace writes only the 2G kpi_id', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('2G')
    const header = [...BASE, 'TCH Users']
    const csvPath = join(ws.dir, 'users.csv')
    writeFileSync(csvPath, [
      header.join(','),
      '2026-07-20,Accra Metro,Greater Accra,ACC-001-A,ACC-001,12'
    ].join('\n'))
    const res = await runImportCore(ws.conn, {
      workspacePath: join(ws.dir, 'test.qosdb'),
      workspaceName: 'test',
      csvPath,
      header,
      mapping: { columns: autoMap(BASE), kpiColumns: { 'TCH Users': 'connected_users' } },
      fingerprint: makeFingerprint(header),
      confidence: 1,
      dbBefore: 0,
      cellsBefore: 0,
      checksum: 'test',
      backupDir: join(ws.dir, 'backups')
    })
    expect(res.insertedRows).toBe(1)
    expect(await techKeys(ws)).toEqual(['2G:connected_users'])
  })

  it('opening a workspace once drops other-technology copies of its own KPI rows', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('2G')
    await insertCells(ws.conn, ['CELL'])
    // what the old import left behind: one row per technology sharing the key,
    // plus a 4G-only KPI row with no 2G twin (kept: nothing to deduplicate)
    await ws.conn.run(
      `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
       SELECT 20260720, 1, kpi_id, 12 FROM kpi_defs WHERE kpi_key = 'connected_users'
       UNION ALL
       SELECT 20260720, 1, kpi_id, 99 FROM kpi_defs WHERE technology = '4G' AND kpi_key = 'call_setup_success_4g'`
    )
    // a workspace from before this change: no marker
    await ws.conn.run(`DELETE FROM workspace_meta WHERE key = 'extra_tech_cleaned'`)
    await setSchemaVersion(ws.conn, 6)
    expect(await techKeys(ws)).toEqual([
      '2G:connected_users', '3G:connected_users', '4G:call_setup_success_4g', '4G:connected_users'
    ])

    await reopen(ws)
    expect(await techKeys(ws)).toEqual(['2G:connected_users', '4G:call_setup_success_4g'])
    const version = (await ws.conn.runAndReadAll(
      `SELECT value FROM workspace_meta WHERE key = 'schema_version'`
    )).getRowObjects()[0]?.value
    expect(String(version)).toBe('7')
  })
})
