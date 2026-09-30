import { describe, it, expect } from 'vitest'
import { DuckDBInstance } from '@duckdb/node-api'
import {
  LIFECYCLES, NC_LIFECYCLES, LIFECYCLE_RANK, PRIORITY_PERSISTENCE, NC_HEALTH, SEVERITY_BASE,
  LIFECYCLE_STYLE, lifecycleCaseSql, lifecycleFromRankSql, rankTableSql, emptyLifecycleCounts
} from '../../shared/lifecycle'

async function scalar(sql: string): Promise<unknown> {
  const db = await DuckDBInstance.create(':memory:')
  const c = await db.connect()
  return (await c.runAndReadAll(`SELECT ${sql} AS v`)).getRowObjects()[0].v
}

describe('NC period vocabulary (spec §3)', () => {
  it('orders the seven labels from mildest to most severe', () => {
    expect(LIFECYCLES).toEqual([
      'Healthy', 'Recovering', 'New NC', 'Recurring NC', 'Intermittent NC', 'Persistent NC', 'Chronic NC'
    ])
    expect(NC_LIFECYCLES).toEqual(['New NC', 'Recurring NC', 'Intermittent NC', 'Persistent NC', 'Chronic NC'])
    expect(LIFECYCLES.map((l) => LIFECYCLE_RANK[l])).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('never scores a worse label better than a milder one', () => {
    for (const table of [PRIORITY_PERSISTENCE, SEVERITY_BASE]) {
      const v = LIFECYCLES.map((l) => table[l])
      expect(v).toEqual([...v].sort((a, b) => a - b))
    }
    const h = LIFECYCLES.map((l) => NC_HEALTH[l])
    expect(h).toEqual([...h].sort((a, b) => b - a))
    expect(PRIORITY_PERSISTENCE['Intermittent NC']).toBe(80)
    expect(NC_HEALTH['Intermittent NC']).toBe(20)
    expect(SEVERITY_BASE['Intermittent NC']).toBe(70)
  })

  it('gives every label its own colour and letter', () => {
    const colors = LIFECYCLES.map((l) => LIFECYCLE_STYLE[l].color)
    const shorts = LIFECYCLES.map((l) => LIFECYCLE_STYLE[l].short)
    expect(new Set(colors).size).toBe(7)
    expect(new Set(shorts).size).toBe(7)
  })

  it('builds SQL that maps labels to scores and ranks to labels', async () => {
    expect(await scalar(lifecycleCaseSql(`'Intermittent NC'`, NC_HEALTH, 100))).toBe(20)
    expect(await scalar(lifecycleCaseSql(`'Unknown'`, NC_HEALTH, 100))).toBe(100)
    expect(await scalar(lifecycleFromRankSql('6'))).toBe('Chronic NC')
    expect(await scalar(lifecycleFromRankSql('0'))).toBe('Healthy')
    expect(await scalar(rankTableSql(SEVERITY_BASE, '5'))).toBe(80)
  })

  it('starts every count at zero for every label', () => {
    expect(emptyLifecycleCounts()).toEqual(Object.fromEntries(LIFECYCLES.map((l) => [l, 0])))
  })
})
