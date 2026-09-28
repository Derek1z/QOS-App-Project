import { describe, it, expect, afterEach } from 'vitest'
import { createTempWorkspace, type TempWorkspace } from '../helpers/tempWorkspace'
import { SCHEMA_SQL } from '../../src/main/workspace/schema'
import { seedKpiDefs, discoverKpiDefs } from '../../src/main/services/kpiService'

describe('2G KPI discovery on a real workspace', () => {
  let ws: TempWorkspace | null = null

  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('maps GPRS traffic, GPRS throughput and connected-users headers to their 2G KPI keys', async () => {
    ws = await createTempWorkspace()
    for (const sql of SCHEMA_SQL) await ws.connection.run(sql)
    await seedKpiDefs(ws.connection, '2G')

    const { mapping } = await discoverKpiDefs(
      ws.connection,
      ['GPRS Traffic (MB)', 'GPRS Throughput', 'Connected Users', 'Totally Unrelated'],
      '2G'
    )

    expect(mapping).toEqual({
      'GPRS Traffic (MB)': 'gprs_traffic',
      'GPRS Throughput': 'gprs_throughput',
      'Connected Users': 'connected_users'
    })
  })
})
