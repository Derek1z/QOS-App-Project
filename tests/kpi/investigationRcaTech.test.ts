import { describe, it, expect } from 'vitest'
import { previewApi } from '../../src/renderer/lib/previewApi'

describe('Investigation Workspace & RCA Multi-Technology Decoupling', () => {
  it('returns pure 2G findings, hypotheses, and evidence with zero PRB mentions for 2G', async () => {
    const res = await previewApi.investigation.get('cell', 100000, { technology: '2G' })
    expect(res).toBeDefined()
    expect(res?.technology).toBe('2G')

    // Evidence metrics must be 2G
    const evidenceKeys = res!.evidence.map((e) => e.metric)
    expect(evidenceKeys).toContain('tch_cong')
    expect(evidenceKeys).toContain('sdcch_cong')
    expect(evidenceKeys).toContain('cssr_2g')
    expect(evidenceKeys).toContain('call_drop_2g')
    expect(evidenceKeys).not.toContain('prb')

    // Hypotheses must be 2G and have NO PRB mentions
    expect(res!.hypotheses.length).toBeGreaterThan(0)
    for (const h of res!.hypotheses) {
      expect(h.title.toLowerCase()).not.toContain('prb')
      expect(h.verdict.toLowerCase()).not.toContain('prb')
      for (const sup of h.supporting ?? []) {
        expect(sup.toLowerCase()).not.toContain('prb')
      }
    }

    const titles = res!.hypotheses.map((h) => h.title)
    expect(titles.some((t) => t.includes('TCH'))).toBe(true)

    // Sibling sectors must not display PRB for 2G
    for (const p of res!.peers) {
      expect(p.primaryKpi).toBeDefined()
      expect(p.primaryKpi).toContain('TCH Cong')
      expect(p.primaryKpi).not.toContain('PRB')
    }
  })

  it('returns pure 3G findings, hypotheses, and evidence with zero PRB mentions for 3G', async () => {
    const res = await previewApi.investigation.get('cell', 100000, { technology: '3G' })
    expect(res).toBeDefined()
    expect(res?.technology).toBe('3G')

    // Evidence metrics must be 3G
    const evidenceKeys = res!.evidence.map((e) => e.metric)
    expect(evidenceKeys).toContain('traffic_util_3g')
    expect(evidenceKeys).toContain('cssr_3g')
    expect(evidenceKeys).toContain('call_drop_3g')
    expect(evidenceKeys).toContain('data_access_3g')
    expect(evidenceKeys).not.toContain('prb')

    // Hypotheses must be 3G and have NO PRB mentions
    expect(res!.hypotheses.length).toBeGreaterThan(0)
    for (const h of res!.hypotheses) {
      expect(h.title.toLowerCase()).not.toContain('prb')
      expect(h.verdict.toLowerCase()).not.toContain('prb')
      for (const sup of h.supporting ?? []) {
        expect(sup.toLowerCase()).not.toContain('prb')
      }
    }

    const titles = res!.hypotheses.map((h) => h.title)
    expect(titles.some((t) => t.includes('3G') || t.includes('Power') || t.includes('CE'))).toBe(true)

    // Sibling sectors must not display PRB for 3G
    for (const p of res!.peers) {
      expect(p.primaryKpi).toBeDefined()
      expect(p.primaryKpi).toContain('Util')
      expect(p.primaryKpi).not.toContain('PRB')
    }
  })

  it('returns 4G findings and PRB hypotheses for 4G', async () => {
    const res = await previewApi.investigation.get('cell', 100000, { technology: '4G' })
    expect(res).toBeDefined()
    expect(res?.technology).toBe('4G')

    const evidenceKeys = res!.evidence.map((e) => e.metric)
    expect(evidenceKeys).toContain('prb')

    const titles = res!.hypotheses.map((h) => h.title)
    expect(titles.some((t) => t.includes('PRB'))).toBe(true)
  })

  it('Comparison Lab provides technology-specific metrics without defaulting to PRB', async () => {
    const comp2G = await previewApi.analytics.comparison({ technology: '2G' })
    expect(comp2G.metric).toBe('tch_congestion')
    const kpiKeys2G = comp2G.kpis.map((k) => k.metric)
    expect(kpiKeys2G).toContain('tch_congestion')
    expect(kpiKeys2G).toContain('sdcch_congestion')
    expect(kpiKeys2G).not.toContain('prb')

    const comp3G = await previewApi.analytics.comparison({ technology: '3G' })
    expect(comp3G.metric).toBe('cssr_3g')
    const kpiKeys3G = comp3G.kpis.map((k) => k.metric)
    expect(kpiKeys3G).toContain('cssr_3g')
    expect(kpiKeys3G).toContain('call_drop_3g')
    expect(kpiKeys3G).not.toContain('prb')

    const comp4G = await previewApi.analytics.comparison({ technology: '4G' })
    expect(comp4G.metric).toBe('prb')
    const kpiKeys4G = comp4G.kpis.map((k) => k.metric)
    expect(kpiKeys4G).toContain('prb')
  })

  it('Cell Intelligence generates technology-coherent cell KPIs', async () => {
    const ci2G = await previewApi.analytics.cellIntelligence({ technology: '2G', limit: 10 })
    expect(ci2G.rows.length).toBeGreaterThan(0)
    const kpis2G = ci2G.rows[0].kpis.map((k) => k.key)
    expect(kpis2G).toContain('tch_congestion')
    expect(kpis2G).not.toContain('prb_utilization')

    const ci3G = await previewApi.analytics.cellIntelligence({ technology: '3G', limit: 10 })
    expect(ci3G.rows.length).toBeGreaterThan(0)
    const kpis3G = ci3G.rows[0].kpis.map((k) => k.key)
    expect(kpis3G).toContain('rrc_connection_success')
    expect(kpis3G).not.toContain('prb_utilization')
  })

  it('adapts report tables and recommendations dynamically to active technology', async () => {
    // Switch to 2G
    await previewApi.workspace.setTechnology('2G')
    const rep2G = await previewApi.reports.generate({ sections: ['all-cells', 'priority-queue'], formats: ['md'] })
    expect(rep2G.files.md?.content).toBeDefined()
    expect(rep2G.files.md?.content).toContain('TCH Cong %')
    expect(rep2G.files.md?.content).not.toContain('PRB %')
    expect(rep2G.files.md?.content).toContain('Congestion severity')
    expect(rep2G.files.md?.content).not.toContain('PRB severity')

    const exec2G = await previewApi.analytics.executiveOverview()
    expect(exec2G.problemSummary.keyRecommendations.some((r) => r.includes('frequency plan') || r.includes('TCH'))).toBe(true)

    // Switch to 3G
    await previewApi.workspace.setTechnology('3G')
    const rep3G = await previewApi.reports.generate({ sections: ['all-cells', 'priority-queue'], formats: ['md'] })
    expect(rep3G.files.md?.content).toBeDefined()
    expect(rep3G.files.md?.content).toContain('Peak Util %')
    expect(rep3G.files.md?.content).not.toContain('PRB %')
    expect(rep3G.files.md?.content).toContain('Load severity')
    expect(rep3G.files.md?.content).not.toContain('PRB severity')

    const exec3G = await previewApi.analytics.executiveOverview()
    expect(exec3G.problemSummary.keyRecommendations.some((r) => r.includes('CE expansion') || r.includes('power rebalancing'))).toBe(true)

    // Restore to 4G
    await previewApi.workspace.setTechnology('4G')
  })
})

