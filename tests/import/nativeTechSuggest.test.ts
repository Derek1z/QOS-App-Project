import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openRealWorkspace, type RealWorkspace } from '../helpers/realWorkspace'

/** Imports are locked to the workspace's own technology: KPI suggestions come
 *  only from that technology's catalogue, and a column mapped to a network
 *  field is not also imported as a KPI. */

const HEADER = 'Date/Time,Cell,PRB Utilization,TCH Congestion (%),VoLTE Drop Rate (%)'

describe('KPI suggestions follow the workspace technology', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('a 2G workspace suggests only 2G KPIs', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('2G')
    const file = join(ws.dir, 'mixed.csv')
    writeFileSync(file, `${HEADER}\n07/05/2026,CELL-1,50,0.5,0.2\n`)
    const { analyzeFiles } = await import('../../src/main/import/importer')
    const [a] = await analyzeFiles([file])
    const keys = Object.values(a.suggestedKpiMapping)
    expect(keys).toContain('tch_congestion')
    expect(keys).not.toContain('prb_utilization')
    const { listKpiDefs } = await import('../../src/main/services/kpiService')
    const twoG = new Set((await listKpiDefs(ws.conn, '2G')).map((d) => d.key))
    for (const k of keys) expect(twoG.has(k)).toBe(true)
  })

  it('a 4G workspace keeps its own PRB KPI and does not suggest the 2G KPI', { timeout: 60000 }, async () => {
    ws = await openRealWorkspace('4G')
    const file = join(ws.dir, 'mixed.csv')
    writeFileSync(file, `${HEADER}\n07/05/2026,CELL-1,50,0.5,0.2\n`)
    const { analyzeFiles } = await import('../../src/main/import/importer')
    const [a] = await analyzeFiles([file])
    expect(Object.values(a.suggestedKpiMapping)).not.toContain('tch_congestion')
    // the PRB column is both the network field and the 4G core KPI: per-KPI
    // values (KPI cards, KPI breach) come only from the KPI half
    expect(a.suggestedMapping['PRB Utilization']).toBe('prb')
    expect(a.suggestedKpiMapping['PRB Utilization']).toBe('prb_utilization')
  })
})
