import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { openRealWorkspace, insertCells, type RealWorkspace } from '../helpers/realWorkspace'
import { getPriorityCenter } from '../../src/main/services/queryService'

describe('Priority Center bands', () => {
  let ws: RealWorkspace

  beforeAll(async () => {
    ws = await openRealWorkspace('4G')
    await insertCells(ws.conn, ['CELL-A', 'CELL-B', 'CELL-C'])
    // band floors are 90 / 75 / 50 / 25: each score sits just below the next floor
    await ws.conn.run(`INSERT INTO cell_priority_history (cell_id, as_of, score, band, mode, weights, ruleset_version)
      VALUES (1, DATE '2026-07-27', 89.5, 'High', 'balanced', '{}', 1),
             (2, DATE '2026-07-27', 74.6, 'Medium', 'balanced', '{}', 1),
             (3, DATE '2026-07-27', 49.2, 'Watch', 'balanced', '{}', 1)`)
  })

  afterAll(async () => {
    await ws.cleanup()
  })

  it('labels fractional scores with the band whose floor they reach', async () => {
    const res = await getPriorityCenter({ scope: 'cell' })
    const bandByCell = Object.fromEntries(res.rows.map((r) => [r.name, r.priorityBand]))
    expect(bandByCell).toEqual({ 'CELL-A': 'High', 'CELL-B': 'Medium', 'CELL-C': 'Watch' })
  })

  it('keeps fractional scores inside the band filter', async () => {
    const res = await getPriorityCenter({ scope: 'cell', band: 'High' })
    expect(res.rows.map((r) => r.name)).toEqual(['CELL-A'])
  })
})
