export interface DerivedKPIConfig {
  id: string
  name: string
  technologyId: number
  operation: 'SUM' | 'AVERAGE' | 'RATIO' | 'CUSTOM'
  sourceKPIKeys: string[]
  displayUnit?: string
  target?: number
  warningThreshold?: number
  criticalThreshold?: number
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER'
  treatMissingAsZero?: boolean
}

export interface CandidateDerivedKPI {
  id: string
  name: string
  sourceKPIKeys: string[]
  operation: 'SUM' | 'AVERAGE' | 'RATIO'
}

export const DL_POWER_CONGESTION_CONFIG: DerivedKPIConfig = {
  id: '3g_dl_power_congestion',
  name: 'DL Power Congestion',
  technologyId: 3,
  operation: 'SUM',
  sourceKPIKeys: [
    'VS.RRC.Rej.DLPower.Cong',
    'VS.RAB.FailEstabPS.DLPower.Cong',
    'VS.RAB.FailEstabCS.DLPower.Cong'
  ],
  direction: 'LOWER_IS_BETTER',
  treatMissingAsZero: false
}

export const UL_CE_CONGESTION_CONFIG: DerivedKPIConfig = {
  id: '3g_ul_ce_congestion',
  name: 'UL CE Congestion',
  technologyId: 3,
  operation: 'SUM',
  sourceKPIKeys: [
    'VS.RRC.Rej.ULCE.Cong',
    'VS.RAB.FailEstabPS.ULCE.Cong',
    'VS.RAB.FailEstabCS.ULCE.Cong'
  ],
  direction: 'LOWER_IS_BETTER',
  treatMissingAsZero: false
}

export const PHYCH_FAILURES_CONFIG: DerivedKPIConfig = {
  id: '3g_phych_failures',
  name: 'PhyCh Failures',
  technologyId: 3,
  operation: 'SUM',
  sourceKPIKeys: [
    'VS.RAB.FailEstabPS.PhyChFail',
    'VS.FailRBRecfg.PhyChFail',
    'VS.FailRBSetup.PhyChFail'
  ],
  direction: 'LOWER_IS_BETTER',
  treatMissingAsZero: false
}

const PREDEFINED_CONFIGS: DerivedKPIConfig[] = [
  DL_POWER_CONGESTION_CONFIG,
  UL_CE_CONGESTION_CONFIG,
  PHYCH_FAILURES_CONFIG
]

export function evaluateDerivedKpi(
  row: Record<string, number | null>,
  config: DerivedKPIConfig
): number | null {
  const values: number[] = []

  for (const key of config.sourceKPIKeys) {
    const val = row[key]
    if (val === undefined || val === null) {
      if (config.treatMissingAsZero) {
        values.push(0)
      } else {
        return null // Strict null protection
      }
    } else {
      values.push(val)
    }
  }

  if (values.length === 0) return null

  switch (config.operation) {
    case 'SUM':
      return values.reduce((a, b) => a + b, 0)
    case 'AVERAGE':
      return values.reduce((a, b) => a + b, 0) / values.length
    default:
      return values.reduce((a, b) => a + b, 0)
  }
}

export function detectCandidateDerivedKpis(headers: string[]): CandidateDerivedKPI[] {
  const candidates: CandidateDerivedKPI[] = []
  const headerSet = new Set(headers.map(h => h.trim()))

  // Check predefined formulas
  for (const conf of PREDEFINED_CONFIGS) {
    const hasAll = conf.sourceKPIKeys.every(k => headerSet.has(k))
    if (hasAll) {
      candidates.push({
        id: conf.id,
        name: conf.name,
        sourceKPIKeys: [...conf.sourceKPIKeys],
        operation: 'SUM'
      })
    }
  }

  // Dynamic Pattern Grouping: Find unlinked counter groups sharing domain keywords like Failure / Fail
  const failHeaders = headers.filter(h => /fail|rej|cong|drop|block/i.test(h) && !PREDEFINED_CONFIGS.some(p => p.sourceKPIKeys.includes(h)))
  if (failHeaders.length >= 2) {
    candidates.push({
      id: `discovered_custom_${Date.now()}`,
      name: 'Discovered Composite Failures',
      sourceKPIKeys: failHeaders,
      operation: 'SUM'
    })
  }

  return candidates
}
