import { describe, it, expect } from 'vitest'
import { rcaBreakdown } from '../../src/renderer/lib/rcaBreakdown'
import type { Hypothesis } from '../../shared/api'

/** The Cell Investigation root-cause window: a labelled breakdown of the
 *  cell's real hypotheses (it used to draw a fixed 50/30/20 ring). */

const h = (title: string, score: number, confidence: Hypothesis['confidence'], supporting: string[], contradicting: string[] = [],
  verdict: Hypothesis['verdict'] = 'suggests'): Hypothesis =>
  ({ id: title, title, score, confidence, verdict, supporting, contradicting } as Hypothesis)

describe('rcaBreakdown', () => {
  it('lists hypotheses strongest first with confidence, score, verdict and evidence counts', () => {
    const rows = rcaBreakdown([
      h('Interference', 40, 'Low', ['UL noise high']),
      h('Capacity exhaustion', 92, 'High', ['PRB 93%', 'users 430', 'throughput low'], ['availability normal'], 'consistent'),
      h('Coverage overshoot', 61, 'Medium', ['TA high', 'drops at edge'])
    ])
    expect(rows.map((r) => r.title)).toEqual(['Capacity exhaustion', 'Coverage overshoot', 'Interference'])
    expect(rows[0]).toEqual({
      title: 'Capacity exhaustion', confidence: 'High', score: 92, verdict: 'consistent', supporting: 3, contradicting: 1
    })
  })

  it('keeps the score within 0..100 for the bar', () => {
    expect(rcaBreakdown([h('A', 140, 'High', []), h('B', -5, 'Low', [])]).map((r) => r.score)).toEqual([100, 0])
  })

  it('is empty when the cell has no hypotheses', () => {
    expect(rcaBreakdown([])).toEqual([])
  })
})
