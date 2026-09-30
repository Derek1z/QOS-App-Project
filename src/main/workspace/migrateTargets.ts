import type { DuckDBConnection } from '@duckdb/node-api'
import type { Technology } from '../../../shared/api'

/** One-time upgrade (spec §8.5). Before kpi_defs owned KPI targets, the
 *  ruleset kept its own copies. Carry a copy someone changed from its old
 *  default into kpi_defs — unless kpi_defs was edited too (kpi_defs wins).
 *  The numbers below are the old schema's column defaults, not live defaults. */
const LEGACY: Array<{ column: string; oldDefault: number; keys: Array<[Technology, string]> }> = [
  { column: 'prb_threshold_pct', oldDefault: 80, keys: [['4G', 'prb_utilization']] },
  { column: 'tch_congestion_threshold_pct', oldDefault: 1, keys: [['2G', 'tch_congestion']] },
  { column: 'sdcch_congestion_threshold_pct', oldDefault: 1, keys: [['2G', 'sdcch_congestion']] },
  {
    column: 'cssr_threshold_pct', oldDefault: 95,
    keys: [['2G', 'call_setup_success_2g'], ['3G', 'call_setup_success_3g'], ['4G', 'call_setup_success_4g']]
  },
  {
    column: 'call_drop_threshold_pct', oldDefault: 1,
    keys: [['2G', 'call_drop_rate_2g'], ['3G', 'call_drop_rate_3g'], ['4G', 'call_drop_rate_4g']]
  },
  { column: 'data_access_threshold_pct', oldDefault: 95, keys: [['3G', 'data_access_success_3g']] },
  { column: 'data_service_failure_threshold_pct', oldDefault: 1, keys: [['4G', 'data_service_failure_4g']] }
]

export async function migrateLegacyTargets(conn: DuckDBConnection): Promise<void> {
  const done = (await conn.runAndReadAll(
    `SELECT value FROM workspace_meta WHERE key = 'targets_owner'`
  )).getRowObjects()[0]
  if (done) return
  const row = (await conn.runAndReadAll(`SELECT * FROM ruleset ORDER BY version DESC LIMIT 1`)).getRowObjects()[0] ?? {}
  for (const { column, oldDefault, keys } of LEGACY) {
    const v = row[column]
    if (v == null || Number(v) === oldDefault) continue
    for (const [tech, key] of keys) {
      await conn.run(
        `UPDATE kpi_defs SET target = ?, updated_at = now()
         WHERE technology = ? AND kpi_key = ? AND target = ?`,
        [Number(v), tech, key, oldDefault]
      )
    }
  }
  await conn.run(`INSERT OR REPLACE INTO workspace_meta (key, value) VALUES ('targets_owner', 'kpi_defs')`)
}
