import type { DuckDBConnection } from '@duckdb/node-api'

/** Transparent data quality scoring (spec §17): cell coverage, KPI completeness,
 *  rejected rows, mapping confidence and duplicate behavior. */
export async function writeQuality(
  conn: DuckDBConnection,
  dateIds: number[],
  stats: { sourceRows: number; rejectedRows: number; duplicatesIgnored: number; confidence: number }
): Promise<number> {
  if (dateIds.length === 0) return 0
  const idList = dateIds.join(',')
  const r = await conn.runAndReadAll(`
    SELECT
      d.date_id,
      COALESCE(cv.coverage_pct, 100) AS coverage_pct,
      ROUND(100.0 * (
        (avg(CASE WHEN f.prb_utilization IS NOT NULL THEN 1.0 ELSE 0.0 END)
         + avg(CASE WHEN f.connected_users IS NOT NULL THEN 1.0 ELSE 0.0 END)
         + avg(CASE WHEN f.data_volume_mb IS NOT NULL THEN 1.0 ELSE 0.0 END)
         + avg(CASE WHEN f.dl_throughput_kbps IS NOT NULL THEN 1.0 ELSE 0.0 END)
         + avg(CASE WHEN f.availability_pct IS NOT NULL THEN 1.0 ELSE 0.0 END)) / 5.0
      ), 1) AS completeness_pct
    FROM fact_cell_daily f
    JOIN dim_date d USING (date_id)
    LEFT JOIN coverage_daily cv USING (date_id)
    WHERE d.date_id IN (${idList})
    GROUP BY d.date_id, cv.coverage_pct
  `)

  let coverageSum = 0
  let completenessSum = 0
  let n = 0
  for (const row of r.getRowObjects()) {
    const coverage = Number(row.coverage_pct ?? 100)
    const completeness = Number(row.completeness_pct ?? 0)
    const score = Math.round(0.5 * coverage + 0.5 * completeness)
    coverageSum += coverage
    completenessSum += completeness
    n++
    await conn.run(
      `INSERT INTO data_quality_scores
         (date_id, cell_coverage_pct, kpi_completeness_pct, rejected_rows, mapping_confidence,
          duplicates_ignored, score, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (date_id) DO UPDATE SET
         cell_coverage_pct = excluded.cell_coverage_pct,
         kpi_completeness_pct = excluded.kpi_completeness_pct,
         rejected_rows = excluded.rejected_rows,
         mapping_confidence = excluded.mapping_confidence,
         duplicates_ignored = excluded.duplicates_ignored,
         score = excluded.score,
         details = excluded.details`,
      [
        Number(row.date_id),
        coverage,
        completeness,
        stats.rejectedRows,
        stats.confidence,
        stats.duplicatesIgnored,
        score,
        JSON.stringify({ sourceRows: stats.sourceRows })
      ]
    )
  }
  if (n === 0) return 0
  const avgCoverage = coverageSum / n
  const avgCompleteness = completenessSum / n
  const rejectRate = stats.sourceRows > 0 ? stats.rejectedRows / stats.sourceRows : 0
  const dupeRate = stats.sourceRows > 0 ? stats.duplicatesIgnored / stats.sourceRows : 0
  return Math.round(
    0.35 * avgCoverage +
      0.25 * avgCompleteness +
      0.15 * stats.confidence * 100 +
      0.15 * (1 - rejectRate) * 100 +
      0.1 * (1 - dupeRate) * 100
  )
}

