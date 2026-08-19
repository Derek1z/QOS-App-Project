import type { DiagnosticHypothesis, EvidenceKpi, InvestigationWeek, Technology } from '../../../../shared/api'

export interface DiagnosticContext {
  technology: Technology
  entityName: string
  isNc: boolean
  ncStreak: number
  weeks: InvestigationWeek[]
  latestWeek: InvestigationWeek | null
  previousWeek: InvestigationWeek | null
  evidence: EvidenceKpi[]
  kpiMap: Map<string, number | null>
  thresholds: {
    prb: number
    tchCongestion: number
    sdcchCongestion: number
    cssr: number
    callDrop: number
    dataAccess: number
    dataFailure: number
    persistentWeeks: number
    chronicWeeks: number
  }
}

export interface DiagnosticRule {
  id: string
  name: string
  evaluate(ctx: DiagnosticContext): DiagnosticHypothesis
}
