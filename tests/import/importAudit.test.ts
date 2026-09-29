import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { DuckDBInstance } from '@duckdb/node-api'
import { SCHEMA_SQL } from '../../src/main/workspace/schema'
import { runImportCore } from '../../src/main/import/importCore'
import { autoMap, makeFingerprint } from '../../src/main/import/mapping'

const HEADER = [
  'DATETIME', 'DISTRICT', 'REGION', 'CELL', 'BASESTATION', 'PRB Utilization',
  'Connected Users', 'Data Volume (MB)', 'Availability', 'DL Throughput (kbps)'
]

describe('import audit', () => {
  let dir: string | null = null

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  it('records the workspace file size after the import, not the source file size', async () => {
    dir = mkdtempSync(join(os.tmpdir(), 'qos-audit-test-'))
    const csvPath = join(dir, 'one-day.csv')
    writeFileSync(csvPath, [
      HEADER.join(','),
      '2026-07-20,Accra Metro,Greater Accra,ACC-001-A,ACC-001,50.0,10,100.0,99.9,20000'
    ].join('\n'))
    const wsPath = join(dir, 'ws.qosdb')
    const instance = await DuckDBInstance.create(wsPath)
    const conn = await instance.connect()
    try {
      for (const sql of SCHEMA_SQL) await conn.run(sql)
      await conn.run('CHECKPOINT')
      const dbBefore = statSync(wsPath).size
      const res = await runImportCore(conn, {
        workspacePath: wsPath,
        workspaceName: 'ws',
        csvPath,
        header: HEADER,
        mapping: { columns: autoMap(HEADER) },
        fingerprint: makeFingerprint(HEADER),
        confidence: 1,
        dbBefore,
        cellsBefore: 0,
        checksum: 'test',
        backupDir: join(dir, 'backups')
      })

      expect(res.insertedRows).toBe(1)
      const r = await conn.runAndReadAll(`SELECT db_size_before, db_size_after FROM import_audit`)
      const audit = r.getRowObjects()[0]
      expect(Number(audit.db_size_before)).toBe(dbBefore)
      // an import only adds data: the same database file cannot have shrunk
      expect(Number(audit.db_size_after)).toBeGreaterThanOrEqual(dbBefore)
    } finally {
      conn.closeSync()
      instance.closeSync()
    }
  })
})
