import type { DuckDBConnection } from '@duckdb/node-api'
import type { KpiDefinition, KpiDefPatch, Technology } from '../../../shared/api'
import { listKpiDefs, saveKpiDef, resetKpiDefsToDefaults, workspaceTechnology, builtInSeeds } from './kpiService'
import { newRulesetVersion } from '../analytics/rules'
import { getCurrent } from '../workspace/manager'

/** Saving KPI definitions (spec §8.2 A6, A8). A change to a field the NC rule
 *  reads — target, direction, core flag, active — creates a new ruleset
 *  version and recomputes, in one transaction; other edits save directly. */

const NC_FIELDS = ['target', 'worseIsHigher', 'isCore', 'active'] as const

export async function saveKpiTargets(conn: DuckDBConnection, patches: KpiDefPatch[]): Promise<KpiDefinition[]> {
  const fallbackTech = await workspaceTechnology(conn)
  const changes: string[] = []
  const normalized: KpiDefPatch[] = []
  for (const rawPatch of patches) {
    const tech = (rawPatch.technology ?? fallbackTech) as Technology
    const existing = (await listKpiDefs(conn, tech)).find((k) => (rawPatch.kpiId != null ? k.kpiId === rawPatch.kpiId : k.key === rawPatch.key))

    // A direction edit only carries `betterDirection` from the UI; the NC
    // rule reads `worseIsHigher`, so derive it here and fold it into the
    // patch — otherwise a flipped direction saves with no version and the
    // edit reverts on reload (review finding #1).
    const p: KpiDefPatch = (rawPatch.betterDirection !== undefined && rawPatch.worseIsHigher === undefined)
      ? { ...rawPatch, worseIsHigher: rawPatch.betterDirection === 'lower_is_better' }
      : rawPatch
    normalized.push(p)

    const isCore = p.isCore ?? existing?.isCore ?? false
    const target = p.target !== undefined ? p.target : existing?.target
    if (isCore && (target == null || !Number.isFinite(Number(target)))) {
      throw new Error(`${existing?.label ?? p.key} is a core NCA KPI and needs a target`)
    }
    // A core KPI can't be demoted out of core status either — that's the
    // same protection in two steps: drop `isCore`, then remove or clear the
    // target (review finding #4).
    if (existing?.isCore && p.isCore === false) {
      throw new Error(`${existing.label} is a core NCA KPI and must stay core`)
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
    for (const p of normalized) saved.push(await saveKpiDef(conn, p))
  }
  if (changes.length === 0) {
    await apply()
    return saved
  }
  await newRulesetVersion(conn, {}, `targets: ${changes.join('; ')}`, apply)
  return saved
}

export async function resetKpiTargets(conn: DuckDBConnection, technology?: Technology): Promise<KpiDefinition[]> {
  const techs: Technology[] = technology ? [technology] : ['2G', '3G', '4G']
  const changes: string[] = []
  for (const tech of techs) {
    const current = await listKpiDefs(conn, tech)
    for (const seed of builtInSeeds(tech)) {
      const existing = current.find((k) => k.key === seed.key)
      if (!existing) continue
      const defaults: Record<(typeof NC_FIELDS)[number], unknown> = {
        target: seed.target,
        worseIsHigher: seed.worseIsHigher,
        isCore: seed.isCore,
        active: true
      }
      for (const f of NC_FIELDS) {
        const before = existing[f]
        const after = defaults[f]
        if (after !== before) changes.push(`${tech} ${seed.key} ${f} ${before}→${after}`)
      }
    }
  }

  if (changes.length === 0) {
    return resetKpiDefsToDefaults(conn, technology)
  }
  let reset: KpiDefinition[] = []
  await newRulesetVersion(
    conn,
    {},
    `targets reset to defaults${technology ? ` (${technology})` : ''}: ${changes.join('; ')}`,
    async () => {
      reset = await resetKpiDefsToDefaults(conn, technology)
    }
  )
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
