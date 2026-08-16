import type { DuckDBConnection } from '@duckdb/node-api'
import type { Rules, RulesPatch } from '../../../shared/api'
import { PRIORITY_MODES } from '../../../shared/api'
import { recomputeAllAggregates } from '../import/aggregates'
import { refreshAllIntelligence } from './engine'

/** Ruleset versioning (spec §63): changing rules creates a new version, never
 *  alters raw observations, recomputes derived intelligence, writes an audit
 *  event, and is referenced by every derived table. */

export const DEFAULT_PRIORITY_WEIGHTS = [25, 20, 15, 15, 15, 10]

export async function getRules(conn: DuckDBConnection): Promise<Rules | null> {
  const r = await conn.runAndReadAll(
    `SELECT CAST(version AS DOUBLE) AS version, CAST(created_at AS VARCHAR) AS created_at,
            prb_threshold_pct, CAST(weekly_breach_days AS DOUBLE) AS weekly_breach_days,
            CAST(persistent_weeks AS DOUBLE) AS persistent_weeks,
            district_nc_threshold_pct, priority_weights, notes
     FROM ruleset ORDER BY version DESC LIMIT 1`
  )
  const row = r.getRowObjects()[0]
  if (!row) return null
  let weights = DEFAULT_PRIORITY_WEIGHTS
  if (row.priority_weights) {
    try {
      const parsed = JSON.parse(String(row.priority_weights))
      if (Array.isArray(parsed) && parsed.length === 6 && parsed.every((n) => typeof n === 'number')) {
        weights = parsed
      }
    } catch {
      /* fall back to defaults */
    }
  }
  return {
    version: Number(row.version),
    createdAt: String(row.created_at ?? ''),
    prbThresholdPct: Number(row.prb_threshold_pct),
    weeklyBreachDays: Number(row.weekly_breach_days ?? 1),
    persistentWeeks: Number(row.persistent_weeks ?? 3),
    districtNcThresholdPct: Number(row.district_nc_threshold_pct),
    priorityWeights: weights,
    notes: row.notes ? String(row.notes) : null
  }
}

function clampInt(v: unknown, lo: number, hi: number, def: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return def
  return Math.min(hi, Math.max(lo, n))
}

export function validateRules(patch: RulesPatch): void {
  if (patch.prbThresholdPct != null) {
    const p = Number(patch.prbThresholdPct)
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('PRB threshold must be between 0 and 100')
  }
  if (patch.weeklyBreachDays != null) {
    const d = clampInt(patch.weeklyBreachDays, 1, 7, 1)
    if (d !== Math.round(Number(patch.weeklyBreachDays))) {
      throw new Error('Weekly breach days must be an integer between 1 and 7')
    }
  }
  if (patch.persistentWeeks != null) {
    const w = clampInt(patch.persistentWeeks, 2, 12, 3)
    if (w !== Math.round(Number(patch.persistentWeeks))) {
      throw new Error('Persistent weeks must be an integer between 2 and 12')
    }
  }
  if (patch.districtNcThresholdPct != null) {
    const p = Number(patch.districtNcThresholdPct)
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('District NC threshold must be between 0 and 100')
  }
  if (patch.priorityWeights != null) {
    const w = patch.priorityWeights
    if (!Array.isArray(w) || w.length !== 6 || w.some((n) => typeof n !== 'number' || n < 0)) {
      throw new Error('Priority weights must be 6 non-negative numbers')
    }
    const total = w.reduce((a, b) => a + b, 0)
    if (total <= 0) throw new Error('Priority weights must sum to more than 0')
  }
}

/** Create a new ruleset version, recompute aggregates + derived intelligence
 *  under the new rules, and write an audit event (spec §63). */
export async function updateRules(conn: DuckDBConnection, patch: RulesPatch): Promise<Rules> {
  const current = await getRules(conn)
  if (!current) throw new Error('No ruleset exists in this workspace')
  validateRules(patch)

  const prb = patch.prbThresholdPct ?? current.prbThresholdPct
  const breach = patch.weeklyBreachDays ?? current.weeklyBreachDays
  const persist = patch.persistentWeeks ?? current.persistentWeeks
  const district = patch.districtNcThresholdPct ?? current.districtNcThresholdPct
  let weights = current.priorityWeights
  if (patch.priorityWeights != null) {
    const total = patch.priorityWeights.reduce((a, b) => a + b, 0)
    weights = patch.priorityWeights.map((n) => Math.round((n / total) * 1000) / 10)
    // keep the weights summing to exactly 100 after rounding
    const diff = 100 - weights.reduce((a, b) => a + b, 0)
    weights[0] = Math.round((weights[0] + diff) * 10) / 10
  }
  const notes = patch.notes ?? current.notes ?? ''

  await conn.run('BEGIN TRANSACTION')
  try {
    await conn.run(
      `INSERT INTO ruleset
         (version, prb_threshold_pct, weekly_breach_days, persistent_weeks,
          district_nc_threshold_pct, priority_weights, notes)
       VALUES ((SELECT COALESCE(max(version), 0) FROM ruleset) + 1, ?, ?, ?, ?, ?, ?)`,
      [prb, breach, persist, district, JSON.stringify(weights), notes]
    )
    const version = current.version + 1
    // Recompute everything under the new rules: aggregates carry is_nc flags and
    // intelligence tables embed the ruleset version.
    await recomputeAllAggregates(conn)
    await refreshAllIntelligence(conn)
    await conn.run(
      `INSERT INTO notes_events (entity_type, entity_id, kind, note, author)
       VALUES ('ruleset', ?, 'ruleset_change', ?, 'app')`,
      [
        version,
        `Ruleset v${current.version} → v${version}: PRB ${current.prbThresholdPct}→${prb}%, ` +
          `breach ${current.weeklyBreachDays}→${breach}d, persistent ${current.persistentWeeks}→${persist}w, ` +
          `district NC ${current.districtNcThresholdPct}→${district}%`
      ]
    )
    await conn.run('COMMIT')
  } catch (e) {
    try {
      await conn.run('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw new Error(`Ruleset update failed and was rolled back: ${e instanceof Error ? e.message : String(e)}`)
  }
  const fresh = await getRules(conn)
  if (!fresh) throw new Error('Ruleset disappeared after update')
  void PRIORITY_MODES
  return fresh
}
