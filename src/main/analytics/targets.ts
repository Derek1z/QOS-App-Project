import type { DuckDBConnection } from '@duckdb/node-api'
import type { Technology } from '../../../shared/api'

/** KPI targets have one owner: kpi_defs (spec 2026-09-29 §8). Every reader
 *  goes through here; nothing else stores or defaults a target.
 *
 *  services/kpiService is imported dynamically inside getKpiTarget, not at
 *  module scope: schema.ts builds AGG_CELL_DAILY_SELECT from
 *  analytics/ncRule's coreBreachDaysSql, which needs PRB_TARGET_SQL from this
 *  file, and kpiService reaches back to schema.ts through workspace/manager —
 *  a static import here would close that cycle. */

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`

export function kpiTargetSql(technology: Technology, key: string): string {
  return `(SELECT max(target) FROM kpi_defs WHERE technology = ${q(technology)} AND kpi_key = ${q(key)})`
}

/** 4G Peak Hour Traffic Utilization — a core NCA KPI like the others. */
export const PRB_TARGET_SQL = kpiTargetSql('4G', 'prb_utilization')

export async function getKpiTarget(conn: DuckDBConnection, technology: Technology, key: string): Promise<number | null> {
  const v = (await conn.runAndReadAll(`SELECT ${kpiTargetSql(technology, key)} AS t`)).getRowObjects()[0]?.t
  if (v != null) return Number(v)
  // Lazy-seed like kpiService.listKpiDefs: a workspace whose kpi_defs table
  // hasn't been populated yet for this technology (e.g. a bare schema in a
  // low-level import test) gets the built-in seeds, including their default
  // targets, on first read instead of silently missing the NC rule.
  const has = (await conn.runAndReadAll(
    `SELECT count(*) AS n FROM kpi_defs WHERE technology = ${q(technology)}`
  )).getRowObjects()[0]?.n
  if (Number(has) > 0) return null
  const { seedKpiDefs } = await import('../services/kpiService')
  await seedKpiDefs(conn, technology)
  const retry = (await conn.runAndReadAll(`SELECT ${kpiTargetSql(technology, key)} AS t`)).getRowObjects()[0]?.t
  return retry == null ? null : Number(retry)
}

export async function getPrbTarget(conn: DuckDBConnection): Promise<number> {
  const t = await getKpiTarget(conn, '4G', 'prb_utilization')
  if (t == null) throw new Error('4G Peak Hour Traffic Utilization has no target in the KPI registry')
  return t
}

export interface CoreTargets {
  prb: number
  tchCongestion: number
  sdcchCongestion: number
  cssr: number
  callDrop: number
  dataAccess: number
  dataFailure: number
}

/** Targets of the core KPIs of `technology`. NaN when the technology has no
 *  such KPI: every comparison with NaN is false, so no finding fires. 3G has
 *  no utilization KPI, so every technology's capacity threshold is the 4G PRB
 *  target (spec §8.2 A5). */
export async function getCoreTargets(conn: DuckDBConnection, technology: Technology): Promise<CoreTargets> {
  const t = technology.toLowerCase()
  const keys: Record<keyof CoreTargets, [Technology, string]> = {
    prb: ['4G', 'prb_utilization'],
    tchCongestion: [technology, technology === '2G' ? 'tch_congestion' : ''],
    sdcchCongestion: [technology, technology === '2G' ? 'sdcch_congestion' : ''],
    cssr: [technology, `call_setup_success_${t}`],
    callDrop: [technology, `call_drop_rate_${t}`],
    dataAccess: [technology, technology === '3G' ? 'data_access_success_3g' : ''],
    dataFailure: [technology, technology === '4G' ? 'data_service_failure_4g' : '']
  }
  const out = {} as CoreTargets
  for (const [name, [tech, key]] of Object.entries(keys) as Array<[keyof CoreTargets, [Technology, string]]>) {
    const v = key ? await getKpiTarget(conn, tech, key) : null
    out[name] = v ?? Number.NaN
  }
  return out
}
