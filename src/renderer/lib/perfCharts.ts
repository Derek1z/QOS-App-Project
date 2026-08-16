import type { EChartsOption } from 'echarts'
import type { MetricDistribution, PerformanceResult, ScatterPoint } from '../../../shared/api'
import { PALETTE, tooltipStyle, axisLabelStyle } from './Chart'

export const QUADRANTS: Array<{ id: ScatterPoint['quadrant']; label: string; color: string }> = [
  { id: 'congested', label: 'Congested · PRB↑ speed↓', color: PALETTE.danger },
  { id: 'busy', label: 'Busy · PRB↑ speed↑', color: PALETTE.warn },
  { id: 'quiet', label: 'Quiet · PRB↓ speed↓', color: PALETTE.accent },
  { id: 'healthy', label: 'Healthy · PRB↓ speed↑', color: PALETTE.green }
]

/** Render a metric value with the unit the UI actually shows (Mbps / GB / %). */
export function formatMetric(d: MetricDistribution, v: number | null): string {
  if (v == null) return '—'
  if (d.metric === 'throughput') return `${(v / 1024).toFixed(1)} Mbps`
  if (d.metric === 'volume') return `${(v / 1024).toFixed(1)} GB`
  if (d.unit === '%') return `${v.toFixed(1)}%`
  return Math.round(v).toLocaleString()
}

/** Percentile curve for one metric: p0 → p100 with P50/P90 threshold marks. */
export function distributionOption(d: MetricDistribution): EChartsOption {
  return {
    backgroundColor: 'transparent',
    grid: { left: 64, right: 24, top: 34, bottom: 32 },
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any) => {
        const arr = Array.isArray(params) ? params : [params]
        const idx = Number(arr[0]?.dataIndex ?? 0)
        const pt = d.points[idx]
        if (!pt) return ''
        const band =
          pt.p >= 90 ? 'worst 10% of cells' : pt.p >= 50 ? 'above median' : pt.p >= 25 ? 'below median' : 'best quarter'
        return [
          `<b>P${pt.p}</b>`,
          `${d.label}: <b>${formatMetric(d, pt.value)}</b>`,
          `Band: ${band}`,
          `Cells in week: ${d.n.toLocaleString()}`
        ].join('<br/>')
      }
    },
    xAxis: {
      type: 'category',
      data: d.points.map((p) => `P${p.p}`),
      axisLabel: { ...axisLabelStyle(), interval: 4 },
      axisLine: { lineStyle: { color: PALETTE.border } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLabel: axisLabelStyle(),
      splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
    },
    series: [
      {
        name: d.label,
        type: 'line',
        smooth: 0.3,
        symbol: 'none',
        data: d.points.map((p) => p.value),
        lineStyle: { color: PALETTE.accent, width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(56,189,248,0.22)' },
              { offset: 1, color: 'rgba(56,189,248,0.02)' }
            ]
          }
        },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { color: PALETTE.dim, fontSize: 10, formatter: '{b}' },
          lineStyle: { type: 'dashed', width: 1 },
          data: [
            { xAxis: 10, name: `P50 ${formatMetric(d, d.p50)}`, lineStyle: { color: PALETTE.green } },
            { xAxis: 18, name: `P90 ${formatMetric(d, d.p90)}`, lineStyle: { color: PALETTE.danger } }
          ]
        }
      }
    ]
  }
}

/** PRB-vs-throughput scatter split into engineering-band quadrants (§40). */
export function scatterOption(p: PerformanceResult): EChartsOption {
  const byQuadrant = new Map<string, Array<{ value: [number, number]; cell: ScatterPoint }>>()
  for (const q of QUADRANTS) byQuadrant.set(q.id, [])
  for (const s of p.scatter) {
    if (s.prb == null || s.throughputKbps == null) continue
    byQuadrant.get(s.quadrant)?.push({ value: [s.prb, s.throughputKbps / 1024], cell: s })
  }
  const medianMbps = p.throughputMedianKbps == null ? null : p.throughputMedianKbps / 1024
  // draw the threshold marks on the first quadrant series that has points
  const firstWithData = QUADRANTS.find((q) => (byQuadrant.get(q.id)?.length ?? 0) > 0)

  return {
    backgroundColor: 'transparent',
    grid: { left: 72, right: 28, top: 42, bottom: 46 },
    legend: {
      data: QUADRANTS.map((q) => q.label),
      top: 4,
      textStyle: { color: PALETTE.dim, fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8
    },
    tooltip: {
      trigger: 'item',
      ...tooltipStyle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cell = (params?.data as any)?.cell as ScatterPoint | undefined
        if (!cell) return ''
        return [
          `<b>${cell.cellName}</b>`,
          cell.district ?? '—',
          `PRB: <b>${(cell.prb ?? 0).toFixed(1)}%</b>`,
          `Speed: <b>${((cell.throughputKbps ?? 0) / 1024).toFixed(1)} Mbps</b>`,
          `Users: <b>${(cell.users ?? 0).toLocaleString()}</b>`,
          `State: <b>${cell.isNc ? 'NC' : 'OK'}</b>`
        ].join('<br/>')
      }
    },
    xAxis: {
      type: 'value',
      name: 'PRB utilization (%)',
      nameTextStyle: { color: PALETTE.dim, fontSize: 11 },
      min: 0,
      max: 100,
      axisLabel: { ...axisLabelStyle(), formatter: '{value}%' },
      splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
    },
    yAxis: {
      type: 'value',
      name: 'DL throughput (Mbps)',
      nameTextStyle: { color: PALETTE.dim, fontSize: 11 },
      axisLabel: axisLabelStyle(),
      splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
    },
    series: QUADRANTS.map((q, i) => ({
      name: q.label,
      type: 'scatter' as const,
      data: byQuadrant.get(q.id) ?? [],
      symbolSize: 8,
      itemStyle: { color: q.color, opacity: 0.85 },
      emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 1 } },
      markLine:
        firstWithData && q.id === firstWithData.id
          ? {
              silent: true,
              symbol: 'none',
              label: { color: PALETTE.dim, fontSize: 10, formatter: '{b}' },
              lineStyle: { type: 'dashed', width: 1 },
              data: [
                { xAxis: p.prbThreshold, name: `PRB threshold ${p.prbThreshold}%`, lineStyle: { color: PALETTE.danger } },
                ...(medianMbps != null
                  ? [{ yAxis: medianMbps, name: 'Median speed', lineStyle: { color: PALETTE.accent } }]
                  : [])
              ]
            }
          : undefined
    }))
  }
}
