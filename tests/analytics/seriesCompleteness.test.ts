import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { recomputeAllAggregates } from '../../src/main/import/aggregates'
import { refreshAllIntelligence } from '../../src/main/analytics/engine'
import { getNcMovement, getCellDetail, getHealth, getHealthMatrix, getKpiOverview } from '../../src/main/services/queryService'
import { getInvestigation } from '../../src/main/services/investigationService'

describe('series rows say whether each period is complete (spec §3.2, §4.3)', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('the Mon–Wed week is in every weekly series, marked partial with 3 days', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['C1'])
    const range = `range(DATE '2026-06-29', DATE '2026-07-23', INTERVAL 1 DAY) r(d)`
    await ws.conn.run(
      `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
         dl_throughput_kbps, availability_pct, source_import_id)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), 1, 50, 100, 10, 20000, 99.9, 1 FROM ${range}`
    )
    await ws.conn.run(
      `INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
       SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), 1, k.kpi_id, 90
       FROM ${range}, kpi_defs k WHERE k.technology = '3G' AND k.kpi_key = 'call_setup_success_3g'`
    )
    await recomputeAllAggregates(ws.conn)
    await refreshAllIntelligence(ws.conn)

    const pick = <T extends { complete: boolean; daysWithData: number }>(rows: T[], key: (r: T) => string, p: string) => {
      const r = rows.find((x) => key(x) === p)!
      return { complete: r.complete, daysWithData: r.daysWithData }
    }
    const partial = { complete: false, daysWithData: 3 }
    const full = { complete: true, daysWithData: 7 }

    const mv = await getNcMovement(8, 'weekly')
    expect(pick(mv, (r) => r.weekStart, '2026-07-20')).toEqual(partial)
    expect(pick(mv, (r) => r.weekStart, '2026-07-13')).toEqual(full)

    const cd = (await getCellDetail(1, 'weekly'))!
    expect(pick(cd.weeks, (r) => r.weekStart, '2026-07-20')).toEqual(partial)

    const h = await getHealth('weekly')
    expect(pick(h.network, (r) => r.asOf, '2026-07-20')).toEqual(partial)

    const kpi = (await getKpiOverview()).kpis.find((k) => k.key === 'call_setup_success_3g')!
    expect(pick(kpi.trend, (r) => r.weekStart, '2026-07-20')).toEqual(partial)

    const inv = (await getInvestigation('cell', 1, { grain: 'weekly' }))!
    expect(pick(inv.weeks, (r) => r.weekStart, '2026-07-20')).toEqual(partial)

    const m = await getHealthMatrix('cell')
    expect(m.weeksComplete.length).toBe(m.weeks.length)
    expect(m.weeksComplete[m.weeksComplete.length - 1]).toBe(false)
  })

  it('health matrix picks its worst entities by the latest complete week, not the latest partial one', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['C1', 'C2'])
    const range = `range(DATE '2026-06-29', DATE '2026-07-23', INTERVAL 1 DAY) r(d)`
    for (const cellId of [1, 2]) {
      await ws.conn.run(
        `INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
           dl_throughput_kbps, availability_pct, source_import_id)
         SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), ${cellId}, 50, 100, 10, 20000, 99.9, 1 FROM ${range}`
      )
    }
    await recomputeAllAggregates(ws.conn)
    await refreshAllIntelligence(ws.conn)

    // Latest COMPLETE week is 2026-07-13..19 (week-end date_id 20260719);
    // latest PARTIAL week is 2026-07-20..22 (week-end date_id 20260726).
    // Force cell 1 to look worst in the partial week but best in the complete
    // week, and cell 2 the opposite — only a ranking keyed on the latest
    // complete week tells them apart correctly.
    await ws.conn.run(`UPDATE cell_health_history SET health_score = 90 WHERE cell_id = 1 AND date_id = 20260719`)
    await ws.conn.run(`UPDATE cell_health_history SET health_score = 20 WHERE cell_id = 2 AND date_id = 20260719`)
    await ws.conn.run(`UPDATE cell_health_history SET health_score = 10 WHERE cell_id = 1 AND date_id = 20260726`)
    await ws.conn.run(`UPDATE cell_health_history SET health_score = 95 WHERE cell_id = 2 AND date_id = 20260726`)

    const m = await getHealthMatrix('cell', { limit: 1, sort: 'worst' })
    expect(m.rows.length).toBe(1)
    expect(m.rows[0].id).toBe(2)
  })
})
