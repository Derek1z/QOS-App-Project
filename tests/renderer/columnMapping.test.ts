import { describe, it, expect } from 'vitest'
import { mappingValue, parseMappingValue, mappingGroups } from '../../src/renderer/lib/columnMapping'
import type { KpiDefinition, Technology } from '../../shared/api'

/** One "Mapped to" list per source column: a network field or a KPI of the
 *  workspace's technology (the two used to be separate dropdowns). */

const kpi = (technology: Technology, key: string, label: string, isCore = false, unit = '%'): KpiDefinition =>
  ({ kpiId: key.length, technology, key, label, unit, isCore } as unknown as KpiDefinition)

const defs = [
  kpi('2G', 'tch_congestion', 'TCH Congestion', true),
  kpi('3G', 'call_setup_success_3g', 'CS Call Setup Success', true),
  kpi('4G', 'prb_utilization', 'PRB Utilization', true),
  kpi('4G', 'volte_drop', 'VoLTE Drop Rate')
]

const values = (groups: ReturnType<typeof mappingGroups>): string[] => groups.flatMap((g) => g.options.map((o) => o.value))

describe('mapping value', () => {
  it('encodes a field, a KPI, or ignore, and reads them back', () => {
    expect(mappingValue('cell', undefined)).toBe('field:cell')
    expect(mappingValue(undefined, 'tch_congestion')).toBe('kpi:tch_congestion')
    expect(mappingValue(undefined, undefined)).toBe('')
    expect(parseMappingValue('field:cell')).toEqual({ field: 'cell' })
    expect(parseMappingValue('kpi:tch_congestion')).toEqual({ kpiKey: 'tch_congestion' })
    expect(parseMappingValue('')).toEqual({})
  })
})

describe('mapping groups follow the workspace technology', () => {
  it('a 4G workspace lists the network fields with PRB, then only the 4G KPIs', () => {
    const g = mappingGroups('4G', defs, '')
    expect(g.map((x) => x.label)).toEqual(['Network & cell fields', '4G LTE KPIs'])
    expect(values(g)).toContain('field:prb')
    expect(g[1].options).toEqual([
      { value: 'kpi:prb_utilization', label: 'PRB Utilization (%) ★' },
      { value: 'kpi:volte_drop', label: 'VoLTE Drop Rate (%)' }
    ])
  })

  it('a 2G workspace leaves out the 4G PRB field and lists only 2G KPIs', () => {
    const g = mappingGroups('2G', defs, '')
    expect(g.map((x) => x.label)).toEqual(['Network & cell fields', '2G GSM KPIs'])
    expect(values(g)).not.toContain('field:prb')
    expect(values(g).filter((v) => v.startsWith('kpi:'))).toEqual(['kpi:tch_congestion'])
  })

  it('a 3G workspace lists only 3G KPIs', () => {
    const g = mappingGroups('3G', defs, '')
    expect(g[1].label).toBe('3G UMTS KPIs')
    expect(values(g).filter((v) => v.startsWith('kpi:'))).toEqual(['kpi:call_setup_success_3g'])
  })

  it('keeps a current choice outside the technology visible, marked', () => {
    const prb = mappingGroups('2G', defs, 'field:prb')
    expect(prb[0].options.find((o) => o.value === 'field:prb')?.label).toBe('PRB Utilization (%) — 4G field')
    const other = mappingGroups('2G', defs, 'kpi:volte_drop')
    expect(other.at(-1)).toEqual({ label: 'Other technology', options: [{ value: 'kpi:volte_drop', label: 'VoLTE Drop Rate (%) — 4G' }] })
    const unknown = mappingGroups('4G', defs, 'kpi:not_in_catalogue')
    expect(unknown.at(-1)?.options).toEqual([{ value: 'kpi:not_in_catalogue', label: 'not_in_catalogue' }])
  })

  it('marks the required fields', () => {
    const f = mappingGroups('4G', defs, '')[0].options
    expect(f.find((o) => o.value === 'field:date')?.label).toBe('Date / Time *')
    expect(f.find((o) => o.value === 'field:cell')?.label).toBe('Cell *')
  })
})
