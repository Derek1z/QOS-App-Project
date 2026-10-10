import { describe, it, expect } from 'vitest'

describe('Huawei RCA engines per technology', () => {
  it('2G Huawei diagnostic engine evaluates RF interference, overshoot, accessibility, and hardware drops accurately', async () => {
    const { runDiagnosticEngine } = await import('../../src/main/analytics/investigation/engine')
    const { DiagnosticContext } = await import('../../src/main/analytics/investigation/types')

    // Scenario: 2G cell with high T200 expirations (M3100A), Timing Advance overshoot,
    // poor CSSR with immediate assignment bottleneck (CA300J vs CA301J), and transceiver hardware drops (CM334)
    const kpiMap = new Map<string, number | null>([
      ['call_drop_rate_2g', 3.2],
      ['tch_congestion', 2.8],
      ['sdcch_congestion', 2.1],
      ['call_setup_success_2g', 91.5],
      ['tch_assignment_success_rate', 89.0],
      ['m3100a_tchf_drops_err_ind_t200', 12],
      ['avg_timing_advance_m', 3650],
      ['ca300j_channel_requests_cs', 1200],
      ['ca301j_imm_assign_cmds_cs', 850],
      ['sdcch_allocation_failures', 45],
      ['cm334_tch_drops_equipment_failure', 8],
      ['cm332_tch_drops_no_mr', 5],
      ['a3030f_sdcch_location_updating', 650],
      ['a3030b_sdcch_moc_sms', 150],
      ['a3030a_sdcch_moc_non_sms', 100],
      ['voice_traffic_2g', 35.0],
      ['tch_hr_traffic_erl', 8.0]
    ])

    const ctx: any = {
      technology: '2G',
      entityName: 'KMA023_2G_S1',
      isNc: true,
      ncStreak: 4,
      weeks: [],
      latestWeek: null,
      previousWeek: null,
      evidence: [
        { metric: 'tch_cong', label: 'TCH Congestion (BH)', unit: '%', worseIsHigher: true, current: 2.8 },
        { metric: 'sdcch_cong', label: 'SDCCH Congestion (BH)', unit: '%', worseIsHigher: true, current: 2.1 },
        { metric: 'cssr_2g', label: 'CSSR', unit: '%', worseIsHigher: false, current: 91.5 },
        { metric: 'call_drop_2g', label: 'Call Drop Rate', unit: '%', worseIsHigher: true, current: 3.2 }
      ],
      kpiMap,
      thresholds: {
        prb: 80,
        tchCongestion: 1.0,
        sdcchCongestion: 1.0,
        cssr: 95.0,
        callDrop: 1.0,
        dataAccess: 95.0,
        dataFailure: 1.0,
        persistentWeeks: 3,
        chronicWeeks: 7
      }
    }

    const hypotheses = runDiagnosticEngine(ctx)
    expect(hypotheses.length).toBe(6)

    // 1. Interference rule should detect T200 expiration and TA overshoot
    const rfHypo = hypotheses.find((h) => h.id === 'interference_rf')
    expect(rfHypo).toBeDefined()
    expect(rfHypo!.score).toBeGreaterThanOrEqual(65)
    expect(rfHypo!.supporting.some((s) => s.includes('T200'))).toBe(true)
    expect(rfHypo!.supporting.some((s) => s.includes('Timing Advance') || s.includes('3650m'))).toBe(true)
    expect(rfHypo!.recommendations.some((r) => r.includes('downtilt'))).toBe(true)

    // 2. Accessibility rule should detect CSSR breach, TCH assignment SR breach, and Immediate Assignment bottleneck
    const accessHypo = hypotheses.find((h) => h.id === 'accessibility_setup')
    expect(accessHypo).toBeDefined()
    expect(accessHypo!.score).toBeGreaterThanOrEqual(65)
    expect(accessHypo!.supporting.some((s) => s.includes('Assignment Success Rate'))).toBe(true)
    expect(accessHypo!.supporting.some((s) => s.includes('Immediate Assignment bottleneck'))).toBe(true)
    expect(accessHypo!.supporting.some((s) => s.includes('SDCCH allocation requests failed'))).toBe(true)

    // 3. Retainability rule should detect hardware failure drops and no-MR drops
    const retainHypo = hypotheses.find((h) => h.id === 'retainability_drop')
    expect(retainHypo).toBeDefined()
    expect(retainHypo!.score).toBeGreaterThanOrEqual(65)
    expect(retainHypo!.supporting.some((s) => s.includes('CM334') || s.includes('equipment failure'))).toBe(true)
    expect(retainHypo!.supporting.some((s) => s.includes('CM332') || s.includes('dead spot'))).toBe(true)

    // 4. Congestion rule should detect TCH BH congestion, AMR-HR traffic ratio, and Location Updating storm
    const congHypo = hypotheses.find((h) => h.id === 'capacity_congestion')
    expect(congHypo).toBeDefined()
    expect(congHypo!.score).toBeGreaterThanOrEqual(65)
    expect(congHypo!.supporting.some((s) => s.includes('TCH Congestion (BH)'))).toBe(true)
    expect(congHypo!.supporting.some((s) => s.includes('AMR Half-Rate'))).toBe(true)
    expect(congHypo!.supporting.some((s) => s.includes('Location Updating'))).toBe(true)
  })

  it('4G Huawei diagnostic engine evaluates S1 signalling, E-RAB setup failures, RRC user licenses, UL Out-of-Sync, and TNL transport accurately', async () => {
    const { runDiagnosticEngine } = await import('../../src/main/analytics/investigation/engine')

    // Scenario: 4G cell with degraded CSSR (91.2%), degraded S1 connection establishment (96.5%),
    // degraded DSAF (2.4%), E-RAB NoRadioRes & RRC license saturation,
    // E-RAB abnormal releases from UL sync failure & SRB reset, and TNL backhaul failure
    const kpiMap = new Map<string, number | null>([
      ['call_setup_success_4g', 91.2],
      ['call_drop_rate_4g', 2.8],
      ['data_service_failure_4g', 2.4],
      ['s1_signalling_success_rate', 96.5],
      ['prb_utilization', 88.5],
      ['l_rrc_connreq_msg', 14500],
      ['l_erab_failest_rnl', 25],
      ['l_erab_failest_noradiores', 64],
      ['l_erab_failest_noradiores_rrcuserlic', 38],
      ['l_erab_failest_tnl', 18],
      ['l_erab_failest_mme', 12],
      ['l_erab_failest_conflict_hofail', 9],
      ['l_erab_failest_x2ap', 7],
      ['l_ra_grpa_att', 1200],
      ['l_ra_grpa_contresolution', 950],
      ['l_erab_abnormrel', 85],
      ['l_erab_abnormrel_radio', 45],
      ['l_erab_abnormrel_radio_ulsyncfail', 32],
      ['l_erab_abnormrel_radio_srbreset', 13],
      ['l_erab_abnormrel_cong', 15],
      ['l_erab_abnormrel_tnl', 16],
      ['l_erab_abnormrel_hofailure', 11]
    ])

    const ctx: any = {
      technology: '4G',
      entityName: 'ACC012_4G_S1',
      isNc: true,
      ncStreak: 4,
      weeks: [],
      latestWeek: null,
      previousWeek: null,
      evidence: [
        { metric: 'prb', label: 'PRB Utilization', unit: '%', worseIsHigher: true, current: 88.5 },
        { metric: 'throughput', label: 'DL Throughput', unit: 'kbps', worseIsHigher: false, current: 8500 },
        { metric: 'cssr_4g', label: 'CSSR', unit: '%', worseIsHigher: false, current: 91.2 },
        { metric: 'call_drop_4g', label: 'Call Drop Rate', unit: '%', worseIsHigher: true, current: 2.8 },
        { metric: 'data_failure_4g', label: 'Data Access Failure', unit: '%', worseIsHigher: true, current: 2.4 },
        { metric: 'availability', label: 'Availability', unit: '%', worseIsHigher: false, current: 99.2 }
      ],
      kpiMap,
      thresholds: {
        prb: 80,
        tchCongestion: 1.0,
        sdcchCongestion: 1.0,
        cssr: 95.0,
        callDrop: 1.0,
        dataAccess: 95.0,
        dataFailure: 1.0,
        persistentWeeks: 3,
        chronicWeeks: 7
      }
    }

    const hypotheses = runDiagnosticEngine(ctx)
    expect(hypotheses.length).toBe(6)

    // 1. Accessibility rule: detects S1 Setup failure, E-RAB NoRadioRes, RRC User license saturation, and TNL setup failure
    const accessHypo = hypotheses.find((h) => h.id === 'accessibility_setup')
    expect(accessHypo).toBeDefined()
    expect(accessHypo!.score).toBeGreaterThanOrEqual(65)
    expect(accessHypo!.supporting.some((s) => s.includes('S1 Signalling Connection Establishment Success Rate'))).toBe(true)
    expect(accessHypo!.supporting.some((s) => s.includes('lack of radio resources'))).toBe(true)
    expect(accessHypo!.supporting.some((s) => s.includes('RRC Connected User license'))).toBe(true)
    expect(accessHypo!.supporting.some((s) => s.includes('PRACH Group A contention resolution'))).toBe(true)
    expect(accessHypo!.recommendations.some((r) => r.includes('S1-MME'))).toBe(true)

    // 2. Retainability rule: detects Uplink Out-of-Sync releases, SRB reset drops, and Handover execution failure
    const retainHypo = hypotheses.find((h) => h.id === 'retainability_drop')
    expect(retainHypo).toBeDefined()
    expect(retainHypo!.score).toBeGreaterThanOrEqual(65)
    expect(retainHypo!.supporting.some((s) => s.includes('Uplink Out-of-Sync'))).toBe(true)
    expect(retainHypo!.supporting.some((s) => s.includes('RLC Max Retransmission'))).toBe(true)
    expect(retainHypo!.supporting.some((s) => s.includes('Handover Execution Failure'))).toBe(true)
    expect(retainHypo!.recommendations.some((r) => r.includes('PUCCH/PUSCH'))).toBe(true)

    // 3. Congestion rule: detects PRB exhaustion, radio resource exhaustion, and RRC user license saturation
    const congHypo = hypotheses.find((h) => h.id === 'capacity_congestion')
    expect(congHypo).toBeDefined()
    expect(congHypo!.score).toBeGreaterThanOrEqual(65)
    expect(congHypo!.supporting.some((s) => s.includes('PRB utilization'))).toBe(true)
    expect(congHypo!.supporting.some((s) => s.includes('License bottleneck'))).toBe(true)
    expect(congHypo!.supporting.some((s) => s.includes('resource exhaustion'))).toBe(true)

    // 4. Transport rule: detects TNL degradation from E-RAB setup failures and abnormal drops
    const transHypo = hypotheses.find((h) => h.id === 'backhaul_transport')
    expect(transHypo).toBeDefined()
    expect(transHypo!.score).toBeGreaterThanOrEqual(60)
    expect(transHypo!.supporting.some((s) => s.includes('Transport Network Layer (TNL) degradation confirmed'))).toBe(true)
  })

  it('4G Huawei column headers auto-match to exact canonical KPI keys via discovery', async () => {
    const { builtInSeeds, normalizeHeader } = await import('../../src/main/services/kpiService')
    const seeds4G = builtInSeeds('4G')

    const headersToTest = [
      { header: '4G Call Connection Success Rate_NCA(%)', expectedKey: 'call_setup_success_4g' },
      { header: '4G Call Drop Rate_NCA(%)', expectedKey: 'call_drop_rate_4g' },
      { header: '4G Data Service Access Failure Rate_NCA', expectedKey: 'data_service_failure_4g' },
      { header: 'S1 Signalling Connection Establishment Success Rate_STD(%)', expectedKey: 's1_signalling_success_rate' },
      { header: '4G Peak Hour Traffic Utilization_NCA(%)', expectedKey: 'prb_utilization' },
      { header: '4G Cell Availability_STD(%)', expectedKey: 'availability' },
      { header: '[H_4G]HWI_4G_CELL.L.RRC.ConnReq.Msg', expectedKey: 'l_rrc_connreq_msg' },
      { header: '[H_4G]HWI_4G_CELL.L.E-RAB.FailEst.RNL', expectedKey: 'l_erab_failest_rnl' },
      { header: '[H_4G]HWI_4G_CELL.L.E-RAB.FailEst.NoRadioRes', expectedKey: 'l_erab_failest_noradiores' },
      { header: '[H_4G]HWI_4G_CELL_5.L.E-RAB.FailEst.NoRadioRes.RrcUserLic', expectedKey: 'l_erab_failest_noradiores_rrcuserlic' },
      { header: '[H_4G]HWI_4G_CELL.L.E-RAB.FailEst.TNL', expectedKey: 'l_erab_failest_tnl' },
      { header: '[H_4G]HWI_4G_CELL.L.E-RAB.FailEst.MME', expectedKey: 'l_erab_failest_mme' },
      { header: '[H_4G]HWI_4G_CELL_4.L.E-RAB.FailEst.Conflict.Hofail', expectedKey: 'l_erab_failest_conflict_hofail' },
      { header: '[H_4G]HWI_4G_CELL_5.L.E-RAB.FailEst.X2AP', expectedKey: 'l_erab_failest_x2ap' },
      { header: '[H_4G]HWI_4G_CELL.L.RA.GrpA.Att', expectedKey: 'l_ra_grpa_att' },
      { header: '[H_4G]HWI_4G_CELL.L.RA.GrpA.ContResolution', expectedKey: 'l_ra_grpa_contresolution' },
      { header: '[H_4G]HWI_4G_CELL.L.RA.GrpB.Att', expectedKey: 'l_ra_grpb_att' },
      { header: '[H_4G]HWI_4G_CELL.L.RA.Dedicate.HO.Att', expectedKey: 'l_ra_dedicate_ho_att' },
      { header: '[H_4G]HWI_4G_CELL.L.E-RAB.AbnormRel', expectedKey: 'l_erab_abnormrel' },
      { header: '[H_4G]HWI_4G_CELL.L.E-RAB.AbnormRel.Radio', expectedKey: 'l_erab_abnormrel_radio' },
      { header: '[H_4G]HWI_4G_CELL_2.L.E-RAB.AbnormRel.Radio.ULSyncFail', expectedKey: 'l_erab_abnormrel_radio_ulsyncfail' },
      { header: '[H_4G]HWI_4G_CELL_2.L.E-RAB.AbnormRel.Radio.SRBReset', expectedKey: 'l_erab_abnormrel_radio_srbreset' },
      { header: '[H_4G]HWI_4G_CELL_2.L.E-RAB.AbnormRel.Radio.DRBReset', expectedKey: 'l_erab_abnormrel_radio_drbreset' },
      { header: '[H_4G]HWI_4G_CELL.L.E-RAB.AbnormRel.Cong', expectedKey: 'l_erab_abnormrel_cong' },
      { header: '[H_4G]HWI_4G_CELL.L.E-RAB.AbnormRel.TNL', expectedKey: 'l_erab_abnormrel_tnl' },
      { header: '[H_4G]HWI_4G_CELL.L.E-RAB.AbnormRel.HOFailure', expectedKey: 'l_erab_abnormrel_hofailure' },
      { header: '[H_4G]HWI_4G_CELL.L.E-RAB.AbnormRel.MME', expectedKey: 'l_erab_abnormrel_mme' }
    ]

    for (const item of headersToTest) {
      const normH = normalizeHeader(item.header)
      const matched = seeds4G.find((seed) => {
        return (
          seed.key === item.expectedKey &&
          seed.aliases.some((a) => normalizeHeader(a) === normH)
        )
      })
      expect(matched, `Expected header "${item.header}" to match key "${item.expectedKey}"`).toBeDefined()
    }
  })
})

