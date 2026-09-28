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

    if (ctx.technology === '4G') {
      if (prbVal != null && prbVal >= ctx.thresholds.prb) {
        support += 30
        sup.push(`PRB utilization is ${prbVal.toFixed(1)}% (at or above the ${ctx.thresholds.prb}% threshold).`)
      } else if (prbVal != null && prbVal < ctx.thresholds.prb - 15) {
        contra += 25
        con.push(`PRB utilization is ${prbVal.toFixed(1)}% (well below the ${ctx.thresholds.prb}% threshold).`)
      }

      const failNoRadio = ctx.kpiMap.get('l_erab_failest_noradiores') ?? 0
      if (failNoRadio > 0) {
        support += 25
        sup.push(`${failNoRadio} E-RAB establishment attempts blocked by radio resource exhaustion (PRB/Power/CCE).`)
        recs.push('Add additional LTE carrier or activate inter-frequency load balancing to alleviate PRB saturation.')
      }

      const failRrcLic = ctx.kpiMap.get('l_erab_failest_noradiores_rrcuserlic') ?? 0
      if (failRrcLic > 0) {
        support += 30
        sup.push(`License bottleneck: ${failRrcLic} E-RAB setup failures caused by max RRC Connected User license limit.`)
        recs.push('Expand RRC connected user license capacity on eNodeB or optimize user inactivity timers.')
      }

      const relCong = ctx.kpiMap.get('l_erab_abnormrel_cong') ?? 0
      if (relCong > 0) {
        support += 20
        sup.push(`${relCong} active E-RABs dropped due to radio congestion and resource preemption.`)
      }
    } else if (ctx.technology === '2G') {
      if (tchCongVal != null && tchCongVal >= ctx.thresholds.tchCongestion) {
        support += 30
        sup.push(`2G TCH Congestion (BH) is ${tchCongVal.toFixed(2)}% (exceeds ${ctx.thresholds.tchCongestion}% regulatory threshold).`)
      } else if (tchCongVal != null && tchCongVal < ctx.thresholds.tchCongestion * 0.5) {
        contra += 20
        con.push(`2G TCH Congestion (BH) is low at ${tchCongVal.toFixed(2)}% (below ${ctx.thresholds.tchCongestion}% threshold).`)
      }
      if (sdcchCongVal != null && sdcchCongVal >= ctx.thresholds.sdcchCongestion) {
        support += 25
        sup.push(`2G SDCCH Congestion (BH) is ${sdcchCongVal.toFixed(2)}% (exceeds ${ctx.thresholds.sdcchCongestion}% threshold).`)
      }

      const voiceErl = ctx.kpiMap.get('voice_traffic_2g')
      const hrErl = ctx.kpiMap.get('tch_hr_traffic_erl')
      if (tchCongVal != null && tchCongVal >= ctx.thresholds.tchCongestion && voiceErl != null && voiceErl > 0) {
        const hrRatio = hrErl != null ? (hrErl / voiceErl) * 100 : null
        if (hrRatio != null && hrRatio < 50) {
          support += 15
          sup.push(`AMR Half-Rate traffic accounts for only ${hrRatio.toFixed(1)}% of carried voice Erlangs — headroom exists to double channel capacity with AMR-HR.`)
          recs.push('Enable or lower dynamic AMR Half-Rate (AMR-HR) allocation threshold to double voice capacity without hardware TRX expansion.')
        }
      }

      const locUp = ctx.kpiMap.get('a3030f_sdcch_location_updating')
      const sms = ctx.kpiMap.get('a3030b_sdcch_moc_sms')
      const mocVoice = ctx.kpiMap.get('a3030a_sdcch_moc_non_sms')
      if (sdcchCongVal != null && sdcchCongVal >= ctx.thresholds.sdcchCongestion) {
        if (locUp != null && (sms == null || locUp > sms) && (mocVoice == null || locUp > mocVoice)) {
          sup.push('SDCCH congestion signature: Location Updating indications (A3030F) dominate setup attempts — LAC boundary ping-pong storm.')
          recs.push('Optimize Cell Reselection Hysteresis (CRH) on LAC boundaries to eliminate excessive periodic Location Updating.')
        } else if (sms != null && (mocVoice == null || sms > mocVoice)) {
          sup.push('SDCCH congestion signature: MOC SMS setup attempts (A3030B) surge detected on signaling channel.')
        } else if (mocVoice != null && mocVoice > 0) {
          sup.push('SDCCH congestion signature: High genuine voice call setup attempt volume (A3030A).')
          recs.push('Convert one static TCH timeslot to dedicated SDCCH/8 to expand signaling capacity.')
        }
      }
    } else if (ctx.technology === '3G') {
      const trafficUtil3g = ctx.kpiMap.get('traffic_utilization_3g') ?? ctx.kpiMap.get('peak_hour_traffic_utilization_3g') ?? ctx.latestWeek?.trafficUtil ?? null
      const ceUtilVal = ctx.kpiMap.get('ce_utilization') ?? ctx.kpiMap.get('cong_3g') ?? null
      if (trafficUtil3g != null && trafficUtil3g >= 75) {
        support += 30
        sup.push(`3G Peak Traffic Utilization is ${trafficUtil3g.toFixed(1)}% (exceeds 75% capacity threshold).`)
      } else if (trafficUtil3g != null && trafficUtil3g < 60) {
        contra += 20
        con.push(`3G Traffic Utilization is healthy at ${trafficUtil3g.toFixed(1)}% (below 75% threshold).`)
      }
      if (ceUtilVal != null && ceUtilVal >= 70) {
        support += 25
        sup.push(`3G Channel Element (CE) Utilization is ${ceUtilVal.toFixed(1)}% (approaching saturation).`)
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
