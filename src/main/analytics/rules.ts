import type { DuckDBConnection } from '@duckdb/node-api'
import type { Rules, RulesPatch } from '../../../shared/api'
import { recomputeAllAggregates } from '../import/aggregates'
import { refreshAllIntelligence } from './engine'
import {
  NC_PERIOD_FIELDS, NC_PERIOD_KEYS, DEFAULT_PRIORITY_WEIGHTS, ncPeriodProblem, type NcPeriodSettings
} from '../../../shared/ruleDefaults'
export { DEFAULT_PRIORITY_WEIGHTS }

/** Ruleset versioning (spec §63): changing rules creates a new version, never
 *  alters raw observations, recomputes derived intelligence, writes an audit
 *  event, and is referenced by every derived table. */

export async function getRules(conn: DuckDBConnection): Promise<Rules | null> {
  const r = await conn.runAndReadAll(`SELECT * FROM ruleset ORDER BY version DESC LIMIT 1`)
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

  const nc = Object.fromEntries(
    NC_PERIOD_KEYS.map((k) => [k, Number(row[NC_PERIOD_FIELDS[k].column] ?? NC_PERIOD_FIELDS[k].default)])
  ) as unknown as NcPeriodSettings

  return {
    ...nc,
    version: Number(row.version),
    createdAt: String(row.created_at ?? ''),
    prbThresholdPct: Number(row.prb_threshold_pct),
    tchCongestionThresholdPct: Number(row.tch_congestion_threshold_pct ?? 1.0),
    sdcchCongestionThresholdPct: Number(row.sdcch_congestion_threshold_pct ?? 1.0),
    cssrThresholdPct: Number(row.cssr_threshold_pct ?? 95.0),
    callDropThresholdPct: Number(row.call_drop_threshold_pct ?? 1.0),
    dataAccessThresholdPct: Number(row.data_access_threshold_pct ?? 95.0),
    dataServiceFailureThresholdPct: Number(row.data_service_failure_threshold_pct ?? 1.0),
    districtNcThresholdPct: Number(row.district_nc_threshold_pct),
    priorityWeights: weights,
    kpiThresholds,
    notes: row.notes ? String(row.notes) : null
  }
}

/** Ruleset version N+1 = the latest row with `columns` replaced. Applies
 *  `apply` (e.g. KPI target writes), recomputes every derived table and writes
 *  one audit note — all in one transaction (spec §63, §8.5). */
export async function newRulesetVersion(
  conn: DuckDBConnection,
  columns: Record<string, number | string>,
  note: string,
  apply?: () => Promise<void>
): Promise<Rules> {
  const current = await getRules(conn)
  if (!current) throw new Error('No ruleset exists in this workspace')
  const lit = (v: number | string): string => (typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`)
  const replace = Object.entries(columns).map(([col, v]) => `, ${lit(v)} AS ${col}`).join('')
  const version = current.version + 1
  await conn.run('BEGIN TRANSACTION')
  try {
    await conn.run(
      `INSERT INTO ruleset BY NAME
       SELECT * REPLACE (version + 1 AS version, now() AS created_at${replace})
       FROM ruleset ORDER BY version DESC LIMIT 1`
    )
    if (apply) await apply()
    await recomputeAllAggregates(conn)
    await refreshAllIntelligence(conn)
    await conn.run(
      `INSERT INTO notes_events (entity_type, entity_id, kind, note, author)
       VALUES ('ruleset', ?, 'ruleset_change', ?, 'app')`,
      [version, `Ruleset v${current.version} → v${version}: ${note}`]
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
  return fresh
}

/** Throws the first problem with `patch` applied on top of `current`. */
export function validateRules(patch: RulesPatch, current: Rules): void {
  const pct = (v: unknown, name: string): void => {
    if (v == null) return
    const p = Number(v)
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error(`${name} must be between 0 and 100`)
  }
  pct(patch.prbThresholdPct, 'PRB threshold')
  pct(patch.tchCongestionThresholdPct, 'TCH Congestion threshold')
  pct(patch.sdcchCongestionThresholdPct, 'SDCCH Congestion threshold')
  pct(patch.cssrThresholdPct, 'CSSR target')
  pct(patch.callDropThresholdPct, 'Call Drop threshold')
  pct(patch.dataAccessThresholdPct, 'Data Access target')
  pct(patch.dataServiceFailureThresholdPct, 'Data Service Failure threshold')
  pct(patch.districtNcThresholdPct, 'District NC threshold')
  const merged = Object.fromEntries(NC_PERIOD_KEYS.map((k) => [k, patch[k] ?? current[k]])) as unknown as NcPeriodSettings
  const problem = ncPeriodProblem(merged)
  if (problem) throw new Error(problem)
  if (patch.priorityWeights != null) {
    const w = patch.priorityWeights
    if (!Array.isArray(w) || w.length !== 6 || w.some((n) => typeof n !== 'number' || n < 0)) {
      throw new Error('Priority weights must be 6 non-negative numbers')
    }
    if (w.reduce((a, b) => a + b, 0) <= 0) throw new Error('Priority weights must sum to more than 0')
  }
}

/** Create a new ruleset version from `patch` (spec §63). */
export async function updateRules(conn: DuckDBConnection, patch: RulesPatch): Promise<Rules> {
  const current = await getRules(conn)
  if (!current) throw new Error('No ruleset exists in this workspace')
  validateRules(patch, current)

  const columns: Record<string, number | string> = {}
  const changes: string[] = []
  for (const k of NC_PERIOD_KEYS) {
    const v = patch[k]
    if (v == null) continue
    const fld = NC_PERIOD_FIELDS[k]
    columns[fld.column] = v
    if (v !== current[k]) changes.push(`${fld.label} ${current[k]}→${v} ${fld.unit}`)
  }
  const scalar: Array<[keyof RulesPatch, string, string]> = [
    ['prbThresholdPct', 'prb_threshold_pct', 'PRB'],
    ['tchCongestionThresholdPct', 'tch_congestion_threshold_pct', 'TCH'],
    ['sdcchCongestionThresholdPct', 'sdcch_congestion_threshold_pct', 'SDCCH'],
    ['cssrThresholdPct', 'cssr_threshold_pct', 'CSSR'],
    ['callDropThresholdPct', 'call_drop_threshold_pct', 'CDR'],
    ['dataAccessThresholdPct', 'data_access_threshold_pct', 'data access'],
    ['dataServiceFailureThresholdPct', 'data_service_failure_threshold_pct', 'data failure'],
    ['districtNcThresholdPct', 'district_nc_threshold_pct', 'district NC %']
  ]
  for (const [key, col, label] of scalar) {
    const v = patch[key] as number | undefined
    if (v == null) continue
    columns[col] = Number(v)
    if (Number(v) !== current[key]) changes.push(`${label} ${current[key]}→${v}`)
  }
  if (patch.priorityWeights != null) {
    const total = patch.priorityWeights.reduce((a, b) => a + b, 0)
    const weights = patch.priorityWeights.map((n) => Math.round((n / total) * 1000) / 10)
    const diff = 100 - weights.reduce((a, b) => a + b, 0)
    weights[0] = Math.round((weights[0] + diff) * 10) / 10
    columns.priority_weights = JSON.stringify(weights)
    changes.push(`priority weights ${current.priorityWeights.join('/')}→${weights.join('/')}`)
  }
  if (patch.notes != null) columns.notes = patch.notes

  const prb = patch.prbThresholdPct
  return newRulesetVersion(conn, columns, changes.join(', ') || 'no setting changed', async () => {
    // Removed in Task 5, when kpi_defs becomes the only owner of targets.
    if (prb != null) {
      await conn.run(`UPDATE kpi_defs SET target = ? WHERE kpi_key = 'prb_utilization' AND is_core`, [prb])
    }
  })
}
