import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Technology } from '../../shared/api'
import { openTechWorkspace } from '../helpers/techWorkspace'
import type { RealWorkspace } from '../helpers/realWorkspace'
import { COMPARE_METRICS } from '../../shared/compareMetrics'

/**
 * Each screen's service, on a real workspace of one technology, speaks that
 * technology: its own KPIs, never another technology's (a 2G or 3G
 * workspace never shows PRB). These replace tests that only exercised the
 * browser-preview mock. Data: the real synthetic generator through the real
 * import core (only the utility-process hop is swapped, see techWorkspace).
 */
vi.setConfig({ testTimeout: 30000 })

vi.mock('../../src/main/import/importer', async (orig) => ({
  ...(await orig<typeof import('../../src/main/import/importer')>()),
  runImport: (await import('../helpers/techWorkspace')).inProcessRunImport
}))

const OWN: Record<'2G' | '3G', { perf: string[]; cell: string; noPrb: true }> = {
  '2G': { perf: ['tch_congestion', 'sdcch_congestion', 'call_drop_rate_2g', 'call_setup_success_2g'], cell: 'tch_congestion', noPrb: true },
  '3G': { perf: ['call_drop_rate_3g', 'call_setup_success_3g', 'data_access_success_3g'], cell: 'call_setup_success_3g', noPrb: true }
}
const mentionsPrb = (s: unknown): boolean => /\bprb\b/i.test(String(s ?? ''))

for (const tech of ['2G', '3G'] as Technology[]) {
  describe(`a real ${tech} workspace`, () => {
    let ws: RealWorkspace
    let firstCellId = 0
    beforeAll(async () => {
      ws = await openTechWorkspace(tech)
      firstCellId = Number((await ws.conn.runAndReadAll(`SELECT min(cell_id) AS id FROM dim_cell`)).getRowObjects()[0].id)
    }, 180000)
    afterAll(async () => {
      await ws?.cleanup()
    })

    it('Performance Analysis shows its own KPIs and no PRB', async () => {
      const { getPerformance } = await import('../../src/main/services/queryService')
      const res = await getPerformance({ technology: tech })
      expect(res.technology).toBe(tech)
      const metrics = res.distributions.map((d) => d.metric)
      for (const k of OWN[tech as '2G'].perf) expect(metrics, k).toContain(k)
      expect(metrics).not.toContain('prb_utilization')
      for (const c of res.correlations) expect([c.a, c.b]).not.toContain('prb_utilization')
    })

    it('Cell Investigation evidence, hypotheses and peers never mention PRB', async () => {
      const { getInvestigation } = await import('../../src/main/services/investigationService')
      const res = await getInvestigation('cell', firstCellId, { technology: tech })
      expect(res).toBeTruthy()
      expect(res!.technology).toBe(tech)
      expect(res!.evidence.length).toBeGreaterThan(0)
      for (const e of res!.evidence) expect(mentionsPrb(e.metric) || mentionsPrb(e.label), `evidence ${e.metric}`).toBe(false)
      for (const h of res!.hypotheses) {
        expect(mentionsPrb(h.title), h.title).toBe(false)
        for (const s of h.supporting ?? []) expect(mentionsPrb(s), s).toBe(false)
      }
      for (const p of res!.peers) expect(mentionsPrb(p.primaryKpi), String(p.primaryKpi)).toBe(false)
    })

    it('Comparison Lab defaults to one of its own KPIs, never PRB', async () => {
      const { getComparison } = await import('../../src/main/services/queryService')
      const res = await getComparison({})
      expect(res.metric).toBe(COMPARE_METRICS[tech][0].metric)
      expect(mentionsPrb(res.metric), String(res.metric)).toBe(false)
      for (const k of res.kpis) expect(mentionsPrb(k.metric) || mentionsPrb(k.label), String(k.metric)).toBe(false)
    })

    it('Comparison Lab gives values for each of its own regulatory KPIs, by period and by region', async () => {
      const { getComparison } = await import('../../src/main/services/queryService')
      for (const m of COMPARE_METRICS[tech]) {
        const period = await getComparison({ metric: m.metric })
        const region = await getComparison({ type: 'region', metric: m.metric })
        if (!OWN[tech as '2G'].perf.includes(m.metric)) continue
        expect(period.metric, m.metric).toBe(m.metric)
        expect(period.rows.some((r) => r.current != null), `${m.metric} period rows`).toBe(true)
        expect(period.kpis.find((k) => k.metric === m.metric)?.current, `${m.metric} network`).not.toBeNull()
        expect(region.rows.some((r) => r.current != null), `${m.metric} region rows`).toBe(true)
        expect(region.kpis.find((k) => k.metric === m.metric)?.best, `${m.metric} region best`).not.toBeNull()
      }
    })

    it('Comparison Lab answers every metric at every grain, by period and by region', async () => {
      const { getComparison } = await import('../../src/main/services/queryService')
      for (const grain of ['daily', 'weekly', 'monthly'] as const) {
        for (const type of ['period', 'region'] as const) {
          for (const m of COMPARE_METRICS[tech]) {
            await expect(getComparison({ grain, type, metric: m.metric }), `${grain} ${type} ${m.metric}`).resolves.toBeTruthy()
          }
        }
      }
    })

    it('Comparison Lab answers an unknown metric id with its own first KPI instead of failing', async () => {
      const { getComparison } = await import('../../src/main/services/queryService')
      const res = await getComparison({ metric: tech === '2G' ? 'cssr_2g' : 'cssr_3g' })
      expect(res.metric).toBe(COMPARE_METRICS[tech][0].metric)
    })

    it('Cell Intelligence rows carry its own KPIs and no PRB', async () => {
      const { getCellIntelligence } = await import('../../src/main/services/queryService')
      const res = await getCellIntelligence({ technology: tech, limit: 10 })
      expect(res.rows.length).toBeGreaterThan(0)
      const keys = res.rows.flatMap((r) => r.kpis.map((k) => k.key))
      expect(keys).toContain(OWN[tech as '2G'].cell)
      expect(keys).not.toContain('prb_utilization')
    })

    it('report tables and the executive recommendations never mention PRB', async () => {
      const { generateReportPack } = await import('../../src/main/services/reportingService')
      const { getExecutiveOverview } = await import('../../src/main/services/queryService')
      const { REPORT_SECTIONS } = await import('../../shared/api')
      const pack = await generateReportPack({ sections: REPORT_SECTIONS.map((x) => x.id), formats: ['md'] })
      const md = pack.files.md?.content ?? ''
      expect(md.length).toBeGreaterThan(0)
      expect(md.split('\n').filter(mentionsPrb), 'report markdown lines').toEqual([])
      // the slide deck and the HTML page carry their own text
      const files = await generateReportPack({ sections: ['executive-summary', 'priority-queue'], formats: ['html', 'pptx'] })
      expect((files.files.html?.content ?? '').split('\n').filter(mentionsPrb), 'report html lines').toEqual([])
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(readFileSync(files.files.pptx!.path))
      const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      expect(slides.length).toBeGreaterThan(0)
      for (const f of slides) {
        const text = [...(await zip.file(f)!.async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => x[1])
        expect(text.filter(mentionsPrb), f).toEqual([])
      }
      const exec = await getExecutiveOverview()
      for (const r of exec.problemSummary.keyRecommendations) expect(mentionsPrb(r), r).toBe(false)
    })
  })
}

describe('a real 4G workspace', () => {
  let ws: RealWorkspace
  beforeAll(async () => {
    ws = await openTechWorkspace('4G')
  }, 180000)
  afterAll(async () => {
    await ws?.cleanup()
  })

  it('Performance Analysis and Comparison Lab use PRB, the 4G capacity KPI', async () => {
    const { getPerformance, getComparison } = await import('../../src/main/services/queryService')
    const perf = await getPerformance({ technology: '4G' })
    expect(perf.distributions.map((d) => d.metric)).toContain('prb_utilization')
    const cmp = await getComparison({ technology: '4G' })
    expect(mentionsPrb(cmp.metric) || cmp.kpis.some((k) => mentionsPrb(k.metric))).toBe(true)
  })

  it('Cell Investigation shows PRB evidence in 4G', async () => {
    const { getInvestigation } = await import('../../src/main/services/investigationService')
    const id = Number((await ws.conn.runAndReadAll(`SELECT min(cell_id) AS id FROM dim_cell`)).getRowObjects()[0].id)
    const res = await getInvestigation('cell', id, { technology: '4G' })
    expect(res!.evidence.some((e) => mentionsPrb(e.metric) || mentionsPrb(e.label))).toBe(true)
  })
})
