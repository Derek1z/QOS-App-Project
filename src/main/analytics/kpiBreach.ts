import type { DuckDBConnection } from '@duckdb/node-api'

/** spec §54a: 0-100 breach severity per cell from its imported KPI values vs
 *  the editable targets of the workspace's technology. Higher-worse KPIs breach
 *  above the target, lower-worse below it; magnitude scales with how far past
 *  the target the value sits. Standalone module so the analytics engine can
 *  import it without pulling the workspace manager into a bundle cycle. */
export async function cellKpiBreachByCell(
  conn: DuckDBConnection,
  cellIds: number[],
  weekStart: string | null
): Promise<Map<number, number>> {
  const out = new Map<number, number>()
  if (cellIds.length === 0) return out
  const techR = await conn.runAndReadAll(
    `SELECT value FROM workspace_meta WHERE key = 'technology'`
  )
  const raw = techR.getRowObjects()[0]?.value
  const tech = raw === '2G' || raw === '3G' ? String(raw) : '4G'

  const r = await conn.runAndReadAll(
    `SELECT w.cell_id, k.worse_is_higher, k.target,
       CASE k.agg
         WHEN 'sum' THEN w.sum_value
         WHEN 'max' THEN w.max_value
         WHEN 'min' THEN w.min_value
         ELSE w.avg_value
       END AS value
     FROM agg_cell_kpi_weekly w
     JOIN kpi_defs k ON k.kpi_id = w.kpi_id
     WHERE w.cell_id IN (${cellIds.join(',')})
       AND k.technology = ? AND k.active AND k.target IS NOT NULL
       ${weekStart ? `AND w.week_start = ?` : ''}`,
    weekStart ? [tech, weekStart] : [tech]
  )
  const acc = new Map<number, { sum: number; n: number }>()
  for (const x of r.getRowObjects()) {
    const cellId = Number(x.cell_id)
    const value = x.value == null ? null : Number(x.value)
    const target = x.target == null ? null : Number(x.target)
    if (value == null || target == null || target === 0) continue
    const worseIsHigher = Boolean(x.worse_is_higher)
    const severity = worseIsHigher
      ? Math.min(100, Math.max(0, ((value - target) / target) * 100))
      : Math.min(100, Math.max(0, ((target - value) / target) * 100))
    const a = acc.get(cellId) ?? { sum: 0, n: 0 }
    a.sum += severity
    a.n += 1
    acc.set(cellId, a)
  }
  for (const [cellId, a] of acc) {
    out.set(cellId, a.n > 0 ? Math.round((a.sum / a.n) * 10) / 10 : 0)
  }
  return out
}
