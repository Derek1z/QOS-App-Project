import { describe, it, expect } from 'vitest'
import { latestComplete, previousComplete, daysInPeriod, periodLabel } from '../../shared/periods'

const rows = [
  { id: 'W38', complete: true },
  { id: 'W39', complete: true },
  { id: 'W40', complete: false }
]

describe('shared period helpers (spec §3.1, §3.2, §4.3)', () => {
  it('latest is the last complete row, else the last row, else nothing', () => {
    expect(latestComplete(rows)?.id).toBe('W39')
    expect(latestComplete([{ id: 'W40', complete: false }])?.id).toBe('W40')
    expect(latestComplete([])).toBeUndefined()
    expect(latestComplete([{ id: 'd1' }, { id: 'd2' }])?.id).toBe('d2') // rows without the flag (daily) are complete
  })

  it('previous is the complete row before the latest', () => {
    expect(previousComplete(rows, latestComplete(rows))?.id).toBe('W38')
    expect(previousComplete([{ id: 'W40', complete: false }], undefined)).toBeUndefined()
  })

  it('knows how many days a period has', () => {
    expect(daysInPeriod('weekly', '2026-09-28')).toBe(7)
    expect(daysInPeriod('monthly', '2026-10-01')).toBe(31)
    expect(daysInPeriod('monthly', '2026-02-01')).toBe(28)
    expect(daysInPeriod('daily', '2026-10-01')).toBe(1)
  })

  it('labels partial periods with their coverage', () => {
    expect(periodLabel('W40', 'weekly', '2026-09-28', { complete: false, daysWithData: 3 })).toBe('W40 · 3 of 7 days')
    expect(periodLabel('Oct', 'monthly', '2026-10-01', { complete: false, daysWithData: 10 })).toBe('Oct · 10 of 31 days')
    expect(periodLabel('W39', 'weekly', '2026-09-21', { complete: true, daysWithData: 7 })).toBe('W39')
    expect(periodLabel('W39', 'weekly', '2026-09-21', {})).toBe('W39')
  })
})
