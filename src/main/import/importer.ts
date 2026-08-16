import {
  existsSync, statSync, createReadStream, unlinkSync
} from 'node:fs'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import type { DuckDBConnection } from '@duckdb/node-api'
import { getCurrent, closeWorkspace, openWorkspace } from '../workspace/manager'
import { dirs } from '../paths'
import { readCsvSample } from './csv'
import {
  autoMap, makeFingerprint, loadProfileConn, mappingConfidence,
  orderedMappedRows, normalizeHeader
} from './mapping'
import { validateSample } from './validator'
import { discoverKpiDefs } from '../services/kpiService'
import createImportWorker from './importWorker?nodeWorker'
import type { ImportCoreJob } from './importCore'
import type {
  CanonicalField, FileAnalysis, ImportProgress, ImportResult, MappingConfig, PreviewResult,
  RawArchiveResult, RawArchiveRow, RawArchiveStatus, RawArchiveStatusKind
} from '../../../shared/api'

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function wsRequired() {
  const ws = getCurrent()
  if (!ws) throw new Error('No workspace is open')
  if (ws.readOnly) throw new Error('Workspace is read-only — imports are blocked')
  return ws
}

/** A background import is holding the workspace file (main handle is closed). */
let importBusy = false
export function isImportBusy(): boolean {
  return importBusy
}

// --- analysis ---

export async function analyzeFiles(paths: string[]): Promise<FileAnalysis[]> {
  const ws = wsRequired()
  const out: FileAnalysis[] = []
  for (const path of paths) {
    try {
      const { header, rows } = readCsvSample(path, 30)
      if (header.length === 0) {
        out.push({
          id: `${path}::bad`, path, filename: basename(path), header: [], sample: [],
          fingerprint: '', suggestedMapping: {}, suggestedKpiMapping: {},
          confidence: 0, knownProfile: false,
          errors: ['File is empty or unreadable']
        })
        continue
      }
      const suggested = autoMap(header)
      const fingerprint = makeFingerprint(header)
      const profile = await loadProfileConn(ws.connection, fingerprint)
      // a remembered source profile restores both the canonical columns and
      // the KPI assignments the user accepted on the last import
      const mapping = profile ? profile.columns : suggested
      const confidence = mappingConfidence(mapping, header)
      const issues = validateSample(header, rows, { columns: mapping })
      // spec §54a: suggest KPI assignments for the active technology from the
      // source column names (exact alias + fuzzy token match)
      const kpiDiscovery = await discoverKpiDefs(ws.connection, header)
      const st = statSync(path)
      const id = `${path}|${st.size}|${st.mtimeMs}`
      out.push({
        id, path, filename: basename(path), header, sample: rows, fingerprint,
        suggestedMapping: mapping,
        suggestedKpiMapping: profile ? profile.kpiColumns : kpiDiscovery.mapping,
        confidence, knownProfile: !!profile,
        errors: issues.filter((i) => i.severity === 'error').map((i) => i.message)
      })
    } catch (e) {
      out.push({
        id: `${path}::err`, path, filename: basename(path), header: [], sample: [],
        fingerprint: '', suggestedMapping: {}, suggestedKpiMapping: {},
        confidence: 0, knownProfile: false,
        errors: [errMessage(e)]
      })
    }
  }
  return out
}

export async function previewImport(id: string, mapping: MappingConfig): Promise<PreviewResult> {
  wsRequired()
  const path = id.split('|')[0]
  if (!existsSync(path)) throw new Error(`File no longer exists: ${path}`)
  const { header, rows } = readCsvSample(path, 20)
  const issues = validateSample(header, rows, mapping)
  const mapped = orderedMappedRows(header, rows, mapping.columns)
  return { rows: mapped, issues, canImport: !issues.some((i) => i.severity === 'error') }
}

async function count(conn: DuckDBConnection, sql: string): Promise<number> {
  const r = await conn.runAndReadAll(sql)
  return Number(r.getRowObjects()[0].n)
}

async function sha1File(path: string): Promise<string> {
  const h = createHash('sha1')
  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(path)
    rs.on('data', (c: Buffer) => h.update(c))
    rs.on('end', () => resolve())
    rs.on('error', reject)
  })
  return h.digest('hex')
}

// --- background run (M5 hardening) ---

interface WorkerMessage {
  type: 'progress' | 'done' | 'error'
  phase?: string
  detail?: string
  result?: unknown
  message?: string
}

function runInWorker(
  job: Omit<ImportCoreJob, 'backupPath'>,
  onProgress?: (p: ImportProgress) => void
): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    const worker = createImportWorker({ workerData: job })
    worker.on('message', (msg: WorkerMessage) => {
      if (msg.type === 'progress') {
        if (msg.phase) onProgress?.({ phase: msg.phase, detail: msg.detail })
      } else if (msg.type === 'done') {
        settled = true
        resolve(msg.result as ImportResult)
      } else if (msg.type === 'error') {
        settled = true
        reject(new Error(msg.message ?? 'Import worker failed'))
      }
    })
    worker.on('error', (e) => {
      if (!settled) {
        settled = true
        reject(e)
      }
    })
    worker.on('exit', (code) => {
      if (!settled) {
        settled = true
        reject(new Error(code === 0 ? 'Import worker exited before reporting a result' : `Import worker exited with code ${code}`))
      }
    })
  })
}

export async function runImport(
  id: string,
  mapping: MappingConfig,
  opts: { backupDir?: string; onProgress?: (p: ImportProgress) => void } = {}
): Promise<ImportResult> {
  const ws = wsRequired()
  if (importBusy) throw new Error('Another import is already running — wait for it to finish')
  const path = id.split('|')[0]
  if (!existsSync(path)) throw new Error(`File no longer exists: ${path}`)

  const { header } = readCsvSample(path, 1)
  if (header.length === 0) throw new Error('File is empty')
  const headerSet = new Set(header.map((h) => normalizeHeader(h)))
  for (const k of Object.keys(mapping.columns)) {
    if (!headerSet.has(normalizeHeader(k))) {
      throw new Error(`Mapping references column "${k}" not found in the file — the file may have changed, re-analyze it`)
    }
  }
  const fields = Object.values(mapping.columns)
  if (!fields.includes('date') || !fields.includes('cell')) {
    throw new Error('Mapping must include Date and Cell columns')
  }

  const fingerprint = makeFingerprint(header)
  const confidence = mappingConfidence(mapping.columns, header)
  const dbBefore = statSync(ws.path).size
  const cellsBefore = await count(ws.connection, `SELECT count(*) n FROM dim_cell`)
  const checksum = await sha1File(path)
  const backupDir = opts.backupDir ?? dirs.backups

  // Hand the file to the worker: close the main handle (Windows locks open
  // DuckDB files), run the whole pipeline off-thread on the worker's own
  // connection, then reopen. The renderer keeps working via progress events.
  importBusy = true
  await closeWorkspace()
  let workerError: unknown = null
  let result: ImportResult | null = null
  try {
    result = await runInWorker(
      {
        workspacePath: ws.path,
        workspaceName: ws.name,
        csvPath: path,
        header,
        mapping,
        fingerprint,
        confidence,
        dbBefore,
        cellsBefore,
        checksum,
        backupDir
      },
      opts.onProgress
    )
  } catch (e) {
    workerError = e
  }
  try {
    await openWorkspace(ws.path)
  } catch (e) {
    workerError = workerError ?? new Error(`Import finished but the workspace could not be reopened: ${errMessage(e)}`)
  } finally {
    importBusy = false
  }
  if (workerError) throw workerError instanceof Error ? workerError : new Error(String(workerError))

  // cellsAfter is only observable on the fresh main handle
  const cellsAfter = await count(getCurrent()!.connection, `SELECT count(*) n FROM dim_cell`)
  return { ...result!, newCells: Math.max(0, cellsAfter - cellsBefore) }
}

// --- history / coverage / quality queries ---

export async function importHistory(): Promise<
  Array<{
    importId: number; importedAt: string; files: string; sourceRows: number; insertedRows: number
    duplicatesIgnored: number; rejectedRows: number; mappingProfile: string | null; rulesetVersion: number | null
  }>
> {
  const ws = getCurrent()
  if (!ws) return []
  const r = await ws.connection.runAndReadAll(`
    SELECT CAST(import_id AS DOUBLE) AS import_id, CAST(imported_at AS VARCHAR) AS imported_at,
      files, CAST(source_rows AS DOUBLE) AS source_rows, CAST(inserted_rows AS DOUBLE) AS inserted_rows,
      CAST(duplicates_ignored AS DOUBLE) AS duplicates_ignored, CAST(rejected_rows AS DOUBLE) AS rejected_rows,
      mapping_profile, CAST(ruleset_version AS DOUBLE) AS ruleset_version
    FROM import_audit ORDER BY import_id DESC LIMIT 50
  `)
  return r.getRowObjects().map((x) => ({
    importId: Number(x.import_id),
    importedAt: String(x.imported_at ?? ''),
    files: String(x.files ?? ''),
    sourceRows: Number(x.source_rows ?? 0),
    insertedRows: Number(x.inserted_rows ?? 0),
    duplicatesIgnored: Number(x.duplicates_ignored ?? 0),
    rejectedRows: Number(x.rejected_rows ?? 0),
    mappingProfile: x.mapping_profile ? String(x.mapping_profile) : null,
    rulesetVersion: x.ruleset_version == null ? null : Number(x.ruleset_version)
  }))
}

export async function importCoverage(): Promise<
  Array<{ date: string; observedCells: number; expectedCells: number; coveragePct: number }>
> {
  const ws = getCurrent()
  if (!ws) return []
  const r = await ws.connection.runAndReadAll(`
    SELECT CAST(d.date AS VARCHAR) AS date, CAST(c.observed_cells AS DOUBLE) AS observed_cells,
      CAST(c.expected_cells AS DOUBLE) AS expected_cells, c.coverage_pct
    FROM coverage_daily c JOIN dim_date d USING (date_id)
    ORDER BY d.date DESC LIMIT 90
  `)
  return r.getRowObjects().map((x) => ({
    date: String(x.date ?? ''),
    observedCells: Number(x.observed_cells ?? 0),
    expectedCells: Number(x.expected_cells ?? 0),
    coveragePct: Number(x.coverage_pct ?? 0)
  }))
}

export async function importQuality(): Promise<
  Array<{ date: string; coveragePct: number; completenessPct: number; score: number }>
> {
  const ws = getCurrent()
  if (!ws) return []
  const r = await ws.connection.runAndReadAll(`
    SELECT CAST(d.date AS VARCHAR) AS date, q.cell_coverage_pct, q.kpi_completeness_pct, q.score
    FROM data_quality_scores q JOIN dim_date d USING (date_id)
    ORDER BY d.date DESC LIMIT 90
  `)
  return r.getRowObjects().map((x) => ({
    date: String(x.date ?? ''),
    coveragePct: Number(x.cell_coverage_pct ?? 0),
    completenessPct: Number(x.kpi_completeness_pct ?? 0),
    score: Number(x.score ?? 0)
  }))
}

// --- raw-source archive & retention (spec §9) ---

const EMPTY_ARCHIVE: RawArchiveResult = { rows: [], status: { total: 0, totalBytes: 0, retained: 0, expiring: 0, expired: 0 } }

function archiveStatus(rows: RawArchiveRow[]): RawArchiveStatus {
  const status: RawArchiveStatus = { total: rows.length, totalBytes: 0, retained: 0, expiring: 0, expired: 0 }
  for (const r of rows) {
    status.totalBytes += r.sizeBytes
    if (r.status === 'retained') status.retained++
    else if (r.status === 'expiring') status.expiring++
    else status.expired++
  }
  return status
}

/** The raw-source archive index: every archived file with its retention window. */
export async function rawArchive(): Promise<RawArchiveResult> {
  const ws = getCurrent()
  if (!ws) return EMPTY_ARCHIVE
  try {
    const r = await ws.connection.runAndReadAll(`
      SELECT CAST(archive_id AS DOUBLE) AS archive_id, CAST(import_id AS DOUBLE) AS import_id,
        filename, CAST(size_bytes AS DOUBLE) AS size_bytes, checksum,
        CAST(imported_at AS VARCHAR) AS imported_at,
        CAST(retention_until AS VARCHAR) AS retention_until,
        CAST(date_diff('day', now(), retention_until) AS DOUBLE) AS days_left
      FROM raw_archive ORDER BY imported_at DESC
    `)
    const rows: RawArchiveRow[] = r.getRowObjects().map((x) => {
      const daysLeft = Math.floor(Number(x.days_left ?? 0))
      const status: RawArchiveStatusKind = daysLeft < 0 ? 'expired' : daysLeft <= 7 ? 'expiring' : 'retained'
      return {
        archiveId: Number(x.archive_id),
        importId: Number(x.import_id ?? 0),
        filename: String(x.filename ?? ''),
        sizeBytes: Number(x.size_bytes ?? 0),
        checksum: String(x.checksum ?? ''),
        importedAt: String(x.imported_at ?? ''),
        retentionUntil: String(x.retention_until ?? ''),
        daysLeft,
        status
      }
    })
    return { rows, status: archiveStatus(rows) }
  } catch {
    // workspace predates the raw_archive table and is opened read-only
    return EMPTY_ARCHIVE
  }
}

/** Delete raw copies past their 90-day retention window (spec §9). */
export async function purgeRawArchive(): Promise<RawArchiveStatus> {
  wsRequired() // needs a writable workspace
  const ws = getCurrent()!
  const r = await ws.connection.runAndReadAll(
    `SELECT archive_id, archived_path FROM raw_archive WHERE retention_until < now()`
  )
  for (const row of r.getRowObjects()) {
    try {
      unlinkSync(String(row.archived_path))
    } catch {
      /* already gone */
    }
  }
  await ws.connection.run(`DELETE FROM raw_archive WHERE retention_until < now()`)
  const after = await rawArchive()
  return after.status
}
