import {
  NC_PERIOD_FIELDS, NC_PERIOD_KEYS, ncPeriodProblem, type NcPeriodKey, type NcPeriodSettings
} from '../../../shared/ruleDefaults'

/** Form model for the NC Periods tab (spec §5). Validation is the shared
 *  ncPeriodProblem, the same check the main process runs on save. */

export const NC_PERIOD_GROUPS: Array<{ title: string; help: string; keys: NcPeriodKey[] }> = [
  { title: 'When a period is NC', help: 'A day is NC when a core NCA KPI misses its target.', keys: ['weeklyBreachDays', 'monthlyBreachDays'] },
  { title: 'Persistent and Chronic', help: 'NC without a break for this long.', keys: ['persistentWeeks', 'chronicWeeks', 'persistentMonths', 'chronicMonths'] },
  { title: 'Recurring or New', help: 'NC again within this window after a clean spell = Recurring; otherwise New.', keys: ['lookbackWeeks', 'lookbackMonths'] },
  { title: 'Intermittent', help: 'This many separate NC runs inside the window = on and off, never long.', keys: ['intermittentRuns', 'intermittentWindowWeeks', 'intermittentWindowMonths'] },
  { title: 'Recovering, then Healthy', help: 'Clean for this long after the last NC period before it counts as Healthy.', keys: ['recoveryWeeks', 'recoveryMonths'] }
]

export function dailyEquivalent(key: NcPeriodKey, value: number): string | null {
  return NC_PERIOD_FIELDS[key].unit === 'weeks' ? `${value * 7} days in the daily view` : null
}

export function settingsToForm(s: NcPeriodSettings): Record<NcPeriodKey, string> {
  return Object.fromEntries(NC_PERIOD_KEYS.map((k) => [k, String(s[k])])) as Record<NcPeriodKey, string>
}

export function formToSettings(form: Record<NcPeriodKey, string>): { settings: NcPeriodSettings | null; problem: string | null } {
  const settings = Object.fromEntries(
    NC_PERIOD_KEYS.map((k) => [k, form[k].trim() === '' ? Number.NaN : Number(form[k])])
  ) as unknown as NcPeriodSettings
  const problem = ncPeriodProblem(settings)
  return problem ? { settings: null, problem } : { settings, problem: null }
}

/** Just the NC-period fields off any superset (e.g. a `Rules` row, which
 *  carries extra columns like version and prbThresholdPct). */
export function ncSettingsOf(r: NcPeriodSettings): NcPeriodSettings {
  return Object.fromEntries(NC_PERIOD_KEYS.map((k) => [k, r[k]])) as unknown as NcPeriodSettings
}

export function settingsEqual(a: NcPeriodSettings, b: NcPeriodSettings): boolean {
  return NC_PERIOD_KEYS.every((k) => a[k] === b[k])
}
