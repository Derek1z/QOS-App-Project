import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { DuckDBInstance } from '@duckdb/node-api'
import { SCHEMA_SQL } from '../../src/main/workspace/schema'
import { runImportCore } from '../../src/main/import/importCore'
import { autoMap, makeFingerprint } from '../../src/main/import/mapping'
import { seedKpiDefs } from '../../src/main/services/kpiService'

const HEADER = [
  'DATETIME', 'DISTRICT', 'REGION', 'CELL', 'BASESTATION', 'PRB Utilization',
  'Connected Users', 'Data Volume (MB)', 'Availability', 'DL Throughput (kbps)'
]

describe('accepted geo value aliases on import', () => {
  let dir: string | null = null

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  it('re-points misspelled or oddly spaced region names at the existing regions', { timeout: 30000 }, async () => {
    dir = mkdtempSync(join(os.tmpdir(), 'qos-alias-test-'))
    const csvPath = join(dir, 'aliases.csv')
    writeFileSync(csvPath, [
      HEADER.join(','),
      '2026-07-20,Sefwi Wiawso,Westrn  North,WN-001-A,WN-001,50.0,10,100.0,99.9,20000',
      '2026-07-20,Accra Metro,Greater Accra,ACC-009-A,ACC-009,50.0,10,100.0,99.9,20000'
    ].join('\n'))
    const wsPath = join(dir, 'ws.qosdb')
    const instance = await DuckDBInstance.create(wsPath)
    const conn = await instance.connect()
    try {
      for (const sql of SCHEMA_SQL) await conn.run(sql)
      await seedKpiDefs(conn, '2G')
      await seedKpiDefs(conn, '3G')
      await seedKpiDefs(conn, '4G')
      await conn.run(`INSERT INTO dim_region VALUES (1, 'Western North'), (2, 'Greater Accra')`)
      // keys are normalized values, exactly as the Data Manager stores them
      const valueAliases = { region: { 'westrn north': 'Western North', 'greater accra': 'Greater Accra' } }
      const res = await runImportCore(conn, {
        workspacePath: wsPath,
        workspaceName: 'ws',
        csvPath,
        header: HEADER,
        mapping: { columns: autoMap(HEADER), valueAliases },
        fingerprint: makeFingerprint(HEADER),
        confidence: 1,
        dbBefore: 0,
        cellsBefore: 0,
        checksum: 'test',
        backupDir: join(dir, 'backups')
      })
      expect(res.insertedRows).toBe(2)

      const r = await conn.runAndReadAll(
        `SELECT c.name AS cell, rg.name AS region FROM dim_cell c JOIN dim_region rg USING (region_id)`
      )
      const regionByCell = Object.fromEntries(r.getRowObjects().map((x) => [String(x.cell), String(x.region)]))
      expect(regionByCell).toEqual({ 'WN-001-A': 'Western North', 'ACC-009-A': 'Greater Accra' })
      const regions = await conn.runAndReadAll(`SELECT count(*) AS n FROM dim_region`)
      expect(Number(regions.getRowObjects()[0].n)).toBe(2)
    } finally {
      conn.closeSync()
      instance.closeSync()
    }
  })
})
