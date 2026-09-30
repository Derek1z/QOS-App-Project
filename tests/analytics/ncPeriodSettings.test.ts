import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { openRealWorkspace, type RealWorkspace } from '../helpers/realWorkspace'
import { getRules, updateRules } from '../../src/main/analytics/rules'
import { DEFAULT_NC_PERIODS, NC_PERIOD_KEYS } from '../../shared/ruleDefaults'

describe('NC-period settings are stored once, versioned and validated', () => {
  let ws: RealWorkspace | null = null
  afterEach(async () => {
    await ws?.cleanup()
    ws = null
  })

  it('a new workspace starts with the defaults', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    const rules = (await getRules(ws.conn))!
    for (const k of NC_PERIOD_KEYS) expect(rules[k]).toBe(DEFAULT_NC_PERIODS[k])
  })

  it('a save creates a version and an audit note naming the change', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    const next = await updateRules(ws.conn, { recoveryWeeks: 4 })
    expect(next.version).toBe(2)
    expect(next.recoveryWeeks).toBe(4)
    const note = (await ws.conn.runAndReadAll(
      `SELECT note FROM notes_events WHERE kind = 'ruleset_change' ORDER BY occurred_at DESC LIMIT 1`
    )).getRowObjects()[0].note
    expect(String(note)).toContain('Recovering lasts 3→4 weeks')
  })

  it('rejects contradictions and saves nothing', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await expect(updateRules(ws.conn, { persistentWeeks: 7 })).rejects.toThrow(/Persistent must be shorter than Chronic/)
    await expect(updateRules(ws.conn, { intermittentRuns: 2 })).rejects.toThrow(/from 3 to 10/)
    expect((await getRules(ws.conn))!.version).toBe(1)
  })

  it('an older workspace without the new columns opens with the defaults', { timeout: 30000 }, async () => {
    ws = await openRealWorkspace('3G')
    await ws.conn.run(`ALTER TABLE ruleset DROP COLUMN lookback_weeks`)
    await ws.conn.run(`ALTER TABLE ruleset DROP COLUMN recovery_months`)
    const manager = await import('../../src/main/workspace/manager')
    await manager.closeWorkspace()
    await manager.openWorkspace(join(ws.dir, 'test.qosdb'))
    ws.conn = manager.getCurrent()!.connection
    const rules = (await getRules(ws.conn))!
    expect(rules.lookbackWeeks).toBe(3)
    expect(rules.recoveryMonths).toBe(2)
  })
})
