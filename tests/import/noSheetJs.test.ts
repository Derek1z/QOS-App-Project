import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import ExcelJS from 'exceljs'
import { readExcelSample, excelToTempCsv } from '../../src/main/import/excel'
import { inspectExcelSheets } from '../../src/main/import/excelSheetParser'

/** SheetJS (xlsx 0.18.5, unpatched on npm) is removed: imports are .xlsx
 *  (read by exceljs) or CSV; a legacy .xls or an unreadable workbook gets a
 *  clear message instead of a silent fallback. */
const dir = mkdtempSync(join(os.tmpdir(), 'qos-nosheetjs-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const XLS_MESSAGE = 'Legacy .xls workbooks are not supported — open the file in Excel and save it as .xlsx, or export it as CSV (comma delimited).'
const UNREADABLE_MESSAGE = 'This workbook could not be read — open it in Excel and save it as .xlsx, or export it as CSV (comma delimited).'

// an OLE2 compound-file header, as a real .xls starts
const xlsPath = join(dir, 'legacy.xls')
writeFileSync(xlsPath, Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]))
const brokenPath = join(dir, 'broken.xlsx')
writeFileSync(brokenPath, 'Date,Cell,PRB\n01/07/2026,C1,50\n')

describe('Excel import without SheetJS', () => {
  it('a legacy .xls is rejected with a clear message by every reader', async () => {
    await expect(readExcelSample(xlsPath)).rejects.toThrow(XLS_MESSAGE)
    await expect(excelToTempCsv(xlsPath)).rejects.toThrow(XLS_MESSAGE)
    await expect(inspectExcelSheets(xlsPath)).rejects.toThrow(XLS_MESSAGE)
  })

  it('a workbook exceljs cannot read gets the re-save message, not a fallback parse', async () => {
    await expect(readExcelSample(brokenPath)).rejects.toThrow(UNREADABLE_MESSAGE)
    await expect(excelToTempCsv(brokenPath)).rejects.toThrow(UNREADABLE_MESSAGE)
    await expect(inspectExcelSheets(brokenPath)).rejects.toThrow(UNREADABLE_MESSAGE)
  })

  it('a normal multi-sheet .xlsx still reads', { timeout: 30000 }, async () => {
    const wb = new ExcelJS.Workbook()
    for (const name of ['4G', '3G']) {
      const ws = wb.addWorksheet(name)
      ws.addRow(['Date', 'Cell', 'PRB'])
      ws.addRow(['01/07/2026', `${name}-C1`, 50])
    }
    const path = join(dir, 'ok.xlsx')
    await wb.xlsx.writeFile(path)
    const sample = await readExcelSample(path)
    expect(sample.header).toEqual(['Date', 'Cell', 'PRB'])
    expect(sample.rows.length).toBeGreaterThanOrEqual(1)
    const csv = await excelToTempCsv(path)
    expect(readFileSync(csv, 'utf8')).toContain('4G-C1')
    rmSync(csv, { force: true })
    expect((await inspectExcelSheets(path)).map((s) => s.name)).toEqual(['4G', '3G'])
  })

  it('xlsx (SheetJS) is no longer a dependency', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    expect(pkg.dependencies?.xlsx).toBeUndefined()
    expect(pkg.devDependencies?.xlsx).toBeUndefined()
  })
})
