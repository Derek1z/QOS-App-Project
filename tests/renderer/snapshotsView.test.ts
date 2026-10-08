import { describe, it, expect } from 'vitest'
import { fmtDateTime, fmtBytes, deltaTone, snapshotNameProblem } from '../../src/renderer/lib/snapshotsView'

describe('snapshots panel helpers', () => {
  it('shows DuckDB and ISO timestamps as DD/MM/YYYY HH:MM', () => {
    expect(fmtDateTime('2026-10-08 10:19:42.123')).toBe('08/10/2026 10:19')
    expect(fmtDateTime('2026-10-08T07:05:00.000Z')).toBe('08/10/2026 07:05')
    expect(fmtDateTime('')).toBe('—')
  })

  it('formats sizes', () => {
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(37 * 1024 * 1024)).toBe('37.0 MB')
  })

  it('colours a change by the KPI direction', () => {
    expect(deltaTone({ delta: 1.2, worseIsHigher: true })).toBe('worse')
    expect(deltaTone({ delta: 1.2, worseIsHigher: false })).toBe('better')
    expect(deltaTone({ delta: -0.4, worseIsHigher: true })).toBe('better')
    expect(deltaTone({ delta: 0, worseIsHigher: true })).toBe('same')
    expect(deltaTone({ delta: null, worseIsHigher: true })).toBe('none')
  })

  it('requires a name of reasonable length', () => {
    expect(snapshotNameProblem('  ')).toBe('Give the snapshot a name')
    expect(snapshotNameProblem('x'.repeat(81))).toBe('Keep the name under 80 characters')
    expect(snapshotNameProblem('Before W41 import')).toBeNull()
  })
})

describe('snapshot comparison values', () => {
  it('whole numbers get separators and no decimals; percentages keep two', async () => {
    const { fmtSnapValue } = await import('../../src/renderer/lib/snapshotsView')
    expect(fmtSnapValue(143000, '')).toBe('143,000')
    expect(fmtSnapValue(4, '')).toBe('4')
    expect(fmtSnapValue(61.4, '%')).toBe('61.40%')
    expect(fmtSnapValue(-2.1, 'pp')).toBe('-2.10 pp')
    expect(fmtSnapValue(null, '%')).toBe('—')
  })
})
