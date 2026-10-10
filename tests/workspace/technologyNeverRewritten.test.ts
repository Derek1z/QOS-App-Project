import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openRealWorkspace, type RealWorkspace } from '../helpers/realWorkspace'
import { runImportCore } from '../../src/main/import/importCore'
import { autoMap, makeFingerprint } from '../../src/main/import/mapping'

/** Spec §6.1: after creation nothing rewrites workspace_meta.technology —
 *  statically (only creation and the one-time correction write it) and at
 *  runtime (opening, importing another technology's KPIs, saving targets). */

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.ts$/.test(n) && !/smoke|bench/.test(n) ? [p] : []
  })
}

async function storedTech(ws: RealWorkspace): Promise<string> {
  return String((await ws.conn.runAndReadAll(
    `SELECT value FROM workspace_meta WHERE key = 'technology'`
  )).getRowObjects()[0]?.value)
}

describe("a workspace's technology is never rewritten", () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('only creation and the one-time correction write it (source scan)', () => {
    const root = join(__dirname, '../../src/main')
    const writers: string[] = []
    for (const file of sources(root)) {
      const text = readFileSync(file, 'utf8')
      // a write to workspace_meta whose statement (possibly split over
      // concatenated strings) names the 'technology' key
      for (const m of text.matchAll(/(INSERT INTO|UPDATE|DELETE FROM)\s+workspace_meta/g)) {
        if (!/'technology'/.test(text.slice(m.index, m.index + 300))) continue
        const fn = [...text.slice(0, m.index).matchAll(/function\s+(\w+)/g)].pop()?.[1] ?? '?'
        writers.push(`${file.slice(root.length + 1)}:${fn}`)
      }
    }
    expect(writers.sort()).toEqual([
      'workspace/manager.ts:createWorkspaceNow',
      'workspace/migrations.ts:correctTechnology'
    ])
  })

  it('opening, importing another technology\'s KPI and saving targets leave it unchanged', { timeout: 90000 }, async () => {
    const manager = await import('../../src/main/workspace/manager')
    const { saveKpiTargets } = await import('../../src/main/services/targetService')
    const { listKpiDefs } = await import('../../src/main/services/kpiService')
    ws = await openRealWorkspace('3G')
    const path = join(ws.dir, 'test.qosdb')

    // import a file carrying a 4G KPI column (as "Import anyway" would)
    const base = ['DATETIME', 'DISTRICT', 'REGION', 'CELL', 'BASESTATION']
    const header = [...base, 'PRB']
    const csvPath = join(ws.dir, 'lte.csv')
    writeFileSync(csvPath, `${header.join(',')}\n2026-07-20,Accra Metro,Greater Accra,ACC-001-A,ACC-001,85\n`)
    await runImportCore(ws.conn, {
      workspacePath: path, workspaceName: 'test', csvPath, header,
      mapping: { columns: autoMap(base), kpiColumns: { PRB: 'prb_utilization' } },
      fingerprint: makeFingerprint(header), confidence: 1, dbBefore: 0, cellsBefore: 0,
      checksum: 'test', backupDir: join(ws.dir, 'backups')
    })
    expect(await storedTech(ws)).toBe('3G')

    // save a target in another technology's catalogue (KPI Definitions tabs)
    const def4g = (await listKpiDefs(ws.conn, '4G')).find((d) => d.key === 'prb_utilization')!
    await saveKpiTargets(ws.conn, [{ kpiId: def4g.kpiId, target: 75 }])
    expect(await storedTech(ws)).toBe('3G')

    for (const readOnly of [false, true, false]) {
      await manager.closeWorkspace()
      const info = await manager.openWorkspace(path, { readOnly })
      ws.conn = manager.getCurrent()!.connection
      expect(info.technology).toBe('3G')
    }
    expect(await storedTech(ws)).toBe('3G')
  })
})
