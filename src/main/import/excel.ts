import ExcelJS from 'exceljs'
import { createWriteStream, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CsvSample } from './csv'
import { readExcelSampleFast } from './xlsxFast'

/** True for Excel workbooks. NCA dashboards ship as Excel workbooks, so the
 *  import pipeline converts their sheets to the same CSV shape it already
 *  handles. A legacy .xls still counts as Excel (so it is never mistaken for
 *  CSV) but is rejected by every reader: imports are .xlsx or CSV. */
export function isExcelPath(path: string): boolean {
  return /\.(xlsx|xls)$/i.test(path)
}

export const LEGACY_XLS_MESSAGE =
  'Legacy .xls workbooks are not supported — open the file in Excel and save it as .xlsx, or export it as CSV (comma delimited).'
export const UNREADABLE_WORKBOOK_MESSAGE =
  'This workbook could not be read — open it in Excel and save it as .xlsx, or export it as CSV (comma delimited).'

/** Throws the user-facing message for a legacy .xls (SheetJS, the only .xls
 *  reader, was removed: xlsx 0.18.5 on npm is unpatched). */
export function assertSupportedWorkbook(path: string): void {
  if (/\.xls$/i.test(path)) throw new Error(LEGACY_XLS_MESSAGE)
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
/** Read all sheets in an Excel workbook and emit their plain text rows.
 *  Handles: single sheet, multi-technology sheets (2G, 3G, 4G), multi-KPI sheets, and multi-week sheets. */
async function emitAllSheets(
  path: string,
  emit: (cells: string[]) => void,
  maxRowsPerSheet?: number
): Promise<void> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.readFile(path)
  } catch (e) {
    throw new Error(UNREADABLE_WORKBOOK_MESSAGE, { cause: e })
  }

  let globalHeader: string[] | null = null
  for (const worksheet of wb.worksheets) {
    let dateCols = new Set<number>()
    let firstInSheet = true
    let emittedInSheet = 0

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (maxRowsPerSheet != null && emittedInSheet >= maxRowsPerSheet && !firstInSheet) return
      const cells = renderRowCells(row as unknown as RowLike, dateCols)

      if (firstInSheet) {
        const h = cells.map((c) => (c ?? '').trim())
        dateCols = dateColumnIndexes(h)
        if (!globalHeader) {
          globalHeader = h
          emit(h)
        }
        firstInSheet = false
        return
      }

      const len = globalHeader?.length ?? cells.length
      const line: string[] = new Array(len).fill('')
      for (let i = 0; i < len; i++) line[i] = cells[i] ?? ''
      emit(line)
      emittedInSheet++
    })
  }
}

/** Read the header plus up to `maxRows` data rows from an
 *  Excel workbook across worksheets (mirror of readCsvSample for the same pipeline). */
export async function readExcelSample(path: string, maxRows = 30): Promise<CsvSample> {
  assertSupportedWorkbook(path)
  // fast path: read only the first rows from the raw zip (milliseconds even
  // for 20MB+ workbooks); falls back to full load on multi-sheet or complex workbooks
  try {
    const fast = await readExcelSampleFast(path, maxRows)
    if (fast.header.length > 0 && fast.rows.length > 0) return fast
  } catch {
    /* fall through to multi-sheet reader */
  }
  const header: string[] = []
  const rows: string[][] = []
  await emitAllSheets(
    path,
    (cells) => {
      if (header.length === 0) header.push(...cells)
      else rows.push(cells)
    },
    maxRows
  )
  return { header, rows }
}

/** Write the worksheets of an Excel workbook as CSV to `dest` (used both
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

  assertSupportedWorkbook(path)
  try {
    await emitAllSheets(path, (cells) => {
      writeBuffered(cells.map(csvField).join(','))
    })
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

/** Convert an .xlsx into a temp CSV file on disk so the
 *  DuckDB staging step can read it with read_csv (header = true). Returns the
 *  temp path; the caller is responsible for deleting it. */
export async function excelToTempCsv(path: string): Promise<string> {
  const dest = join(tmpdir(), `qos-import-${randomUUID()}.csv`)
  await excelToCsvFile(path, dest)
  return dest
}
