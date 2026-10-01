import type { Grain } from './api'

/** Complete-period helpers shared by main and renderer (spec 2026-10-01 §3, §4.3).
 *  Every "take the latest period of a series" goes through latestComplete. */

export interface PeriodCompleteness {
  /** every day of the period has imported data */
  complete: boolean
  /** days of the period that have imported data */
  daysWithData: number
}

const isComplete = (r: { complete?: boolean }): boolean => r.complete !== false

/** The last complete row; the last row when none is complete; undefined when empty. */
export function latestComplete<T extends { complete?: boolean }>(rows: readonly T[]): T | undefined {
  for (let i = rows.length - 1; i >= 0; i--) if (isComplete(rows[i])) return rows[i]
  return rows[rows.length - 1]
}

/** The complete row before `current` (for period-on-period comparisons). */
export function previousComplete<T extends { complete?: boolean }>(rows: readonly T[], current: T | undefined): T | undefined {
  if (!current) return undefined
  const at = rows.indexOf(current)
  for (let i = at - 1; i >= 0; i--) if (isComplete(rows[i])) return rows[i]
  return undefined
}

export function daysInPeriod(grain: Grain, periodStart: string): number {
  if (grain === 'daily') return 1
  if (grain === 'weekly') return 7
  const [y, m] = periodStart.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** `W40 · 3 of 7 days` for a partial period, the plain label otherwise. */
export function periodLabel(label: string, grain: Grain, periodStart: string, p: Partial<PeriodCompleteness>): string {
  if (p.complete !== false) return label
  return `${label} · ${p.daysWithData ?? 0} of ${daysInPeriod(grain, periodStart)} days`
}
