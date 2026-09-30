/** The NC-period vocabulary (spec docs/superpowers/specs/2026-09-29-nc-lifecycle-design.md §3).
 *  Ordered mildest → most severe; the index is the severity rank used by the
 *  roll-up, by sorting and by every score table below. Nothing else in the app
 *  may list these labels or their scores. */

export const LIFECYCLES = [
  'Healthy',
  'Recovering',
  'New NC',
  'Recurring NC',
  'Intermittent NC',
  'Persistent NC',
  'Chronic NC'
] as const

export type Lifecycle = (typeof LIFECYCLES)[number]

export const NC_LIFECYCLES: readonly Lifecycle[] = LIFECYCLES.slice(2)

export const LIFECYCLE_RANK = Object.fromEntries(LIFECYCLES.map((l, i) => [l, i])) as Record<Lifecycle, number>

/** Priority "persistence" component, 0–100. */
export const PRIORITY_PERSISTENCE: Record<Lifecycle, number> = {
  'Healthy': 0,
  'Recovering': 0,
  'New NC': 35,
  'Recurring NC': 70,
  'Intermittent NC': 80,
  'Persistent NC': 90,
  'Chronic NC': 100
}

/** Cell health NC component, 0–100 (higher is healthier). */
export const NC_HEALTH: Record<Lifecycle, number> = {
  'Healthy': 100,
  'Recovering': 90,
  'New NC': 40,
  'Recurring NC': 25,
  'Intermittent NC': 20,
  'Persistent NC': 10,
  'Chronic NC': 0
}

/** Starting points of the severity score of an NC period. */
export const SEVERITY_BASE: Record<Lifecycle, number> = {
  'Healthy': 0,
  'Recovering': 0,
  'New NC': 40,
  'Recurring NC': 60,
  'Intermittent NC': 70,
  'Persistent NC': 80,
  'Chronic NC': 90
}

export const LIFECYCLE_STYLE: Record<Lifecycle, { color: string; bg: string; border: string; short: string }> = {
  'Healthy': { color: '#34d399', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.3)', short: '·' },
  'Recovering': { color: '#38bdf8', bg: 'rgba(6, 182, 212, 0.15)', border: 'rgba(6, 182, 212, 0.3)', short: '↺' },
  'New NC': { color: '#facc15', bg: 'rgba(234, 179, 8, 0.15)', border: 'rgba(234, 179, 8, 0.3)', short: 'N' },
  'Recurring NC': { color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.3)', short: 'R' },
  'Intermittent NC': { color: '#fb923c', bg: 'rgba(249, 115, 22, 0.15)', border: 'rgba(249, 115, 22, 0.3)', short: 'I' },
  'Persistent NC': { color: '#f87171', bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.3)', short: 'P' },
  'Chronic NC': { color: '#e879f9', bg: 'rgba(192, 38, 211, 0.18)', border: 'rgba(192, 38, 211, 0.35)', short: 'C' }
}

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`

/** `CASE <column> WHEN 'Healthy' THEN .. END` from a score table. */
export function lifecycleCaseSql(column: string, table: Record<Lifecycle, number>, otherwise: number): string {
  return `CASE ${column} ${LIFECYCLES.map((l) => `WHEN ${q(l)} THEN ${table[l]}`).join(' ')} ELSE ${otherwise} END`
}

/** The label for a 0-based rank expression. */
export function lifecycleFromRankSql(rankExpr: string): string {
  return `([${LIFECYCLES.map(q).join(', ')}])[(${rankExpr}) + 1]`
}

/** The score of a 0-based rank expression in `table`. */
export function rankTableSql(table: Record<Lifecycle, number>, rankExpr: string): string {
  return `([${LIFECYCLES.map((l) => table[l]).join(', ')}])[(${rankExpr}) + 1]`
}

export function emptyLifecycleCounts(): Record<Lifecycle, number> {
  return Object.fromEntries(LIFECYCLES.map((l) => [l, 0])) as Record<Lifecycle, number>
}
