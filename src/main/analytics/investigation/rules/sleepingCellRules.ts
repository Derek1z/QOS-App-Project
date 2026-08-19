import type { DiagnosticRule, DiagnosticContext } from '../types'
import type { DiagnosticHypothesis } from '../../../../../shared/api'

export const sleepingCellRule: DiagnosticRule = {
  id: 'sleeping_cell',
  name: 'Sleeping Cell & Silent Outage',
  evaluate(ctx: DiagnosticContext): DiagnosticHypothesis {
    let support = 0
    let contra = 0
    const sup: string[] = []
    const con: string[] = []
    const recs: string[] = []

    const availKpi = ctx.evidence.find((e) => e.metric === 'availability')
    const volKpi = ctx.evidence.find((e) => e.metric === 'volume')
    const usrKpi = ctx.evidence.find((e) => e.metric === 'users')

    const isAvailHigh = availKpi?.current != null && availKpi.current >= 99.0
    const isVolNearZero = volKpi?.current != null && volKpi.current < 10
    const isUsersNearZero = usrKpi?.current != null && usrKpi.current < 2

    const hadHistoricalTraffic = (volKpi?.previous != null && volKpi.previous > 100) ||
      (usrKpi?.previous != null && usrKpi.previous > 20)

    if (isAvailHigh && (isVolNearZero || isUsersNearZero) && hadHistoricalTraffic) {
      support += 50
      sup.push(`Availability reports ${availKpi?.current?.toFixed(1)}% uptime, yet traffic dropped to near zero (${volKpi?.current ?? 0} MB).`)
      sup.push(`Cell carried traffic in previous periods (${volKpi?.previous ?? 0} MB / ${usrKpi?.previous ?? 0} users) but is now inactive.`)
    } else if (isVolNearZero && !isAvailHigh) {
      contra += 20
      con.push('Low traffic is accompanied by low availability — standard outage rather than sleeping cell.')
    } else if (!isVolNearZero && !isUsersNearZero) {
      contra += 40
      con.push('Cell is actively carrying user traffic and data volume.')
    }

    const score = Math.max(5, Math.min(95, 20 + support - contra))
    const verdict = score >= 65 ? 'consistent' : score >= 45 ? 'suggests' : 'not supported'

    if (score >= 45) {
      recs.push('Perform remote soft reset on the baseband unit (BBU) or sector carrier.')
      recs.push('Inspect CPRI/eCPRI optical link between BBU and RRU for frame sync errors or optical power degradation.')
      recs.push('Dispatch field engineer to verify RRU power supply, RF jumpers, and antenna feeder connections.')
    }

    return {
      id: 'sleeping_cell',
      title: 'Sleeping Cell / Silent Hardware Failure',
      score,
      confidence: score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low',
      verdict,
      supporting: sup,
      contradicting: con,
      recommendations: recs
    }
  }
}
