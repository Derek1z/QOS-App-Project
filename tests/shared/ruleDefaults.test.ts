import { describe, it, expect } from 'vitest'
import {
  NC_PERIOD_FIELDS, NC_PERIOD_KEYS, DEFAULT_NC_PERIODS, ncPeriodProblem, periodsFor
} from '../../shared/ruleDefaults'

describe('NC-period settings (spec §5)', () => {
  it('has the agreed defaults', () => {
    expect(DEFAULT_NC_PERIODS).toEqual({
      weeklyBreachDays: 1, monthlyBreachDays: 3,
      persistentWeeks: 3, chronicWeeks: 7, persistentMonths: 2, chronicMonths: 3,
      lookbackWeeks: 3, lookbackMonths: 2,
      intermittentRuns: 3, intermittentWindowWeeks: 7, intermittentWindowMonths: 6,
      recoveryWeeks: 3, recoveryMonths: 2
    })
  })

  it('maps every setting to its own ruleset column', () => {
    const cols = NC_PERIOD_KEYS.map((k) => NC_PERIOD_FIELDS[k].column)
    expect(new Set(cols).size).toBe(NC_PERIOD_KEYS.length)
    expect(NC_PERIOD_FIELDS.recoveryWeeks.column).toBe('recovery_weeks')
  })

  it('accepts the defaults and rejects contradictions', () => {
    expect(ncPeriodProblem(DEFAULT_NC_PERIODS)).toBeNull()
    expect(ncPeriodProblem({ ...DEFAULT_NC_PERIODS, persistentWeeks: 7 })).toMatch(/Persistent must be shorter than Chronic \(weeks\)/)
    expect(ncPeriodProblem({ ...DEFAULT_NC_PERIODS, persistentMonths: 3 })).toMatch(/\(months\)/)
    expect(ncPeriodProblem({ ...DEFAULT_NC_PERIODS, intermittentRuns: 2 })).toMatch(/from 3 to 10/)
    expect(ncPeriodProblem({ ...DEFAULT_NC_PERIODS, recoveryWeeks: 1.5 })).toMatch(/whole number/)
  })

  it('expresses daily thresholds as weeks × 7', () => {
    expect(periodsFor('daily', DEFAULT_NC_PERIODS)).toEqual({
      persistent: 21, chronic: 49, lookback: 21, intermittentRuns: 3, intermittentWindow: 49, recovery: 21
    })
    expect(periodsFor('weekly', DEFAULT_NC_PERIODS)).toEqual({
      persistent: 3, chronic: 7, lookback: 3, intermittentRuns: 3, intermittentWindow: 7, recovery: 3
    })
    expect(periodsFor('monthly', DEFAULT_NC_PERIODS)).toEqual({
      persistent: 2, chronic: 3, lookback: 2, intermittentRuns: 3, intermittentWindow: 6, recovery: 2
    })
  })
})
