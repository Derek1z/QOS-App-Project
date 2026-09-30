import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'
import { getRules, updateRules } from '../../src/main/analytics/rules'
import { getCoreTargets } from '../../src/main/analytics/targets'
import { saveKpiTargets, resetKpiTargets } from '../../src/main/services/targetService'
import { listKpiDefs, removeKpiDef } from '../../src/main/services/kpiService'

const WEEK = [20260720, 20260721, 20260722, 20260723, 20260724, 20260725, 20260726]

async function addWeek(ws: RealWorkspace, cellId: number, prb: number, tech: string, key: string, value: number): Promise<void> {
  for (const d of WEEK) {
    await ws.conn.run(
      `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
         dl_throughput_kbps, availability_pct, source_import_id) VALUES (?, ?, ?, 100, 10, 20000, 99.9, 1)`,
      [d, cellId, prb]
    )
  }
  await ws.conn.run(
    `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
     SELECT d.date_id, ?, k.kpi_id, ? FROM (SELECT unnest([${WEEK.join(', ')}]) AS date_id) d
     JOIN kpi_defs k ON k.technology = ? AND k.kpi_key = ?`,
    [cellId, value, tech, key]
  )
  await recomputeAllAggregates(ws.conn)
  await refreshAllIntelligence(ws.conn)
}

async function weeklyNc(ws: RealWorkspace): Promise<boolean> {
  return Boolean((await ws.conn.runAndReadAll(`SELECT bool_or(is_nc) AS nc FROM agg_cell_weekly`)).getRowObjects()[0].nc)
}

async function target(ws: RealWorkspace, tech: string, key: string): Promise<number | null> {
  const d = (await listKpiDefs(ws.conn, tech as '2G' | '3G' | '4G')).find((k) => k.key === key)
  return d?.target ?? null
}

describe('kpi_defs is the only owner of KPI targets (spec §8)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('saving a target recomputes NC and versions the change (A6)', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['CSSR-96'])
    await addWeek(ws, 1, 50, '3G', 'call_setup_success_3g', 96) // target 95: compliant
    expect(await weeklyNc(ws)).toBe(false)
    await saveKpiTargets(ws.conn, [{ technology: '3G', key: 'call_setup_success_3g', target: 97 }])
    expect(await weeklyNc(ws)).toBe(true)
    expect((await getRules(ws.conn))!.version).toBe(2)
    const note = (await ws.conn.runAndReadAll(
      `SELECT note FROM notes_events WHERE kind = 'ruleset_change' ORDER BY occurred_at DESC LIMIT 1`
    )).getRowObjects()[0].note
    expect(String(note)).toContain('3G call_setup_success_3g target 95→97')
  })

  it('a save that changes no NC field creates no version', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await saveKpiTargets(ws.conn, [{ technology: '3G', key: 'call_setup_success_3g', target: 95, warningThreshold: 93 }])
    expect((await getRules(ws.conn))!.version).toBe(1)
    expect(await target(ws, '3G', 'call_setup_success_3g')).toBe(95)
  })

  it('a target edit survives a ruleset save (A3)', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await saveKpiTargets(ws.conn, [{ technology: '3G', key: 'call_setup_success_3g', target: 97 }])
    await updateRules(ws.conn, { districtNcThresholdPct: 12 })
    expect(await target(ws, '3G', 'call_setup_success_3g')).toBe(97)
    expect(await target(ws, '2G', 'call_setup_success_2g')).toBe(95)
  })

  it('the 4G PRB target in kpi_defs decides PRB NC (A4)', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['PRB-85'])
    await addWeek(ws, 1, 85, '4G', 'call_setup_success_4g', 99)
    expect(await weeklyNc(ws)).toBe(true)
    await saveKpiTargets(ws.conn, [{ technology: '4G', key: 'prb_utilization', target: 90 }])
    expect(await weeklyNc(ws)).toBe(false)
    expect((await getRules(ws.conn))!.prbThresholdPct).toBe(90)
  })

  it('investigation reads each technology its own targets (A5)', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('2G')
    await saveKpiTargets(ws.conn, [{ technology: '2G', key: 'call_setup_success_2g', target: 96 }])
    expect((await getCoreTargets(ws.conn, '2G')).cssr).toBe(96)
    expect((await getCoreTargets(ws.conn, '4G')).cssr).toBe(95)
    expect((await getCoreTargets(ws.conn, '2G')).tchCongestion).toBe(1)
    expect(Number.isNaN((await getCoreTargets(ws.conn, '4G')).tchCongestion)).toBe(true)
  })

  it('core KPIs keep a target and cannot be removed (A8)', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('4G')
    await expect(
      saveKpiTargets(ws.conn, [{ technology: '4G', key: 'call_drop_rate_4g', target: null }])
    ).rejects.toThrow(/needs a target/)
    const core = (await listKpiDefs(ws.conn, '4G')).find((k) => k.key === 'call_drop_rate_4g')!
    await expect(removeKpiDef(ws.conn, core.kpiId)).rejects.toThrow(/cannot be removed/)
  })

  it('a core KPI cannot be demoted out of core status either (A8, fix round 1 #4)', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('4G')
    await expect(
      saveKpiTargets(ws.conn, [{ technology: '4G', key: 'call_drop_rate_4g', isCore: false }])
    ).rejects.toThrow(/must stay core/)
    const core = (await listKpiDefs(ws.conn, '4G')).find((k) => k.key === 'call_drop_rate_4g')!
    expect(core.isCore).toBe(true)
  })

  it('a direction change reaches NC and persists after reload (fix round 1 #1)', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    const before = (await listKpiDefs(ws.conn, '3G')).find((k) => k.key === 'call_setup_success_3g')!
    expect(before.worseIsHigher).toBe(false)
    await saveKpiTargets(ws.conn, [{ technology: '3G', key: 'call_setup_success_3g', betterDirection: 'lower_is_better' }])
    expect((await getRules(ws.conn))!.version).toBe(2)
    const afterSave = (await listKpiDefs(ws.conn, '3G')).find((k) => k.key === 'call_setup_success_3g')!
    expect(afterSave.worseIsHigher).toBe(true)
    expect(afterSave.betterDirection).toBe('lower_is_better')

    const mgr = await import('../../src/main/workspace/manager')
    mgr.closeWorkspace()
    await mgr.openWorkspace(join(ws.dir, 'test.qosdb'))
    const afterReload = (await listKpiDefs(mgr.getCurrent()!.connection, '3G')).find((k) => k.key === 'call_setup_success_3g')!
    expect(afterReload.worseIsHigher).toBe(true)
    expect(afterReload.betterDirection).toBe('lower_is_better')
  })

  it('a reset with nothing to change creates no version (fix round 1 #3)', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await resetKpiTargets(ws.conn, '3G')
    expect((await getRules(ws.conn))!.version).toBe(1)
  })

  it('a reset after an edit lists the change in its note (fix round 1 #3)', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await saveKpiTargets(ws.conn, [{ technology: '3G', key: 'call_setup_success_3g', target: 97 }])
    await resetKpiTargets(ws.conn, '3G')
    expect((await getRules(ws.conn))!.version).toBe(3)
    expect(await target(ws, '3G', 'call_setup_success_3g')).toBe(95)
    const note = (await ws.conn.runAndReadAll(
      `SELECT note FROM notes_events WHERE kind = 'ruleset_change' ORDER BY occurred_at DESC LIMIT 1`
    )).getRowObjects()[0].note
    expect(String(note)).toContain('3G call_setup_success_3g target 97→95')
  })

  it('a reset does not version an active-only difference (fix round 2)', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('4G')
    await saveKpiTargets(ws.conn, [{ technology: '4G', key: 'prb_utilization', active: false }])
    expect((await getRules(ws.conn))!.version).toBe(2)
    await resetKpiTargets(ws.conn, '4G')
    expect((await getRules(ws.conn))!.version).toBe(2)
  })
})
