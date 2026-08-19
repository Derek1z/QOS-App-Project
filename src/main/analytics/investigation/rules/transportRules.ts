import type { DiagnosticRule, DiagnosticContext } from '../types'
import type { DiagnosticHypothesis } from '../../../../../shared/api'

export const transportRule: DiagnosticRule = {
  id: 'transport_bottleneck',
  name: 'Transport & Backhaul Limitation',
  evaluate(ctx: DiagnosticContext): DiagnosticHypothesis {
    let support = 0
    let contra = 0
    const sup: string[] = []
    const con: string[] = []
    const recs: string[] = []

    const thrKpi = ctx.evidence.find((e) => e.metric === 'throughput')
    const prbVal = ctx.kpiMap.get('prb_utilization') ?? ctx.latestWeek?.prbAvg ?? null
    const availKpi = ctx.evidence.find((e) => e.metric === 'availability')

    if (thrKpi?.deltaPct != null && thrKpi.deltaPct <= -15) {
      support += 25
      sup.push(`User throughput dropped ${Math.abs(thrKpi.deltaPct).toFixed(1)}% week-over-week.`)
    }
    if (thrKpi?.current != null && thrKpi.current < 2000) {
      support += 20
      sup.push(`Average DL throughput is severely constrained at ${(thrKpi.current / 1024).toFixed(2)} Mbps.`)
    }

    if (availKpi?.current != null && availKpi.current >= 99.5) {
      support += 10
      sup.push('Availability is healthy (>=99.5%) — radio link is operational, pointing to IP transport bottleneck.')
    } else if (availKpi?.current != null && availKpi.current < 95.0) {
      contra += 20
      con.push('Availability is severely degraded — RF outage is more likely than a pure transport limitation.')
    }

    if (prbVal != null && prbVal < 40 && thrKpi?.current != null && thrKpi.current < 2000) {
      support += 25
      sup.push(`Throughput is choked despite low radio PRB load (${prbVal.toFixed(1)}%), strongly indicating backhaul bandwidth limits.`)
    }

    const score = Math.max(5, Math.min(95, 30 + support - contra))
    const verdict = score >= 65 ? 'consistent' : score >= 45 ? 'suggests' : 'not supported'

    if (score >= 45) {
      recs.push('Inspect transmission microwave link modulation status and Ethernet switch port error counters (CRC/drops).')
      recs.push('Verify IP backhaul bandwidth allocation / Committed Information Rate (CIR) and VLAN QoS priority tagging (DSCP).')
      recs.push('Run end-to-end IP SLA ping/jitter tests from site router to S-GW / Core Gateway.')
    }

    return {
      id: 'backhaul_transport',
      title: 'Backhaul / IP Transport Limitation',
      score,
      confidence: score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low',
      verdict,
      supporting: sup,
      contradicting: con,
      recommendations: recs
    }
  }
}
