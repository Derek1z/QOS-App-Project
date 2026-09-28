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

    const s1Setup = ctx.kpiMap.get('s1_signalling_success_rate')
    if (s1Setup != null) {
      if (s1Setup < 99.0) {
        support += 30
        sup.push(`S1 Signalling Connection Establishment Success Rate is degraded at ${s1Setup.toFixed(2)}% (below 99.0% target) — S1-MME control plane link degradation.`)
        recs.push('Investigate S1-MME control plane connectivity, SCTP association status, and MME capacity.')
      } else {
        contra += 15
        con.push(`S1 Signalling Connection Establishment is healthy at ${s1Setup.toFixed(2)}% (meeting 99.0% target).`)
      }
    }

    if (sdcchCong != null && sdcchCong > ctx.thresholds.sdcchCongestion) {
      support += 20
      sup.push(`2G SDCCH Congestion is elevated at ${sdcchCong.toFixed(2)}% — signalling channel blocking call setup.`)
    }

    if (ctx.technology === '4G') {
      const failNoRadio = ctx.kpiMap.get('l_erab_failest_noradiores') ?? 0
      const failLic = ctx.kpiMap.get('l_erab_failest_noradiores_rrcuserlic') ?? 0
      if (failNoRadio > 0) {
        support += 25
        sup.push(`${failNoRadio} E-RAB setup failures caused by lack of radio resources (PRB/Power/CCE exhaustion).`)
        recs.push('Address cell congestion: activate load balancing or expand carrier capacity to free radio resources for E-RAB setup.')
      }
      if (failLic > 0) {
        support += 30
        sup.push(`${failLic} E-RAB setup failures caused by RRC Connected User license limitation.`)
        recs.push('Upgrade eNodeB RRC connected user license capacity or adjust active UE inactivity timers.')
      }

      const failRnl = ctx.kpiMap.get('l_erab_failest_rnl') ?? 0
      if (failRnl > 0) {
        support += 20
        sup.push(`${failRnl} E-RAB setup failures caused by Radio Network Layer (RF channel quality/sync issues).`)
        recs.push('Check RF channel conditions, Uplink/Downlink interference, and cell-edge coverage gaps.')
      }

      const failTnl = ctx.kpiMap.get('l_erab_failest_tnl') ?? 0
      if (failTnl > 0) {
        support += 25
        sup.push(`${failTnl} E-RAB setup failures caused by Transport Network Layer (backhaul/IP transport degradation).`)
        recs.push('Audit transmission backhaul for packet loss, jitter, and S1-U IP path availability.')
      }

      const failMme = ctx.kpiMap.get('l_erab_failest_mme') ?? 0
      if (failMme > 0) {
        support += 25
        sup.push(`${failMme} E-RAB setup failures caused by Core Network / MME rejection.`)
        recs.push('Check EPC MME error logs, subscriber profile / HSS authentication, and core network availability.')
      }

      const failHo = ctx.kpiMap.get('l_erab_failest_conflict_hofail') ?? 0
      if (failHo > 0) {
        support += 20
        sup.push(`${failHo} E-RAB setup failures caused by Handover conflict.`)
        recs.push('Optimize handover parameters and audit neighbor relations to prevent setup collision with ongoing handovers.')
      }

      const failX2 = ctx.kpiMap.get('l_erab_failest_x2ap') ?? 0
      if (failX2 > 0) {
        support += 20
        sup.push(`${failX2} E-RAB setup failures caused by X2AP interface signaling errors with neighbor eNodeBs.`)
        recs.push('Check X2 link status, SCTP connectivity, and IP routing to neighboring eNodeBs.')
      }

      const grpAAtt = ctx.kpiMap.get('l_ra_grpa_att') ?? 0
      const grpARes = ctx.kpiMap.get('l_ra_grpa_contresolution') ?? 0
      if (grpAAtt > 0 && grpARes < grpAAtt * 0.9) {
        const resRateA = (grpARes / grpAAtt) * 100
        support += 20
        sup.push(`PRACH Group A contention resolution degraded at ${resRateA.toFixed(1)}% (${grpARes}/${grpAAtt}) — high cell-edge access failure / collision.`)
        recs.push('Adjust PRACH power ramping step size, preamble initial received target power, and root sequence index.')
      }

      const grpBAtt = ctx.kpiMap.get('l_ra_grpb_att') ?? 0
      const grpBRes = ctx.kpiMap.get('l_ra_grpb_contresolution') ?? 0
      if (grpBAtt > 0 && grpBRes < grpBAtt * 0.9) {
        const resRateB = (grpBRes / grpBAtt) * 100
        support += 15
        sup.push(`PRACH Group B contention resolution degraded at ${resRateB.toFixed(1)}% (${grpBRes}/${grpBAtt}).`)
      }

      const rrcReq = ctx.kpiMap.get('l_rrc_connreq_msg') ?? 0
      if (rrcReq > 10000 && cssr4g != null && cssr4g < ctx.thresholds.cssr) {
        support += 15
        sup.push(`Surge in initial access attempts: ${rrcReq.toLocaleString()} RRC Connection Request messages received.`)
      }
    }

    if (ctx.technology === '2G') {
      const asgSr = ctx.kpiMap.get('tch_assignment_success_rate')
      if (asgSr != null && asgSr < 95.0) {
        support += 25
        sup.push(`2G TCH Assignment Success Rate is degraded at ${asgSr.toFixed(2)}% (below 95.0% target) — calls failing during TCH voice channel allocation.`)
        recs.push('Verify dynamic SDCCH/TCH channel allocation parameters and half-rate AMR switching thresholds.')
      }

      const rachReq = ctx.kpiMap.get('ca300j_channel_requests_cs') ?? 0
      const agchCmd = ctx.kpiMap.get('ca301j_imm_assign_cmds_cs') ?? 0
      if (rachReq > 0 && agchCmd < rachReq * 0.95) {
        const immRate = (agchCmd / rachReq) * 100
        support += 25
        sup.push(`Immediate Assignment bottleneck on CCCH: ${rachReq} RACH channel requests vs ${agchCmd} AGCH assignment commands (${immRate.toFixed(1)}% conversion).`)
        recs.push('Audit CCCH configuration (CCCH-CONF), increase AGCH reserved blocks (BS-AG-BLKS-RES), and check for RACH phantom preambles.')
      }

      const sdcchFail = ctx.kpiMap.get('sdcch_allocation_failures') ?? 0
      if (sdcchFail > 0) {
        support += 20
        sup.push(`${sdcchFail} SDCCH allocation requests failed due to signalling channel congestion during call setup.`)
      }

      const hosr2g = ctx.kpiMap.get('handover_success_rate_2g')
      if (hosr2g != null && hosr2g < 95.0) {
        support += 20
        sup.push(`2G Handover Success Rate is degraded at ${hosr2g.toFixed(2)}% (below 95.0% target).`)
        recs.push('Audit incoming and outgoing handover relations and tune handover hysteresis / penalty timers.')
      }
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
