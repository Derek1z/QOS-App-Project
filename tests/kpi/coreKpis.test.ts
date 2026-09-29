import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTempWorkspace, type TempWorkspace } from '../helpers/tempWorkspace'
import { SCHEMA_SQL } from '../../src/main/workspace/schema'
import { seedKpiDefs, listKpiDefs, discoverKpiDefs } from '../../src/main/services/kpiService'
import type { Technology } from '../../shared/api'

// The regulatory (NCA) KPIs that decide non-compliance, per technology.
const CORE: Record<Technology, string[]> = {
  '2G': ['call_drop_rate_2g', 'call_setup_success_2g', 'sdcch_congestion', 'tch_congestion'],
  '3G': ['call_drop_rate_3g', 'call_setup_success_3g', 'data_access_success_3g'],
  '4G': ['call_drop_rate_4g', 'call_setup_success_4g', 'data_service_failure_4g', 'prb_utilization']
}

describe('core (NC) KPIs per technology', () => {
  let ws: TempWorkspace

  beforeAll(async () => {
    ws = await createTempWorkspace()
    for (const sql of SCHEMA_SQL) await ws.connection.run(sql)
    for (const tech of ['2G', '3G', '4G'] as Technology[]) await seedKpiDefs(ws.connection, tech)
  })

  afterAll(async () => {
    await ws.cleanup()
  })

  it('marks exactly the regulatory KPIs as core', async () => {
    const core: Record<string, string[]> = {}
    for (const tech of ['2G', '3G', '4G'] as Technology[]) {
      core[tech] = (await listKpiDefs(ws.connection, tech)).filter((k) => k.isCore).map((k) => k.key).sort()
    }
    expect(core).toEqual(CORE)
  })

  it('maps the 2G _NCA export headers to the core KPIs', async () => {
    const { mapping } = await discoverKpiDefs(
      ws.connection,
      [
        '2G Call Connection Success Rate_NCA(%)',
        '2G Call Drop Rate_NCA(%)',
        '2G TCH Congestion Rate_NCA(%)',
        '2G SDCCH Congestion Rate_NCA(%)'
      ],
      '2G'
    )
    expect(mapping).toEqual({
      '2G Call Connection Success Rate_NCA(%)': 'call_setup_success_2g',
      '2G Call Drop Rate_NCA(%)': 'call_drop_rate_2g',
      '2G TCH Congestion Rate_NCA(%)': 'tch_congestion',
      '2G SDCCH Congestion Rate_NCA(%)': 'sdcch_congestion'
    })
  })
})
