import { describe, it, expect } from 'vitest'
import { runJobs, packJobs, runPacked, unpackResults, type SeriesJob } from '../../src/main/forecast/runner'

/** The pool exchanges packed typed arrays (one copy per message instead of an
 *  object per series); packing must not change a single result. */
describe('forecast job packing', () => {
  it('pack → run → unpack equals running the jobs directly', () => {
    const jobs: SeriesJob[] = []
    for (let s = 0; s < 60; s++) {
      const n = s % 7 === 0 ? 3 : 6 + (s % 40) // some withheld (n < 4)
      const values = Array.from({ length: n }, (_, i) => 50 + i * (s % 5) * 0.3 + Math.sin(i + s) * 2)
      jobs.push({ id: s, values, dates: [], opts: { grain: 'weekly', horizon: 12, domain: s % 2 ? 'percent' : 'nonNegative', periodNoun: 'weeks' } })
    }
    // a daily job keeps its dates
    const d0 = Date.parse('2026-01-05T00:00:00Z')
    const dates = Array.from({ length: 30 }, (_, i) => new Date(d0 + i * 86400000).toISOString().slice(0, 10))
    jobs.push({ id: 60, values: dates.map((_, i) => (i % 7 >= 5 ? 30 : 60) + Math.cos(i)), dates, opts: { grain: 'daily', horizon: 7, domain: 'none', periodNoun: 'days' } })
    const direct = runJobs(jobs)
    const packed = unpackResults(runPacked(packJobs(jobs)))
    expect(packed).toEqual(direct)
  })
})
