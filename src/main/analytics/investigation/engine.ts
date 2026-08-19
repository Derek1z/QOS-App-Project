import type { DiagnosticRule, DiagnosticContext } from './types'
import type { DiagnosticHypothesis } from '../../../../shared/api'
import { congestionRule } from './rules/congestionRules'
import { accessibilityRule } from './rules/accessibilityRules'
import { retainabilityRule } from './rules/retainabilityRules'
import { sleepingCellRule } from './rules/sleepingCellRules'
import { transportRule } from './rules/transportRules'
import { interferenceRule } from './rules/interferenceRules'

export const DIAGNOSTIC_RULES: DiagnosticRule[] = [
  congestionRule,
  accessibilityRule,
  retainabilityRule,
  sleepingCellRule,
  transportRule,
  interferenceRule
]

export function runDiagnosticEngine(ctx: DiagnosticContext): DiagnosticHypothesis[] {
  return DIAGNOSTIC_RULES.map((rule) => rule.evaluate(ctx)).sort((a, b) => b.score - a.score)
}
