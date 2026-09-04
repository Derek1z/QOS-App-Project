import { describe, it, expect } from 'vitest'
import { createTempWorkspace } from '../helpers/tempWorkspace'
import { ensureSchemaV020 } from '../../src/main/kpi/schemaV2'

describe('Schema v0.2.0', () => {
  it('creates dim_technology, dim_kpi, fact_kpi_daily, derived_kpi_config, and kpi_targets tables', async () => {
    const ws = await createTempWorkspace()
    await ensureSchemaV020(ws.connection)
    const tablesRes = await ws.connection.runAndReadAll(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'`)
    const tableNames = tablesRes.getRowObjects().map(r => String(r.table_name))
    
    expect(tableNames).toContain('dim_technology')
    expect(tableNames).toContain('dim_kpi')
    expect(tableNames).toContain('fact_kpi_daily')
    expect(tableNames).toContain('derived_kpi_config')
    expect(tableNames).toContain('kpi_targets')
    await ws.cleanup()
  })
})
