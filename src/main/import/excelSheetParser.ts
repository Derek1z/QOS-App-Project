import ExcelJS from 'exceljs'
import { isExcelPath, cellToText, assertSupportedWorkbook, UNREADABLE_WORKBOOK_MESSAGE } from './excel'

export interface SheetInfo {
  name: string
  rowCount: number
  headers: string[]
  sampleRows: string[][]
  detectedTech: '2G' | '3G' | '4G' | 'Unknown'
}

export function detectTechFromSheet(name: string, headers: string[]): '2G' | '3G' | '4G' | 'Unknown' {
  const combined = (name + ' ' + headers.join(' ')).toUpperCase()
  if (/\b(4G|LTE|ENODEB|CELL_4G)\b/.test(combined)) return '4G'
  if (/\b(3G|UMTS|RNC|NODEB|CELL_3G)\b/.test(combined)) return '3G'
  if (/\b(2G|GSM|BSC|BTS|CELL_2G)\b/.test(combined)) return '2G'
  return 'Unknown'
}

export async function inspectExcelSheets(filePath: string): Promise<SheetInfo[]> {
  if (!isExcelPath(filePath)) return []

  assertSupportedWorkbook(filePath)

  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.readFile(filePath)
  } catch (e) {
    throw new Error(UNREADABLE_WORKBOOK_MESSAGE, { cause: e })
  }
  const sheets: SheetInfo[] = []
  for (const ws of wb.worksheets) {
    const headers: string[] = []
    const sampleRows: string[][] = []
    let rowCount = 0
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) {
        row.eachCell({ includeEmpty: true }, (cell) => {
          headers.push(cellToText(cell.value).trim())
        })
      } else {
        rowCount++
        if (sampleRows.length < 5) {
          const r: string[] = []
          row.eachCell({ includeEmpty: true }, (cell) => {
            r.push(cellToText(cell.value))
          })
          sampleRows.push(r)
        }
      }
    })
    sheets.push({
      name: ws.name,
      rowCount,
      headers,
      sampleRows,
      detectedTech: detectTechFromSheet(ws.name, headers)
    })
  }
  return sheets
}
