import type { DiagnosticRule, DiagnosticContext } from '../types'
import type { DiagnosticHypothesis } from '../../../../../shared/api'

export const interferenceRule: DiagnosticRule = {
  id: 'rf_interference',
  name: 'RF Interference & Channel Quality Degradation',
  evaluate(ctx: DiagnosticContext): DiagnosticHypothesis {
    let support = 0
    let contra = 0
    const sup: string[] = []
    const con: string[] = []
    const recs: string[] = []

    const prbVal = ctx.kpiMap.get('prb_utilization') ?? ctx.latestWeek?.prbAvg ?? null
    const thrKpi = ctx.evidence.find((e) => e.metric === 'throughput')
    const availKpi = ctx.evidence.find((e) => e.metric === 'availability')
    const cdrVal = ctx.kpiMap.get('call_drop_rate_4g') ?? ctx.kpiMap.get('call_drop_rate_3g') ?? ctx.kpiMap.get('call_drop_rate_2g') ?? null

    if (prbVal != null && prbVal < 60 && thrKpi?.current != null && thrKpi.current < 4000) {
      support += 30
      sup.push(`Low user throughput observed despite moderate radio load (${prbVal.toFixed(1)}% PRB), indicating low modulation order (CQI degradation).`)
    }

    if (cdrVal != null && cdrVal > ctx.thresholds.callDrop && (prbVal == null || prbVal < ctx.thresholds.prb)) {
      support += 25
      sup.push(`Call drops are elevated (${cdrVal.toFixed(2)}%) without radio congestion — signature of RF interference or poor SINR.`)
    }

    if (availKpi?.current != null && availKpi.current < 99.0) {
      support += 10
      sup.push(`Cell availability fluctuation (${availKpi.current.toFixed(1)}%) can correlate with antenna feeder or external interference.`)
    }

    if (prbVal != null && prbVal >= ctx.thresholds.prb) {
      contra += 20
      con.push('High PRB load suggests capacity saturation is the primary driver rather than pure RF interference.')
    }

    const score = Math.max(5, Math.min(95, 30 + support - contra))
    const verdict = score >= 65 ? 'consistent' : score >= 45 ? 'suggests' : 'not supported'

    if (score >= 45) {
      recs.push('Perform Physical Cell ID (PCI) mod 3 / mod 30 collision and BCCH/BSIC frequency planning audit with neighboring sectors.')
      recs.push('Conduct external interference and passive intermodulation (PIM) sweep using spectrum analyzer.')
      recs.push('Check uplink RSSI distribution across subcarriers to identify narrow-band or wideband jammer interference.')
    }

    return {
      id: 'interference_rf',
      title: 'RF Interference & Channel Quality Degradation',
      score,
      confidence: score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low',
      verdict,
      supporting: sup,
      contradicting: con,
      recommendations: recs
    }
  }
}
