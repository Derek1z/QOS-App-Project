import type { DuckDBConnection } from '@duckdb/node-api'
import type { MappingConfig, ValidationIssue } from '../../../shared/api'

const KPI_COLS: Array<{ col: string; label: string }> = [
  { col: 'prb_raw', label: 'PRB utilization' },
  { col: 'users_raw', label: 'Connected users' },
  { col: 'volume_raw', label: 'Data volume' },
  { col: 'avail_raw', label: 'Availability' },
  { col: 'thrpt_raw', label: 'DL throughput' }
]

function dmValid(a: number, b: number): boolean {
  // a date is valid if (day, month) or (month, day) makes sense — mirrors the
  // staging coalesce which tries day-first then month-first formats
  return (a >= 1 && a <= 31 && b >= 1 && b <= 12) || (b >= 1 && b <= 31 && a >= 1 && a <= 12)
}

export function parseDateOk(raw: string | null | undefined): boolean {
  const s = (raw ?? '').trim()
  if (!s) return false
  // ISO 8601 with optional time / timezone (e.g. 2026-08-14T10:30:00+00:00)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return !Number.isNaN(Date.parse(s.slice(0, 10)))
  // slash-separated day-first or month-first, 2- or 4-digit year, optionally
  // with a time-of-day component (NCA exports write DD/MM/YY HH:MM)
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(\s+\d{1,2}:\d{2}(:\d{2})?)?$/.exec(s)
  if (slash) {
    return dmValid(Number(slash[1]), Number(slash[2]))
  }
  // dash-separated day-first (e.g. 05-07-26)
  const dash = /^(\d{1,2})-(\d{1,2})-(\d{2,4})(\s+\d{1,2}:\d{2}(:\d{2})?)?$/.exec(s)
  if (dash) {
    return dmValid(Number(dash[1]), Number(dash[2]))
  }
  // dot-separated (e.g. 14.08.2026)
  const dot = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(\s+\d{1,2}:\d{2}(:\d{2})?)?$/.exec(s)
  if (dot) {
    return dmValid(Number(dot[1]), Number(dot[2]))
  }
  // year-first slash (e.g. 2026/08/14)
  const ymd = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s)
  if (ymd) {
    const m = Number(ymd[2])
    const d = Number(ymd[3])
    return m >= 1 && m <= 12 && d >= 1 && d <= 31
  }
  return false
}

function isNumeric(s: string | null | undefined): boolean {
  if (s == null) return false
  const t = s.trim()
  if (!t) return false
  return !Number.isNaN(Number(t))
}

function severityFor(field: string): 'warning' | 'info' {
  return field === 'date' || field === 'cell' ? 'warning' : 'warning'
}

/** Sample-level validation used for the preview (JS mirror of the SQL checks). */
export function validateSample(
  header: string[],
  rows: string[][],
  mapping: MappingConfig
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const fields = Object.values(mapping.columns)
  if (!fields.includes('date')) {
    issues.push({ severity: 'error', message: 'No column mapped to Date/Time (required)' })
  }
  if (!fields.includes('cell')) {
    issues.push({ severity: 'error', message: 'No column mapped to Cell (required)' })
  }
  if (rows.length === 0) {
    issues.push({ severity: 'info', message: 'No data rows in sample' })
    return issues
  }

  const dateIdx = header.findIndex((h) => mapping.columns[h] === 'date')
  const cellIdx = header.findIndex((h) => mapping.columns[h] === 'cell')
  let badDates = 0
  let badCells = 0
  const unparsed: Record<string, number> = {}
  let missingDistrict = 0
  let missingRegion = 0

  for (const row of rows) {
    if (dateIdx >= 0 && !parseDateOk(row[dateIdx])) badDates++
    if (cellIdx >= 0 && !(row[cellIdx] ?? '').trim()) badCells++
    for (const k of KPI_COLS) {
      const field = k.col.replace('_raw', '') as never
      const idx = header.findIndex((h) => mapping.columns[h] === field)
      if (idx >= 0 && row[idx] != null && row[idx] !== '' && !isNumeric(row[idx])) {
        unparsed[k.label] = (unparsed[k.label] ?? 0) + 1
      }
    }
    const dIdx = header.findIndex((h) => mapping.columns[h] === 'district')
    const rIdx = header.findIndex((h) => mapping.columns[h] === 'region')
    if (dIdx >= 0 && !(row[dIdx] ?? '').trim()) missingDistrict++
    if (rIdx >= 0 && !(row[rIdx] ?? '').trim()) missingRegion++
  }

  if (badDates > 0) issues.push({ severity: 'error', message: 'Rows with unparseable or missing dates', count: badDates })
  if (badCells > 0) issues.push({ severity: 'error', message: 'Rows with missing Cell', count: badCells })
  for (const [label, n] of Object.entries(unparsed)) {
    issues.push({ severity: 'warning', message: `${label} values that are not numeric`, count: n })
  }
  if (missingDistrict > 0) issues.push({ severity: 'info', message: 'Rows missing District', count: missingDistrict })
  if (missingRegion > 0) issues.push({ severity: 'info', message: 'Rows missing Region', count: missingRegion })
  void severityFor
  return issues
}

/** Full-staged validation (authoritative) — runs against stg_import / stg_clean. */
export async function validateStaged(
  conn: DuckDBConnection,
  mapping: MappingConfig
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = []
  const q = async (sql: string): Promise<number> =>
    Number((await conn.runAndReadAll(sql)).getRowObjects()[0].n)

  const total = await q(`SELECT count(*) n FROM stg_clean`)
  if (total === 0) {
    issues.push({ severity: 'error', message: 'No valid rows after parsing' })
    return issues
  }

  const badDate = await q(`SELECT count(*) n FROM stg_clean WHERE date_id IS NULL`)
  if (badDate > 0) issues.push({ severity: 'error', message: 'Rows with unparseable or missing dates', count: badDate })
  const badCell = await q(`SELECT count(*) n FROM stg_clean WHERE cell_name IS NULL OR cell_name = ''`)
  if (badCell > 0) issues.push({ severity: 'error', message: 'Rows with missing Cell', count: badCell })

  const mappedFields = new Set(Object.values(mapping.columns))
  for (const k of KPI_COLS) {
    const field = k.col.replace('_raw', '')
    if (!mappedFields.has(field as never)) continue
    const unparsed = await q(
      `SELECT count(*) n FROM stg_import WHERE ${k.col} IS NOT NULL AND trim(${k.col}) <> '' AND try_cast(${k.col} AS DOUBLE) IS NULL`
    )
    if (unparsed > 0) issues.push({ severity: 'warning', message: `${k.label} values that are not numeric`, count: unparsed })
  }

  if (mappedFields.has('prb')) {
    const oob = await q(`SELECT count(*) n FROM stg_import WHERE prb_raw IS NOT NULL AND trim(prb_raw) <> '' AND (try_cast(prb_raw AS DOUBLE) < 0 OR try_cast(prb_raw AS DOUBLE) > 100)`)
    if (oob > 0) issues.push({ severity: 'warning', message: 'PRB utilization outside 0-100%', count: oob })
  }
  if (mappedFields.has('availability')) {
    const oob = await q(`SELECT count(*) n FROM stg_import WHERE avail_raw IS NOT NULL AND trim(avail_raw) <> '' AND (try_cast(avail_raw AS DOUBLE) < 0 OR try_cast(avail_raw AS DOUBLE) > 100)`)
    if (oob > 0) issues.push({ severity: 'warning', message: 'Availability outside 0-100%', count: oob })
  }
  for (const [col, label] of [
    ['users_raw', 'Connected users'],
    ['volume_raw', 'Data volume'],
    ['thrpt_raw', 'DL throughput']
  ] as const) {
    const field = col.replace('_raw', '')
    if (!mappedFields.has(field as never)) continue
    const neg = await q(`SELECT count(*) n FROM stg_import WHERE ${col} IS NOT NULL AND trim(${col}) <> '' AND try_cast(${col} AS DOUBLE) < 0`)
    if (neg > 0) issues.push({ severity: 'warning', message: `Negative ${label.toLowerCase()} values`, count: neg })
  }

  const noDistrict = await q(`SELECT count(*) n FROM stg_clean WHERE district_raw IS NULL OR district_raw = ''`)
  if (noDistrict > 0) issues.push({ severity: 'info', message: 'Rows missing District', count: noDistrict })
  const noRegion = await q(`SELECT count(*) n FROM stg_clean WHERE region_raw IS NULL OR region_raw = ''`)
  if (noRegion > 0) issues.push({ severity: 'info', message: 'Rows missing Region', count: noRegion })

  const unmapped = Object.keys(mapping.columns).length === 0 ? 0 : 0
  void unmapped
  return issues
}

