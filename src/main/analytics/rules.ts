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
            prb_threshold_pct,
            COALESCE(tch_congestion_threshold_pct, 2.0) AS tch_congestion_threshold_pct,
            COALESCE(sdcch_congestion_threshold_pct, 2.0) AS sdcch_congestion_threshold_pct,
            COALESCE(cssr_threshold_pct, 98.5) AS cssr_threshold_pct,
            COALESCE(call_drop_threshold_pct, 1.5) AS call_drop_threshold_pct,
            COALESCE(data_access_threshold_pct, 98.0) AS data_access_threshold_pct,
            COALESCE(data_service_failure_threshold_pct, 1.0) AS data_service_failure_threshold_pct,
            CAST(weekly_breach_days AS DOUBLE) AS weekly_breach_days,
            CAST(persistent_weeks AS DOUBLE) AS persistent_weeks,
            CAST(COALESCE(chronic_weeks, 7) AS DOUBLE) AS chronic_weeks,
            district_nc_threshold_pct, priority_weights, kpi_thresholds, notes
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
  let kpiThresholds: Record<string, number> = {}
  if (row.kpi_thresholds) {
    try {
      const parsed = JSON.parse(String(row.kpi_thresholds))
      if (parsed && typeof parsed === 'object') kpiThresholds = parsed as Record<string, number>
    } catch {
      /* ignore */
    }
  }

  return {
    version: Number(row.version),
    createdAt: String(row.created_at ?? ''),
    prbThresholdPct: Number(row.prb_threshold_pct),
    tchCongestionThresholdPct: Number(row.tch_congestion_threshold_pct),
    sdcchCongestionThresholdPct: Number(row.sdcch_congestion_threshold_pct),
    cssrThresholdPct: Number(row.cssr_threshold_pct),
    callDropThresholdPct: Number(row.call_drop_threshold_pct),
    dataAccessThresholdPct: Number(row.data_access_threshold_pct),
    dataServiceFailureThresholdPct: Number(row.data_service_failure_threshold_pct),
    weeklyBreachDays: Number(row.weekly_breach_days ?? 1),
    persistentWeeks: Number(row.persistent_weeks ?? 3),
    chronicWeeks: Number(row.chronic_weeks ?? 7),
    districtNcThresholdPct: Number(row.district_nc_threshold_pct),
    priorityWeights: weights,
    kpiThresholds,
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
  if (patch.tchCongestionThresholdPct != null) {
    const p = Number(patch.tchCongestionThresholdPct)
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('TCH Congestion threshold must be between 0 and 100')
  }
  if (patch.sdcchCongestionThresholdPct != null) {
    const p = Number(patch.sdcchCongestionThresholdPct)
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('SDCCH Congestion threshold must be between 0 and 100')
  }
  if (patch.cssrThresholdPct != null) {
    const p = Number(patch.cssrThresholdPct)
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('CSSR target must be between 0 and 100')
  }
  if (patch.callDropThresholdPct != null) {
    const p = Number(patch.callDropThresholdPct)
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('Call Drop threshold must be between 0 and 100')
  }
  if (patch.dataAccessThresholdPct != null) {
    const p = Number(patch.dataAccessThresholdPct)
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('Data Access target must be between 0 and 100')
  }
  if (patch.dataServiceFailureThresholdPct != null) {
    const p = Number(patch.dataServiceFailureThresholdPct)
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('Data Service Failure threshold must be between 0 and 100')
  }
  if (patch.weeklyBreachDays != null) {
    const d = clampInt(patch.weeklyBreachDays, 1, 7, 1)
    if (d !== Math.round(Number(patch.weeklyBreachDays))) {
      throw new Error('Weekly breach days must be an integer between 1 and 7')
    }
  }
  if (patch.persistentWeeks != null) {
    const w = clampInt(patch.persistentWeeks, 1, 26, 3)
    if (w !== Math.round(Number(patch.persistentWeeks))) {
      throw new Error('Persistent streak must be an integer between 1 and 26')
    }
  }
  if (patch.chronicWeeks != null) {
    const w = clampInt(patch.chronicWeeks, 2, 52, 7)
    if (w !== Math.round(Number(patch.chronicWeeks))) {
      throw new Error('Chronic streak must be an integer between 2 and 52')
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
  const tchCong = patch.tchCongestionThresholdPct ?? current.tchCongestionThresholdPct
  const sdcchCong = patch.sdcchCongestionThresholdPct ?? current.sdcchCongestionThresholdPct
  const cssr = patch.cssrThresholdPct ?? current.cssrThresholdPct
  const callDrop = patch.callDropThresholdPct ?? current.callDropThresholdPct
  const dataAccess = patch.dataAccessThresholdPct ?? current.dataAccessThresholdPct
  const dataFailure = patch.dataServiceFailureThresholdPct ?? current.dataServiceFailureThresholdPct
  const breach = patch.weeklyBreachDays ?? current.weeklyBreachDays
  const persist = patch.persistentWeeks ?? current.persistentWeeks
  const chronic = patch.chronicWeeks ?? current.chronicWeeks
  const district = patch.districtNcThresholdPct ?? current.districtNcThresholdPct
  const kpiThresholds = patch.kpiThresholds ?? current.kpiThresholds ?? {}

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
         (version, prb_threshold_pct, tch_congestion_threshold_pct, sdcch_congestion_threshold_pct,
          cssr_threshold_pct, call_drop_threshold_pct, data_access_threshold_pct,
          data_service_failure_threshold_pct, weekly_breach_days, persistent_weeks,
          chronic_weeks, district_nc_threshold_pct, priority_weights, kpi_thresholds, notes)
       VALUES ((SELECT COALESCE(max(version), 0) FROM ruleset) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        prb, tchCong, sdcchCong, cssr, callDrop, dataAccess, dataFailure,
        breach, persist, chronic, district, JSON.stringify(weights),
        JSON.stringify(kpiThresholds), notes
      ]
    )
    const version = current.version + 1
    // Also sync the core KPI targets in kpi_defs so the whole application uses the new thresholds
    await conn.run(
      `UPDATE kpi_defs SET target = CASE
         WHEN kpi_key = 'prb_utilization' THEN ?
         WHEN kpi_key = 'tch_congestion' THEN ?
         WHEN kpi_key = 'sdcch_congestion' THEN ?
         WHEN kpi_key LIKE 'call_setup_success%' THEN ?
         WHEN kpi_key LIKE 'call_drop_rate%' THEN ?
         WHEN kpi_key = 'data_access_success_3g' THEN ?
         WHEN kpi_key = 'data_service_failure_4g' THEN ?
         ELSE target
       END WHERE is_core = true`,
      [prb, tchCong, sdcchCong, cssr, callDrop, dataAccess, dataFailure]
    )

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
          `TCH ${current.tchCongestionThresholdPct}→${tchCong}%, SDCCH ${current.sdcchCongestionThresholdPct}→${sdcchCong}%, ` +
          `CSSR ${current.cssrThresholdPct}→${cssr}%, CDR ${current.callDropThresholdPct}→${callDrop}%, ` +
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
