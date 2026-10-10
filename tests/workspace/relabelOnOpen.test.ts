import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { openRealWorkspace, insertCells, setSchemaVersion, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'

/** One row per day from `from` to `to`; CSSR 90 (target 95, a bad day) where
 *  `bad` holds, else 99. Mirrors the `days()` helper in
 *  tests/analytics/ncPeriods.test.ts. */
async function days(ws: RealWorkspace, cellId: number, from: string, to: string, bad: string): Promise<void> {
  const range = `range(DATE '${from}', DATE '${to}' + INTERVAL 1 DAY, INTERVAL 1 DAY) r(d)`
  await ws.conn.run(
    `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
       dl_throughput_kbps, availability_pct, source_import_id)
     SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, 50, 100, 10, 20000, 99.9, 1
     FROM ${range}`
  )
  await ws.conn.run(
    `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
     SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, k.kpi_id, CASE WHEN ${bad} THEN 90 ELSE 99 END
     FROM ${range}, kpi_defs k
     WHERE k.technology = '3G' AND k.kpi_key = 'call_setup_success_3g'`
  )
}

async function lifecycleAt(ws: RealWorkspace, cell: string, date: string): Promise<string> {
  const row = (await ws.conn.runAndReadAll(
    `SELECT l.lifecycle FROM cell_nc_lifecycle l JOIN dim_cell c USING (cell_id)
     WHERE c.name = ? AND l.grain = 'daily' AND l.period_start = DATE '${date}'`,
    [cell]
  )).getRowObjects()[0]?.lifecycle
  return String(row)
}

describe('old workspaces are relabelled once on open (fix wave 2026-09-30, item 1)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('relabels legacy lifecycle rows on the first open, then never again', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['TUESDAYS'])
    // A Tuesdays-only cell: New -> Recurring -> Intermittent from the 3rd
    // Tuesday (same pattern as tests/analytics/ncPeriods.test.ts).
    await days(ws, 1, '2026-07-06', '2026-08-30', `dayofweek(d) = 2`)
    await recomputeAllAggregates(ws.conn)
    await refreshAllIntelligence(ws.conn)
    expect(await lifecycleAt(ws, 'TUESDAYS', '2026-07-21')).toBe('Intermittent NC')

    // Simulate a workspace built before this branch: every NC daily row still
    // carries the old "Recurring NC" label (the pre-branch rules never
    // produced Intermittent), and it has no 'nc_periods' marker.
    await ws.conn.run(`UPDATE cell_nc_lifecycle SET lifecycle = 'Recurring NC' WHERE grain = 'daily' AND is_nc`)
    await ws.conn.run(`DELETE FROM workspace_meta WHERE key = 'nc_periods'`)
    await setSchemaVersion(ws.conn, 4) // before step 5 (NC periods relabel)
    expect(await lifecycleAt(ws, 'TUESDAYS', '2026-07-21')).toBe('Recurring NC')

    const manager = await import('../../src/main/workspace/manager')
    await manager.closeWorkspace()
    await manager.openWorkspace(join(ws.dir, 'test.qosdb'))
    ws.conn = manager.getCurrent()!.connection

    // The open recomputed from raw facts, so the 3rd Tuesday is Intermittent
    // again, and the marker is now set.
    expect(await lifecycleAt(ws, 'TUESDAYS', '2026-07-21')).toBe('Intermittent NC')
    const version = (await ws.conn.runAndReadAll(
      `SELECT value FROM workspace_meta WHERE key = 'schema_version'`
    )).getRowObjects()[0]?.value
    expect(String(version)).toBe('8')

    // Overwrite the same row again; with the marker present a second reopen
    // must not recompute, so the overwritten value survives.
    await ws.conn.run(`UPDATE cell_nc_lifecycle SET lifecycle = 'Recurring NC' WHERE grain = 'daily' AND period_start = DATE '2026-07-21'`)
    await manager.closeWorkspace()
    await manager.openWorkspace(join(ws.dir, 'test.qosdb'))
    ws.conn = manager.getCurrent()!.connection
    expect(await lifecycleAt(ws, 'TUESDAYS', '2026-07-21')).toBe('Recurring NC')
  })

  it('a workspace relabelled under the earlier month rule is relabelled again', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['TUESDAYS'])
    await days(ws, 1, '2026-07-06', '2026-08-30', `dayofweek(d) = 2`)
    await recomputeAllAggregates(ws.conn)
    await refreshAllIntelligence(ws.conn)
    // Stamped by the 2026-09-30 build, whose monthly roll-up counted a week for
    // the month it starts in; the month rule changed on 2026-10-01.
    await ws.conn.run(`UPDATE cell_nc_lifecycle SET lifecycle = 'Recurring NC' WHERE grain = 'daily' AND is_nc`)
    await ws.conn.run(
      `INSERT INTO workspace_meta (key, value) VALUES ('nc_periods', '2026-09-30')
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    )
    await setSchemaVersion(ws.conn, 4)
    const manager = await import('../../src/main/workspace/manager')
    await manager.closeWorkspace()
    await manager.openWorkspace(join(ws.dir, 'test.qosdb'))
    ws.conn = manager.getCurrent()!.connection
    expect(await lifecycleAt(ws, 'TUESDAYS', '2026-07-21')).toBe('Intermittent NC')
    const version = (await ws.conn.runAndReadAll(
      `SELECT value FROM workspace_meta WHERE key = 'schema_version'`
    )).getRowObjects()[0]?.value
    expect(String(version)).toBe('8')
  })

  it('a newly created workspace is at the latest version, so it never triggers the relabel', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    const version = (await ws.conn.runAndReadAll(
      `SELECT value FROM workspace_meta WHERE key = 'schema_version'`
    )).getRowObjects()[0]?.value
    expect(String(version)).toBe('8')
  })
})
