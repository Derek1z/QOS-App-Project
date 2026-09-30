import type { DuckDBConnection } from '@duckdb/node-api'
import type { Technology } from '../../../shared/api'

/** KPI targets have one owner: kpi_defs (spec 2026-09-29 §8). Every reader
 *  goes through here; nothing else stores or defaults a target. */

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`

export function kpiTargetSql(technology: Technology, key: string): string {
  return `(SELECT max(target) FROM kpi_defs WHERE technology = ${q(technology)} AND kpi_key = ${q(key)})`
}

/** 4G Peak Hour Traffic Utilization — a core NCA KPI like the others. */
export const PRB_TARGET_SQL = kpiTargetSql('4G', 'prb_utilization')

export async function getKpiTarget(conn: DuckDBConnection, technology: Technology, key: string): Promise<number | null> {
  const v = (await conn.runAndReadAll(`SELECT ${kpiTargetSql(technology, key)} AS t`)).getRowObjects()[0]?.t
  return v == null ? null : Number(v)
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
