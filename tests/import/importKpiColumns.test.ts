import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ImportResult } from '../../shared/api'
import { openRealWorkspace, type RealWorkspace } from '../helpers/realWorkspace'
import { readCsvSample } from '../../src/main/import/csv'
import { autoMap, makeFingerprint, mappingConfidence } from '../../src/main/import/mapping'
import { runImportCore } from '../../src/main/import/importCore'

/** What the import stores from a file's KPI columns (fact_extra_metrics),
 *  pinned on a real 3G workspace: mapped columns, a header that is itself a
 *  KPI key, ignored counters, blank and non-numeric values, duplicate rows,
 *  re-imports, derived KPIs from dotted counter names, odd header characters. */

const BASE = ['DATETIME', 'CELL', 'BASESTATION', 'DISTRICT', 'REGION']
const CSV_QUOTE = (v: string): string => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

async function importCsv(ws: RealWorkspace, name: string, header: string[], rows: string[][], kpiColumns: Record<string, string>): Promise<ImportResult> {
  const csvPath = join(ws.dir, name)
  writeFileSync(csvPath, [header, ...rows].map((r) => r.map(CSV_QUOTE).join(',')).join('\n') + '\n')
  const { header: h } = readCsvSample(csvPath, 1)
  const columns = autoMap(h)
  const backupDir = join(ws.dir, 'backups')
  mkdirSync(backupDir, { recursive: true })
  return runImportCore(ws.conn, {
    workspacePath: join(ws.dir, 'test.qosdb'), workspaceName: 'test', csvPath, header: h,
    mapping: { columns, kpiColumns }, fingerprint: makeFingerprint(h), confidence: mappingConfidence(columns, h),
    dbBefore: 0, cellsBefore: 0, checksum: name, backupDir
  })
}

/** "key|dd/mm|cell" → value for every stored extra KPI value. */
async function stored(ws: RealWorkspace): Promise<Record<string, number>> {
  const r = await ws.conn.runAndReadAll(
    `SELECT k.kpi_key, strftime(d.date, '%d/%m') AS day, c.name AS cell, f.value
     FROM fact_extra_metrics f
     JOIN kpi_defs k USING (kpi_id) JOIN dim_date d USING (date_id) JOIN dim_cell c USING (cell_id)`
  )
  return Object.fromEntries(r.getRowObjects().map((x) => [`${x.kpi_key}|${x.day}|${x.cell}`, Number(x.value)]))
}

const DERIVED = ['VS.RRC.Rej.DLPower.Cong', 'VS.RAB.FailEstabPS.DLPower.Cong', 'VS.RAB.FailEstabCS.DLPower.Cong']
const HEADER = [...BASE, '3G CSSR', 'Drops (%)', 'data_access_success_3g', 'VS.Other.Counter', 'HSDPA "Thr", kbps', 'TCH from 2G', ...DERIVED]
const KPI_COLUMNS = {
  '3G CSSR': 'call_setup_success_3g',
  'Drops (%)': 'call_drop_rate_3g',
  'HSDPA "Thr", kbps': 'hsdpa_throughput',
  'TCH from 2G': 'tch_congestion', // a 2G key: not stored in a 3G workspace
  'Not In File': 'availability_3g'
}
const geo = (cell: string): string[] => [cell, 'S1', 'Accra Metropolitan', 'Greater Accra']

describe('KPI columns of an import, on a real 3G workspace', () => {
  let ws: RealWorkspace
  let first: Record<string, number>
  beforeAll(async () => {
    ws = await openRealWorkspace('3G')
    await importCsv(ws, 'day1.csv', HEADER, [
      ['01/07/2026', ...geo('C1'), '98.5', '0.4', '97', '5', '1500', '0.7', '1', '2', '3'],
      ['01/07/2026', ...geo('C2'), '', 'abc', '96', '5', '2000', '0.7', '1', '', '3'],
      ['02/07/2026', ...geo('C1'), '99', '0.3', '95', '7', '1800', '0.7', '0', '0', '0']
    ], KPI_COLUMNS)
    first = await stored(ws)
  }, 60000)
  afterAll(async () => {
    await ws?.cleanup()
  })

  it('stores mapped columns and a header that is itself a KPI key of the workspace technology', () => {
    expect(first['call_setup_success_3g|01/07|C1']).toBe(98.5)
    expect(first['call_drop_rate_3g|01/07|C1']).toBe(0.4)
    expect(first['data_access_success_3g|01/07|C1']).toBe(97)
    expect(first['data_access_success_3g|01/07|C2']).toBe(96)
  })

  it('reads a header with quotes and commas', () => {
    expect(first['hsdpa_throughput|01/07|C1']).toBe(1500)
    expect(first['hsdpa_throughput|02/07|C1']).toBe(1800)
  })

  it('skips blank and non-numeric values, unknown counters and other technologies\' keys', () => {
    expect(first['call_setup_success_3g|01/07|C2']).toBeUndefined()
    expect(first['call_drop_rate_3g|01/07|C2']).toBeUndefined()
    expect(Object.keys(first).some((k) => k.startsWith('tch_congestion|'))).toBe(false)
    expect(Object.keys(first).some((k) => k.startsWith('VS.'))).toBe(false)
  })

  it('computes a derived KPI from dotted counter names, only when every counter is present', () => {
    expect(first['3g_dl_power_congestion|01/07|C1']).toBe(6)
    expect(first['3g_dl_power_congestion|02/07|C1']).toBe(0)
    expect(first['3g_dl_power_congestion|01/07|C2']).toBeUndefined()
  })

  it('stores exactly these values', () => {
    // C1 day 1: 5, C2 day 1: 2 (access, throughput), C1 day 2: 5
    expect(Object.keys(first).length).toBe(12)
  })

  it('a re-import fills gaps and adds new days, but never overwrites a stored value', async () => {
    await importCsv(ws, 'day1-again.csv', HEADER, [
      ['01/07/2026', ...geo('C1'), '11', '11', '11', '5', '11', '0.7', '9', '9', '9'],
      ['01/07/2026', ...geo('C2'), '90', '0.9', '11', '5', '11', '0.7', '1', '1', '1'],
      ['03/07/2026', ...geo('C1'), '97', '0.2', '94', '7', '1700', '0.7', '1', '1', '1']
    ], KPI_COLUMNS)
    const now = await stored(ws)
    for (const [k, v] of Object.entries(first)) expect(now[k], k).toBe(v)
    expect(now['call_setup_success_3g|01/07|C2']).toBe(90)
    expect(now['call_drop_rate_3g|01/07|C2']).toBe(0.9)
    expect(now['3g_dl_power_congestion|01/07|C2']).toBe(3)
    expect(now['call_setup_success_3g|03/07|C1']).toBe(97)
    expect(now['3g_dl_power_congestion|03/07|C1']).toBe(3)
  })
})

describe('duplicate rows and duplicate mappings', () => {
  let ws: RealWorkspace
  beforeAll(async () => {
    ws = await openRealWorkspace('3G')
  }, 60000)
  afterAll(async () => {
    await ws?.cleanup()
  })

  it('keeps one row per cell and day, taking every KPI from that same row', async () => {
    await importCsv(ws, 'dupes.csv', [...BASE, '3G CSSR', 'Drops (%)'], [
      ['01/07/2026', ...geo('C1'), '98.5', '0.4'],
      ['01/07/2026', ...geo('C1'), '50', '9']
    ], { '3G CSSR': 'call_setup_success_3g', 'Drops (%)': 'call_drop_rate_3g' })
    const s = await stored(ws)
    expect(Object.keys(s).length).toBe(2)
    const pair = [s['call_setup_success_3g|01/07|C1'], s['call_drop_rate_3g|01/07|C1']]
    expect([[98.5, 0.4], [50, 9]]).toContainEqual(pair)
  })

  it('two columns mapped to one KPI: the first column wins and the import succeeds', async () => {
    const res = await importCsv(ws, 'two-to-one.csv', [...BASE, 'CSSR A', 'CSSR B'], [
      ['02/07/2026', ...geo('C1'), '91', '92']
    ], { 'CSSR A': 'call_setup_success_3g', 'CSSR B': 'call_setup_success_3g' })
    expect(res.insertedRows).toBe(1)
    expect((await stored(ws))['call_setup_success_3g|02/07|C1']).toBe(91)
  })
})
