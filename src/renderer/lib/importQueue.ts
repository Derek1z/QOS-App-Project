import type { FileAnalysis, MappingConfig, Technology } from '../../../shared/api'
import { importTechBlock } from './importTech'

/** The Data Manager's import decisions for the analysed files (spec §4.5). */
export interface ImportQueue {
  /** imported by "Import": no errors, a mapping, not blocked */
  toImport: FileAnalysis[]
  /** another technology's files without "Import anyway" — kept listed after an import */
  blocked: FileAnalysis[]
  /** files without errors that are not blocked (the batch button's count) */
  importableCount: number
  /** at least one file to import has its date and cell columns mapped */
  canRun: boolean
}

export function importQueue(input: {
  analyses: FileAnalysis[]
  mappings: Record<string, MappingConfig>
  workspaceTech: Technology
  overrides: Record<string, boolean>
}): ImportQueue {
  const { analyses, mappings, workspaceTech, overrides } = input
  const isBlocked = (a: FileAnalysis): boolean =>
    importTechBlock(a.detectedTechnology, workspaceTech, !!overrides[a.id]).blocked
  const blocked = analyses.filter(isBlocked)
  const clean = analyses.filter((a) => a.errors.length === 0 && !isBlocked(a))
  const toImport = clean.filter((a) => mappings[a.id] != null)
  const canRun = toImport.some((a) => {
    // columns is keyed by source header, so check the mapped canonical values
    const values = Object.values(mappings[a.id].columns ?? {})
    return values.includes('date') && values.includes('cell')
  })
  return { toImport, blocked, importableCount: clean.length, canRun }
}
