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

// the smoke suite's multi-format file: ISO with offset, slash, dot, 2-digit years
const ROWS = [
  '2026-07-05T06:00:00+00:00,Accra Metro,Greater Accra,ACC-005-A,ACC-005,86.0,50,1380.0,99.7,19300',
  '07/05/2026,Accra Metro,Greater Accra,ACC-005-B,ACC-005,74.0,31,880.0,99.6,15800',
  '06.07.2026,Kumasi,Ashanti,KUM-005-A,KUM-005,90.0,66,1680.0,98.8,23800',
  '05/07/26 06:30:00,Accra Metro,Greater Accra,ACC-005-C,ACC-005,73.0,30,870.0,99.5,15700',
  '05-07-26,Accra Metro,Greater Accra,ACC-005-D,ACC-005,72.0,29,860.0,99.4,15600'
]

describe('import of a file mixing date formats', () => {
  let dir: string | null = null

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  it('stores every row and reads ISO and day-first dates correctly', { timeout: 30000 }, async () => {
    dir = mkdtempSync(join(os.tmpdir(), 'qos-import-test-'))
    const csvPath = join(dir, 'formats.csv')
    writeFileSync(csvPath, [HEADER.join(','), ...ROWS].join('\n'))
    const wsPath = join(dir, 'ws.qosdb')
    const instance = await DuckDBInstance.create(wsPath)
    const conn = await instance.connect()
    try {
      for (const sql of SCHEMA_SQL) await conn.run(sql)
      await seedKpiDefs(conn, '2G')
      await seedKpiDefs(conn, '3G')
      await seedKpiDefs(conn, '4G')
      const res = await runImportCore(conn, {
        workspacePath: wsPath,
        workspaceName: 'ws',
        csvPath,
        header: HEADER,
        mapping: { columns: autoMap(HEADER) },
        fingerprint: makeFingerprint(HEADER),
        confidence: 1,
        dbBefore: 0,
        cellsBefore: 0,
        checksum: 'test',
        backupDir: join(dir, 'backups')
      })

      expect(res.issues.filter((i) => i.severity === 'error')).toEqual([])
      expect(res.insertedRows).toBe(5)

      const r = await conn.runAndReadAll(
        `SELECT c.name AS cell, CAST(d.date AS VARCHAR) AS date
         FROM fact_cell_daily f JOIN dim_cell c USING (cell_id) JOIN dim_date d USING (date_id)`
      )
      const dateByCell = Object.fromEntries(r.getRowObjects().map((x) => [String(x.cell), String(x.date)]))
      expect(dateByCell['ACC-005-A']).toBe('2026-07-05') // ISO 8601 with offset
      expect(dateByCell['KUM-005-A']).toBe('2026-07-06') // DD.MM.YYYY
      expect(dateByCell['ACC-005-C']).toBe('2026-07-05') // DD/MM/YY HH:MM:SS
      expect(dateByCell['ACC-005-D']).toBe('2026-07-05') // DD-MM-YY
    } finally {
      conn.closeSync()
      instance.closeSync()
    }
  })
})
