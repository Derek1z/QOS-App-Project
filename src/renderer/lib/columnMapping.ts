import { FIELD_LABELS, FIELD_ORDER } from '../../../shared/api'
import type { CanonicalField, KpiDefinition, Technology } from '../../../shared/api'

/** One "Mapped to" list per source column (Data Manager). A column goes to a
 *  network field or to a KPI of the workspace's technology, never both, so
 *  one value encodes the choice: 'field:<field>', 'kpi:<key>', or '' (ignore). */

export function mappingValue(field: CanonicalField | undefined, kpiKey: string | undefined): string {
  if (field) return `field:${field}`
  if (kpiKey) return `kpi:${kpiKey}`
  return ''
}

export function parseMappingValue(v: string): { field?: CanonicalField; kpiKey?: string } {
  if (v.startsWith('field:')) return { field: v.slice(6) as CanonicalField }
  if (v.startsWith('kpi:')) return { kpiKey: v.slice(4) }
  return {}
}

export interface MappingGroup {
  label: string
  options: Array<{ value: string; label: string }>
}

const TECH_NAME: Record<Technology, string> = { '2G': '2G GSM', '3G': '3G UMTS', '4G': '4G LTE' }

/** PRB utilisation is a 4G measure: NC counts it only in a 4G workspace, and
 *  2G/3G utilisation comes from their KPIs (TCH congestion, peak utilisation). */
const FOUR_G_ONLY: CanonicalField[] = ['prb']

const kpiLabel = (k: KpiDefinition): string => `${k.label}${k.unit ? ` (${k.unit})` : ''}${k.isCore ? ' ★' : ''}`

/** The option groups for one column in a `technology` workspace. `current` is
 *  the column's present value; a choice outside the technology (a 4G field,
 *  another catalogue's KPI, e.g. from a remembered source) stays listed and
 *  marked so the select never shows a value it has no option for. */
export function mappingGroups(technology: Technology, kpiDefs: KpiDefinition[], current: string): MappingGroup[] {
  const fields = FIELD_ORDER.flatMap((f) => {
    const value = mappingValue(f, undefined)
    const fourGOnly = technology !== '4G' && FOUR_G_ONLY.includes(f)
    if (fourGOnly && value !== current) return []
    const label = `${FIELD_LABELS[f]}${f === 'date' || f === 'cell' ? ' *' : ''}${fourGOnly ? ' — 4G field' : ''}`
    return [{ value, label }]
  })
  const own = kpiDefs.filter((k) => k.technology === technology)
  const groups: MappingGroup[] = [
    { label: 'Network & cell fields', options: fields },
    { label: `${TECH_NAME[technology]} KPIs`, options: own.map((k) => ({ value: mappingValue(undefined, k.key), label: kpiLabel(k) })) }
  ]
  const cur = parseMappingValue(current).kpiKey
  if (cur && !own.some((k) => k.key === cur)) {
    const other = kpiDefs.find((k) => k.key === cur)
    groups.push({
      label: 'Other technology',
      options: [{ value: current, label: other ? `${kpiLabel(other)} — ${other.technology}` : cur }]
    })
  }
  return groups.filter((g) => g.options.length > 0)
}
