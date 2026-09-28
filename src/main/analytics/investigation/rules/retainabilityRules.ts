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

    if (ctx.technology === '4G') {
      const relUlSync = ctx.kpiMap.get('l_erab_abnormrel_radio_ulsyncfail') ?? 0
      const relSrb = ctx.kpiMap.get('l_erab_abnormrel_radio_srbreset') ?? 0
      const relDrb = ctx.kpiMap.get('l_erab_abnormrel_radio_drbreset') ?? 0
      const relRadio = ctx.kpiMap.get('l_erab_abnormrel_radio') ?? 0
      const relHo = ctx.kpiMap.get('l_erab_abnormrel_hofailure') ?? 0
      const relCong = ctx.kpiMap.get('l_erab_abnormrel_cong') ?? 0
      const relMme = ctx.kpiMap.get('l_erab_abnormrel_mme') ?? 0

      if (relUlSync > 0) {
        support += 30
        sup.push(`High Uplink Out-of-Sync releases: ${relUlSync} abnormal E-RAB drops caused by UL synchronization loss (max out-of-sync indications).`)
        recs.push('Investigate uplink coverage, UE transmit power limits, UL interference (RSSI), and tune PUCCH/PUSCH power control.')
      }

      if (relSrb > 0 || relDrb > 0) {
        support += 25
        sup.push(`RLC Max Retransmission reset drops detected: ${relSrb} SRB resets and ${relDrb} DRB resets.`)
        recs.push('Check radio channel quality, high block error rate (BLER), and tune max RLC retransmission thresholds.')
      } else if (relRadio > 0 && relUlSync === 0) {
        support += 20
        sup.push(`${relRadio} abnormal E-RAB drops caused by Radio Link Failure (RLF).`)
      }

      if (relHo > 0) {
        support += 25
        sup.push(`${relHo} abnormal E-RAB drops caused by Handover Execution Failure.`)
        recs.push('Audit neighbor relations, adjust handover time-to-trigger (TTT), and optimize A3/A5 event offset thresholds to resolve late handovers.')
      }

      if (relCong > 0) {
        support += 20
        sup.push(`${relCong} abnormal E-RAB drops caused by radio congestion or preemption.`)
      }

      if (relMme > 0) {
        support += 20
        sup.push(`${relMme} abnormal E-RAB drops initiated by EPC MME core release requests.`)
        recs.push('Review MME logs and core network attach/session management alarms.')
      }
    }

    if (ctx.technology === '2G') {
      const cm334 = ctx.kpiMap.get('cm334_tch_drops_equipment_failure') ?? 0
      const cm364 = ctx.kpiMap.get('cm364_sdcch_drops_equipment_failure') ?? 0
      const equipDrops = cm334 + cm364
      if (equipDrops > 0) {
        support += 35
        sup.push(`Direct transceiver hardware drop alarm detected: ${equipDrops} drops caused by equipment failure (CM334/CM364).`)
        recs.push('Dispatch field technician to inspect/replace faulty BTS TRX transceiver board and power amplifier.')
      }

      const cm332 = ctx.kpiMap.get('cm332_tch_drops_no_mr') ?? 0
      if (cm332 > 0) {
        support += 25
        sup.push(`Radio coverage dead spot signature: ${cm332} drops occurred due to no Measurement Reports received from MS (CM332).`)
        recs.push('Perform drive test to map RF dead zones and verify uplink/downlink link balance.')
      }

      const rlfTchf = ctx.kpiMap.get('m3101a_tchf_drops_conn_fail_rlf') ?? 0
      const rlfTchh = ctx.kpiMap.get('m3201a_tchh_drops_conn_fail_rlf') ?? 0
      const totalRlf = rlfTchf + rlfTchh
      if (totalRlf > 0) {
        support += 20
        sup.push(`Radio Link Failures (RLF) logged on traffic channels: ${totalRlf} drops from connection failure (M3101A/M3201A).`)
      }
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
