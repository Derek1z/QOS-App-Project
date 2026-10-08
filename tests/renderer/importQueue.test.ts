import { describe, it, expect } from 'vitest'
import { importQueue } from '../../src/renderer/lib/importQueue'
import type { FileAnalysis, MappingConfig, Technology } from '../../shared/api'

/** The Data Manager's import decisions (spec §4.5): which analysed files are
 *  blocked as another technology, which are imported, whether Import is
 *  enabled, and what stays listed afterwards. */

const file = (id: string, detected: Technology | null, errors: string[] = []): FileAnalysis =>
  ({ id, path: `/f/${id}.csv`, filename: `${id}.csv`, detectedTechnology: detected, errors } as unknown as FileAnalysis)
const ok: MappingConfig = { columns: { Date: 'date', Cell: 'cell' } }
const noCell: MappingConfig = { columns: { Date: 'date' } }

describe('importQueue', () => {
  it('blocks another technology\'s file and imports the rest', () => {
    const q = importQueue({
      analyses: [file('lte', '4G'), file('umts', '3G'), file('unsure', null)],
      mappings: { lte: ok, umts: ok, unsure: ok },
      workspaceTech: '4G',
      overrides: {}
    })
    expect(q.toImport.map((a) => a.id)).toEqual(['lte', 'unsure'])
    expect(q.blocked.map((a) => a.id)).toEqual(['umts'])
    expect(q.importableCount).toBe(2)
    expect(q.canRun).toBe(true)
  })

  it('"Import anyway" moves a blocked file into the import', () => {
    const q = importQueue({
      analyses: [file('umts', '3G')],
      mappings: { umts: ok },
      workspaceTech: '4G',
      overrides: { umts: true }
    })
    expect(q.toImport.map((a) => a.id)).toEqual(['umts'])
    expect(q.blocked).toEqual([])
  })

  it('cannot run when every importable file is blocked', () => {
    const q = importQueue({ analyses: [file('umts', '3G')], mappings: { umts: ok }, workspaceTech: '4G', overrides: {} })
    expect(q.canRun).toBe(false)
    expect(q.importableCount).toBe(0)
  })

  it('needs date and cell mapped, and skips files with errors or no mapping', () => {
    const q = importQueue({
      analyses: [file('nocell', '4G'), file('broken', '4G', ['bad header']), file('unmapped', '4G')],
      mappings: { nocell: noCell, broken: ok },
      workspaceTech: '4G',
      overrides: {}
    })
    expect(q.canRun).toBe(false)
    expect(q.toImport.map((a) => a.id)).toEqual(['nocell'])
    expect(q.importableCount).toBe(2)
  })
})
