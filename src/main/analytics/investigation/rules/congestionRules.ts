import type { DiagnosticRule, DiagnosticContext } from '../types'
import type { DiagnosticHypothesis } from '../../../../../shared/api'

export const congestionRule: DiagnosticRule = {
  id: 'congestion_capacity',
  name: 'Capacity Exhaustion & Congestion',
  evaluate(ctx: DiagnosticContext): DiagnosticHypothesis {
    let support = 0
    let contra = 0
    const sup: string[] = []
    const con: string[] = []
    const recs: string[] = []

    const prbVal = ctx.kpiMap.get('prb_utilization') ?? ctx.latestWeek?.prbAvg ?? null
    const tchCongVal = ctx.kpiMap.get('tch_congestion') ?? null
    const sdcchCongVal = ctx.kpiMap.get('sdcch_congestion') ?? null
    const usersKpi = ctx.evidence.find((e) => e.metric === 'users')
    const volKpi = ctx.evidence.find((e) => e.metric === 'volume')

    if (ctx.technology === '4G' || prbVal != null) {
      if (prbVal != null && prbVal >= ctx.thresholds.prb) {
        support += 30
        sup.push(`PRB utilization is ${prbVal.toFixed(1)}% (at or above the ${ctx.thresholds.prb}% threshold).`)
      } else if (prbVal != null && prbVal < ctx.thresholds.prb - 15) {
        contra += 25
        con.push(`PRB utilization is ${prbVal.toFixed(1)}% (well below the ${ctx.thresholds.prb}% threshold).`)
      }
    }

    if (ctx.technology === '2G') {
      if (tchCongVal != null && tchCongVal >= ctx.thresholds.tchCongestion) {
        support += 30
        sup.push(`2G TCH Congestion is ${tchCongVal.toFixed(2)}% (exceeds ${ctx.thresholds.tchCongestion}% threshold).`)
      }
      if (sdcchCongVal != null && sdcchCongVal >= ctx.thresholds.sdcchCongestion) {
        support += 25
        sup.push(`2G SDCCH Congestion is ${sdcchCongVal.toFixed(2)}% (exceeds ${ctx.thresholds.sdcchCongestion}% threshold).`)
      }
    }

    if (usersKpi?.deltaPct != null && usersKpi.deltaPct >= 10) {
      support += 15
      sup.push(`Connected users grew ${usersKpi.deltaPct.toFixed(1)}% week-over-week.`)
    }
    if (volKpi?.deltaPct != null && volKpi.deltaPct >= 10) {
      support += 15
      sup.push(`Data volume traffic grew ${volKpi.deltaPct.toFixed(1)}% week-over-week.`)
    }

    if (ctx.ncStreak >= ctx.thresholds.persistentWeeks) {
      support += 15
      sup.push(`Entity has been in non-compliance for ${ctx.ncStreak} consecutive weeks.`)
    }

    const score = Math.max(5, Math.min(95, 35 + support - contra))
    const verdict = score >= 65 ? 'consistent' : score >= 45 ? 'suggests' : 'not supported'

    if (score >= 45) {
      recs.push('Evaluate secondary carrier addition (carrier aggregation / additional TRX / second carrier).')
      recs.push('Adjust intra-frequency cell reselection and handover offsets to offload traffic to adjacent lighter cells.')
      recs.push('Review physical antenna tilt and azimuth to optimize coverage footprint and reduce overshooting.')
    }

    return {
      id: 'capacity_congestion',
      title: 'Capacity Exhaustion & Radio Congestion',
      score,
      confidence: score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low',
      verdict,
      supporting: sup,
      contradicting: con,
      recommendations: recs
    }
  }
}
