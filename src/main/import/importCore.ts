import { statSync, readdirSync, unlinkSync, mkdirSync, createReadStream, createWriteStream } from 'node:fs'
import { createGzip } from 'node:zlib'
import { basename, join } from 'node:path'
import os from 'node:os'
import { isExcelPath, excelToTempCsv } from './excel'
import type { DuckDBConnection } from '@duckdb/node-api'
import {
  headersForField, saveProfileConn
} from './mapping'
import { validateStaged } from './validator'
import { recomputeAggregates, updateCoverage } from './aggregates'
import { refreshIntelligence } from '../analytics/engine'
import { writeQuality } from './quality'
import { listDerivedKpis, saveDerivedKpi } from '../services/derivedKpiService'
import type {
  CanonicalField, ImportResult, MappingConfig, ValidationIssue
} from '../../../shared/api'

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function esc(s: string): string {
  return s.replace(/'/g, "''")
}

function quoteId(s: string): string {
  return `"${s.replace(/"/g, '""')}"`
}

async function count(conn: DuckDBConnection, sql: string): Promise<number> {
  const r = await conn.runAndReadAll(sql)
  return Number(r.getRowObjects()[0].n)
}

async function dropStaging(conn: DuckDBConnection): Promise<void> {
  await conn.run('DROP TABLE IF EXISTS stg_import')
  await conn.run('DROP TABLE IF EXISTS stg_rejects')
  await conn.run('DROP TABLE IF EXISTS stg_clean')
}

// --- staging ---

async function stageCsv(
  conn: DuckDBConnection,
  path: string,
  header: string[],
  mapping: MappingConfig,
  displayName = basename(path)
): Promise<void> {
  await conn.run('DROP TABLE IF EXISTS stg_import')
  await conn.run('DROP TABLE IF EXISTS stg_rejects')
  await conn.run('DROP TABLE IF EXISTS stg_clean')
  await conn.run(`CREATE TEMP TABLE stg_import (
    date_raw VARCHAR, cell_raw VARCHAR, district_raw VARCHAR, region_raw VARCHAR,
    site_raw VARCHAR, prb_raw VARCHAR, users_raw VARCHAR, volume_raw VARCHAR,
    avail_raw VARCHAR, thrpt_raw VARCHAR, src_file VARCHAR,
    kpi_json VARCHAR
  )`)

  const seen = new Set<string>()
  for (const h of header) {
    if (seen.has(h)) throw new Error(`Duplicate column name "${h}" — rename columns and retry`)
    seen.add(h)
  }

  const dict = header.map((h) => `'${esc(h)}':'VARCHAR'`).join(', ')
  const sel = (field: CanonicalField): string => {
    const h = headersForField(header, mapping.columns, field)
    return h ? quoteId(h) : `NULL::VARCHAR`
  }

  // extra columns mapped to KPI keys + unmapped source headers become one JSON object per row:
  // {"tch_congestion": "1.2", "VS.RRC.Rej.DLPower.Cong": "5"}
  const kpiCols = (mapping.kpiColumns ?? {})
  const mappedCols = new Set(Object.keys(mapping.columns))
  const unmapped = header.filter((h) => !mappedCols.has(h) && !kpiCols[h])
  const allKpiEntries = [
    ...Object.entries(kpiCols).filter(([h, k]) => header.includes(h) && k),
    ...unmapped.map((h) => [h, h] as [string, string])
  ]
  const kpiJsonSel = (() => {
    if (allKpiEntries.length === 0) return `NULL::VARCHAR`
    const json = allKpiEntries.map(([h, k]) => `'${esc(k)}', ${quoteId(h)}`).join(', ')
    return `json_object(${json})`
  })()

  await conn.run(`
    INSERT INTO stg_import
      (date_raw, cell_raw, district_raw, region_raw, site_raw,
       prb_raw, users_raw, volume_raw, avail_raw, thrpt_raw, src_file, kpi_json)
    SELECT
      ${sel('date')}, ${sel('cell')}, ${sel('district')}, ${sel('region')}, ${sel('site')},
      ${sel('prb')}, ${sel('users')}, ${sel('volume')}, ${sel('availability')}, ${sel('throughput')},
      '${esc(displayName)}', ${kpiJsonSel}
    FROM read_csv('${esc(path)}', header = true, columns = { ${dict} },
      ignore_errors = true, store_rejects = true, rejects_table = 'stg_rejects')
  `)

  // value-level geo remaps (spec §13): an unmatched value the user pointed at
  // an existing dimension is rewritten before cleaning/upserts, so no new
  // (misspelled) dimension row is created and references resolve to the
  // intended one. Keys are normalized values; the WHEN clause normalizes the
  // staged column the same way (trim + lowercase + collapse whitespace).
  const aliasCols: Record<string, string> = {
    region: 'region_raw', district: 'district_raw', site: 'site_raw', cell: 'cell_raw'
  }
  const aliases = mapping.valueAliases ?? {}
  for (const [field, col] of Object.entries(aliasCols)) {
    const map = aliases[field as CanonicalField]
    if (!map || Object.keys(map).length === 0) continue
    const cases = Object.entries(map)
      .map(([k, v]) => `WHEN lower(trim(regexp_replace(${col}, '\s+', ' '))) = '${esc(k)}' THEN '${esc(v)}'`)
      .join(' ')
    await conn.run(
      `UPDATE stg_import SET ${col} = CASE ${cases} ELSE ${col} END WHERE ${col} IS NOT NULL`
    )
  }
}

const CANDIDATE_DATE_PATTERNS = [
  '%Y-%m-%dT%H:%M:%S%z',
  '%Y-%m-%dT%H:%M:%S',
  '%d/%m/%y %H:%M:%S',
  '%d/%m/%y %H:%M',
  '%d/%m/%y',
  '%d-%m-%y %H:%M:%S',
  '%d-%m-%y %H:%M',
  '%d-%m-%y',
  '%d.%m.%y %H:%M:%S',
  '%d.%m.%y %H:%M',
  '%d.%m.%y',
  '%d-%b-%y',
  '%m/%d/%y',
  '%Y-%m-%d %H:%M:%S',
  '%Y-%m-%d',
  '%d/%m/%Y %H:%M:%S',
  '%d/%m/%Y %H:%M',
  '%d/%m/%Y',
  '%d-%m-%Y %H:%M:%S',
  '%d-%m-%Y %H:%M',
  '%d-%m-%Y',
  '%d.%m.%Y %H:%M:%S',
  '%d.%m.%Y %H:%M',
  '%d.%m.%Y',
  '%d-%b-%Y',
  '%m/%d/%Y',
  '%Y/%m/%d',
  '%Y%m%d'
]

/** Fast date pattern detector: probes the first sample date strings from staging
 *  to find the exact matching strptime pattern. Placing the winning format at index 0
 *  of coalesce() short-circuits DuckDB's vectorized kernel, avoiding up to 120M+ failed
 *  strptime evaluations on 4M+ row datasets. */
async function detectOptimalDateCoalesce(conn: DuckDBConnection): Promise<string> {
  try {
    const r = await conn.runAndReadAll(`
      SELECT date_raw FROM stg_import
      WHERE date_raw IS NOT NULL AND trim(date_raw) <> ''
      LIMIT 10
    `)
    const samples = r.getRowObjects().map((x) => String(x.date_raw).trim()).filter(Boolean)
    if (samples.length > 0) {
      for (const pattern of CANDIDATE_DATE_PATTERNS) {
        const testRes = await conn.runAndReadAll(
          `SELECT try_strptime(?, '${pattern}') AS p WHERE year(try_strptime(?, '${pattern}')) BETWEEN 2000 AND 2050`,
          [samples[0], samples[0]]
        )
        const parsed = testRes.getRowObjects()[0]?.p
        if (parsed != null) {
          const others = CANDIDATE_DATE_PATTERNS.filter((p) => p !== pattern)
          const exprs = [
            `try_strptime(date_raw, '${pattern}')`,
            ...others.map((p) => `try_strptime(date_raw, '${p}')`),
            `try_cast(date_raw AS DATE)`
          ]
          return exprs.join(',\n        ')
        }
      }
    }
  } catch {
    /* fallback to default order */
  }
  return CANDIDATE_DATE_PATTERNS.map((p) => `try_strptime(date_raw, '${p}')`).concat(['try_cast(date_raw AS DATE)']).join(',\n        ')
}

async function buildClean(conn: DuckDBConnection): Promise<void> {
  const dateCoalesceExpr = await detectOptimalDateCoalesce(conn)
  await conn.run(`
    CREATE TEMP TABLE stg_clean AS
    SELECT
      trim(p.cell_raw) AS cell_name,
      CASE
        WHEN try_cast(trim(p.district_raw) AS DOUBLE) IS NOT NULL
             OR lower(trim(p.district_raw)) IN ('total', 'grand total', 'subtotal', 'average', 'avg', 'sum', 'count', 'summary')
             OR NOT regexp_matches(trim(p.district_raw), '[a-zA-Z]')
        THEN NULL
        ELSE trim(p.district_raw)
      END AS district_raw,
      CASE
        WHEN try_cast(trim(p.region_raw) AS DOUBLE) IS NOT NULL
             OR lower(trim(p.region_raw)) IN ('total', 'grand total', 'subtotal', 'average', 'avg', 'sum', 'count', 'summary')
             OR NOT regexp_matches(trim(p.region_raw), '[a-zA-Z]')
        THEN NULL
        ELSE trim(p.region_raw)
      END AS region_raw,
      CASE
        WHEN try_cast(trim(p.site_raw) AS DOUBLE) IS NOT NULL
             OR lower(trim(p.site_raw)) IN ('total', 'grand total', 'subtotal', 'average', 'avg', 'sum', 'count', 'summary')
             OR NOT regexp_matches(trim(p.site_raw), '[a-zA-Z]')
        THEN NULL
        ELSE trim(p.site_raw)
      END AS site_raw,
      d.date_id, p.parsed_date,
      try_cast(p.prb_raw AS DOUBLE) AS prb,
      try_cast(p.users_raw AS DOUBLE) AS users,
      try_cast(p.volume_raw AS DOUBLE) AS volume,
      try_cast(p.avail_raw AS DOUBLE) AS avail,
      try_cast(p.thrpt_raw AS DOUBLE) AS thrpt,
      p.kpi_json,
      row_number() OVER (PARTITION BY d.date_id, trim(p.cell_raw) ORDER BY 1) AS rn
    FROM (
      SELECT *, coalesce(
        ${dateCoalesceExpr}
      ) AS parsed_date
      FROM stg_import
    ) p
    LEFT JOIN dim_date d ON d.date = CAST(p.parsed_date AS DATE)
    WHERE p.cell_raw IS NOT NULL
      AND trim(p.cell_raw) <> ''
      AND lower(trim(p.cell_raw)) NOT IN ('total', 'grand total', 'subtotal', 'average', 'avg', 'sum', 'count', 'summary')
      AND regexp_matches(trim(p.cell_raw), '[a-zA-Z]')
      AND try_cast(trim(p.cell_raw) AS DOUBLE) IS NULL
  `)
}

/** Deterministic ids: max existing id + row_number over the surviving rows. */
async function upsertRegions(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    INSERT INTO dim_region (region_id, name)
    SELECT
      (SELECT COALESCE(max(region_id), 0) FROM dim_region) + row_number() OVER (ORDER BY s.region_raw),
      s.region_raw
    FROM (SELECT DISTINCT region_raw FROM stg_clean
          WHERE region_raw IS NOT NULL AND region_raw <> '') s
    WHERE NOT EXISTS (SELECT 1 FROM dim_region x WHERE x.name = s.region_raw)
  `)
}

async function upsertDistricts(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    INSERT INTO dim_district (district_id, name, region_id)
    SELECT
      (SELECT COALESCE(max(district_id), 0) FROM dim_district) + row_number() OVER (ORDER BY d.district_raw),
      d.district_raw,
      r.region_id
    FROM (
      SELECT district_raw, region_raw
      FROM (
        SELECT district_raw, region_raw,
               row_number() OVER (PARTITION BY district_raw ORDER BY cnt DESC, region_raw) AS rn
        FROM (
          SELECT district_raw, region_raw, count(*) AS cnt
          FROM stg_clean
          WHERE district_raw IS NOT NULL AND district_raw <> ''
          GROUP BY district_raw, region_raw
        ) g
      ) r
      WHERE rn = 1
    ) d
    LEFT JOIN dim_region r ON r.name = d.region_raw
    WHERE NOT EXISTS (SELECT 1 FROM dim_district x WHERE x.name = d.district_raw)
  `)
}

async function upsertSites(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    INSERT INTO dim_site (site_id, name, district_id)
    SELECT
      (SELECT COALESCE(max(site_id), 0) FROM dim_site) + row_number() OVER (ORDER BY s.site_raw),
      s.site_raw,
      d.district_id
    FROM (
      SELECT site_raw, district_raw
      FROM (
        SELECT site_raw, district_raw,
               row_number() OVER (PARTITION BY site_raw ORDER BY cnt DESC, district_raw) AS rn
        FROM (
          SELECT site_raw, district_raw, count(*) AS cnt
          FROM stg_clean
          WHERE site_raw IS NOT NULL AND site_raw <> ''
          GROUP BY site_raw, district_raw
        ) g
      ) r
      WHERE rn = 1
    ) s
    LEFT JOIN dim_district d ON d.name = s.district_raw
    WHERE NOT EXISTS (SELECT 1 FROM dim_site x WHERE x.name = s.site_raw)
  `)
}

async function upsertCells(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    INSERT INTO dim_cell (cell_id, name, site_id, district_id, region_id)
    SELECT
      (SELECT COALESCE(max(cell_id), 0) FROM dim_cell) + row_number() OVER (ORDER BY c.cell_name),
      c.cell_name,
      s.site_id,
      d.district_id,
      r.region_id
    FROM (
      SELECT cell_name, site_raw, district_raw, region_raw
      FROM (
        SELECT cell_name, site_raw, district_raw, region_raw,
               row_number() OVER (PARTITION BY cell_name ORDER BY cnt DESC, site_raw, district_raw, region_raw) AS rn
        FROM (
          SELECT cell_name, site_raw, district_raw, region_raw, count(*) AS cnt
          FROM stg_clean
          WHERE cell_name IS NOT NULL AND cell_name <> ''
          GROUP BY cell_name, site_raw, district_raw, region_raw
        ) g
      ) r
      WHERE rn = 1
    ) c
    LEFT JOIN dim_site s ON s.name = c.site_raw
    LEFT JOIN dim_district d ON d.name = c.district_raw
    LEFT JOIN dim_region r ON r.name = c.region_raw
    WHERE NOT EXISTS (SELECT 1 FROM dim_cell x WHERE x.name = c.cell_name)
  `)
}


async function backfillCellDims(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    UPDATE dim_cell c
    SET site_id = coalesce(c.site_id, s.site_id),
        district_id = coalesce(c.district_id, d.district_id),
        region_id = coalesce(c.region_id, r.region_id)
    FROM (SELECT DISTINCT cell_name, site_raw, district_raw, region_raw FROM stg_clean
          WHERE cell_name IS NOT NULL AND cell_name <> '') src
    LEFT JOIN dim_site s ON s.name = src.site_raw
    LEFT JOIN dim_district d ON d.name = src.district_raw
    LEFT JOIN dim_region r ON r.name = src.region_raw
    WHERE c.name = src.cell_name
  `)
}

async function nextAuditId(conn: DuckDBConnection): Promise<number> {
  const r = await conn.runAndReadAll(`SELECT CAST(nextval('seq_import_audit') AS DOUBLE) AS id`)
  return Number(r.getRowObjects()[0].id)
}

async function insertFacts(conn: DuckDBConnection, importId: number): Promise<number> {
  await conn.run(
    `INSERT INTO fact_cell_daily
       (date_id, cell_id, prb_utilization, data_volume_mb, connected_users,
        dl_throughput_kbps, availability_pct, source_import_id)
     SELECT s.date_id, c.cell_id, s.prb, s.volume, s.users, s.thrpt, s.avail, ?
     FROM stg_clean s
     JOIN dim_cell c ON c.name = s.cell_name
     WHERE s.date_id IS NOT NULL AND s.cell_name IS NOT NULL AND s.cell_name <> '' AND s.rn = 1
       AND NOT EXISTS (
         SELECT 1 FROM fact_cell_daily f
         WHERE f.date_id = s.date_id AND f.cell_id = c.cell_id
       )`,
    [importId]
  )
  return count(conn, `SELECT count(*) n FROM fact_cell_daily WHERE source_import_id = ${importId}`)
}

/** Persist extra per-cell KPI values (spec §54a): unmapped source columns that
 *  were assigned a KpiDefinition.key are extracted directly from each row's JSON blob. */
async function insertExtraMetrics(conn: DuckDBConnection): Promise<void> {
  const r = await conn.runAndReadAll(`SELECT count(*) n FROM stg_clean WHERE kpi_json IS NOT NULL`)
  if (Number(r.getRowObjects()[0].n) === 0) return

  const kpis = await conn.runAndReadAll(`SELECT kpi_id, kpi_key FROM kpi_defs`)
  const kpiList = kpis.getRowObjects()
  if (kpiList.length === 0) return

  for (const k of kpiList) {
    const kpiId = Number(k.kpi_id)
    const kpiKey = String(k.kpi_key).replace(/'/g, "''")
    await conn.run(`
      INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
      SELECT s.date_id, c.cell_id, ${kpiId}, try_cast(json_extract_string(s.kpi_json, '$.${kpiKey}') AS DOUBLE)
      FROM stg_clean s
      JOIN dim_cell c ON c.name = s.cell_name
      WHERE s.date_id IS NOT NULL AND s.cell_name IS NOT NULL AND s.cell_name <> '' AND s.rn = 1
        AND json_extract_string(s.kpi_json, '$.${kpiKey}') IS NOT NULL
        AND try_cast(json_extract_string(s.kpi_json, '$.${kpiKey}') AS DOUBLE) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM fact_extra_metrics f
          WHERE f.date_id = s.date_id AND f.cell_id = c.cell_id AND f.kpi_id = ${kpiId}
        )
    `)
  }
}

async function insertDerivedMetrics(conn: DuckDBConnection): Promise<void> {
  const r = await conn.runAndReadAll(`SELECT count(*) n FROM stg_clean WHERE kpi_json IS NOT NULL`)
  if (Number(r.getRowObjects()[0].n) === 0) return

  const derivedList = await listDerivedKpis(conn)
  const enabledDerived = derivedList.filter((d) => d.enabled)
  if (enabledDerived.length === 0) return

  for (const def of enabledDerived) {
    await saveDerivedKpi(conn, def)
    const kpiRow = await conn.runAndReadAll(`SELECT kpi_id FROM kpi_defs WHERE kpi_key = '${def.id.replace(/'/g, "''")}'`)
    const kpiId = Number(kpiRow.getRowObjects()[0]?.kpi_id)
    if (!kpiId) continue

    const parts = def.sourceKPIs.map((src) => {
      const escSrc = src.replace(/'/g, "''")
      return `COALESCE(try_cast(json_extract_string(s.kpi_json, '$.\"${escSrc}\"') AS DOUBLE), try_cast(json_extract_string(s.kpi_json, '$.${escSrc}') AS DOUBLE))`
    })

    let calcExpr = ''
    if (def.operation === 'SUM') {
      if (def.treatMissingAsZero) {
        calcExpr = parts.map((p) => `COALESCE(${p}, 0)`).join(' + ')
      } else {
        const nullCheck = parts.map((p) => `${p} IS NOT NULL`).join(' AND ')
        calcExpr = `CASE WHEN ${nullCheck} THEN (${parts.join(' + ')}) ELSE NULL END`
      }
    } else if (def.operation === 'AVERAGE') {
      if (def.treatMissingAsZero) {
        calcExpr = `(${parts.map((p) => `COALESCE(${p}, 0)`).join(' + ')}) / ${parts.length}`
      } else {
        const nullCheck = parts.map((p) => `${p} IS NOT NULL`).join(' AND ')
        calcExpr = `CASE WHEN ${nullCheck} THEN (${parts.join(' + ')}) / ${parts.length} ELSE NULL END`
      }
    } else if (def.operation === 'RATIO' && parts.length >= 2) {
      calcExpr = `CASE WHEN ${parts[0]} IS NOT NULL AND ${parts[1]} IS NOT NULL AND ${parts[1]} > 0 THEN ${parts[0]} / ${parts[1]} ELSE NULL END`
    } else {
      calcExpr = parts.join(' + ')
    }

    await conn.run(`
      INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value)
      SELECT s.date_id, c.cell_id, ${kpiId}, ${calcExpr}
      FROM stg_clean s
      JOIN dim_cell c ON c.name = s.cell_name
      WHERE s.date_id IS NOT NULL AND s.cell_name IS NOT NULL AND s.cell_name <> '' AND s.rn = 1
        AND s.kpi_json IS NOT NULL
        AND (${calcExpr}) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM fact_extra_metrics f
          WHERE f.date_id = s.date_id AND f.cell_id = c.cell_id AND f.kpi_id = ${kpiId}
        )
    `)
  }
}

async function affectedDateIds(conn: DuckDBConnection): Promise<number[]> {
  const r = await conn.runAndReadAll(`SELECT DISTINCT date_id FROM stg_clean WHERE date_id IS NOT NULL ORDER BY date_id`)
  return r.getRowObjects().map((x) => Number(x.date_id))
}

function rotateBackups(workspaceName: string, backupDir: string): void {
  let files: string[] = []
  try {
    files = readdirSync(backupDir).filter((f) => f.startsWith(`${workspaceName}-`) && f.endsWith('.qosdb'))
  } catch {
    return
  }
  files.sort().reverse().slice(7).forEach((f) => {
    try {
      unlinkSync(join(backupDir, f))
    } catch {
      /* ignore */
    }
  })
}

/** Streaming gzip copy of one file (raw source CSV → archive, spec §9). */
function gzipCopy(src: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const rs = createReadStream(src)
    const ws = createWriteStream(dest)
    rs.on('error', reject)
    ws.on('error', reject)
    ws.on('finish', () => resolve())
    rs.pipe(createGzip()).pipe(ws)
  })
}

/** Copy the raw source into the workspace's sidecar archive folder and record
 *  it in raw_archive with a 90-day retention window (spec §9). Never fails the
 *  import — a broken archive is reported as archivePath = null instead. */
async function archiveRawFile(
  conn: DuckDBConnection,
  job: ImportCoreJob,
  importId: number
): Promise<{ archivedPath: string; retentionUntil: string } | null> {
  try {
    const rawDir = `${job.workspacePath}.raw`
    mkdirSync(rawDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const archivedPath = join(rawDir, `${stamp}_${basename(job.csvPath)}.gz`)
    const srcSize = statSync(job.csvPath).size
    await gzipCopy(job.csvPath, archivedPath)
    await conn.run(
      `INSERT INTO raw_archive
         (import_id, filename, archived_path, size_bytes, checksum, imported_at, retention_until)
       VALUES (?, ?, ?, ?, ?, now(), now() + INTERVAL 90 DAY)`,
      [importId, basename(job.csvPath), archivedPath, srcSize, job.checksum]
    )
    const r = await conn.runAndReadAll(
      `SELECT CAST(retention_until AS VARCHAR) AS v FROM raw_archive WHERE archive_id = (SELECT max(archive_id) FROM raw_archive)`
    )
    return { archivedPath, retentionUntil: String(r.getRowObjects()[0]?.v ?? '') }
  } catch {
    return null
  }
}

// --- core pipeline (runs inside the import worker on its own connection) ---

/** Excel sources are converted to a temp CSV first, staged through the same
 *  DuckDB read_csv path, and the original workbook is what gets archived. */
export async function runImportCore(
  conn: DuckDBConnection,
  job: ImportCoreJob,
  onPhase?: (phase: string, detail?: string) => void
): Promise<ImportResult> {
  const path = job.csvPath
  let tempCsv: string | null = null
  if (isExcelPath(path)) {
    onPhase?.('Reading file', basename(path))
    tempCsv = await excelToTempCsv(path)
  }
  try {
    return await runImportCoreInner(conn, job, tempCsv ?? path, onPhase)
  } finally {
    if (tempCsv) {
      try {
        unlinkSync(tempCsv)
      } catch {
        /* temp file already gone — nothing to clean */
      }
    }
  }
}

export interface ImportCoreJob {
  workspacePath: string
  workspaceName: string
  csvPath: string
  header: string[]
  mapping: MappingConfig
  fingerprint: string
  confidence: number
  dbBefore: number
  cellsBefore: number
  checksum: string
  backupDir: string
  /** computed by the worker (main hands the file over without opening it) */
  backupPath?: string
}

async function runImportCoreInner(
  conn: DuckDBConnection,
  job: ImportCoreJob,
  csvPath: string,
  onPhase?: (phase: string, detail?: string) => void
): Promise<ImportResult> {
  const t0 = Date.now()
  const { mapping, header } = job
  const path = job.csvPath

  // Enable multi-threaded vectorized execution and scalable memory limit for large datasets
  try {
    const totalRamGb = Math.floor(os.totalmem() / (1024 * 1024 * 1024))
    const memLimitGb = Math.max(4, Math.min(32, Math.floor(totalRamGb * 0.75)))
    const cpuThreads = Math.max(1, os.cpus().length)
    await conn.run(`PRAGMA memory_limit = '${memLimitGb}GB'`)
    await conn.run(`PRAGMA threads = ${cpuThreads}`)
    await conn.run('PRAGMA preserve_insertion_order = false')
  } catch {
    /* ignore if unsupported */
  }

  // stage + authoritative validation
  onPhase?.('Reading file', basename(path))
  await stageCsv(conn, csvPath, header, mapping, basename(path))
  const staged = await count(conn, `SELECT count(*) n FROM stg_import`)
  const csvRejects = await count(conn, `SELECT count(*) n FROM stg_rejects`)
  await buildClean(conn)
  onPhase?.('Validating')
  const issues: ValidationIssue[] = await validateStaged(conn, mapping)
  const errors = issues.filter((i) => i.severity === 'error')
  if (errors.length > 0) {
    await dropStaging(conn)
    return {
      importId: 0, filename: basename(path), sourceRows: staged + csvRejects,
      insertedRows: 0, duplicatesIgnored: 0, rejectedRows: 0, newCells: 0,
      issues, qualityScore: 0, durationMs: Date.now() - t0, backupPath: job.backupPath ?? null,
      archivePath: null, retentionUntil: null
    }
  }

  // transactional merge: failure rolls back and leaves the workspace unchanged
  await conn.run('BEGIN TRANSACTION')
  try {
    onPhase?.('Merging')
    await upsertRegions(conn)
    await upsertDistricts(conn)
    await upsertSites(conn)
    await upsertCells(conn)
    await backfillCellDims(conn)
    const importId = await nextAuditId(conn)
    const inserted = await insertFacts(conn, importId)
    await insertExtraMetrics(conn)
    await insertDerivedMetrics(conn)
    const dateIds = await affectedDateIds(conn)
    onPhase?.('Aggregating', `${dateIds.length} day${dateIds.length === 1 ? '' : 's'}`)
    await recomputeAggregates(conn, dateIds)
    await updateCoverage(conn, dateIds)
    onPhase?.('Refreshing intelligence')
    await refreshIntelligence(conn, dateIds)
    await conn.run('COMMIT')

    const validRows = await count(conn, `SELECT count(*) n FROM stg_clean WHERE date_id IS NOT NULL AND cell_name IS NOT NULL AND cell_name <> ''`)
    const rejectedRows = Math.max(0, staged - validRows) + csvRejects
    const duplicatesIgnored = Math.max(0, validRows - inserted)
    await dropStaging(conn)

    onPhase?.('Archiving source')
    const archive = await archiveRawFile(conn, job, importId)
    const dbAfter = statSync(path).size
    onPhase?.('Finalizing')
    const qualityScore = await writeQuality(conn, dateIds, {
      sourceRows: staged + csvRejects,
      rejectedRows,
      duplicatesIgnored,
      confidence: job.confidence
    })
    await conn.run(
      `INSERT INTO import_audit
         (files, source_rows, inserted_rows, duplicates_ignored, rejected_rows,
          mapping_profile, schema_version, validation_result, raw_checksum,
          db_size_before, db_size_after, ruleset_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         (SELECT max(version) FROM ruleset))`,
      [
        JSON.stringify([basename(path)]),
        staged + csvRejects,
        inserted,
        duplicatesIgnored,
        rejectedRows,
        job.fingerprint,
        '0.1.0',
        JSON.stringify(issues),
        job.checksum,
        job.dbBefore,
        dbAfter
      ]
    )
    await saveProfileConn(conn, job.fingerprint, mapping, Math.min(1, job.confidence + 0.05))
    rotateBackups(job.workspaceName, job.backupDir)

    return {
      importId, filename: basename(path), sourceRows: staged + csvRejects,
      insertedRows: inserted, duplicatesIgnored, rejectedRows,
      newCells: 0, // cellsAfter is computed on the main side after reopen
      issues, qualityScore, durationMs: Date.now() - t0, backupPath: job.backupPath ?? null,
      archivePath: archive?.archivedPath ?? null,
      retentionUntil: archive?.retentionUntil ?? null
    }
  } catch (e) {
    try {
      await conn.run('ROLLBACK')
    } catch {
      /* ignore */
    }
    await dropStaging(conn)
    throw new Error(`Import failed and was rolled back — the workspace is unchanged: ${errMessage(e)}`)
  }
}
