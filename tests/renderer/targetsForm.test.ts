import { describe, it, expect } from 'vitest'
import { targetInputProblem } from '../../src/renderer/lib/targetsForm'

describe('KPI Targets form validation (fix wave 2026-09-30, item 4)', () => {
  const valid = { target: '97', warningThreshold: '95', criticalThreshold: '90' }

  it('accepts finite numbers and empty fields', () => {
    expect(targetInputProblem('3G CSSR', valid)).toBeNull()
    expect(targetInputProblem('3G CSSR', { ...valid, warningThreshold: '', criticalThreshold: '' })).toBeNull()
  })

  it('names the KPI and field for a non-numeric target ("97,5" -> NaN)', () => {
    expect(targetInputProblem('3G CSSR', { ...valid, target: '97,5' }))
      .toBe('3G CSSR: Target "97,5" is not a number')
  })

  it('checks warning and critical too', () => {
    expect(targetInputProblem('3G CSSR', { ...valid, warningThreshold: 'abc' }))
      .toBe('3G CSSR: Warning Threshold "abc" is not a number')
    expect(targetInputProblem('3G CSSR', { ...valid, criticalThreshold: '1.2.3' }))
      .toBe('3G CSSR: Critical Threshold "1.2.3" is not a number')
  })
})
