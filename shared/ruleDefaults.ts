/** NC-period settings (spec docs/superpowers/specs/2026-09-29-nc-lifecycle-design.md §5):
 *  the only place their defaults, limits, labels and ruleset columns exist.
 *  Schema DEFAULTs, upgrade ALTERs, getRules, updateRules, validation, the
 *  preview mock and the NC Periods tab are all generated from this table. */

export interface NcPeriodSettings {
  weeklyBreachDays: number
  monthlyBreachDays: number
  persistentWeeks: number
  chronicWeeks: number
  persistentMonths: number
  chronicMonths: number
  lookbackWeeks: number
  lookbackMonths: number
  intermittentRuns: number
  intermittentWindowWeeks: number
  intermittentWindowMonths: number
  recoveryWeeks: number
  recoveryMonths: number
}

export type NcPeriodKey = keyof NcPeriodSettings

export interface NcPeriodField {
  column: string
  label: string
  unit: 'bad days' | 'weeks' | 'months' | 'runs'
  min: number
  max: number
  default: number
}

const f = (column: string, label: string, unit: NcPeriodField['unit'], min: number, max: number, def: number): NcPeriodField =>
  ({ column, label, unit, min, max, default: def })

export const NC_PERIOD_FIELDS: Record<NcPeriodKey, NcPeriodField> = {
  weeklyBreachDays: f('weekly_breach_days', 'NC week needs', 'bad days', 1, 7, 1),
  monthlyBreachDays: f('monthly_breach_days', 'NC month needs', 'bad days', 1, 31, 3),
  persistentWeeks: f('persistent_weeks', 'Persistent after', 'weeks', 1, 26, 3),
  chronicWeeks: f('chronic_weeks', 'Chronic after', 'weeks', 2, 52, 7),
  persistentMonths: f('persistent_months', 'Persistent after', 'months', 1, 12, 2),
  chronicMonths: f('chronic_months', 'Chronic after', 'months', 2, 24, 3),
  lookbackWeeks: f('lookback_weeks', 'Recurring if NC again within', 'weeks', 1, 26, 3),
  lookbackMonths: f('lookback_months', 'Recurring if NC again within', 'months', 1, 12, 2),
  intermittentRuns: f('intermittent_runs', 'Intermittent after', 'runs', 3, 10, 3),
  intermittentWindowWeeks: f('intermittent_window_weeks', 'Intermittent window', 'weeks', 2, 52, 7),
  intermittentWindowMonths: f('intermittent_window_months', 'Intermittent window', 'months', 2, 24, 6),
  recoveryWeeks: f('recovery_weeks', 'Recovering lasts', 'weeks', 1, 26, 3),
  recoveryMonths: f('recovery_months', 'Recovering lasts', 'months', 1, 12, 2)
}

export const NC_PERIOD_KEYS = Object.keys(NC_PERIOD_FIELDS) as NcPeriodKey[]

export const DEFAULT_NC_PERIODS = Object.fromEntries(
  NC_PERIOD_KEYS.map((k) => [k, NC_PERIOD_FIELDS[k].default])
) as unknown as NcPeriodSettings

export const DEFAULT_DISTRICT_NC_PCT = 10
export const DEFAULT_PRIORITY_WEIGHTS = [25, 20, 15, 15, 15, 10]

/** The first problem with a complete set of settings, or null when valid. */
export function ncPeriodProblem(s: NcPeriodSettings): string | null {
  for (const k of NC_PERIOD_KEYS) {
    const fld = NC_PERIOD_FIELDS[k]
    const v = s[k]
    if (!Number.isInteger(v) || v < fld.min || v > fld.max) {
      return `${fld.label} (${fld.unit}) must be a whole number from ${fld.min} to ${fld.max}`
    }
  }
  if (s.persistentWeeks >= s.chronicWeeks) return 'Persistent must be shorter than Chronic (weeks)'
  if (s.persistentMonths >= s.chronicMonths) return 'Persistent must be shorter than Chronic (months)'
  return null
}

export type NcGrain = 'daily' | 'weekly' | 'monthly'

export interface GrainPeriods {
  persistent: number
  chronic: number
  lookback: number
  intermittentRuns: number
  intermittentWindow: number
  recovery: number
}

/** Thresholds counted in periods of `grain`; daily is always weeks × 7. */
export function periodsFor(grain: NcGrain, s: NcPeriodSettings): GrainPeriods {
  if (grain === 'monthly') {
    return {
      persistent: s.persistentMonths,
      chronic: s.chronicMonths,
      lookback: s.lookbackMonths,
      intermittentRuns: s.intermittentRuns,
      intermittentWindow: s.intermittentWindowMonths,
      recovery: s.recoveryMonths
    }
  }
  const x = grain === 'daily' ? 7 : 1
  return {
    persistent: s.persistentWeeks * x,
    chronic: s.chronicWeeks * x,
    lookback: s.lookbackWeeks * x,
    intermittentRuns: s.intermittentRuns,
    intermittentWindow: s.intermittentWindowWeeks * x,
    recovery: s.recoveryWeeks * x
  }
}
