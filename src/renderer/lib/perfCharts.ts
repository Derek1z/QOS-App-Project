import type { EChartsOption } from 'echarts'
import type { MetricDistribution, PerformanceResult, ScatterPoint } from '../../../shared/api'
import { PALETTE, tooltipStyle, axisLabelStyle } from './Chart'

export interface DynamicQuadrant {
  id: string
  label: string
  color: string
}

export const QUADRANTS: Array<{ id: string; label: string; color: string }> = [
  { id: 'critical', label: 'Dual Breach · Both Impaired', color: PALETTE.danger },
  { id: 'x_impaired', label: 'X-Metric Impaired', color: PALETTE.warn },
  { id: 'y_impaired', label: 'Y-Metric Impaired', color: PALETTE.accent },
  { id: 'optimal', label: 'Optimal · Dual Compliant', color: PALETTE.green }
]

/** Render a metric value with the unit the UI actually shows (Mbps / GB / %). */
export function formatMetric(d: { metric?: string; unit?: string; label?: string }, v: number | null): string {
  if (v == null) return '—'
  if (d.unit === 'kbps') {
    return v >= 1000 ? `${(v / 1000).toFixed(1)} Mbps` : `${Math.round(v)} kbps`
  }
  if (d.unit === 'MB' || d.metric === 'volume') {
    return v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${Math.round(v)} MB`
  }
  if (d.unit === '%') return `${v.toFixed(1)}%`
  return `${Math.round(v).toLocaleString()}${d.unit ? ` ${d.unit}` : ''}`
}

export function formatMetricVal(val: number | null, unit = '', metricKey = ''): string {
  if (val == null) return '—'
  if (unit === 'kbps' || metricKey.includes('throughput') || metricKey.includes('speed')) {
    return val >= 1000 ? `${(val / 1000).toFixed(1)} Mbps` : `${Math.round(val)} kbps`
  }
  if (unit === 'MB' || metricKey.includes('volume')) {
    return val >= 1024 ? `${(val / 1024).toFixed(1)} GB` : `${Math.round(val)} MB`
  }
  if (unit === '%') return `${val.toFixed(1)}%`
  return `${Number(val.toFixed(1)).toLocaleString()}${unit ? ` ${unit}` : ''}`
}

/** Percentile curve for one metric: p0 → p100 with P50/P90 threshold marks. */
export function distributionOption(d: MetricDistribution): EChartsOption {
  const markLineData: Array<{ xAxis?: number; yAxis?: number; name: string; lineStyle: { color: string; type: 'dashed' | 'solid' } }> = [
    { xAxis: 10, name: `P50 ${formatMetric(d, d.p50)}`, lineStyle: { color: PALETTE.green, type: 'dashed' } },
    { xAxis: 18, name: `P90 ${formatMetric(d, d.p90)}`, lineStyle: { color: PALETTE.danger, type: 'dashed' } }
  ]
  if (d.target != null) {
    markLineData.push({
      yAxis: d.target,
      name: `Target (${d.target}${d.unit || ''})`,
      lineStyle: { color: '#f59e0b', type: 'solid' }
    })
  }

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
          `Cells in period: ${d.n.toLocaleString()}`
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
          data: markLineData
        }
      }
    ]
  }
}

export interface MetricMeta {
  id: string
  label: string
  unit: string
  target?: number | null
  worseIsHigher?: boolean
}

/** Configurable Multi-KPI scatter plot with dynamic 4-quadrant thresholds */
export function configurableScatterOption(
  cells: ScatterPoint[],
  xMeta: MetricMeta,
  yMeta: MetricMeta
): { option: EChartsOption; quadrantCounts: Record<string, number>; quadrants: DynamicQuadrant[] } {
  // Extract values
  const getVal = (c: ScatterPoint, m: MetricMeta): number | null => {
    if (c.kpis && c.kpis[m.id] !== undefined) return c.kpis[m.id]
    if (m.id === 'prb' || m.id === 'prb_utilization') return c.prb
    if (m.id === 'throughput' || m.id === 'dl_throughput') return c.throughputKbps
    if (m.id === 'users' || m.id === 'connected_users') return c.users
    return null
  }

  const validCells: Array<{ cell: ScatterPoint; x: number; y: number }> = []
  for (const c of cells) {
    const vx = getVal(c, xMeta)
    const vy = getVal(c, yMeta)
    if (vx != null && vy != null) {
      validCells.push({ cell: c, x: vx, y: vy })
    }
  }

  // Calculate median thresholds if target not explicitly provided
  const sortedX = [...validCells].map((p) => p.x).sort((a, b) => a - b)
  const sortedY = [...validCells].map((p) => p.y).sort((a, b) => a - b)
  const medX = sortedX.length > 0 ? sortedX[Math.floor(sortedX.length / 2)] : 0
  const medY = sortedY.length > 0 ? sortedY[Math.floor(sortedY.length / 2)] : 0

  const threshX = xMeta.target != null ? xMeta.target : medX
  const threshY = yMeta.target != null ? yMeta.target : medY

  const isXBreached = (val: number): boolean => {
    return xMeta.worseIsHigher ? val > threshX : val < threshX
  }
  const isYBreached = (val: number): boolean => {
    return yMeta.worseIsHigher ? val > threshY : val < threshY
  }

  const quadrants: DynamicQuadrant[] = [
    {
      id: 'critical',
      label: `Dual Breach · ${xMeta.label} ${xMeta.worseIsHigher ? '↑' : '↓'} & ${yMeta.label} ${yMeta.worseIsHigher ? '↑' : '↓'}`,
      color: PALETTE.danger
    },
    {
      id: 'x_impaired',
      label: `${xMeta.label} Impaired · ${yMeta.label} OK`,
      color: PALETTE.warn
    },
    {
      id: 'y_impaired',
      label: `${xMeta.label} OK · ${yMeta.label} Impaired`,
      color: PALETTE.accent
    },
    {
      id: 'optimal',
      label: `Optimal · Dual Compliant`,
      color: PALETTE.green
    }
  ]

  const byQuadrant = new Map<string, Array<{ value: [number, number]; cell: ScatterPoint }>>()
  for (const q of quadrants) byQuadrant.set(q.id, [])

  const quadrantCounts: Record<string, number> = {
    critical: 0,
    x_impaired: 0,
    y_impaired: 0,
    optimal: 0
  }

  for (const p of validCells) {
    const xBad = isXBreached(p.x)
    const yBad = isYBreached(p.y)
    let qId = 'optimal'
    if (xBad && yBad) qId = 'critical'
    else if (xBad && !yBad) qId = 'x_impaired'
    else if (!xBad && yBad) qId = 'y_impaired'

    quadrantCounts[qId] = (quadrantCounts[qId] ?? 0) + 1
    byQuadrant.get(qId)?.push({ value: [p.x, p.y], cell: p.cell })
  }

  const firstWithData = quadrants.find((q) => (byQuadrant.get(q.id)?.length ?? 0) > 0)

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    grid: { left: 72, right: 32, top: 44, bottom: 48 },
    legend: {
      data: quadrants.map((q) => q.label),
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
        const valX = (params?.data as any)?.value?.[0]
        const valY = (params?.data as any)?.value?.[1]
        return [
          `<b>${cell.cellName}</b> (${cell.site ?? '—'})`,
          `${cell.district ?? '—'}, ${cell.region ?? '—'}`,
          `${xMeta.label}: <b>${formatMetricVal(valX, xMeta.unit, xMeta.id)}</b>`,
          `${yMeta.label}: <b>${formatMetricVal(valY, yMeta.unit, yMeta.id)}</b>`,
          `State: <b>${cell.isNc ? '⚠ Non-Compliant' : '✓ Compliant'}</b>`
        ].join('<br/>')
      }
    },
    xAxis: {
      type: 'value',
      name: `${xMeta.label}${xMeta.unit ? ` (${xMeta.unit})` : ''}`,
      nameTextStyle: { color: PALETTE.dim, fontSize: 11 },
      axisLabel: { ...axisLabelStyle(), formatter: xMeta.unit === '%' ? '{value}%' : '{value}' },
      splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
    },
    yAxis: {
      type: 'value',
      name: `${yMeta.label}${yMeta.unit ? ` (${yMeta.unit})` : ''}`,
      nameTextStyle: { color: PALETTE.dim, fontSize: 11 },
      axisLabel: { ...axisLabelStyle(), formatter: yMeta.unit === '%' ? '{value}%' : '{value}' },
      splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
    },
    series: quadrants.map((q) => ({
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
                {
                  xAxis: threshX,
                  name: `${xMeta.label} Threshold (${threshX}${xMeta.unit || ''})`,
                  lineStyle: { color: xMeta.worseIsHigher ? PALETTE.danger : PALETTE.green }
                },
                {
                  yAxis: threshY,
                  name: `${yMeta.label} Threshold (${threshY}${yMeta.unit || ''})`,
                  lineStyle: { color: yMeta.worseIsHigher ? PALETTE.danger : PALETTE.green }
                }
              ]
            }
          : undefined
    }))
  }

  return { option, quadrantCounts, quadrants }
}

/** Legacy scatter option fallback */
export function scatterOption(p: PerformanceResult): EChartsOption {
  const xMeta: MetricMeta = { id: 'prb', label: 'PRB Utilization', unit: '%', target: p.prbThreshold, worseIsHigher: true }
  const yMeta: MetricMeta = { id: 'throughput', label: 'DL Throughput', unit: 'kbps', target: p.throughputMedianKbps, worseIsHigher: false }
  return configurableScatterOption(p.scatter, xMeta, yMeta).option
}

