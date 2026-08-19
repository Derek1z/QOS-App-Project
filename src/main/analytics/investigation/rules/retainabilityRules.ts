import type { DiagnosticRule, DiagnosticContext } from '../types'
import type { DiagnosticHypothesis } from '../../../../../shared/api'

export const retainabilityRule: DiagnosticRule = {
  id: 'retainability_drops',
  name: 'Retainability & Abnormal Call Drops',
  evaluate(ctx: DiagnosticContext): DiagnosticHypothesis {
    let support = 0
    let contra = 0
    const sup: string[] = []
    const con: string[] = []
    const recs: string[] = []

    const cdr2g = ctx.kpiMap.get('call_drop_rate_2g')
    const cdr3g = ctx.kpiMap.get('call_drop_rate_3g')
    const cdr4g = ctx.kpiMap.get('call_drop_rate_4g')
    const cdr = cdr4g ?? cdr3g ?? cdr2g ?? null

    if (cdr != null) {
      if (cdr > ctx.thresholds.callDrop) {
        support += 35
        sup.push(`Call Drop Rate is ${cdr.toFixed(2)}% (exceeds the ${ctx.thresholds.callDrop}% threshold).`)
      } else {
        contra += 20
        con.push(`Call Drop Rate is within acceptable threshold at ${cdr.toFixed(2)}%.`)
      }
    }

    const availKpi = ctx.evidence.find((e) => e.metric === 'availability')
    if (availKpi?.current != null && availKpi.current < 99.0) {
      support += 15
      sup.push(`Cell availability is low (${availKpi.current.toFixed(1)}%) — cell outages cause abrupt call drops.`)
    }

    const score = Math.max(5, Math.min(95, 30 + support - contra))
    const verdict = score >= 65 ? 'consistent' : score >= 45 ? 'suggests' : 'not supported'

    if (score >= 45) {
      recs.push('Perform ANR (Automatic Neighbor Relation) and neighbor list audit to fix missing neighbor definitions.')
      recs.push('Check handover hysteresis and time-to-trigger (TTT) timers to avoid ping-pong or late handovers.')
      recs.push('Inspect uplink interference (RSSI) and hardware VSWR alarms on the RF antenna jumpers.')
    }

    return {
      id: 'retainability_drop',
      title: 'Retainability & Premature Call Drops',
      score,
      confidence: score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low',
      verdict,
      supporting: sup,
      contradicting: con,
      recommendations: recs
    }
  }
}
