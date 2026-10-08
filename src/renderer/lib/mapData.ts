/** Health map data: match workspace region/district names to the map's
 *  shapes, and never show a score the data does not have. */

const SUFFIX = /\b(municipal|metropolitan|metro|district|assembly)\b/g

/** 'ADENTA', 'Adenta Municipal' and 'adenta-municipal' share one key. */
export function mapNameKey(name: string): string {
  return name.toLowerCase().replace(SUFFIX, '').replace(/[^a-z0-9]/g, '')
}

/** `aliases` maps other spellings (e.g. the boundary source's) to shape names. */
export function matchMapData(
  rows: Array<{ name: string; healthScore: number | null }>,
  shapeNames: string[],
  aliases: Record<string, string> = {}
): { data: Array<{ name: string; value: number }>; unmatched: string[] } {
  const byKey = new Map(shapeNames.map((n) => [mapNameKey(n), n]))
  for (const [alias, shape] of Object.entries(aliases)) {
    if (!byKey.has(mapNameKey(alias))) byKey.set(mapNameKey(alias), shape)
  }
  const data: Array<{ name: string; value: number }> = []
  const unmatched: string[] = []
  for (const r of rows) {
    if (r.healthScore == null) continue
    const shape = byKey.get(mapNameKey(r.name))
    if (shape) data.push({ name: shape, value: Math.round(r.healthScore) })
    else unmatched.push(r.name)
  }
  return { data, unmatched }
}

export function mapTooltip(p: { name: string; value?: unknown }): string {
  const v = typeof p.value === 'number' ? p.value : NaN
  return Number.isFinite(v) ? `${p.name}: Health Score ${v}%` : `${p.name}: no data`
}
