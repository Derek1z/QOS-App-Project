import { describe, it, expect, afterEach } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { fillDays, rebuild } from '../helpers/forecastData'
import { getInvestigation } from '../../src/main/services/investigationService'

/** Honest-forecasting spec §8 (test 17): Investigation never invents a KPI
 *  value; a rule that cannot run says what was not assessed. */
describe('investigation without invented values', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  const ev = (r: Awaited<ReturnType<typeof getInvestigation>>, metric: string) =>
    r!.evidence.find((e) => e.metric === metric)

  it('a missing CSSR stays null, draws no finding, and is listed as not assessed (spec test 17)', { timeout: 120000 }, async () => {
    ws = await openRealWorkspace('2G')
    await insertCells(ws.conn, ['G1'])
    await fillDays(ws, 1, '2026-06-01', '2026-07-12', {}, { tch_congestion: 1.0 }, '2G')
    await rebuild(ws)
    const r = await getInvestigation('cell', 1, { technology: '2G' })
    expect(ev(r, 'cssr_2g')!.current).toBeNull()
    expect(r!.findings.map((f) => f.id)).not.toContain('cssr_low')
    expect(r!.notAssessed).toContain('Not assessed: 2G CSSR not imported')
    expect(r!.notAssessed).not.toContain('Not assessed: 2G TCH Congestion not imported')
  })

  it('an NC cell gets no invented call-drop rate', { timeout: 120000 }, async () => {
    ws = await openRealWorkspace('2G')
    await insertCells(ws.conn, ['G1'])
    await fillDays(ws, 1, '2026-06-01', '2026-07-12', {}, { tch_congestion: 9.0 }, '2G') // past the 2% target → NC
    await rebuild(ws)
    const r = await getInvestigation('cell', 1, { technology: '2G' })
    expect(r!.current?.isNc).toBe(true)
    expect(ev(r, 'call_drop_2g')!.current).toBeNull()
  })

  it('congestion is not derived from PRB', { timeout: 120000 }, async () => {
    ws = await openRealWorkspace('2G')
    await insertCells(ws.conn, ['G1'])
    await fillDays(ws, 1, '2026-06-01', '2026-07-12', { prb: 60 }, {}, '2G')
    await rebuild(ws)
    const r = await getInvestigation('cell', 1, { technology: '2G' })
    expect(ev(r, 'tch_cong')!.current).toBeNull()
    expect(ev(r, 'sdcch_cong')!.current).toBeNull()
    expect(ev(r, 'voice_traffic')!.current).toBeNull()
  })

  it('3G user speed is the imported throughput converted kbps → Mbps', { timeout: 120000 }, async () => {
    ws = await openRealWorkspace('3G')
    await insertCells(ws.conn, ['U1'])
    await fillDays(ws, 1, '2026-06-01', '2026-07-12', { thr: 4096 }, { call_setup_success_3g: 99 }, '3G')
    await rebuild(ws)
    const r = await getInvestigation('cell', 1, { technology: '3G' })
    expect(ev(r, 'throughput_3g')!.current).toBe(4)
  })
})
