import type { DuckDBConnection } from '@duckdb/node-api'
import type { KpiDefinition, KpiDefPatch, Technology } from '../../../shared/api'
import { listKpiDefs, saveKpiDef, resetKpiDefsToDefaults, workspaceTechnology } from './kpiService'
import { newRulesetVersion } from '../analytics/rules'
import { getCurrent } from '../workspace/manager'

/** Saving KPI definitions (spec §8.2 A6, A8). A change to a field the NC rule
 *  reads — target, direction, core flag, active — creates a new ruleset
 *  version and recomputes, in one transaction; other edits save directly. */

const NC_FIELDS = ['target', 'worseIsHigher', 'isCore', 'active'] as const

export async function saveKpiTargets(conn: DuckDBConnection, patches: KpiDefPatch[]): Promise<KpiDefinition[]> {
  const fallbackTech = await workspaceTechnology(conn)
  const changes: string[] = []
  for (const p of patches) {
    const tech = (p.technology ?? fallbackTech) as Technology
    const existing = (await listKpiDefs(conn, tech)).find((k) => (p.kpiId != null ? k.kpiId === p.kpiId : k.key === p.key))
    const isCore = p.isCore ?? existing?.isCore ?? false
    const target = p.target !== undefined ? p.target : existing?.target
    if (isCore && (target == null || !Number.isFinite(Number(target)))) {
      throw new Error(`${existing?.label ?? p.key} is a core NCA KPI and needs a target`)
    }
    if (!existing) continue
    for (const f of NC_FIELDS) {
      const before = existing[f]
      const after = p[f]
      if (after !== undefined && after !== before) changes.push(`${tech} ${existing.key} ${f} ${before}→${after}`)
    }
  }

  const saved: KpiDefinition[] = []
  const apply = async (): Promise<void> => {
    for (const p of patches) saved.push(await saveKpiDef(conn, p))
  }
  if (changes.length === 0) {
    await apply()
    return saved
  }
  await newRulesetVersion(conn, {}, `targets: ${changes.join('; ')}`, apply)
  return saved
}

export async function resetKpiTargets(conn: DuckDBConnection, technology?: Technology): Promise<KpiDefinition[]> {
  let reset: KpiDefinition[] = []
  await newRulesetVersion(conn, {}, `targets reset to defaults${technology ? ` (${technology})` : ''}`, async () => {
    reset = await resetKpiDefsToDefaults(conn, technology)
  })
  return reset
}

function conn(): DuckDBConnection {
  const w = getCurrent()
  if (!w) throw new Error('No workspace is open')
  return w.connection
}

export function saveKpiTargetsCurrent(patches: KpiDefPatch[]): Promise<KpiDefinition[]> {
  return saveKpiTargets(conn(), patches)
}

export function resetKpiTargetsCurrent(technology?: Technology): Promise<KpiDefinition[]> {
  return resetKpiTargets(conn(), technology)
}
