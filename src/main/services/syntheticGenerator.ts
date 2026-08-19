import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { SyntheticDataConfig, SyntheticGenerateResult, Technology } from '../../../shared/api'
import { getCurrent } from '../workspace/manager'
import { runImport } from '../import/importer'
import { autoMap } from '../import/mapping'

const REGIONS = ['Greater Accra', 'Ashanti', 'Western', 'Eastern', 'Central']
const DISTRICTS = [
  'Accra Metro', 'Tema Municipal', 'Ga East', 'Ga West',
  'Kumasi Metro', 'Obuasi Municipal', 'Asokore Mampong',
  'Sekondi-Takoradi', 'Tarkwa-Nsuaem',
  'New Juaben', 'Akuapem South', 'Cape Coast Metro'
]

export async function generateSyntheticMultiTechData(
  config: SyntheticDataConfig = {}
): Promise<SyntheticGenerateResult> {
  const t0 = Date.now()
  let technologies: Technology[] = ['2G', '3G', '4G']
  if (config.technology && config.technology !== 'All') {
    technologies = [config.technology]
  } else if (config.technologies?.length) {
    technologies = config.technologies
  }
  const weeksCount = config.weeks ?? 12
  const cellsPerTech = config.cellsPerTech ?? (config.cellsPerSite ? config.cellsPerSite * (config.siteCount ?? 5) : 40)
  const scenarios = new Set(config.faultScenarios ?? ['congestion', 'chronic_nc', 'sleeping_cell', 'high_drops', 'backhaul_bottleneck', 'recovering'])

  const daysCount = weeksCount * 7
  const baseDate = new Date(Date.now() - daysCount * 24 * 3600 * 1000)

  // Common Header
  const header = [
    'Date', 'Cell Name', 'Site Name', 'District', 'Region', 'Technology',
    // 2G Core KPIs
    'TCH Congestion (%)', 'SDCCH Congestion (%)', '2G CSSR (%)', '2G Call Drop Rate (%)',
    // 3G Core KPIs
    '3G CSSR (%)', '3G Call Drop Rate (%)', '3G DASR (%)',
    // 4G Core KPIs
    '4G Peak Hour PRB Utilization (%)', '4G CSSR (%)', '4G Call Drop Rate (%)', '4G DSAF (%)',
    // General Metrics
    'Connected Users', 'Data Volume (MB)', 'DL Throughput (kbps)', 'Cell Availability (%)'
  ]

  const rows: string[][] = []
  let cellIndex = 1

  for (const tech of technologies) {
    for (let c = 1; c <= cellsPerTech; c++) {
      const cellId = `C_${tech}_${String(cellIndex).padStart(4, '0')}`
      const siteId = `S_${String(Math.ceil(cellIndex / 3)).padStart(3, '0')}`
      const district = DISTRICTS[(cellIndex - 1) % DISTRICTS.length]
      const region = REGIONS[(cellIndex - 1) % REGIONS.length]
      cellIndex++

      // Assign Fault Scenarios to specific cells
      const isChronic = scenarios.has('chronic_nc') && c <= 3
      const isCongestion = scenarios.has('congestion') && c >= 4 && c <= 7
      const isSleepingCell = scenarios.has('sleeping_cell') && c === 8
      const isHighDrops = scenarios.has('high_drops') && c === 9
      const isBackhaul = scenarios.has('backhaul_bottleneck') && c === 10
      const isRecovering = scenarios.has('recovering') && c === 11

      for (let day = 0; day < daysCount; day++) {
        const curDate = new Date(baseDate.getTime() + day * 24 * 3600 * 1000)
        const dateStr = curDate.toISOString().slice(0, 10)
        const weekNum = Math.floor(day / 7)

        // Baseline Metrics with realistic noise
        let prb = 45 + Math.random() * 25
        let tchCong = 0.5 + Math.random() * 1.0
        let sdcchCong = 0.4 + Math.random() * 0.8
        let cssr2g = 99.0 - Math.random() * 0.4
        let cdr2g = 0.8 + Math.random() * 0.4

        let cssr3g = 99.1 - Math.random() * 0.4
        let cdr3g = 0.7 + Math.random() * 0.4
        let dasr3g = 98.8 - Math.random() * 0.5

        let cssr4g = 99.2 - Math.random() * 0.3
        let cdr4g = 0.6 + Math.random() * 0.4
        let dsaf4g = 0.4 + Math.random() * 0.3

        let users = Math.round(50 + Math.random() * 80)
        let volume = Math.round(800 + Math.random() * 1500)
        let thrpt = Math.round(15000 + Math.random() * 10000)
        let avail = 99.8 - Math.random() * 0.2

        // Apply Injected Scenarios
        if (isChronic) {
          prb = 85 + Math.random() * 12
          tchCong = 3.5 + Math.random() * 2.5
          sdcchCong = 3.0 + Math.random() * 2.0
          cdr4g = 2.8 + Math.random() * 1.5
          users += 100
        } else if (isCongestion) {
          if (weekNum >= 6) {
            prb = 88 + Math.random() * 10
            tchCong = 4.0 + Math.random() * 2.0
            users += 80
            volume += 1200
          }
        } else if (isSleepingCell) {
          if (weekNum >= 8) {
            avail = 100.0 // Appears up
            volume = Math.round(Math.random() * 2) // No traffic
            users = Math.round(Math.random() * 1)
            thrpt = 0
          }
        } else if (isHighDrops) {
          cdr2g = 4.5 + Math.random() * 2.0
          cdr3g = 4.2 + Math.random() * 2.0
          cdr4g = 3.8 + Math.random() * 1.8
          cssr4g = 94.0 - Math.random() * 3.0
        } else if (isBackhaul) {
          prb = 75 + Math.random() * 15
          thrpt = 450 + Math.random() * 300 // Severely choked throughput
        } else if (isRecovering) {
          if (weekNum < 8) {
            prb = 88 + Math.random() * 8
          } else {
            prb = 55 + Math.random() * 10 // Normalizes
          }
        }

        const row = [
          dateStr, cellId, siteId, district, region, tech,
          tchCong.toFixed(2), sdcchCong.toFixed(2), cssr2g.toFixed(2), cdr2g.toFixed(2),
          cssr3g.toFixed(2), cdr3g.toFixed(2), dasr3g.toFixed(2),
          prb.toFixed(1), cssr4g.toFixed(2), cdr4g.toFixed(2), dsaf4g.toFixed(2),
          String(users), String(volume), String(thrpt), avail.toFixed(2)
        ]
        rows.push(row)
      }
    }
  }

  // Write CSV
  const csvContent = [
    header.join(','),
    ...rows.map((r) => r.join(','))
  ].join('\n')

  const outPath = config.outputPath ?? join(tmpdir(), `synthetic-qos-dataset-${randomUUID().slice(0, 8)}.csv`)
  writeFileSync(outPath, csvContent, 'utf8')

  // Auto-import if workspace is open
  const ws = getCurrent()
  let importedRows = 0
  if (ws) {
    try {
      const mapping = autoMap(header)
      const kpiCols: Record<string, string> = {
        'TCH Congestion (%)': 'tch_congestion',
        'SDCCH Congestion (%)': 'sdcch_congestion',
        '2G CSSR (%)': 'call_setup_success_2g',
        '2G Call Drop Rate (%)': 'call_drop_rate_2g',
        '3G CSSR (%)': 'call_setup_success_3g',
        '3G Call Drop Rate (%)': 'call_drop_rate_3g',
        '3G DASR (%)': 'data_access_success_3g',
        '4G Peak Hour PRB Utilization (%)': 'prb_utilization',
        '4G CSSR (%)': 'call_setup_success_4g',
        '4G Call Drop Rate (%)': 'call_drop_rate_4g',
        '4G DSAF (%)': 'data_service_failure_4g'
      }
      const importRes = await runImport(outPath, { columns: mapping, kpiColumns: kpiCols })
      importedRows = importRes.insertedRows
    } catch {
      /* ignore import error if workspace busy */
    }
  }

  return {
    path: outPath,
    outputPath: outPath,
    filename: `synthetic-qos-dataset.csv`,
    rowCount: rows.length,
    rowsCount: rows.length,
    technology: config.technology ?? 'All',
    technologies,
    weeksCount,
    cellsCount: cellIndex - 1,
    injectedFaultsCount: 6
  }
}
