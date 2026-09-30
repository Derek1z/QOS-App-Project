import { describe, it, expect } from 'vitest'
import { NC_PERIOD_GROUPS, dailyEquivalent, formToSettings, settingsToForm, ncSettingsOf, settingsEqual } from '../../src/renderer/lib/ncPeriodsForm'
import { NC_PERIOD_KEYS, DEFAULT_NC_PERIODS } from '../../shared/ruleDefaults'

describe('NC Periods form', () => {
  it('shows every setting exactly once', () => {
    const shown = NC_PERIOD_GROUPS.flatMap((g) => g.keys)
    expect([...shown].sort()).toEqual([...NC_PERIOD_KEYS].sort())
  })

  it('states the daily equivalent of week settings', () => {
    expect(dailyEquivalent('chronicWeeks', 7)).toBe('49 days in the daily view')
    expect(dailyEquivalent('chronicMonths', 3)).toBeNull()
    expect(dailyEquivalent('weeklyBreachDays', 1)).toBeNull()
  })

  it('round-trips valid settings and reports the first problem', () => {
    const form = settingsToForm(DEFAULT_NC_PERIODS)
    expect(formToSettings(form)).toEqual({ settings: DEFAULT_NC_PERIODS, problem: null })
    expect(formToSettings({ ...form, persistentWeeks: '7' }).problem).toBe('Persistent must be shorter than Chronic (weeks)')
    expect(formToSettings({ ...form, recoveryWeeks: 'abc' }).problem).toMatch(/Recovering lasts \(weeks\) must be a whole number/)
  })

  it('ncSettingsOf keeps only the NC-period fields off a superset (fix wave 2026-09-30, item 5)', () => {
    const rulesLike = { ...DEFAULT_NC_PERIODS, version: 3, prbThresholdPct: 80, notes: 'x' }
    expect(ncSettingsOf(rulesLike)).toEqual(DEFAULT_NC_PERIODS)
  })

  it('settingsEqual compares only the NC-period keys (fix wave 2026-09-30, item 5)', () => {
    expect(settingsEqual(DEFAULT_NC_PERIODS, { ...DEFAULT_NC_PERIODS })).toBe(true)
    expect(settingsEqual(DEFAULT_NC_PERIODS, { ...DEFAULT_NC_PERIODS, recoveryWeeks: 4 })).toBe(false)
  })
})
