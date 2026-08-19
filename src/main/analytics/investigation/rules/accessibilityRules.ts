import type { DiagnosticRule, DiagnosticContext } from '../types'
import type { DiagnosticHypothesis } from '../../../../../shared/api'

export const accessibilityRule: DiagnosticRule = {
  id: 'accessibility_failures',
  name: 'Accessibility & Call Setup Failures',
  evaluate(ctx: DiagnosticContext): DiagnosticHypothesis {
    let support = 0
    let contra = 0
    const sup: string[] = []
    const con: string[] = []
    const recs: string[] = []

    const cssr2g = ctx.kpiMap.get('call_setup_success_2g')
    const cssr3g = ctx.kpiMap.get('call_setup_success_3g')
    const cssr4g = ctx.kpiMap.get('call_setup_success_4g')
    const dasr3g = ctx.kpiMap.get('data_access_success_3g')
    const dsaf4g = ctx.kpiMap.get('data_service_failure_4g')
    const sdcchCong = ctx.kpiMap.get('sdcch_congestion')

    const cssr = cssr4g ?? cssr3g ?? cssr2g ?? null
    if (cssr != null) {
      if (cssr < ctx.thresholds.cssr) {
        support += 30
        sup.push(`Call Connection Success Rate (CSSR) is ${cssr.toFixed(2)}% (below ${ctx.thresholds.cssr}% target).`)
      } else {
        contra += 20
        con.push(`CSSR is healthy at ${cssr.toFixed(2)}% (meeting ${ctx.thresholds.cssr}% target).`)
      }
    }

    if (dasr3g != null && dasr3g < ctx.thresholds.dataAccess) {
      support += 25
      sup.push(`3G Data Access Success Rate is ${dasr3g.toFixed(2)}% (below ${ctx.thresholds.dataAccess}% target).`)
    }

    if (dsaf4g != null && dsaf4g > ctx.thresholds.dataFailure) {
      support += 30
      sup.push(`4G Data Service Access Failure Rate is ${dsaf4g.toFixed(2)}% (exceeds ${ctx.thresholds.dataFailure}% threshold).`)
    }

    if (sdcchCong != null && sdcchCong > ctx.thresholds.sdcchCongestion) {
      support += 20
      sup.push(`2G SDCCH Congestion is elevated at ${sdcchCong.toFixed(2)}% — signalling channel blocking call setup.`)
    }

    const score = Math.max(5, Math.min(95, 30 + support - contra))
    const verdict = score >= 65 ? 'consistent' : score >= 45 ? 'suggests' : 'not supported'

    if (score >= 45) {
      recs.push('Inspect Random Access / PRACH configuration (preamble detection, power ramping step, root sequence index conflict).')
      recs.push('Verify Core Network signalling links (S1-MME / Iu-CS / A-interface) and TAC/LAC boundary paging congestion.')
      recs.push('Check license utilization for maximum concurrent connected users and RRC connection licenses.')
    }

    return {
      id: 'accessibility_setup',
      title: 'Accessibility & Service Access Failure',
      score,
      confidence: score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low',
      verdict,
      supporting: sup,
      contradicting: con,
      recommendations: recs
    }
  }
}
