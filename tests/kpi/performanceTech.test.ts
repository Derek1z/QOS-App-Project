import { describe, it, expect } from 'vitest'
import { previewApi } from '../../src/renderer/lib/previewApi'

describe('Performance Analysis Multi-Technology Decoupling', () => {
  it('generates 2G-specific metrics, correlations, and scatter points for 2G', async () => {
    const res = await previewApi.analytics.performance({ technology: '2G' })
    expect(res).toBeDefined()
    expect(res.technology).toBe('2G')
    
    // Check metric distributions
    const metricKeys = res.distributions.map(d => d.metric)
    expect(metricKeys).toContain('tch_congestion')
    expect(metricKeys).toContain('sdcch_congestion')
    expect(metricKeys).toContain('call_drop_rate_2g')
    expect(metricKeys).toContain('call_setup_success_2g')
    expect(metricKeys).toContain('gprs_throughput')
    expect(metricKeys).not.toContain('prb_utilization')

    // Check correlation pairs
    const pairKeys = res.correlations.map(c => `${c.a}:${c.b}`)
    expect(pairKeys).toContain('tch_congestion:call_drop_rate_2g')
    expect(pairKeys).toContain('sdcch_congestion:call_setup_success_2g')
  })

  it('generates 3G-specific metrics, correlations, and scatter points for 3G', async () => {
    const res = await previewApi.analytics.performance({ technology: '3G' })
    expect(res).toBeDefined()
    expect(res.technology).toBe('3G')

    const metricKeys = res.distributions.map(d => d.metric)
    expect(metricKeys).toContain('peak_hour_traffic_utilization_3g')
    expect(metricKeys).toContain('ce_utilization')
    expect(metricKeys).toContain('call_drop_rate_3g')
    expect(metricKeys).toContain('hsdpa_throughput')
    expect(metricKeys).not.toContain('prb_utilization')

    const pairKeys = res.correlations.map(c => `${c.a}:${c.b}`)
    expect(pairKeys).toContain('peak_hour_traffic_utilization_3g:call_drop_rate_3g')
    expect(pairKeys).toContain('ce_utilization:call_drop_rate_3g')
  })

  it('generates 4G-specific metrics, correlations, and scatter points for 4G', async () => {
    const res = await previewApi.analytics.performance({ technology: '4G' })
    expect(res).toBeDefined()
    expect(res.technology).toBe('4G')

    const metricKeys = res.distributions.map(d => d.metric)
    expect(metricKeys).toContain('prb_utilization')
    expect(metricKeys).toContain('call_drop_rate_4g')
    expect(metricKeys).toContain('call_setup_success_4g')
    expect(metricKeys).toContain('dl_throughput')
    expect(metricKeys).not.toContain('tch_congestion')

    const pairKeys = res.correlations.map(c => `${c.a}:${c.b}`)
    expect(pairKeys).toContain('prb_utilization:dl_throughput')
    expect(pairKeys).toContain('prb_utilization:connected_users')
  })
})
