import { describe, it, expect } from 'vitest'
import { parseDateOk } from '../../src/main/import/validator'

describe('CSV Date & Time Ingestion Parsing (DD/MM/YYYY priority)', () => {
  it('validates and accepts pure DD/MM/YYYY dates', () => {
    expect(parseDateOk('05/08/2026')).toBe(true)
    expect(parseDateOk('31/12/2025')).toBe(true)
    expect(parseDateOk('01/01/2026')).toBe(true)
    expect(parseDateOk('29/02/2024')).toBe(true)
  })

  it('validates and accepts DD/MM/YYYY with 24-hour timestamps', () => {
    expect(parseDateOk('05/08/2026 14:30:00')).toBe(true)
    expect(parseDateOk('12/03/2026 00:00:00')).toBe(true)
    expect(parseDateOk('31/12/2025 23:59:59')).toBe(true)
  })

  it('validates and accepts DD/MM/YYYY with 12-hour AM/PM timestamps', () => {
    expect(parseDateOk('05/08/2026 09:15:22 AM')).toBe(true)
    expect(parseDateOk('05/08/2026 11:59:59 PM')).toBe(true)
    expect(parseDateOk('05/08/2026 12:00:00 am')).toBe(true)
    expect(parseDateOk('05/08/2026 01:30:00 pm')).toBe(true)
  })

  it('validates and accepts DD/MM/YYYY with milliseconds', () => {
    expect(parseDateOk('05/08/2026 10:45:12.345')).toBe(true)
    expect(parseDateOk('05/08/2026 10:45:12.1')).toBe(true)
  })

  it('validates dash and dot separated DD-MM-YYYY / DD.MM.YYYY', () => {
    expect(parseDateOk('05-08-2026')).toBe(true)
    expect(parseDateOk('05.08.2026 10:00:00')).toBe(true)
    expect(parseDateOk('25-11-2025 18:20:00')).toBe(true)
  })

  it('validates standard ISO YYYY-MM-DD formats as fallbacks', () => {
    expect(parseDateOk('2026-08-05')).toBe(true)
    expect(parseDateOk('2026-08-05 14:30:00')).toBe(true)
    expect(parseDateOk('2026-08-05T14:30:00+00:00')).toBe(true)
  })

  it('rejects completely invalid date strings', () => {
    expect(parseDateOk('not-a-date')).toBe(false)
    expect(parseDateOk('')).toBe(false)
    expect(parseDateOk('   ')).toBe(false)
    expect(parseDateOk('32/08/2026')).toBe(false)
    expect(parseDateOk('32/13/2026')).toBe(false)
    expect(parseDateOk('00/08/2026')).toBe(false)
    expect(parseDateOk('05/00/2026')).toBe(false)
  })
})
