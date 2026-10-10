import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { BUILTIN_DERIVED_KPIS } from '../../shared/api'
import { openTechWorkspace } from '../helpers/techWorkspace'
import type { RealWorkspace } from '../helpers/realWorkspace'

/**
 * kpi_defs owns every KPI target, derived KPIs included: a target, direction
 * or on/off set in Targets survives the next import and Data Manager's
 * "Create All", and a derived save that changes one goes through the target
 * service (new ruleset version + recompute). Data: the real synthetic
 * generator through the real import core (see techWorkspace).
 */
vi.setConfig({ testTimeout: 60000 })

vi.mock('../../src/main/import/importer', async (orig) => ({
  ...(await orig<typeof import('../../src/main/import/importer')>()),
  runImport: (await import('../helpers/techWorkspace')).inProcessRunImport
}))

const KEY = '3g_phych_failures' // seeded target 30, lower is better
const seed = BUILTIN_DERIVED_KPIS.find((d) => d.id === KEY)!

describe('derived KPI targets on a real 3G workspace', () => {
  let ws: RealWorkspace
  beforeEach(async () => {
    ws = await openTechWorkspace('3G', { weeks: 2, cells: 3 })
  }, 180000)
  afterEach(async () => {
    await ws?.cleanup()
  })

  const kpiRow = async (): Promise<{ target: number | null; worse_is_higher: boolean; active: boolean }> => {
    const r = await ws.conn.runAndReadAll(
      `SELECT target, worse_is_higher, active FROM kpi_defs WHERE technology = '3G' AND kpi_key = '${KEY}'`
    )
    const row = r.getRowObjects()[0]
    return { target: row.target == null ? null : Number(row.target), worse_is_higher: Boolean(row.worse_is_higher), active: Boolean(row.active) }
  }
  const rulesetVersion = async (): Promise<number> =>
    Number((await ws.conn.runAndReadAll(`SELECT max(version) AS v FROM ruleset`)).getRowObjects()[0].v)
  const importAgain = async (): Promise<void> => {
    const { generateSyntheticMultiTechData } = await import('../../src/main/services/syntheticGenerator')
    await generateSyntheticMultiTechData({ technology: '3G', weeks: 1, cellsPerTech: 3, outputPath: join(ws.dir, 'again.csv') })
  }

  it('a target and direction set in Targets survive the next import', async () => {
    const { saveKpiTargets } = await import('../../src/main/services/targetService')
    expect((await kpiRow()).target).toBe(30)
    await saveKpiTargets(ws.conn, [{ technology: '3G', key: KEY, target: 45, betterDirection: 'higher_is_better' }])

    await importAgain()

    expect(await kpiRow()).toMatchObject({ target: 45, worse_is_higher: false })
  })

  it('a derived KPI switched off in Targets stays off after the next import', async () => {
    const { saveKpiTargets } = await import('../../src/main/services/targetService')
    await saveKpiTargets(ws.conn, [{ technology: '3G', key: KEY, active: false }])

    await importAgain()

    expect((await kpiRow()).active).toBe(false)
  })

  it("Data Manager's Create All keeps the target set in Targets, and the derived list reports it", async () => {
    const { saveKpiTargets } = await import('../../src/main/services/targetService')
    const { saveDerivedKpi, listDerivedKpis } = await import('../../src/main/services/derivedKpiService')
    await saveKpiTargets(ws.conn, [{ technology: '3G', key: KEY, target: 45 }])

    await saveDerivedKpi(ws.conn, { ...seed, enabled: true })

    expect((await kpiRow()).target).toBe(45)
    const listed = (await listDerivedKpis(ws.conn, '3G')).find((d) => d.id === KEY)!
    expect(listed.target).toBe(45)
  })

  it('switching a derived KPI back on goes through the target service: a new ruleset version', async () => {
    const { saveKpiTargets } = await import('../../src/main/services/targetService')
    const { saveDerivedKpi } = await import('../../src/main/services/derivedKpiService')
    await saveKpiTargets(ws.conn, [{ technology: '3G', key: KEY, active: false }])
    const before = await rulesetVersion()

    await saveDerivedKpi(ws.conn, { ...seed, enabled: true })

    expect((await kpiRow()).active).toBe(true)
    expect(await rulesetVersion()).toBe(before + 1)
  })
})
