import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import { createWriteStream, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CsvSample } from './csv'
import { readExcelSampleFast } from './xlsxFast'

/** True for Excel workbooks (.xlsx and legacy .xls). NCA dashboards ship as
 *  Excel workbooks, so the import pipeline converts the first sheet to the same
 *  CSV shape it already handles. */
export function isExcelPath(path: string): boolean {
  return /\.(xlsx|xls)$/i.test(path)
}

/** True only for legacy binary .xls workbooks (read via SheetJS, not exceljs). */
function isLegacyXls(path: string): boolean {
  return /\.xls$/i.test(path)
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

/** Header aliases the pipeline treats as the Date/Time column (mirrors the
 *  canonical 'date' field aliases in mapping.ts). */
const DATE_ALIASES = new Set([
  'datetime', 'date', 'day', 'time', 'timestamp',
  'date time', 'report date', 'day date'
])

function dateToText(v: Date): string {
  // Excel date cells are timezone-naive (midnight serials); render in UTC so a
  // date-only cell never shifts a day under a local timezone
  const p = (n: number): string => String(n).padStart(2, '0')
  const date = `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`
  if (v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0) return date
  return `${date} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}:${p(v.getUTCSeconds())}`
}

/** Excel serial (days since 1899-12-30) -> ISO text. The streaming reader does
 *  not parse cell date styles, so date cells arrive as raw numbers there. */
export function excelSerialToText(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400000)
  return dateToText(new Date(ms))
}

/** Render one cell value as the plain text the CSV pipeline expects. */
export function cellToText(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return dateToText(v)
  if (typeof v === 'object' && v !== null) {
    // formula cells ({result}), hyperlinks ({text}), rich text ({richText})
    const o = v as { result?: unknown; text?: unknown; richText?: Array<{ text: string }> }
    if (o.result != null) return String(o.result)
    if (o.text != null) return String(o.text)
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join('')
    return ''
  }
  return String(v)
}

function csvField(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

interface CellLike {
  value: unknown
}

interface RowLike {
  eachCell(options: { includeEmpty: boolean }, cb: (cell: CellLike, colNumber: number) => void): void
}

function dateColumnIndexes(header: string[]): Set<number> {
  const set = new Set<number>()
  header.forEach((h, i) => {
    if (DATE_ALIASES.has(normalizeHeader(h))) set.add(i)
  })
  return set
}

function renderCell(value: unknown, colIndex: number, dateCols: Set<number>): string | null {
  if (value == null) return null
  if (dateCols.has(colIndex) && typeof value === 'number') return excelSerialToText(value)
  return cellToText(value)
}

function renderRowCells(row: RowLike, dateCols: Set<number>): Array<string | null> {
  const cells: Array<string | null> = []
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cells[colNumber - 1] = renderCell(cell.value, colNumber - 1, dateCols)
  })
  return cells
}

/** Emit the header then up to `maxRows` data rows of the first worksheet as
 *  plain text rows. Prefers exceljs's streaming reader (fast, low memory);
 *  Excel's compact sheet format omits cell addresses, which the streaming
 *  reader cannot parse, so any failure falls back to the full in-memory load
 *  (slower but handles every workbook, e.g. real NCA dashboard exports). */
async function emitFirstSheet(
  path: string,
  emit: (cells: string[]) => void,
  maxRows?: number
): Promise<void> {
  let headerLen = -1
  let dateCols = new Set<number>()
  let first = true
  let emitted = 0
  const handle = (row: RowLike): boolean => {
    const cells = renderRowCells(row, dateCols)
    if (first) {
      const h = cells.map((c) => (c ?? '').trim())
      headerLen = h.length
      dateCols = dateColumnIndexes(h)
      emit(h)
      first = false
      return true
    }
    if (cells.length === 1 && (cells[0] ?? '').trim() === '') return true
    const line: string[] = new Array(headerLen).fill('')
    for (let i = 0; i < headerLen; i++) line[i] = cells[i] ?? ''
    emit(line)
    emitted++
    return maxRows == null || emitted < maxRows
  }

  try {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
      worksheets: 'emit'
    })
    for await (const worksheet of reader) {
      for await (const row of worksheet as unknown as AsyncIterable<RowLike>) {
        if (!handle(row)) return
      }
      break // first worksheet only
    }
  } catch {
    // fallback: full in-memory load (handles compact sheets the stream cannot)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(path)
    const worksheet = wb.worksheets[0]
    if (!worksheet) return
    if (maxRows != null) {
      const n = Math.min(1 + maxRows, worksheet.rowCount)
      for (let i = 1; i <= n; i++) {
        if (!handle(worksheet.getRow(i))) break
      }
    } else {
      worksheet.eachRow({ includeEmpty: true }, (row) => {
        handle(row as unknown as RowLike)
      })
    }
  }
}

/** Legacy .xls path: read the first worksheet with SheetJS (BIFF) and emit the
 *  same header + text rows the exceljs path produces for .xlsx. */
function emitXlsSheet(
  path: string,
  emit: (cells: string[]) => void,
  maxRows?: number
): void {
  const wb = XLSX.readFile(path, { cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as Array<Array<unknown>>
  if (aoa.length === 0) return
  let headerLen = -1
  let dateCols = new Set<number>()
  let first = true
  let emitted = 0
  for (const row of aoa) {
    if (first) {
      const h = row.map((c) => String(c ?? '').trim())
      headerLen = h.length
      dateCols = dateColumnIndexes(h)
      emit(h)
      first = false
      continue
    }
    if (row.length === 1 && String(row[0] ?? '').trim() === '') continue
    const line: string[] = new Array(headerLen).fill('')
    for (let i = 0; i < headerLen; i++) line[i] = renderCell(row[i], i, dateCols) ?? ''
    emit(line)
    emitted++
    if (maxRows != null && emitted >= maxRows) break
  }
}

/** Read the header plus up to `maxRows` data rows from the first sheet of an
 *  Excel workbook (mirror of readCsvSample for the same pipeline). */
export async function readExcelSample(path: string, maxRows = 30): Promise<CsvSample> {
  if (isLegacyXls(path)) {
    const header: string[] = []
    const rows: string[][] = []
    emitXlsSheet(
      path,
      (cells) => {
        if (header.length === 0) header.push(...cells)
        else rows.push(cells)
      },
      maxRows
    )
    return { header, rows }
  }
  // fast path: read only the first rows from the raw zip (milliseconds even
  // for 20MB+ workbooks); falls back to exceljs below on any oddity
  try {
    return await readExcelSampleFast(path, maxRows)
  } catch {
    /* fall through to exceljs */
  }
  const header: string[] = []
  const rows: string[][] = []
  await emitFirstSheet(
    path,
    (cells) => {
      if (header.length === 0) header.push(...cells)
      else rows.push(cells)
    },
    maxRows
  )
  return { header, rows }
}

/** Write the first worksheet of an Excel workbook as CSV to `dest` (used both
 *  for the temp staging file and for user-initiated "Export as CSV"). */
export async function excelToCsvFile(path: string, dest: string): Promise<void> {
  const writer = createWriteStream(dest)
  let buffer = ''
  const CHUNK_SIZE = 65536 // 64KB memory chunk buffer

  const writeBuffered = (line: string): void => {
    buffer += line + '\n'
    if (buffer.length >= CHUNK_SIZE) {
      writer.write(buffer)
      buffer = ''
    }
  }

  try {
    if (isLegacyXls(path)) {
      emitXlsSheet(path, (cells) => {
        writeBuffered(cells.map(csvField).join(','))
      })
    } else {
      await emitFirstSheet(path, (cells) => {
        writeBuffered(cells.map(csvField).join(','))
      })
    }
    if (buffer.length > 0) {
      writer.write(buffer)
      buffer = ''
    }
    await new Promise<void>((resolve, reject) => {
      writer.end((e?: Error | null) => (e ? reject(e) : resolve()))
    })
  } catch (e) {
    try {
      unlinkSync(dest)
    } catch {
      /* ignore */
    }
    throw e
  }
}

/** Convert the first worksheet of an .xlsx into a temp CSV file on disk so the
 *  DuckDB staging step can read it with read_csv (header = true). Returns the
 *  temp path; the caller is responsible for deleting it. */
export async function excelToTempCsv(path: string): Promise<string> {
  const dest = join(tmpdir(), `qos-import-${randomUUID()}.csv`)
  await excelToCsvFile(path, dest)
  return dest
}
