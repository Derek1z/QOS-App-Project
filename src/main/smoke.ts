import { openSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import { excelToCsvFile } from './import/excel'
import * as ws from './workspace/manager'
import {
  getSummary, getNcLifecycle, getNcMovement, getPriorityQueue, getHealth, getHealthMatrix,
  getCellIntelligence, getCellDetail, getPerformance, getComparison, getExplorer,
  getPriorityCenter, getForecast, getRulesCurrent, updateRulesCurrent,
  getRegionMap, getRegionDistricts, getKpiOverview
} from './services/queryService'
import {
  searchEntities, getInvestigation, setInvestigationStatus, addInvestigationNote,
  exportInvestigationReport
} from './services/investigationService'
import {
  generateReportPack, listReportDefinitions, saveReportDefinition, listReportHistory,
  checkDueReports
} from './services/reportingService'
import { analyzeFiles, previewImport, runImport, rawArchive, purgeRawArchive } from './import/importer'
import {
  createSnapshot, listSnapshots, restoreSnapshot, removeSnapshot, compareSnapshots
} from './services/snapshotService'
import { runMaintenance } from './services/maintenanceService'
import {
  getSchedule, setSchedule, runScheduled, scheduleHistory, maybeRunScheduled
} from './services/maintenanceScheduler'
import {
  seedKpiDefs, listKpiDefs, saveKpiDef, removeKpiDef, discoverKpiDefs
} from './services/kpiService'
import { app } from 'electron'
import { overrideDataDirs, dirs } from './paths'

export async function runSmokeTest(dir: string): Promise<void> {
  // keep snapshots/safety backups inside the temp dir, never the portable folder
  overrideDataDirs({ backups: join(dir, 'backups'), snapshots: join(dir, 'snapshots'), exports: join(dir, 'exports') })

  // 1. create workspace
  const created = await ws.createWorkspace(dir, 'Smoke Test')
  if (created.rowCount !== 0) throw new Error('fresh workspace should be empty')

  // 1b. lock file must exist while writable handle is open
  try {
    openSync(created.path + '.lock', 'wx')
    throw new Error('lock-missing')
  } catch (e) {
    if ((e as Error).message === 'lock-missing') throw e
  }

  // 2. insert sample rows
  const cur = ws.getCurrent()!
  await cur.connection.run(`INSERT INTO dim_region VALUES (1, 'Greater Accra'), (2, 'Ashanti')`)
  await cur.connection.run(`INSERT INTO dim_district VALUES (1, 'Accra Metro', 1), (2, 'Kumasi', 2)`)
  await cur.connection.run(`INSERT INTO dim_site VALUES (1, 'ACC-001', 1), (2, 'KUM-001', 2)`)
  await cur.connection.run(`INSERT INTO dim_cell VALUES
    (1001, 'ACC-001-A', 1, 1, 1),
    (1002, 'ACC-001-B', 1, 1, 1),
    (2001, 'KUM-001-A', 2, 2, 2)`)
  await cur.connection.run(`INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users, dl_throughput_kbps, availability_pct) VALUES
    (20260701, 1001, 82.0, 1200.5, 45, 18000, 99.8),
    (20260701, 1002, 75.0, 800.2, 30, 15000, 99.5),
    (20260701, 2001, 90.0, 1500.0, 60, 22000, 98.9),
    (20260702, 1001, 84.0, 1300.0, 50, 18500, 99.7),
    (20260702, 1002, 72.0, 700.0, 28, 14000, 99.6),
    (20260702, 2001, 91.0, 1600.0, 65, 23000, 98.8)`)

  // 3. summary must reflect inserted rows
  const summary = await getSummary()
  if (!summary) throw new Error('summary is null with workspace open')
  if (summary.rowCount !== 6) throw new Error(`rowCount ${summary.rowCount} != 6`)
  if (summary.cells !== 3 || summary.regions !== 2 || summary.districts !== 2 || summary.sites !== 2) {
    throw new Error(`dims mismatch: ${JSON.stringify(summary)}`)
  }
  if (summary.avgPrb === null || summary.avgPrb < 80 || summary.avgPrb > 85) {
    throw new Error(`avgPrb unexpected: ${summary.avgPrb}`)
  }
  if (summary.minDate !== '2026-07-01' || summary.maxDate !== '2026-07-02') {
    throw new Error(`date range unexpected: ${summary.minDate}..${summary.maxDate}`)
  }
  if (summary.rulesetVersion !== 1) throw new Error('ruleset v1 missing')

  // 4. read-only open; writes must fail
  await ws.closeWorkspace()
  const ro = await ws.openWorkspace(created.path, { readOnly: true })
  if (!ro.readOnly) throw new Error('expected read-only open')
  if (ro.rowCount !== 6) throw new Error('read-only open lost data')
  let roWriteFailed = false
  try {
    await ws.getCurrent()!.connection.run(`INSERT INTO dim_region VALUES (9, 'X')`)
  } catch {
    roWriteFailed = true
  }
  if (!roWriteFailed) throw new Error('read-only write did not fail')

  // 5. reopen writable after close works
  await ws.closeWorkspace()
  const again = await ws.openWorkspace(created.path)
  if (again.rowCount !== 6) throw new Error('reopen after close lost data')

  // 6. random file must be rejected as a workspace
  await ws.closeWorkspace()
  const bad = join(dir, 'junk.txt')
  writeFileSync(bad, 'not a duckdb file')
  let rejected = false
  try {
    await ws.openWorkspace(bad)
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('invalid workspace was accepted')

  await ws.closeWorkspace()

  // 8. import pipeline: CSV with one new cell + one new site
  const csv = join(dir, 'import.csv')
  writeFileSync(
    csv,
    [
      'DATETIME,DISTRICT,REGION,CELL,BASESTATION,4G Peak Hour Traffic Utilization_NCA,RRC Connected UEs (Avg)_STD(#),4G Data Volume_STD(MB),4G Cell Availability_STD(%),E-UTRAN IP Throughput UE DL_STD(kbps)',
      '2026-07-05,Accra Metro,Greater Accra,ACC-001-A,ACC-001,88.0,52,1400.0,99.7,19500',
      '2026-07-05,Accra Metro,Greater Accra,ACC-001-B,ACC-001,76.0,33,900.0,99.6,16000',
      '2026-07-05,Kumasi,Ashanti,KUM-001-A,KUM-001,92.0,68,1700.0,98.8,24000',
      '2026-07-06,Accra Metro,Greater Accra,ACC-001-A,ACC-001,89.0,55,1450.0,99.8,19800',
      '2026-07-06,Accra Metro,Greater Accra,ACC-001-B,ACC-001,74.0,31,850.0,99.5,15500',
      '2026-07-06,Kumasi,Ashanti,KUM-002-A,KUM-002,93.0,70,1750.0,98.9,24500'
    ].join('\n')
  )
  await ws.openWorkspace(created.path)
  const [analysis] = await analyzeFiles([csv])
  if (!analysis || analysis.errors.length > 0) throw new Error('analyze failed: ' + JSON.stringify(analysis.errors))
  if (Object.keys(analysis.suggestedMapping).length < 8) {
    throw new Error('mapping too small: ' + JSON.stringify(analysis.suggestedMapping))
  }
  const mapping = { columns: analysis.suggestedMapping }
  const preview = await previewImport(analysis.id, mapping)
  if (!preview.canImport) throw new Error('preview blocked: ' + JSON.stringify(preview.issues))
  const phases: string[] = []
  const res = await runImport(analysis.id, mapping, {
    backupDir: join(dir, 'backups'),
    onProgress: (p) => phases.push(p.phase)
  })
  if (res.insertedRows !== 6) throw new Error('import inserted ' + res.insertedRows)
  if (phases.length < 2) {
    throw new Error('import worker progress missing: ' + JSON.stringify(phases))
  }
  if (res.rejectedRows !== 0) throw new Error('import rejected ' + res.rejectedRows)
  if (res.newCells !== 1) throw new Error('import newCells ' + res.newCells)
  const sum2 = await getSummary()
  if (!sum2 || sum2.rowCount !== 12) throw new Error('post-import rows ' + (sum2 ? sum2.rowCount : 'null'))
  const cur2 = ws.getCurrent()!
  const wk = await cur2.connection.runAndReadAll(`SELECT count(*) n FROM agg_cell_weekly`)
  if (Number(wk.getRowObjects()[0].n) < 2) throw new Error('weekly aggregates missing')
  const cov = await cur2.connection.runAndReadAll(`SELECT count(*) n FROM coverage_daily`)
  if (Number(cov.getRowObjects()[0].n) < 2) throw new Error('coverage missing')
  const aud = await cur2.connection.runAndReadAll(`SELECT count(*) n FROM import_audit`)
  if (Number(aud.getRowObjects()[0].n) < 1) throw new Error('audit missing')

  // 9. re-import the same file: every row is a duplicate, nothing inserted
  const res2 = await runImport(analysis.id, mapping, { backupDir: join(dir, 'backups') })
  if (res2.insertedRows !== 0 || res2.duplicatesIgnored !== 6) {
    throw new Error('dedupe failed: ' + JSON.stringify(res2))
  }

  // 10. mapping profile remembered for next time (fresh handle: import #2 reopened the workspace)
  const cur3 = ws.getCurrent()!
  const prof = await cur3.connection.runAndReadAll(`SELECT count(*) n FROM source_mapping_profiles`)
  if (Number(prof.getRowObjects()[0].n) < 1) throw new Error('mapping profile not saved')

  // 10b. raw-source archive (spec §9): both imports archived the CSV as gzip
  if (!res.archivePath || !res.retentionUntil) {
    throw new Error('import result missing archive metadata: ' + JSON.stringify(res))
  }
  if (!existsSync(res.archivePath)) throw new Error('archived raw file missing: ' + res.archivePath)
  const gz = readFileSync(res.archivePath)
  if (gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Error('archived file is not gzip')
  const arch = await cur3.connection.runAndReadAll(
    `SELECT archived_path, CAST(retention_until AS VARCHAR) AS until FROM raw_archive`
  )
  const archRows = arch.getRowObjects()
  if (archRows.length !== 2) throw new Error('raw_archive rows ' + archRows.length + ' (two imports)')
  for (const a of archRows) {
    if (!String(a.until)) throw new Error('raw archive missing retention_until')
  }
  const ar = await rawArchive()
  if (ar.status.total !== 2 || ar.rows.length !== 2) throw new Error('rawArchive() total ' + ar.status.total)
  if (!ar.rows.every((r) => r.status === 'retained' && r.daysLeft > 80 && r.checksum)) {
    throw new Error('rawArchive rows malformed: ' + JSON.stringify(ar.rows))
  }
  // purge: backdate one file past retention, purge, expect it gone and the other kept
  const backdated = archRows[0].archived_path
  await cur3.connection.run(
    `UPDATE raw_archive SET retention_until = now() - INTERVAL 1 DAY WHERE archived_path = ?`,
    [backdated]
  )
  const purged = await purgeRawArchive()
  if (purged.expired !== 0 || purged.total !== 1) {
    throw new Error('purge result wrong: ' + JSON.stringify(purged))
  }
  if (existsSync(String(backdated))) throw new Error('purged raw file still on disk')
  const remaining = await cur3.connection.runAndReadAll(`SELECT count(*) n FROM raw_archive`)
  if (Number(remaining.getRowObjects()[0].n) !== 1) throw new Error('raw_archive row count after purge')

  // --- M2: analytics engine ---

  // 11. NC lifecycle classifications exist for the imported cells
  const life = await cur3.connection.runAndReadAll(`SELECT count(*) n FROM cell_nc_lifecycle`)
  if (Number(life.getRowObjects()[0].n) < 4) throw new Error('cell_nc_lifecycle empty')
  const cls = await cur3.connection.runAndReadAll(`
    SELECT c.name, l.period_start, l.lifecycle, l.severity
    FROM cell_nc_lifecycle l JOIN dim_cell c USING (cell_id)
    WHERE l.grain = 'weekly' AND CAST(l.period_start AS VARCHAR) = '2026-07-06'
    ORDER BY c.name
  `)
  const byName: Record<string, string> = {}
  const bySev: Record<string, string> = {}
  for (const row of cls.getRowObjects()) {
    byName[String(row.name)] = String(row.lifecycle)
    bySev[String(row.name)] = String(row.severity)
  }
  if (byName['ACC-001-A'] !== 'Recurring NC') {
    throw new Error('ACC-001-A should be Recurring NC (2nd consecutive week): ' + JSON.stringify(byName))
  }
  if (bySev['ACC-001-A'] !== 'Critical') {
    throw new Error('ACC-001-A should be Critical (recurring + worsening + high PRB): ' + JSON.stringify(bySev))
  }
  if (byName['ACC-001-B'] !== 'Healthy') throw new Error('ACC-001-B should be Healthy')
  if (byName['KUM-002-A'] !== 'New NC') throw new Error('KUM-002-A should be New NC')
  const newNc = await cur3.connection.runAndReadAll(
    `SELECT count(*) n FROM cell_nc_lifecycle WHERE grain='weekly' AND lifecycle='New NC'`
  )
  if (Number(newNc.getRowObjects()[0].n) < 2) throw new Error('expected at least 2 New NC weeks')

  // 12. lifecycle query service returns the latest week's summary
  const nc = await getNcLifecycle()
  if (nc.totalCells !== 3) throw new Error('nc totalCells ' + nc.totalCells)
  if (nc.ncCells !== 2) throw new Error('nc ncCells ' + nc.ncCells)
  if (nc.bySeverity.Critical + nc.bySeverity.High + nc.bySeverity.Watch !== 2) {
    throw new Error('severity spread wrong: ' + JSON.stringify(nc.bySeverity))
  }

  // 13. priority queue: latest week, balanced mode; ACC-001-A leads
  //     (Recurring + worsening + high PRB outweighs KUM-002-A's PRB-only score)
  const queue = await getPriorityQueue('balanced', 10)
  if (queue.length !== 3) throw new Error('priority queue length ' + queue.length)
  if (queue[0].cellName !== 'ACC-001-A') {
    throw new Error('priority top should be ACC-001-A: ' + queue[0].cellName)
  }
  if (!['Watch', 'Medium', 'High', 'Critical'].includes(queue[0].band)) {
    throw new Error('priority band wrong: ' + queue[0].band + ' ' + queue[0].score)
  }
  const pq = await cur3.connection.runAndReadAll(
    `SELECT count(*) n FROM cell_priority_history`
  )
  if (Number(pq.getRowObjects()[0].n) !== 20) {
    throw new Error('priority rows ' + Number(pq.getRowObjects()[0].n) + ' (expect 4 cells x 5 modes)')
  }

  // 14. health: network series + cell snapshot, all scores in 0..100
  const health = await getHealth()
  if (health.network.length < 1) throw new Error('no network health rows')
  const latest = health.network[health.network.length - 1]
  if (latest.score < 0 || latest.score > 100) throw new Error('network health score OOB ' + latest.score)
  if (health.cells.length < 3) throw new Error('cell health rows ' + health.cells.length)
  for (const c of health.cells) {
    if (c.healthScore < 0 || c.healthScore > 100) throw new Error('cell health OOB ' + c.healthScore)
  }

  // 15. ruleset change: threshold 80 → 90 creates v2, recomputes, keeps facts intact
  const rulesBefore = await getRulesCurrent()
  if (!rulesBefore || rulesBefore.version !== 1) throw new Error('ruleset v1 missing')
  const rules2 = await updateRulesCurrent({ prbThresholdPct: 90, notes: 'smoke bump' })
  if (rules2.version !== 2 || rules2.prbThresholdPct !== 90) throw new Error('ruleset v2 missing')
  const cur4 = ws.getCurrent()!
  const still = await cur4.connection.runAndReadAll(`SELECT count(*) n FROM fact_cell_daily`)
  if (Number(still.getRowObjects()[0].n) !== 12) throw new Error('ruleset change altered raw facts')
  const accA = await cur4.connection.runAndReadAll(`
    SELECT w.is_nc FROM agg_cell_weekly w JOIN dim_cell c USING (cell_id)
    WHERE c.name = 'ACC-001-A' AND CAST(w.week_start AS VARCHAR) = '2026-07-06'
  `)
  if (Boolean(accA.getRowObjects()[0].is_nc)) throw new Error('ACC-001-A should no longer be NC at 90% threshold')
  const rc = await cur4.connection.runAndReadAll(
    `SELECT count(*) n FROM notes_events WHERE kind = 'ruleset_change'`
  )
  if (Number(rc.getRowObjects()[0].n) < 1) throw new Error('ruleset change not audited')
  let invalidRejected2 = false
  try {
    await updateRulesCurrent({ prbThresholdPct: 150 })
  } catch {
    invalidRejected2 = true
  }
  if (!invalidRejected2) throw new Error('invalid ruleset accepted')
  const ver = await cur4.connection.runAndReadAll(`SELECT max(version) n FROM ruleset`)
  if (Number(ver.getRowObjects()[0].n) !== 2) throw new Error('invalid ruleset still bumped version')

  // 16. NC movement (M3 overview): per-week lifecycle counts under current rules
  const movement = await getNcMovement(8)
  if (movement.length !== 2) throw new Error('movement weeks ' + movement.length)
  const latestMove = movement[movement.length - 1]
  if (latestMove.ncCells !== 1 || latestMove.newNc !== 1) {
    throw new Error('movement latest week wrong: ' + JSON.stringify(latestMove))
  }

  // 17. health matrix (M3): cell x week heatmap source rolls up cell health
  const mat = await getHealthMatrix('cell', { weeks: 8, sort: 'worst' })
  if (mat.rows.length !== 4) throw new Error('matrix rows ' + mat.rows.length)
  if (mat.weeks.length !== 2) throw new Error('matrix weeks ' + mat.weeks.length)
  for (const row of mat.rows) {
    if (row.scores.length !== mat.weeks.length) throw new Error('matrix row width mismatch')
    for (const s of row.scores) {
      if (s != null && (s < 0 || s > 100)) throw new Error('matrix score OOB ' + s)
    }
  }
  const matSite = await getHealthMatrix('site', { weeks: 8 })
  if (matSite.rows.length < 1) throw new Error('site matrix empty')

  // 18. cell intelligence: all-cells table + per-cell detail history
  const ci = await getCellIntelligence({})
  if (ci.total !== 3) throw new Error('cell intelligence total ' + ci.total)
  if (ci.rows.length !== 3) throw new Error('cell intelligence rows ' + ci.rows.length)
  // under ruleset v2 (threshold 90) the only NC cell (KUM-002-A) leads the queue
  if (ci.rows[0].cellName !== 'KUM-002-A') {
    throw new Error('cell intelligence top should be KUM-002-A: ' + ci.rows[0].cellName)
  }
  if (ci.rows[0].priorityScore == null) throw new Error('cell intelligence missing priority')
  const ciSearch = await getCellIntelligence({ search: 'KUM' })
  if (ciSearch.total !== 1 || ciSearch.rows[0].cellName !== 'KUM-002-A') {
    throw new Error('cell intelligence search failed: ' + ciSearch.total)
  }
  const ciNc = await getCellIntelligence({ lifecycle: 'New NC' })
  if (ciNc.total !== 1) throw new Error('cell intelligence lifecycle filter ' + ciNc.total)
  const cd = await getCellDetail(1001)
  if (!cd || cd.weeks.length < 2) throw new Error('cell detail weeks ' + (cd ? cd.weeks.length : 'null'))
  if (cd.current?.lifecycle !== 'Healthy') {
    throw new Error('ACC-001-A detail lifecycle ' + cd.current?.lifecycle)
  }
  const cd2 = await getCellDetail(2002)
  if (!cd2 || cd2.current?.lifecycle !== 'New NC') {
    throw new Error('KUM-002-A detail lifecycle ' + cd2?.current?.lifecycle)
  }
  const cdMissing = await getCellDetail(999999)
  if (cdMissing !== null) throw new Error('unknown cell detail should be null')

  // 19. performance analysis: distributions, quadrant scatter, correlations
  const perf = await getPerformance()
  if (perf.totalCells !== 3) throw new Error('perf totalCells ' + perf.totalCells)
  if (perf.distributions.length !== 5) throw new Error('perf distributions ' + perf.distributions.length)
  for (const d of perf.distributions) {
    if (d.points.length !== 21) throw new Error('perf points ' + d.points.length + ' for ' + d.metric)
    if (d.p50 == null || d.p90 == null || d.min == null || d.max == null) {
      throw new Error('perf missing stats for ' + d.metric)
    }
    if (d.p50 > d.p90) throw new Error('perf p50>p90 for ' + d.metric)
    if (d.min > d.max) throw new Error('perf min>max for ' + d.metric)
  }
  if (perf.scatter.length !== 3) throw new Error('perf scatter ' + perf.scatter.length)
  if (perf.throughputMedianKbps == null) throw new Error('perf median throughput missing')
  const quadrants = new Set(perf.scatter.map((s) => s.quadrant))
  if (quadrants.size < 2) throw new Error('perf quadrants collapsed: ' + [...quadrants].join(','))
  if (perf.correlations.length !== 10) throw new Error('perf correlations ' + perf.correlations.length)
  for (const c of perf.correlations) {
    if (c.pearson != null && (c.pearson < -1.01 || c.pearson > 1.01)) {
      throw new Error('perf correlation OOB ' + c.pearson)
    }
  }

  // 20. comparison lab: period-vs-period (latest week vs previous ISO week) and
  //     region-vs-region (regions vs network baseline)
  const cmpP = await getComparison({ type: 'period', scope: 'cell', metric: 'prb' })
  if (cmpP.aLabel !== '2026-07-06' || cmpP.bLabel !== '2026-06-29') {
    throw new Error('comparison weeks ' + cmpP.aLabel + ' ' + cmpP.bLabel)
  }
  if (cmpP.kpis.length !== 6) throw new Error('comparison kpis ' + cmpP.kpis.length)
  if (cmpP.rows.length !== 4) throw new Error('comparison rows ' + cmpP.rows.length)
  const cmpByName: Record<string, (typeof cmpP.rows)[number]> = {}
  for (const r of cmpP.rows) cmpByName[r.name] = r
  // KUM-002-A is NC in the latest week but absent from the previous → New NC
  if (!cmpByName['KUM-002-A'] || cmpByName['KUM-002-A'].transition !== 'new') {
    throw new Error('KUM-002-A should be a new NC transition: ' + JSON.stringify(cmpByName['KUM-002-A']))
  }
  // KUM-001-A was NC in the previous week (PRB 91) but gone from the latest → Recovered
  if (!cmpByName['KUM-001-A'] || cmpByName['KUM-001-A'].transition !== 'recovered') {
    throw new Error('KUM-001-A should be recovered: ' + JSON.stringify(cmpByName['KUM-001-A']))
  }
  const cmpAcc = cmpByName['ACC-001-A']
  if (!cmpAcc || cmpAcc.current == null || cmpAcc.previous == null || !(cmpAcc.delta! > 0)) {
    throw new Error('ACC-001-A PRB should rise: ' + JSON.stringify(cmpAcc))
  }
  const prbKpi = cmpP.kpis.find((k) => k.metric === 'prb')!
  if (prbKpi.current == null || prbKpi.previous == null || prbKpi.current <= prbKpi.previous) {
    throw new Error('network PRB should worsen: ' + JSON.stringify(prbKpi))
  }
  const cmpR = await getComparison({ type: 'region', metric: 'throughput' })
  if (cmpR.rows.length !== 2) throw new Error('region rows ' + cmpR.rows.length)
  const thrKpi = cmpR.kpis.find((k) => k.metric === 'throughput')!
  if (thrKpi.current == null || thrKpi.best == null || thrKpi.worst == null) {
    throw new Error('region throughput kpi missing best/worst')
  }
  if (!(thrKpi.best > thrKpi.worst)) throw new Error('region best <= worst')
  for (const r of cmpR.rows) {
    if (r.previous == null || r.previous !== thrKpi.current) {
      throw new Error('region baseline should be network value: ' + r.name)
    }
  }

  // 21. network explorer: hierarchical drill-down with health rollups
  const exR = await getExplorer('region')
  if (exR.nodes.length !== 2) throw new Error('explorer regions ' + exR.nodes.length)
  const exByRegion: Record<string, (typeof exR.nodes)[number]> = {}
  for (const n of exR.nodes) exByRegion[n.name] = n
  if (exByRegion['Ashanti']?.ncCells !== 1) throw new Error('Ashanti should have 1 NC cell')
  if (exByRegion['Greater Accra']?.ncCells !== 0) throw new Error('Greater Accra NC count wrong')
  for (const n of exR.nodes) {
    if (n.cells !== 2) throw new Error('region cells ' + n.name + ' ' + n.cells)
    if (n.healthScore != null && (n.healthScore < 0 || n.healthScore > 100)) throw new Error('region health OOB')
  }
  const exD = await getExplorer('district', 1)
  if (exD.nodes.length !== 1 || exD.nodes[0].name !== 'Accra Metro') {
    throw new Error('district drill failed: ' + exD.nodes.map((n) => n.name).join(','))
  }
  if (exD.breadcrumb.length !== 1 || exD.breadcrumb[0].name !== 'Greater Accra') {
    throw new Error('district breadcrumb ' + JSON.stringify(exD.breadcrumb))
  }
  const exS = await getExplorer('site', 1)
  if (exS.nodes.length !== 1 || exS.nodes[0].name !== 'ACC-001') throw new Error('site drill failed')
  if (exS.breadcrumb.length !== 2) throw new Error('site breadcrumb ' + exS.breadcrumb.length)
  const exC = await getExplorer('cell', 1)
  if (exC.nodes.length !== 2) throw new Error('cell drill count ' + exC.nodes.length)
  if (exC.breadcrumb.length !== 3) throw new Error('cell breadcrumb ' + exC.breadcrumb.length)
  for (const n of exC.nodes) {
    if (n.lifecycle !== 'Healthy') throw new Error('ACC cell should be Healthy: ' + n.name + ' ' + n.lifecycle)
    if (n.priorityScore == null) throw new Error('ACC cell missing priority')
  }
  const exKum = await getExplorer('cell', 3)
  if (exKum.nodes.length !== 1 || exKum.nodes[0].name !== 'KUM-002-A') throw new Error('KUM-002-A drill failed')
  if (!exKum.nodes[0].isNc) throw new Error('KUM-002-A should be NC')
  const exQ = await getExplorer('district', 1, { q: 'accra' })
  if (exQ.nodes.length !== 1 || exQ.nodes[0].name !== 'Accra Metro') throw new Error('explorer search failed')
  const exEmpty = await getExplorer('site', 999)
  if (exEmpty.nodes.length !== 0) throw new Error('unknown parent should be empty')

  // 22. investigation workspace: evidence, diagnosis, notes/status, report
  const invSearch = await searchEntities('cell', 'kum')
  if (invSearch.length !== 2) throw new Error('inv search ' + invSearch.length + ' ' + JSON.stringify(invSearch.map((e) => e.name)))
  const inv = await getInvestigation('cell', 1001)
  if (!inv) throw new Error('investigation null for ACC-001-A')
  if (inv.entityName !== 'ACC-001-A' || inv.path.length !== 4) {
    throw new Error('inv path ' + inv.entityName + ' ' + JSON.stringify(inv.path))
  }
  if (inv.current?.lifecycle !== 'Healthy') throw new Error('inv lifecycle ' + inv.current?.lifecycle)
  if (inv.evidence.length !== 6) throw new Error('inv evidence ' + inv.evidence.length)
  const invPrb = inv.evidence.find((e) => e.metric === 'prb')!
  if (invPrb.current !== 89 || Math.abs((invPrb.previous ?? 0) - 84.67) > 0.01) {
    throw new Error('inv prb evidence wrong: ' + JSON.stringify(invPrb))
  }
  if (inv.findings.length < 2) throw new Error('inv findings ' + inv.findings.length)
  if (inv.hypotheses.length !== 5) throw new Error('inv hypotheses ' + inv.hypotheses.length)
  for (const h of inv.hypotheses) {
    if (h.score < 5 || h.score > 95) throw new Error('inv hypo score OOB ' + h.score)
    if (!['consistent', 'suggests', 'not supported'].includes(h.verdict)) throw new Error('inv hypo verdict ' + h.verdict)
  }
  if (inv.weeks.length !== 2) throw new Error('inv weeks ' + inv.weeks.length)
  if (inv.peers.length !== 2) throw new Error('inv peers ' + inv.peers.length)
  if (inv.status.status !== null) throw new Error('inv status should start null')
  const invSite = await getInvestigation('site', 1)
  if (!invSite || invSite.entityName !== 'ACC-001' || invSite.path.length !== 3 || invSite.weeks.length !== 2) {
    throw new Error('inv site failed: ' + JSON.stringify(invSite?.path))
  }
  const invDist = await getInvestigation('district', 1)
  if (!invDist || invDist.entityName !== 'Accra Metro' || invDist.path.length !== 2) {
    throw new Error('inv district failed')
  }
  const invMissing = await getInvestigation('cell', 999999)
  if (invMissing !== null) throw new Error('unknown investigation should be null')
  const invSt = await setInvestigationStatus('cell', 1001, { status: 'Investigating', owner: 'Ops' })
  if (invSt.status !== 'Investigating' || invSt.owner !== 'Ops') throw new Error('inv setStatus failed')
  const inv2 = await getInvestigation('cell', 1001)
  if (inv2?.status.status !== 'Investigating' || inv2.status.owner !== 'Ops') {
    throw new Error('inv status not persisted')
  }
  if (!inv2.events.some((e) => e.kind === 'status_change')) throw new Error('status change not evented')
  const invNote = await addInvestigationNote('cell', 1001, 'smoke note')
  if (invNote.kind !== 'user_note' || invNote.note !== 'smoke note') throw new Error('addNote failed')
  const invRep = await exportInvestigationReport('cell', 1001)
  if (!invRep || !invRep.path.endsWith('.md') || !invRep.markdown.includes('ACC-001-A')) {
    throw new Error('report export failed: ' + JSON.stringify(invRep?.path))
  }
  if (!invRep.markdown.includes('Deterministic conclusion')) throw new Error('report missing diagnosis')

  // 23. priority center: workflow queue across scopes, filters, status rollups
  const pc = await getPriorityCenter({})
  if (pc.total < 3) throw new Error('priority center total ' + pc.total)
  if (pc.rows[0].name !== 'KUM-002-A' || pc.rows[0].priorityScore == null) {
    throw new Error('priority center top should be KUM-002-A: ' + pc.rows[0].name + ' ' + pc.rows[0].priorityScore)
  }
  if (pc.byStatus['Investigating'] !== 1) {
    throw new Error('priority center should roll up 1 Investigating (ACC-001-A status set earlier): ' + JSON.stringify(pc.byStatus))
  }
  const pcSearch = await getPriorityCenter({ search: 'kum' })
  if (pcSearch.total !== 2) throw new Error('priority center search ' + pcSearch.total)
  const pcStatus = await getPriorityCenter({ status: 'Investigating' })
  if (pcStatus.total !== 1 || pcStatus.rows[0].name !== 'ACC-001-A') {
    throw new Error('priority center status filter ' + pcStatus.total + ' ' + pcStatus.rows[0]?.name)
  }
  const topBand = pc.rows[0].priorityBand
  if (!topBand) throw new Error('priority center top row missing band')
  const pcBand = await getPriorityCenter({ band: topBand })
  if (pcBand.total < 1) throw new Error('priority center band filter empty for ' + topBand)
  const pcOverdue = await getPriorityCenter({ overdueOnly: true })
  if (typeof pcOverdue.overdue !== 'number') throw new Error('priority center overdue shape')
  const pcSite = await getPriorityCenter({ scope: 'site' })
  if (pcSite.total < 2) throw new Error('priority center site scope ' + pcSite.total)
  const kumSite = pcSite.rows.find((r) => r.name === 'KUM-002')
  if (!kumSite || kumSite.ncCells !== 1 || kumSite.cells !== 1) {
    throw new Error('priority center KUM-002 site rollup ' + JSON.stringify(kumSite))
  }
  const pcDist = await getPriorityCenter({ scope: 'district' })
  if (pcDist.total < 2) throw new Error('priority center district scope ' + pcDist.total)

  // 24. forecasting & early warning: simple-first methods, risk states
  const fc = await getForecast({})
  if (fc.entity.scope !== 'network' || fc.entity.name !== 'Network') {
    throw new Error('forecast network entity ' + JSON.stringify(fc.entity))
  }
  if (fc.series.length !== 5) throw new Error('forecast series ' + fc.series.length)
  const fcPrb = fc.series.find((s) => s.metric === 'prb')!
  if (fcPrb.threshold !== 90) throw new Error('forecast prb threshold ' + fcPrb.threshold + ' (ruleset v2)')
  const fcActuals = fcPrb.points.filter((p) => p.kind === 'actual')
  const fcFc = fcPrb.points.filter((p) => p.kind === 'forecast')
  if (fcActuals.length !== 2 || fcFc.length !== 4) {
    throw new Error('forecast points actual/forecast ' + fcActuals.length + '/' + fcFc.length)
  }
  if (fcPrb.forecast.next == null || fcPrb.forecast.quality === 'suppressed') {
    throw new Error('network prb forecast should run on 2 weeks: ' + fcPrb.forecast.quality)
  }
  if (fcPrb.forecast.lower == null || fcPrb.forecast.upper == null || fcPrb.forecast.lower >= fcPrb.forecast.upper) {
    throw new Error('forecast band invalid: ' + fcPrb.forecast.lower + '..' + fcPrb.forecast.upper)
  }
  const riskSum = Object.values(fc.riskCounts).reduce((a, b) => a + b, 0)
  if (riskSum !== fc.totalEntities) throw new Error('forecast risk counts sum ' + riskSum + ' != ' + fc.totalEntities)
  if (fc.riskRows.length !== 4) throw new Error('forecast risk rows ' + fc.riskRows.length + ' (4 cells have weekly history)')
  if (!fc.riskRows.every((r) => r.risk && r.explanation.length > 10)) throw new Error('forecast risk row missing fields')
  // suppressed: KUM-002-A has a single week of history
  const fcCell = await getForecast({ scope: 'cell', entityId: 2002 })
  const fcCellPrb = fcCell.series.find((s) => s.metric === 'prb')!
  if (fcCellPrb.forecast.quality !== 'suppressed' || fcCellPrb.forecast.next !== null) {
    throw new Error('KUM-002-A single-week forecast should be suppressed: ' + fcCellPrb.forecast.quality)
  }
  // site scope rolls two cells up; forecast still runs
  const fcSite = await getForecast({ scope: 'site', entityId: 1 })
  if (fcSite.entity.name !== 'ACC-001') throw new Error('forecast site entity ' + fcSite.entity.name)
  if (fcSite.totalEntities !== 2) throw new Error('forecast site cells ' + fcSite.totalEntities)
  const fcThr = await getForecast({ metric: 'throughput' })
  if (fcThr.series.find((s) => s.metric === 'throughput')!.threshold !== 10_000) {
    throw new Error('forecast throughput threshold')
  }

  // 25. reporting center: report packs, snapshot, templates, history
  const rp = await generateReportPack({ name: 'Smoke Executive Pack' })
  if (rp.sections.length < 3) throw new Error('report sections ' + rp.sections.length)
  if (rp.snapshot.rulesetVersion !== 2) throw new Error('report ruleset snapshot ' + rp.snapshot.rulesetVersion)
  if (rp.snapshot.thresholds.prb !== 90) throw new Error('report prb threshold snapshot ' + rp.snapshot.thresholds.prb)
  if (rp.snapshot.ncCount !== 1) throw new Error('report ncCount snapshot ' + rp.snapshot.ncCount)
  const rpMd = rp.files.md?.content ?? ''
  const rpCsv = rp.files.csv?.content ?? ''
  const rpHtml = rp.files.html?.content ?? ''
  if (!rpMd.includes('Executive Summary') || !rpMd.includes('Priority Queue')) {
    throw new Error('report md missing sections')
  }
  if (!rpMd.includes('Snapshot frozen at generation time')) throw new Error('report md missing snapshot note')
  if (!rpCsv.includes('##,Executive Summary') || !rpCsv.includes('KPI,Value')) throw new Error('report csv malformed')
  if (!rpHtml.includes('<table>') || !rpHtml.includes('Reporting Center')) throw new Error('report html malformed')
  if (!rp.files.pdf?.path || !existsSync(rp.files.pdf.path) || readFileSync(rp.files.pdf.path).length < 100) {
    throw new Error('report pdf missing or empty: ' + (rp.files.pdf?.path ?? 'none'))
  }
  const rpDef = await saveReportDefinition('Weekly Mgmt', 'executive', ['executive-summary', 'priority-queue'], 'weekly')
  if (rpDef.name !== 'Weekly Mgmt' || rpDef.type !== 'executive' || rpDef.sections.length !== 2) {
    throw new Error('report definition save failed')
  }
  const rpDefs = await listReportDefinitions()
  if (!rpDefs.some((d) => d.name === 'Weekly Mgmt' && d.schedule === 'weekly')) throw new Error('report definition list missing')
  const rpHist = await listReportHistory()
  if (!rpHist.some((h) => h.id === rp.id && h.rulesetVersion === 2)) throw new Error('report history missing pack')
  const rpCustom = await generateReportPack({ type: 'capacity', sections: ['forecast-risk', 'persistent-nc'], formats: ['md'] })
  if (rpCustom.sections.length !== 2 || !rpCustom.files.md) throw new Error('report custom sections failed')
  if (!(rpCustom.files.md.content.includes('Forecast Risk') && rpCustom.files.md.content.includes('Persistent NC'))) {
    throw new Error('report custom content failed')
  }

  // 25b. due-report check on open (§56): schedules are app-local; a weekly
  // definition never generated is due, and generating it clears the due flag
  const dueDef = await saveReportDefinition('Due Smoke Weekly', 'executive', ['executive-summary'], 'weekly')
  const dueBefore = await checkDueReports()
  const dueSmoke = dueBefore.find((d) => d.definitionId === dueDef.id)
  if (!dueSmoke || dueSmoke.overdueDays !== 0 || dueSmoke.lastGenerated !== null) {
    throw new Error('due report missing for never-generated weekly def: ' + JSON.stringify(dueBefore.map((d) => d.name)))
  }
  await generateReportPack({ definitionId: dueDef.id, formats: ['md'] })
  const dueAfter = await checkDueReports()
  if (dueAfter.some((d) => d.definitionId === dueDef.id)) {
    throw new Error('generated definition still marked due')
  }
  if (!dueAfter.some((d) => d.name === 'Weekly Mgmt')) {
    throw new Error('other due report should remain: ' + JSON.stringify(dueAfter.map((d) => d.name)))
  }

  // 25c. Excel 13-sheet pack + PowerPoint deck (spec §53–54)
  const rpOffice = await generateReportPack({
    name: 'Office Smoke',
    sections: ['executive-summary', 'kpi-trend', 'priority-queue'],
    formats: ['xlsx', 'pptx']
  })
  const xlsxPath = rpOffice.files.xlsx?.path
  const pptxPath = rpOffice.files.pptx?.path
  if (!xlsxPath || !existsSync(xlsxPath)) throw new Error('xlsx missing: ' + rpOffice.files.xlsx?.content)
  const xb = readFileSync(xlsxPath)
  if (xb.length < 1000 || xb[0] !== 0x50 || xb[1] !== 0x4b) throw new Error('xlsx not a valid zip (size ' + xb.length + ')')
  if (!pptxPath || !existsSync(pptxPath)) throw new Error('pptx missing: ' + rpOffice.files.pptx?.content)
  const pb = readFileSync(pptxPath)
  if (pb.length < 1000 || pb[0] !== 0x50 || pb[1] !== 0x4b) throw new Error('pptx not a valid zip (size ' + pb.length + ')')

  // 25d. native Excel charts (§53): the pack must embed PNG chart images
  // (kpi-trend line + executive-summary components bars) under xl/media/
  const JSZip = require('jszip')
  const xzip = await JSZip.loadAsync(xb)
  const media = Object.keys(xzip.files).filter((p) => p.startsWith('xl/media/'))
  const chartPngs = media.filter((p) => p.endsWith('.png'))
  if (chartPngs.length < 2) throw new Error('xlsx should embed >= 2 chart PNGs, found: ' + chartPngs.join(','))
  const pngCheck = await xzip.file(chartPngs[0])?.async('nodebuffer')
  if (!pngCheck || pngCheck.length < 100 || pngCheck[0] !== 0x89 || pngCheck[1] !== 0x50) {
    throw new Error('xlsx chart media is not a PNG')
  }

  // 25e. native editable Excel chart objects: the pack injects real chart XML
  // (xl/charts/*.xml + chart rels) so charts open editable in Excel, with the
  // PNGs as rasterized fallback/decoration
  const chartParts = Object.keys(xzip.files).filter((p) => p.startsWith('xl/charts/') && p.endsWith('.xml'))
  if (chartParts.length < 1) throw new Error('xlsx should contain native chart XML parts, found none')
  const chart1 = (await xzip.file(chartParts[0])?.async('string')) ?? ''
  if (!chart1.includes('<c:chartSpace') || !chart1.includes('c:barChart') && !chart1.includes('c:lineChart')) {
    throw new Error('chart XML malformed: ' + chartParts[0])
  }
  // charts disabled in the builder must produce no native chart parts (config respected)
  const rpNoCharts = await generateReportPack({
    name: 'No Charts Smoke',
    sections: ['executive-summary', 'kpi-trend'],
    formats: ['xlsx'],
    charts: { kpiTrend: { enabled: false, metric: 'nc' }, executive: { enabled: false }, region: { enabled: false }, district: { enabled: false }, site: { enabled: false } }
  })
  const noChartPath = rpNoCharts.files.xlsx?.path
  if (!noChartPath || !existsSync(noChartPath)) throw new Error('no-charts xlsx missing')
  const noChartZip = await JSZip.loadAsync(readFileSync(noChartPath))
  const noChartParts = Object.keys(noChartZip.files).filter((p) => p.startsWith('xl/charts/') && p.endsWith('.xml'))
  if (noChartParts.length !== 0) throw new Error('disabled charts still injected: ' + noChartParts.join(','))
  const noChartMedia = Object.keys(noChartZip.files).filter((p) => p.startsWith('xl/media/') && p.endsWith('.png'))
  if (noChartMedia.length !== 0) throw new Error('disabled charts still rendered PNGs: ' + noChartMedia.join(','))

  // 26. workspace snapshots (spec §7): create / list / compare / restore / remove
  const snap0 = await createSnapshot('Pre-optimization', { reason: 'smoke milestone', notes: 'before threshold change' })
  if (!snap0.snapshotId || !existsSync(snap0.path)) throw new Error('snapshot file missing: ' + snap0.path)
  if (snap0.name !== 'Pre-optimization' || snap0.reason !== 'smoke milestone') {
    throw new Error('snapshot metadata wrong: ' + JSON.stringify(snap0))
  }
  const snaps1 = await listSnapshots()
  if (snaps1.length !== 1 || snaps1[0].snapshotId !== snap0.snapshotId) throw new Error('snapshot list ' + snaps1.length)
  await removeSnapshot(snap0.snapshotId)
  if (existsSync(snap0.path)) throw new Error('removed snapshot file still on disk')
  const snaps2 = await listSnapshots()
  if (snaps2.length !== 0) throw new Error('snapshot list after remove ' + snaps2.length)
  const snap1 = await createSnapshot('Post-campaign', { reason: 'after' })
  // snapshot comparison: bump the ruleset, snapshot again, diff the two milestones
  const rules3 = await updateRulesCurrent({ prbThresholdPct: 95 })
  if (rules3.version !== 3) throw new Error('ruleset v3 missing for snapshot compare')
  const snap2 = await createSnapshot('Post-campaign v3', { reason: 'ruleset v3' })
  const cmp = await compareSnapshots(snap1.snapshotId, snap2.snapshotId)
  if (cmp.a.name !== 'Post-campaign' || cmp.b.name !== 'Post-campaign v3') {
    throw new Error('compare labels ' + cmp.a.name + ' vs ' + cmp.b.name)
  }
  const cmpRules = cmp.kpis.find((k) => k.key === 'ruleset_version')
  if (!cmpRules || cmpRules.a !== 2 || cmpRules.b !== 3 || cmpRules.delta !== 1) {
    throw new Error('compare ruleset delta: ' + JSON.stringify(cmpRules))
  }
  if (cmp.kpis.length < 8) throw new Error('compare kpis ' + cmp.kpis.length)
  const beforeRestore = (await ws.getCurrentInfo())!
  const restored = await restoreSnapshot(snap1.snapshotId)
  if (restored.rowCount !== beforeRestore.rowCount || restored.rowCount !== 12) {
    throw new Error('restore changed row count: ' + restored.rowCount)
  }
  const restoredInfo = (await ws.getCurrentInfo())!
  if (restoredInfo.name !== 'Smoke Test' || restoredInfo.readOnly) throw new Error('restore reopened workspace badly')
  const restAudit = await ws.getCurrent()!.connection.runAndReadAll(
    `SELECT count(*) n FROM notes_events WHERE kind = 'snapshot_restore'`
  )
  if (Number(restAudit.getRowObjects()[0].n) < 1) throw new Error('snapshot restore not audited')

  // 27. workspace maintenance (spec §58): integrity / storage / optimize / rebuild / purge / compact
  const mInteg = await runMaintenance('integrity')
  if (!mInteg.ok) throw new Error('integrity: ' + mInteg.message)
  const mSto = await runMaintenance('storage')
  if (!mSto.ok || !mSto.detail) throw new Error('storage: ' + mSto.message)
  const stoTables = (mSto.detail as { tables: Array<{ table: string; rows: number }> }).tables
  const factRow = stoTables.find((t) => t.table === 'fact_cell_daily')
  if (!factRow || factRow.rows !== 12) throw new Error('storage fact rows ' + JSON.stringify(factRow))
  const mOpt = await runMaintenance('optimize')
  if (!mOpt.ok) throw new Error('optimize: ' + mOpt.message)
  const mReb = await runMaintenance('rebuild')
  if (!mReb.ok) throw new Error('rebuild: ' + mReb.message)
  const sumAfterRebuild = await getSummary()
  if (!sumAfterRebuild || sumAfterRebuild.rowCount !== 12) throw new Error('rebuild lost facts')
  const mPur = await runMaintenance('purge')
  if (!mPur.ok) throw new Error('purge: ' + mPur.message)
  const mCom = await runMaintenance('compact')
  if (!mCom.ok) throw new Error('compact: ' + mCom.message)
  const afterCompact = await ws.getCurrent()!.connection.runAndReadAll(`SELECT count(*) n FROM fact_cell_daily`)
  if (Number(afterCompact.getRowObjects()[0].n) !== 12) throw new Error('compact lost data')

  // 27b. maintenance scheduler (§58): defaults, settings persist, due run audits
  const schedDef = await getSchedule()
  if (schedDef.enabled || schedDef.cadenceHours !== 24) throw new Error('bad default schedule ' + JSON.stringify(schedDef))
  const schedSaved = await setSchedule({ enabled: true, cadenceHours: 6, actions: ['integrity', 'purge'], runOnOpen: true })
  if (!schedSaved.enabled || schedSaved.cadenceHours !== 6 || schedSaved.actions.join(',') !== 'integrity,purge') {
    throw new Error('schedule not persisted ' + JSON.stringify(schedSaved))
  }
  const schedReloaded = await getSchedule()
  if (!schedReloaded.enabled || schedReloaded.actions.join(',') !== 'integrity,purge') {
    throw new Error('schedule did not round-trip')
  }
  // not due yet: lastRunAt was just written by the reload path — force by backdating
  await ws.getCurrent()!.connection.run(
    `UPDATE maintenance_settings SET last_run_at = now() - INTERVAL 1 DAY WHERE id = 1`
  )
  const due = await maybeRunScheduled()
  if (!due.ran || !due.ok) throw new Error('scheduled run did not fire: ' + JSON.stringify(due))
  const schedAfter = await getSchedule()
  if (!schedAfter.lastRunAt || schedAfter.lastOk !== true) throw new Error('schedule last-run not updated')
  const runs = await scheduleHistory(5)
  if (runs.length < 1 || runs[0].actions.join(',') !== 'integrity,purge' || !runs[0].ok) {
    throw new Error('schedule history missing ' + JSON.stringify(runs))
  }
  const schedAudit = await ws.getCurrent()!.connection.runAndReadAll(
    `SELECT count(*) n FROM notes_events WHERE kind = 'maintenance_run'`
  )
  if (Number(schedAudit.getRowObjects()[0].n) < 1) throw new Error('scheduled maintenance not audited')
  // disabled scheduler never runs
  await setSchedule({ enabled: false })
  const skipped = await maybeRunScheduled()
  if (skipped.ran || skipped.skippedReason !== 'disabled') throw new Error('disabled scheduler ran: ' + JSON.stringify(skipped))
  const manual = await runScheduled()
  if (manual.ran || manual.skippedReason !== 'disabled') throw new Error('manual run bypassed disable')

  // 27c. Ghana map: per-region KPIs + district drill-down
  const regionRows = await getRegionMap()
  if (regionRows.length < 1) throw new Error('region map empty')
  if (regionRows.some((r) => !r.name || r.cells == null || r.ncCells == null)) {
    throw new Error('region map row malformed: ' + JSON.stringify(regionRows[0]))
  }
  const dists = await getRegionDistricts(regionRows[0].id)
  if (!Array.isArray(dists) || dists.some((d) => !d.name || d.cells == null)) {
    throw new Error('region districts malformed')
  }

  // 27d. per-technology KPI definitions (spec §54a): seeded sets, CRUD,
  // discovery, extra-column import into Cell Intelligence
  const tech = '2G'
  const seeded = await seedKpiDefs(ws.getCurrent()!.connection, tech)
  if (seeded.length < 3 || seeded.some((k) => !k.label || k.key !== k.key)) {
    throw new Error('kpi seed set malformed: ' + JSON.stringify(seeded.slice(0, 2)))
  }
  const listed = await listKpiDefs(ws.getCurrent()!.connection, tech)
  if (listed.length !== seeded.length) throw new Error('kpi list != seed')
  const discovery = await discoverKpiDefs(
    ws.getCurrent()!.connection,
    ['TCH Congestion (%)', 'GPRS Traffic (MB)', 'Totally Unrelated'],
    tech
  )
  if (discovery.mapping['TCH Congestion (%)'] !== 'tch_congestion' ||
      discovery.mapping['GPRS Traffic (MB)'] !== 'gprs_traffic' ||
      Object.keys(discovery.mapping).length !== 2) {
    throw new Error('kpi discovery wrong: ' + JSON.stringify(discovery))
  }
  const saved = await saveKpiDef(ws.getCurrent()!.connection, {
    technology: tech,
    key: 'custom_trial_kpi',
    label: 'Custom Trial KPI',
    unit: 'x',
    worseIsHigher: true,
    target: 5,
    agg: 'avg',
    sourceHeaders: ['trial header']
  })
  if (saved.key !== 'custom_trial_kpi' || saved.target !== 5 || !saved.isCustom) {
    throw new Error('kpi save failed: ' + JSON.stringify(saved))
  }
  const patched = await saveKpiDef(ws.getCurrent()!.connection, {
    kpiId: saved.kpiId,
    technology: tech,
    target: 9
  })
  if (patched.target !== 9) throw new Error('kpi patch failed')
  // 27d2. switch to 2G so the imported 2G columns (TCH congestion) belong to
  // the active technology — the flow a real 2G user follows
  await ws.setWorkspaceTechnology('2G')
  const extraCsv = join(dir, 'kpi_extra.csv')
  writeFileSync(extraCsv, [
    'Date/Time,Cell,District,Region,Site,PRB Utilization,Connected Users,Data Volume (MB),Availability,DL Throughput (kbps),TCH Congestion (%)',
    '2026-07-28 00:00,EXTRA_001_A,Accra Metro,Greater Accra,EXTRA_001,60.0,300,10000,99.8,20000,3.5',
    '2026-07-28 00:00,EXTRA_002_A,Accra Metro,Greater Accra,EXTRA_002,75.0,350,12000,99.7,18000,1.2'
  ].join('\n'))
  const kpiAnalysis = await analyzeFiles([extraCsv])
  const kpiRec = kpiAnalysis[0]
  if (!kpiRec) throw new Error('kpi extra file not analyzed')
  const kpiMapping = {
    columns: kpiRec.suggestedMapping,
    kpiColumns: { 'TCH Congestion (%)': 'tch_congestion' } as Record<string, string>
  }
  const kpiPrev = await previewImport(kpiRec.id, kpiMapping as never)
  if (kpiPrev.canImport !== true) throw new Error('kpi extra preview rejected: ' + JSON.stringify(kpiPrev.issues))
  await runImport(kpiRec.id, kpiMapping as never)
  const kpiCi = await getCellIntelligence({ limit: 500 })
  const extraRow = kpiCi.rows.find((r) => r.cellName === 'EXTRA_001_A')
  if (!extraRow) throw new Error('kpi-imported cell missing from cell intelligence')
  const tch = extraRow.kpis.find((k) => k.key === 'tch_congestion')
  if (!tch || tch.value == null) throw new Error('tch_congestion value missing: ' + JSON.stringify(extraRow.kpis))
  if (tch.value !== 3.5) throw new Error('tch_congestion value wrong: ' + tch.value)
  if (tch.breached !== true) throw new Error('tch_congestion should breach target 2: ' + JSON.stringify(tch))
  // 27d3. tech-aware NC: under 2G the cell breaching TCH Congestion (3.5 > 2)
  // every day must be classified NC from its imported KPI — not the PRB rule
  const kpiNc = await getCellIntelligence({ limit: 500 })
  const ncRow = kpiNc.rows.find((r) => r.cellName === 'EXTRA_001_A')
  const nonNcRow = kpiNc.rows.find((r) => r.cellName === 'EXTRA_002_A')
  if (!ncRow || !ncRow.isNc) throw new Error('2G cell breaching TCH Congestion should be NC: ' + JSON.stringify(ncRow))
  if (nonNcRow && nonNcRow.isNc) throw new Error('2G cell under the TCH target must not be NC: ' + JSON.stringify(nonNcRow))
  // 27d4. KPI overview: breach summary + worst cells for the active technology
  const kpiOv = await getKpiOverview(10)
  if (kpiOv.technology !== '2G') throw new Error('kpi overview wrong tech: ' + kpiOv.technology)
  const tchKpi = kpiOv.kpis.find((k) => k.key === 'tch_congestion')
  if (!tchKpi || tchKpi.breachedCells < 1) throw new Error('kpi overview missing tch breach: ' + JSON.stringify(kpiOv.kpis))
  if (!kpiOv.worstCells.some((c) => c.cellName === 'EXTRA_001_A')) {
    throw new Error('kpi overview worst cells missing EXTRA_001_A: ' + JSON.stringify(kpiOv.worstCells))
  }
  // 27d5. accepted KPI suggestions persist in the source profile: re-analyzing
  // the same file must restore the TCH assignment from the remembered profile
  const kpiRec2 = (await analyzeFiles([extraCsv]))[0]
  if (!kpiRec2) throw new Error('re-analyze of kpi extra file failed')
  if (!kpiRec2.knownProfile) throw new Error('kpi source profile not remembered on re-analyze')
  if (kpiRec2.suggestedKpiMapping['TCH Congestion (%)'] !== 'tch_congestion') {
    throw new Error('kpi profile lost accepted assignment: ' + JSON.stringify(kpiRec2.suggestedKpiMapping))
  }
  await removeKpiDef(ws.getCurrent()!.connection, saved.kpiId)
  const afterRemove = await listKpiDefs(ws.getCurrent()!.connection, tech)
  if (afterRemove.some((k) => k.key === 'custom_trial_kpi')) throw new Error('kpi remove failed')

  // 27e. technology switching (spec §54a): the workspace is now 2G from 27d2;
  // the imported TCH congestion (3.5 vs target 2) must feed the priority score
  const infoNow = await ws.getCurrentInfo()
  if (infoNow?.technology !== '2G') throw new Error('expected 2G after switch: ' + infoNow?.technology)
  const twoGDefs = await listKpiDefs(ws.getCurrent()!.connection, '2G')
  if (twoGDefs.length < 5) throw new Error('2G KPI set not seeded on switch: ' + twoGDefs.length)
  const kpiPrio = await getPriorityQueue('balanced', 100)
  const prioCell = kpiPrio.find((p) => p.cellName === 'EXTRA_001_A')
  if (prioCell && prioCell.components.kpiBreach < 1) {
    throw new Error('kpiBreach component not populated: ' + JSON.stringify(prioCell.components))
  }
  const ciKpi = await getCellIntelligence({ limit: 500 })
  const extraDetail = ciKpi.rows.find((r) => r.cellName === 'EXTRA_001_A')
  if (extraDetail && extraDetail.kpis.length === 0) throw new Error('cell kpis missing after tech switch')
  // switch back so later smoke steps run under the default 4G
  const backTo4G = await ws.setWorkspaceTechnology('4G')
  if (backTo4G.technology !== '4G') throw new Error('switch back to 4G failed')

  // 27f. Excel (.xlsx) import: real NCA dashboards ship as xlsx (spec §9 keeps
  // the raw source), so the first sheet is converted and staged like a CSV
  await ws.createWorkspace(dir, 'Xlsx Test')
  const xlsxImportPath = join(dir, 'import.xlsx')
  {
    const wb = new ExcelJS.Workbook()
    const sh = wb.addWorksheet('Data')
    sh.addRow(['DATETIME', 'DISTRICT', 'REGION', 'CELL', 'BASESTATION', '4G Peak Hour Traffic Utilization_NCA', 'RRC Connected UEs (Avg)_STD(#)', '4G Data Volume_STD(MB)', '4G Cell Availability_STD(%)', 'E-UTRAN IP Throughput UE DL_STD(kbps)'])
    sh.addRow([new Date(Date.UTC(2026, 6, 5)), 'Accra Metro', 'Greater Accra', 'ACC-001-A', 'ACC-001', 88.0, 52, 1400.0, 99.7, 19500])
    sh.addRow([new Date(Date.UTC(2026, 6, 5)), 'Accra Metro', 'Greater Accra', 'ACC-001-B', 'ACC-001', 76.0, 33, 900.0, 99.6, 16000])
    sh.addRow([new Date(Date.UTC(2026, 6, 5)), 'Kumasi', 'Ashanti', 'KUM-001-A', 'KUM-001', 92.0, 68, 1700.0, 98.8, 24000])
    sh.addRow([new Date(Date.UTC(2026, 6, 6)), 'Accra Metro', 'Greater Accra', 'ACC-001-A', 'ACC-001', 89.0, 55, 1450.0, 99.8, 19800])
    sh.addRow([new Date(Date.UTC(2026, 6, 6)), 'Accra Metro', 'Greater Accra', 'ACC-001-B', 'ACC-001', 74.0, 31, 850.0, 99.5, 15500])
    sh.addRow([new Date(Date.UTC(2026, 6, 6)), 'Kumasi', 'Ashanti', 'KUM-001-A', 'KUM-001', 93.0, 70, 1750.0, 98.9, 24500])
    await wb.xlsx.writeFile(xlsxImportPath)
  }
  const analyzePhases: string[] = []
  const [xa] = await analyzeFiles([xlsxImportPath], (p) => analyzePhases.push(p.phase))
  if (!analyzePhases.includes('Reading workbook (fast scan)')) {
    throw new Error('xlsx analyze did not report the fast-scan phase: ' + JSON.stringify(analyzePhases))
  }
  if (!xa || xa.errors.length > 0) throw new Error('xlsx analyze failed: ' + JSON.stringify(xa?.errors))
  if (xa.suggestedMapping['DATETIME'] !== 'date' || xa.suggestedMapping['CELL'] !== 'cell') {
    throw new Error('xlsx mapping missing date/cell: ' + JSON.stringify(xa.suggestedMapping))
  }
  const xaPrev = await previewImport(xa.id, { columns: xa.suggestedMapping })
  if (!xaPrev.canImport) throw new Error('xlsx preview blocked: ' + JSON.stringify(xaPrev.issues))
  const xaRes = await runImport(xa.id, { columns: xa.suggestedMapping }, { backupDir: join(dir, 'backups') })
  if (xaRes.insertedRows !== 6) throw new Error('xlsx import inserted ' + xaRes.insertedRows)
  if (xaRes.rejectedRows !== 0) throw new Error('xlsx import rejected ' + xaRes.rejectedRows)
  if (!xaRes.archivePath || !xaRes.archivePath.endsWith('.xlsx.gz')) {
    throw new Error('xlsx archive must keep the original workbook: ' + xaRes.archivePath)
  }
  if (!existsSync(xaRes.archivePath)) throw new Error('xlsx archived workbook missing: ' + xaRes.archivePath)
  // the source profile is remembered for Excel sources too
  const [xa2] = await analyzeFiles([xlsxImportPath])
  if (!xa2 || !xa2.knownProfile) throw new Error('xlsx source profile not remembered')
  // 2-digit-year CSV (NCA CSV exports write DD/MM/YY)
  const dmyCsv = join(dir, 'dmy.csv')
  writeFileSync(dmyCsv, [
    'DATETIME,DISTRICT,REGION,CELL,BASESTATION,PRB Utilization,Connected Users,Data Volume (MB),Availability,DL Throughput (kbps)',
    '05/07/26,Accra Metro,Greater Accra,ACC-003-A,ACC-003,88.0,52,1400.0,99.7,19500',
    '05/07/26,Accra Metro,Greater Accra,ACC-003-B,ACC-003,76.0,33,900.0,99.6,16000',
    '05/07/26,Kumasi,Ashanti,KUM-003-A,KUM-003,92.0,68,1700.0,98.8,24000',
    '06/07/26,Accra Metro,Greater Accra,ACC-003-A,ACC-003,89.0,55,1450.0,99.8,19800',
    '06/07/26,Accra Metro,Greater Accra,ACC-003-B,ACC-003,74.0,31,850.0,99.5,15500',
    '06/07/26,Kumasi,Ashanti,KUM-003-A,KUM-003,93.0,70,1750.0,98.9,24500'
  ].join('\n'))
  const [da] = await analyzeFiles([dmyCsv])
  if (!da || da.errors.length > 0) throw new Error('dmy analyze failed: ' + JSON.stringify(da?.errors))
  const daRes = await runImport(da.id, { columns: da.suggestedMapping }, { backupDir: join(dir, 'backups') })
  if (daRes.insertedRows !== 6) throw new Error('dmy import inserted ' + daRes.insertedRows)

  // legacy .xls (BIFF) import via SheetJS — same first-sheet conversion path
  const xlsImportPath = join(dir, 'import.xls')
  {
    const wb = XLSX.utils.book_new()
    const rows = [
      ['DATETIME', 'DISTRICT', 'REGION', 'CELL', 'BASESTATION', 'PRB Utilization', 'Connected Users', 'Data Volume (MB)', 'Availability', 'DL Throughput (kbps)'],
      ['2026-07-05', 'Accra Metro', 'Greater Accra', 'ACC-004-A', 'ACC-004', 87.0, 51, 1390.0, 99.7, 19400],
      ['2026-07-05', 'Accra Metro', 'Greater Accra', 'ACC-004-B', 'ACC-004', 75.0, 32, 890.0, 99.6, 15900],
      ['2026-07-06', 'Kumasi', 'Ashanti', 'KUM-004-A', 'KUM-004', 91.0, 67, 1690.0, 98.8, 23900]
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Data')
    XLSX.writeFile(wb, xlsImportPath, { bookType: 'biff8' })
  }
  const [xla] = await analyzeFiles([xlsImportPath])
  if (!xla || xla.errors.length > 0) throw new Error('xls analyze failed: ' + JSON.stringify(xla?.errors))
  if (xla.suggestedMapping['DATETIME'] !== 'date' || xla.suggestedMapping['CELL'] !== 'cell') {
    throw new Error('xls mapping missing date/cell: ' + JSON.stringify(xla.suggestedMapping))
  }
  const xlaPrev = await previewImport(xla.id, { columns: xla.suggestedMapping })
  if (!xlaPrev.canImport) throw new Error('xls preview blocked: ' + JSON.stringify(xlaPrev.issues))
  const xlaRes = await runImport(xla.id, { columns: xla.suggestedMapping }, { backupDir: join(dir, 'backups') })
  if (xlaRes.insertedRows !== 3) throw new Error('xls import inserted ' + xlaRes.insertedRows)
  if (!xlaRes.archivePath || !xlaRes.archivePath.endsWith('.xls.gz')) {
    throw new Error('xls archive must keep the original workbook: ' + xlaRes.archivePath)
  }

  // duplicate dimension names within one file: the same SITE under two
  // DISTRICTS and the same DISTRICT under two REGIONS used to crash the import
  // ("More than one row returned by a subquery") because the NOT EXISTS guard
  // cannot see same-statement inserts — the upserts must dedupe by name
  // (majority parent wins) instead of failing.
  const dupCsv = join(dir, 'dup-dims.csv')
  writeFileSync(dupCsv, [
    'DATETIME,DISTRICT,REGION,CELL,BASESTATION,PRB Utilization,Connected Users,Data Volume (MB),Availability,DL Throughput (kbps)',
    '2026-07-05,Accra Metro,Greater Accra,ACC-006-A,SITE-X,88.0,52,1400.0,99.7,19500',
    '2026-07-05,Tema,Greater Accra,ACC-006-B,SITE-X,76.0,33,900.0,99.6,16000',
    '2026-07-05,Accra Metro,GA,ACC-006-C,SITE-Y,92.0,68,1700.0,98.8,24000'
  ].join('\n'))
  const [dua] = await analyzeFiles([dupCsv])
  if (!dua || dua.errors.length > 0) throw new Error('dup-dims analyze failed: ' + JSON.stringify(dua?.errors))
  const duaRes = await runImport(dua.id, { columns: dua.suggestedMapping }, { backupDir: join(dir, 'backups') })
  if (duaRes.insertedRows !== 3) throw new Error('dup-dims import inserted ' + duaRes.insertedRows)
  const dupSites = await ws.getCurrent()!.connection.runAndReadAll(
    "SELECT count(*) n FROM dim_site WHERE name = 'SITE-X'"
  )
  if (Number(dupSites.getRowObjects()[0].n) !== 1) {
    throw new Error('dup-dims SITE-X must be a single dim_site row, got ' + dupSites.getRowObjects()[0].n)
  }
  const dupDistricts = await ws.getCurrent()!.connection.runAndReadAll(
    "SELECT count(*) n FROM dim_district WHERE name = 'Accra Metro'"
  )
  if (Number(dupDistricts.getRowObjects()[0].n) !== 1) {
    throw new Error(
      'dup-dims Accra Metro must be a single dim_district row, got ' + dupDistricts.getRowObjects()[0].n
    )
  }
  const dupCells = await ws.getCurrent()!.connection.runAndReadAll("SELECT count(*) n FROM dim_cell WHERE name = 'ACC-006-A'")
  if (Number(dupCells.getRowObjects()[0].n) !== 1) {
    throw new Error('dup-dims ACC-006-A must be a single dim_cell row, got ' + dupCells.getRowObjects()[0].n)
  }

  // startup repair: a legacy workspace holding duplicate dimension rows (from
  // pre-fix imports) is merged automatically on open — double-counted facts,
  // extra metrics and derived rows are re-pointed, aggregates regenerated
  const repairWsPath = join(dir, 'repair-ws')
  mkdirSync(repairWsPath, { recursive: true })
  await ws.createWorkspace(repairWsPath, 'Repair Test')
  {
    const conn = ws.getCurrent()!.connection
    await conn.run(`INSERT INTO dim_region (region_id, name) VALUES (1, 'GR')`)
    await conn.run(`INSERT INTO dim_district (district_id, name, region_id) VALUES (10, 'Accra Metro', 1), (11, 'Accra Metro', 1)`)
    await conn.run(`INSERT INTO dim_site (site_id, name, district_id) VALUES (20, 'SITE-A', 10), (21, 'SITE-A', 11)`)
    await conn.run(`INSERT INTO dim_cell (cell_id, name, site_id, district_id, region_id) VALUES (30, 'CELL-A', 20, 10, 1), (31, 'CELL-A', 21, 11, 1)`)
    await conn.run(`INSERT INTO fact_cell_daily (date_id, cell_id, prb_utilization, data_volume_mb, connected_users, dl_throughput_kbps, availability_pct, source_import_id)
       VALUES (20260705, 30, 50.0, 100.0, 10, 1000.0, 99.0, 999001), (20260705, 31, 60.0, 200.0, 20, 2000.0, 98.0, 999001)`)
    const kpiRow = await conn.runAndReadAll(`SELECT kpi_id FROM kpi_defs ORDER BY kpi_id LIMIT 1`)
    const kpiId = Number(kpiRow.getRowObjects()[0].kpi_id)
    await conn.run(`INSERT INTO fact_extra_metrics (date_id, cell_id, kpi_id, value) VALUES (20260705, 30, ${kpiId}, 5.0), (20260705, 31, ${kpiId}, 6.0)`)
    await conn.run(`INSERT INTO cell_anomalies (cell_id, date_id, metric, score, detail) VALUES (30, 20260705, 'prb', 0.5, '{}'), (31, 20260705, 'prb', 0.9, '{}')`)
    await conn.run(`INSERT INTO entity_action_status (entity_type, entity_id, status, owner) VALUES ('cell', 30, 'watch', 'x'), ('cell', 31, 'watch', 'y'), ('site', 21, 'watch', 'z')`)
  }
  await ws.closeWorkspace()
  await ws.openWorkspace(join(repairWsPath, 'Repair Test.qosdb')) // the repair hook runs on open
  {
    const c = ws.getCurrent()!.connection
    const one = async (sql: string): Promise<number> =>
      Number((await c.runAndReadAll(sql)).getRowObjects()[0].n)
    if ((await one(`SELECT count(*) n FROM dim_cell WHERE name = 'CELL-A'`)) !== 1) throw new Error('repair: cells not merged')
    if ((await one(`SELECT count(*) n FROM dim_site WHERE name = 'SITE-A'`)) !== 1) throw new Error('repair: sites not merged')
    if ((await one(`SELECT count(*) n FROM dim_district WHERE name = 'Accra Metro'`)) !== 1) throw new Error('repair: districts not merged')
    if ((await one(`SELECT count(*) n FROM fact_cell_daily WHERE date_id = 20260705 AND cell_id IN (30, 31)`)) !== 1) {
      throw new Error('repair: double-counted facts not merged')
    }
    if ((await one(`SELECT count(*) n FROM fact_cell_daily WHERE cell_id = 31`)) !== 0) throw new Error('repair: dup cell facts remain')
    if ((await one(`SELECT count(*) n FROM fact_extra_metrics WHERE date_id = 20260705 AND cell_id IN (30, 31)`)) !== 1) {
      throw new Error('repair: extra metrics not merged')
    }
    if ((await one(`SELECT count(*) n FROM cell_anomalies WHERE cell_id IN (30, 31)`)) !== 1) throw new Error('repair: anomalies not merged')
    if ((await one(`SELECT count(*) n FROM entity_action_status WHERE entity_type = 'cell'`)) !== 1) throw new Error('repair: action status not deduped')
    if ((await one(`SELECT count(*) n FROM entity_action_status WHERE entity_type = 'site' AND entity_id = 20`)) !== 1) {
      throw new Error('repair: site action status not re-pointed')
    }
    if ((await one(`SELECT count(*) n FROM agg_cell_weekly WHERE cell_id = 31`)) !== 0) throw new Error('repair: stale aggregate remains')
    if ((await one(`SELECT count(*) n FROM agg_cell_weekly WHERE cell_id = 30`)) < 1) throw new Error('repair: canonical aggregate missing')
    // second open must be a clean no-op (idempotent)
    await ws.closeWorkspace()
    await ws.openWorkspace(join(repairWsPath, 'Repair Test.qosdb'))
    const c2 = ws.getCurrent()!.connection
    if (
      Number((await c2.runAndReadAll(`SELECT count(*) n FROM dim_cell WHERE name = 'CELL-A'`)).getRowObjects()[0].n) !== 1
    ) {
      throw new Error('repair: not idempotent')
    }
  }

  // expanded date formats: ISO with timezone, MM/DD/YYYY, dot-separated
  const fmtCsv = join(dir, 'formats.csv')
  writeFileSync(fmtCsv, [
    'DATETIME,DISTRICT,REGION,CELL,BASESTATION,PRB Utilization,Connected Users,Data Volume (MB),Availability,DL Throughput (kbps)',
    '2026-07-05T06:00:00+00:00,Accra Metro,Greater Accra,ACC-005-A,ACC-005,86.0,50,1380.0,99.7,19300',
    '07/05/2026,Accra Metro,Greater Accra,ACC-005-B,ACC-005,74.0,31,880.0,99.6,15800',
    '06.07.2026,Kumasi,Ashanti,KUM-005-A,KUM-005,90.0,66,1680.0,98.8,23800',
    '05/07/26 06:30:00,Accra Metro,Greater Accra,ACC-005-C,ACC-005,73.0,30,870.0,99.5,15700',
    '05-07-26,Accra Metro,Greater Accra,ACC-005-D,ACC-005,72.0,29,860.0,99.4,15600'
  ].join('\n'))
  const [fa] = await analyzeFiles([fmtCsv])
  if (!fa || fa.errors.length > 0) throw new Error('formats analyze failed: ' + JSON.stringify(fa?.errors))
  const fmtRes = await runImport(fa.id, { columns: fa.suggestedMapping }, { backupDir: join(dir, 'backups') })
  if (fmtRes.insertedRows !== 5) throw new Error('formats import inserted ' + fmtRes.insertedRows)

  // xlsx -> CSV export (user-facing "Export as CSV" writes the first sheet)
  const exportDest = join(dir, 'exported.csv')
  await excelToCsvFile(xlsxImportPath, exportDest)
  const exportedCsv = readFileSync(exportDest, 'utf8')
  if (!exportedCsv.includes('DATETIME') || !exportedCsv.includes('ACC-001-A')) {
    throw new Error('exported CSV missing header/data: ' + exportedCsv.slice(0, 200))
  }
  if (!exportedCsv.includes('2026-07-05')) throw new Error('exported CSV date not ISO: ' + exportedCsv.slice(0, 200))

  await ws.closeWorkspace()

  // file-based success marker for packaged runs: the portable 7z SFX wrapper
  // swallows the child's stdout, so verify-portable checks for this file.
  if (app.isPackaged) {
    const targets = new Set<string>()
    try { targets.add(join(process.cwd(), 'smoke_ok.marker')) } catch {}
    try { targets.add(join(dirs.root, 'smoke_ok.marker')) } catch {}
    try { if (process.env.PORTABLE_EXECUTABLE_DIR) targets.add(join(process.env.PORTABLE_EXECUTABLE_DIR, 'smoke_ok.marker')) } catch {}
    try { targets.add(join(dirname(process.execPath), 'smoke_ok.marker')) } catch {}
    for (const markerPath of targets) {
      try { writeFileSync(markerPath, 'SMOKE_OK') } catch {}
    }
  }

  await ws.closeWorkspace()
  console.log(
    'SMOKE_OK ' +
      JSON.stringify({
        createdEmpty: true,
        lockFile: true,
        rowCount: 6,
        dims: { regions: 2, districts: 2, sites: 2, cells: 3 },
        readOnlyWritesBlocked: true,
        reopenOk: true,
        invalidRejected: true,
        importOk: true,
        xlsxImport: true,
        dmyDates: true,
        xlsImport: true,
        dateFormats: true,
        exportCsv: true,
        importInserted: 6,
        importDedupe: true,
        profileRemembered: true,
        ncLifecycle: true,
        ncRecurring: byName['ACC-001-A'],
        priorityQueue: queue[0].cellName,
        healthScore: latest.score,
        rulesetVersioned: true,
        rulesRecompute: true,
        ncMovement: true,
        healthMatrix: true,
        cellIntelligence: true,
        cellDetail: true,
        performance: true,
        comparison: true,
        explorer: true,
        investigation: true,
        priorityCenter: true,
        forecast: true,
        reports: true,
        dueReports: true,
        rawArchive: true,
        retentionPurge: true,
        snapshots: true,
        snapshotRestore: true,
        snapshotCompare: true,
        maintenance: true,
        maintenanceScheduler: true,
        xlsxPptx: true,
        xlsxCharts: true,
        xlsxNativeCharts: true,
        xlsxChartConfig: true,
        regionMap: true,
        kpiDefs: true,
        kpiDiscovery: true,
        kpiSaveRemove: true,
        kpiExtraImport: true,
        kpiTechSwitch: true,
        kpiScoring: true
      })
  )
}
