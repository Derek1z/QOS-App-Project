import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { ImportResult, MappingConfig, Technology } from '../../shared/api'
import { openRealWorkspace, type RealWorkspace } from './realWorkspace'
import { readCsvSample } from '../../src/main/import/csv'
import { makeFingerprint, mappingConfidence } from '../../src/main/import/mapping'
import { runImportCore } from '../../src/main/import/importCore'

/**
 * A real workspace of one technology filled with the real synthetic
 * generator through the real import core. The app hands imports to a
 * utility process, which vitest cannot start; test files swap only that hop
 * for inProcessRunImport:
 *
 *   vi.mock('../../src/main/import/importer', async (orig) => ({
 *     ...(await orig<typeof import('../../src/main/import/importer')>()),
 *     runImport: (await import('../helpers/techWorkspace')).inProcessRunImport
 *   }))
 */
export async function inProcessRunImport(id: string, mapping: MappingConfig): Promise<ImportResult> {
  const manager = await import('../../src/main/workspace/manager')
  const ws = manager.getCurrent()
  if (!ws) throw new Error('no workspace open')
  const csvPath = id.split('|')[0]
  const { header } = readCsvSample(csvPath, 1)
  const backupDir = join(ws.path, '..', 'backups')
  mkdirSync(backupDir, { recursive: true })
  return runImportCore(ws.connection, {
    workspacePath: ws.path,
    workspaceName: ws.name,
    csvPath,
    header,
    mapping,
    fingerprint: makeFingerprint(header),
    confidence: mappingConfidence(mapping.columns, header),
    dbBefore: 0,
    cellsBefore: 0,
    checksum: 'test',
    backupDir
  })
}

/** A real `technology` workspace with `weeks` of synthetic data for `cells` cells. */
export async function openTechWorkspace(technology: Technology, opts: { weeks?: number; cells?: number } = {}): Promise<RealWorkspace> {
  const ws = await openRealWorkspace(technology)
  const { overrideDataDirs } = await import('../../src/main/paths')
  overrideDataDirs({ exports: join(ws.dir, 'exports') })
  const { generateSyntheticMultiTechData } = await import('../../src/main/services/syntheticGenerator')
  await generateSyntheticMultiTechData({
    technology,
    weeks: opts.weeks ?? 6,
    cellsPerTech: opts.cells ?? 12,
    outputPath: join(ws.dir, `synthetic-${technology}.csv`)
  })
  const manager = await import('../../src/main/workspace/manager')
  ws.conn = manager.getCurrent()!.connection
  // the generator swallows import errors: fail here if nothing arrived
  const n = Number((await ws.conn.runAndReadAll(`SELECT count(*) AS n FROM fact_extra_metrics`)).getRowObjects()[0].n)
  if (n === 0) throw new Error(`synthetic ${technology} import stored no KPI rows`)
  return ws
}
