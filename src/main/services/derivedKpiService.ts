import type { DuckDBConnection } from '@duckdb/node-api'
import type { Technology, DerivedKPI, DerivedKpiSuggestion, DerivedOperation, KpiDefinition } from '../../../shared/api'
import { BUILTIN_DERIVED_KPIS } from '../../../shared/api'
import { normalizeHeader } from '../import/mapping'
import { listKpiDefs, saveKpiDef } from './kpiService'
import { saveKpiTargets } from './targetService'

/**
 * Derived KPI & Formula Engine
 * Computes derived metrics (e.g., 3G DL Power Congestion, UL CE Congestion, PhyCh Failures)
 * row-by-row with strict null and missing counter handling.
 */

export async function ensureDerivedKpiSchema(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS derived_kpi_defs (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      technology VARCHAR NOT NULL CHECK (technology IN ('2G', '3G', '4G')),
      operation VARCHAR NOT NULL DEFAULT 'SUM',
      source_kpis JSON NOT NULL,
      unit VARCHAR DEFAULT '',
      target DOUBLE,
      warning_threshold DOUBLE,
      critical_threshold DOUBLE,
      direction VARCHAR DEFAULT 'lower_is_better',
      category VARCHAR DEFAULT 'Congestion',
      is_core BOOLEAN DEFAULT false,
      enabled BOOLEAN DEFAULT true,
      treat_missing_as_zero BOOLEAN DEFAULT false,
      description VARCHAR,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )
  `)

  // Seed built-in derived definitions if not present
  for (const b of BUILTIN_DERIVED_KPIS) {
    const safeId = b.id.replace(/'/g, "''")
    const safeName = b.name.replace(/'/g, "''")
    const safeTech = b.technology.replace(/'/g, "''")
    const safeSources = JSON.stringify(b.sourceKPIs).replace(/'/g, "''")
    const safeUnit = (b.unit ?? '').replace(/'/g, "''")
    const targetVal = b.target == null ? 'NULL' : Number(b.target)
    const warnVal = b.warningThreshold == null ? 'NULL' : Number(b.warningThreshold)
    const critVal = b.criticalThreshold == null ? 'NULL' : Number(b.criticalThreshold)
    const safeDir = (b.direction ?? 'lower_is_better').replace(/'/g, "''")
    const safeCat = (b.category ?? 'Congestion').replace(/'/g, "''")
    const safeDesc = (b.description ?? '').replace(/'/g, "''")

    await conn.run(`
      INSERT INTO derived_kpi_defs
        (id, name, technology, operation, source_kpis, unit, target, warning_threshold,
         critical_threshold, direction, category, is_core, enabled, treat_missing_as_zero, description)
      VALUES
        ('${safeId}', '${safeName}', '${safeTech}', '${b.operation}', '${safeSources}', '${safeUnit}',
         ${targetVal}, ${warnVal}, ${critVal}, '${safeDir}', '${safeCat}', ${Boolean(b.isCore)},
         ${Boolean(b.enabled)}, ${Boolean(b.treatMissingAsZero)}, '${safeDesc}')
      ON CONFLICT (id) DO NOTHING
    `)
  }
}

export async function listDerivedKpis(
  conn: DuckDBConnection,
  technology?: Technology
): Promise<DerivedKPI[]> {
  await ensureDerivedKpiSchema(conn)
  const where = technology ? `WHERE d.technology = '${technology.replace(/'/g, "''")}'` : ''
  // kpi_defs owns the target, thresholds, direction and core flag once the
  // KPI exists there; derived_kpi_defs only holds the formula and the seed
  // values used to create it.
  const own = (col: string, seedCol = col): string => `CASE WHEN k.kpi_id IS NULL THEN d.${seedCol} ELSE k.${col} END AS ${seedCol}`
  const r = await conn.runAndReadAll(`
    SELECT d.id, d.name, d.technology, d.operation, d.source_kpis, d.unit,
           ${own('target')}, ${own('warning_threshold')}, ${own('critical_threshold')},
           ${own('better_direction', 'direction')}, d.category,
           ${own('is_core')}, d.enabled, d.treat_missing_as_zero, d.description
    FROM derived_kpi_defs d
    LEFT JOIN kpi_defs k ON k.technology = d.technology AND k.kpi_key = d.id
    ${where}
    ORDER BY d.technology, d.id
  `)

  return r.getRowObjects().map((row) => {
    let sourceKPIs: string[] = []
    try {
      sourceKPIs = JSON.parse(String(row.source_kpis ?? '[]'))
    } catch {
      sourceKPIs = []
    }
    return {
      id: String(row.id),
      name: String(row.name),
      technology: String(row.technology) as Technology,
      operation: String(row.operation) as DerivedOperation,
      sourceKPIs,
      unit: String(row.unit ?? ''),
      target: row.target == null ? null : Number(row.target),
      warningThreshold: row.warning_threshold == null ? null : Number(row.warning_threshold),
      criticalThreshold: row.critical_threshold == null ? null : Number(row.critical_threshold),
      direction: String(row.direction ?? 'lower_is_better') as 'higher_is_better' | 'lower_is_better',
      category: row.category ? (String(row.category) as never) : 'Congestion',
      isCore: Boolean(row.is_core),
      isDerived: true,
      enabled: Boolean(row.enabled),
      treatMissingAsZero: Boolean(row.treat_missing_as_zero),
      description: row.description ? String(row.description) : undefined
    }
  })
}

export async function saveDerivedKpi(
  conn: DuckDBConnection,
  def: DerivedKPI
): Promise<DerivedKPI> {
  await ensureDerivedKpiSchema(conn)
  const safeId = def.id.replace(/'/g, "''")
  const safeName = def.name.replace(/'/g, "''")
  const safeTech = def.technology.replace(/'/g, "''")
  const safeSources = JSON.stringify(def.sourceKPIs).replace(/'/g, "''")
  const safeUnit = (def.unit ?? '').replace(/'/g, "''")
  const targetVal = def.target == null ? 'NULL' : Number(def.target)
  const warnVal = def.warningThreshold == null ? 'NULL' : Number(def.warningThreshold)
  const critVal = def.criticalThreshold == null ? 'NULL' : Number(def.criticalThreshold)
  const safeDir = (def.direction ?? 'lower_is_better').replace(/'/g, "''")
  const safeCat = (def.category ?? 'Congestion').replace(/'/g, "''")
  const safeDesc = (def.description ?? '').replace(/'/g, "''")

  await conn.run(`
    INSERT INTO derived_kpi_defs
      (id, name, technology, operation, source_kpis, unit, target, warning_threshold,
       critical_threshold, direction, category, is_core, enabled, treat_missing_as_zero, description, updated_at)
    VALUES
      ('${safeId}', '${safeName}', '${safeTech}', '${def.operation}', '${safeSources}', '${safeUnit}',
       ${targetVal}, ${warnVal}, ${critVal}, '${safeDir}', '${safeCat}', ${Boolean(def.isCore)},
       ${Boolean(def.enabled)}, ${Boolean(def.treatMissingAsZero)}, '${safeDesc}', now())
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      technology = excluded.technology,
      operation = excluded.operation,
      source_kpis = excluded.source_kpis,
      unit = excluded.unit,
      category = excluded.category,
      enabled = excluded.enabled,
      treat_missing_as_zero = excluded.treat_missing_as_zero,
      description = excluded.description,
      updated_at = now()
  `)

  // kpi_defs owns the target, thresholds, direction, core flag and on/off
  // (single source of truth): create the definition there once, after that
  // only an on/off change is forwarded, through the target service so it
  // versions the ruleset and recomputes like any other target edit.
  const existing = await findKpiDef(conn, def)
  if (!existing) {
    await createKpiDef(conn, def)
  } else if (existing.active !== (def.enabled ?? true)) {
    await saveKpiTargets(conn, [{ technology: def.technology, key: def.id, active: def.enabled ?? true }])
  }

  return (await listDerivedKpis(conn, def.technology)).find((d) => d.id === def.id) ?? def
}

/** The import's step for each enabled derived KPI: create its kpi_defs
 *  definition if it has none, never change one that exists. */
export async function ensureDerivedKpiDef(conn: DuckDBConnection, def: DerivedKPI): Promise<void> {
  if (!(await findKpiDef(conn, def))) await createKpiDef(conn, def)
}

async function findKpiDef(conn: DuckDBConnection, def: DerivedKPI): Promise<KpiDefinition | undefined> {
  return (await listKpiDefs(conn, def.technology)).find((k) => k.key === def.id)
}

async function createKpiDef(conn: DuckDBConnection, def: DerivedKPI): Promise<void> {
  await saveKpiDef(conn, {
    technology: def.technology,
    key: def.id,
    label: def.name,
    unit: def.unit ?? '',
    target: def.target,
    warningThreshold: def.warningThreshold,
    criticalThreshold: def.criticalThreshold,
    betterDirection: def.direction ?? 'lower_is_better',
    worseIsHigher: (def.direction ?? 'lower_is_better') === 'lower_is_better',
    category: (def.category as never) ?? 'Congestion',
    isCore: def.isCore ?? false,
    showInExecutiveView: true,
    isCustom: false,
    active: def.enabled ?? true
  })
}

/**
 * Detects which derived KPIs can be constructed from the given list of source headers.
 */
export function detectDerivedKpiSuggestions(
  headers: string[],
  technology?: Technology | null
): DerivedKpiSuggestion[] {
  const normHeaders = headers.map(normalizeHeader)
  const allDerived = BUILTIN_DERIVED_KPIS

  const suggestions: DerivedKpiSuggestion[] = []

  for (const def of allDerived) {
    if (technology && def.technology !== technology) continue

    const matchedSources: string[] = []
    const missingSources: string[] = []

    for (const src of def.sourceKPIs) {
      const normSrc = normalizeHeader(src)
      const found = headers.find((h, idx) => {
        const nh = normHeaders[idx]
        const lh = h.toLowerCase()
        const lsrc = src.toLowerCase()
        return (
          nh === normSrc ||
          lh === lsrc ||
          nh.endsWith(normSrc) ||
          lh.endsWith(lsrc) ||
          lh.includes(lsrc)
        )
      })
      if (found) {
        matchedSources.push(found)
      } else {
        missingSources.push(src)
      }
    }

    if (matchedSources.length > 0) {
      suggestions.push({
        derivedKpi: def,
        canCalculate: missingSources.length === 0,
        matchedSources,
        missingSources
      })
    }
  }

  return suggestions
}

/**
 * Evaluates a single derived formula on a key-value record of counter numbers.
 */
export function evaluateDerivedRow(
  valuesByCounter: Record<string, number | null | undefined>,
  def: DerivedKPI
): number | null {
  const nums: number[] = []

  for (const src of def.sourceKPIs) {
    const normSrc = normalizeHeader(src)
    const lsrc = src.toLowerCase()

    // try exact key, normalized key, lowercase key, and suffix/vendor-prefixed key
    let v = valuesByCounter[src] ?? valuesByCounter[normSrc] ?? valuesByCounter[lsrc]
    if (v == null) {
      for (const [k, val] of Object.entries(valuesByCounter)) {
        const lk = k.toLowerCase()
        if (lk.endsWith(lsrc) || lk.includes(lsrc) || normalizeHeader(k).endsWith(normSrc)) {
          v = val
          break
        }
      }
    }

    if (v == null || !Number.isFinite(v)) {
      if (def.treatMissingAsZero) {
        nums.push(0)
      } else {
        return null // strict null propagation
      }
    } else {
      nums.push(Number(v))
    }
  }

  if (nums.length === 0) return null

  switch (def.operation) {
    case 'SUM':
      return nums.reduce((a, b) => a + b, 0)
    case 'AVERAGE':
      return nums.reduce((a, b) => a + b, 0) / nums.length
    case 'RATIO':
      return nums.length >= 2 && nums[1] !== 0 ? nums[0] / nums[1] : null
    case 'CUSTOM':
    default:
      return nums.reduce((a, b) => a + b, 0)
  }
}
