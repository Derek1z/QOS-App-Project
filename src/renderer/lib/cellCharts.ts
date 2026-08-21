import type { EChartsOption, SeriesOption } from 'echarts'
import type { CellDetail, Grain, Technology } from '../../../shared/api'
import { PALETTE, tooltipStyle, axisLabelStyle } from './Chart'
import { formatTimeLabel } from './overviewCharts'

/** Aligned multi-grid layout (spec §68): Technology-specific core KPIs on
 *  shared axes with linked cursors — one chart instance, four grids. */
export function cellDetailOption(
  detail: CellDetail,
  prbThreshold: number,
  grain: Grain = 'weekly',
  technology: Technology = '4G'
): EChartsOption {
  const timeLabels = detail.weeks.map((w) => formatTimeLabel(w.weekStart, grain))
  const grids = [0, 1, 2, 3].map((i) => ({
    left: 64,
    right: 30,
    top: i * 118 + 6,
    height: 96
  }))
  const xAxis = [0, 1, 2, 3].map((i) => ({
    type: 'category' as const,
    gridIndex: i,
    data: timeLabels,
    axisLabel: i === 3 ? axisLabelStyle() : { show: false },
    axisLine: { lineStyle: { color: PALETTE.border } },
    axisTick: { show: i === 3 }
  }))

  const is4G = technology === '4G'
  const is3G = technology === '3G'

  const yAxis = is4G
    ? [
        {
          gridIndex: 0,
          type: 'value' as const,
          min: 0,
          max: 100,
          axisLabel: { ...axisLabelStyle(), formatter: '{value}%' },
          splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
        },
        {
          gridIndex: 1,
          type: 'value' as const,
          axisLabel: { ...axisLabelStyle(), formatter: (v: number) => `${(v / 1024).toFixed(1)}M` },
          splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
        },
        {
          gridIndex: 2,
          type: 'value' as const,
          axisLabel: axisLabelStyle(),
          splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
        },
        {
          gridIndex: 3,
          type: 'value' as const,
          axisLabel: { ...axisLabelStyle(), formatter: (v: number) => `${Math.round(v / 1024)}G` },
          splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
        }
      ]
    : is3G
    ? [
        {
          gridIndex: 0,
          type: 'value' as const,
          min: 0,
          max: 100,
          axisLabel: { ...axisLabelStyle(), formatter: '{value}%' },
          splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
        },
        {
          gridIndex: 1,
          type: 'value' as const,
          axisLabel: { ...axisLabelStyle(), formatter: (v: number) => `${(v / 1024).toFixed(1)}M` },
          splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
        },
        {
          gridIndex: 2,
          type: 'value' as const,
          min: 0,
          max: 100,
          axisLabel: { ...axisLabelStyle(), formatter: '{value}%' },
          splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
        },
        {
          gridIndex: 3,
          type: 'value' as const,
          axisLabel: axisLabelStyle(),
          splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
        }
      ]
    : [
        // 2G
        {
          gridIndex: 0,
          type: 'value' as const,
          min: 0,
          max: 100,
          axisLabel: { ...axisLabelStyle(), formatter: '{value}%' },
          splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
        },
        {
          gridIndex: 1,
          type: 'value' as const,
          axisLabel: { ...axisLabelStyle(), formatter: (v: number) => `${(v / 1024).toFixed(1)}M` },
          splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
        },
        {
          gridIndex: 2,
          type: 'value' as const,
          min: 0,
          max: 100,
          axisLabel: { ...axisLabelStyle(), formatter: '{value}%' },
          splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
        },
        {
          gridIndex: 3,
          type: 'value' as const,
          axisLabel: axisLabelStyle(),
          splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
        }
      ]

  const series: SeriesOption[] = is4G
    ? [
        {
          name: 'PRB utilization',
          type: 'line' as const,
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: detail.weeks.map((w) => w.prbAvg),
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: PALETTE.warn, width: 2 },
          itemStyle: { color: PALETTE.warn },
          areaStyle: { color: 'rgba(251,191,36,0.12)' },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { formatter: `threshold {c}%`, color: PALETTE.danger, fontSize: 10 },
            lineStyle: { type: 'dashed', color: PALETTE.danger, width: 1 },
            data: [{ yAxis: prbThreshold }]
          }
        },
        {
          name: 'DL throughput',
          type: 'line' as const,
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: detail.weeks.map((w) => w.throughputKbps),
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: PALETTE.accent, width: 2 },
          itemStyle: { color: PALETTE.accent }
        },
        {
          name: 'Connected users',
          type: 'line' as const,
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: detail.weeks.map((w) => w.users),
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: PALETTE.green, width: 2 },
          itemStyle: { color: PALETTE.green }
        },
        {
          name: 'Data volume',
          type: 'line' as const,
          xAxisIndex: 3,
          yAxisIndex: 3,
          data: detail.weeks.map((w) => w.volumeMb),
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: PALETTE.text, width: 2 },
          itemStyle: { color: PALETTE.text }
        }
      ]
    : is3G
    ? [
        {
          name: '3G Traffic Utilization',
          type: 'line' as const,
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: detail.weeks.map((w) => w.prbAvg),
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: PALETTE.warn, width: 2 },
          itemStyle: { color: PALETTE.warn },
          areaStyle: { color: 'rgba(251,191,36,0.12)' },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { formatter: `threshold {c}%`, color: PALETTE.danger, fontSize: 10 },
            lineStyle: { type: 'dashed', color: PALETTE.danger, width: 1 },
            data: [{ yAxis: prbThreshold }]
          }
        },
        {
          name: 'HSDPA Throughput',
          type: 'line' as const,
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: detail.weeks.map((w) => w.throughputKbps),
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: PALETTE.accent, width: 2 },
          itemStyle: { color: PALETTE.accent }
        },
        {
          name: 'Cell Availability',
          type: 'line' as const,
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: detail.weeks.map((w) => w.availability),
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: PALETTE.green, width: 2 },
          itemStyle: { color: PALETTE.green }
        },
        {
          name: 'Breach Days',
          type: 'line' as const,
          xAxisIndex: 3,
          yAxisIndex: 3,
          data: detail.weeks.map((w) => w.breachDays),
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: PALETTE.danger, width: 2 },
          itemStyle: { color: PALETTE.danger }
        }
      ]
    : [
        // 2G
        {
          name: 'TCH Congestion',
          type: 'line' as const,
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: detail.weeks.map((w) => w.prbAvg),
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: PALETTE.warn, width: 2 },
          itemStyle: { color: PALETTE.warn },
          areaStyle: { color: 'rgba(251,191,36,0.12)' },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { formatter: `threshold {c}%`, color: PALETTE.danger, fontSize: 10 },
            lineStyle: { type: 'dashed', color: PALETTE.danger, width: 1 },
            data: [{ yAxis: prbThreshold }]
          }
        },
        {
          name: 'GPRS/EDGE Throughput',
          type: 'line' as const,
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: detail.weeks.map((w) => w.throughputKbps),
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: PALETTE.accent, width: 2 },
          itemStyle: { color: PALETTE.accent }
        },
        {
          name: 'TCH Availability',
          type: 'line' as const,
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: detail.weeks.map((w) => w.availability),
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: PALETTE.green, width: 2 },
          itemStyle: { color: PALETTE.green }
        },
        {
          name: 'Breach Days',
          type: 'line' as const,
          xAxisIndex: 3,
          yAxisIndex: 3,
          data: detail.weeks.map((w) => w.breachDays),
          smooth: 0.25,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: PALETTE.danger, width: 2 },
          itemStyle: { color: PALETTE.danger }
        }
      ]

  return {
    backgroundColor: 'transparent',
    grid: grids,
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle(),
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const idx = Number((arr[0] as any)?.dataIndex ?? 0)
        const w = detail.weeks[idx]
        if (!w) return ''
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lines = arr.map((p: any) => {
          const v = Number(p.value)
          const name = String(p.seriesName ?? '')
          if (name.includes('utilization') || name.includes('Utilization') || name.includes('Congestion') || name.includes('Availability')) {
            return `${p.marker ?? ''}${name}: <b>${v.toFixed(1)}%</b>`
          }
          if (name.includes('throughput') || name.includes('Throughput')) {
            return `${p.marker ?? ''}${name}: <b>${(v / 1024).toFixed(1)} Mbps</b>`
          }
          if (name === 'Data volume') {
            return `${p.marker ?? ''}${name}: <b>${(v / 1024).toFixed(1)} GB</b>`
          }
          return `${p.marker ?? ''}${name}: <b>${Math.round(v)}</b>`
        })
        const state = w.isNc ? `${w.lifecycle} · ${w.severity}` : w.lifecycle
        const labelPrefix = grain === 'daily' ? 'Day' : grain === 'monthly' ? 'Month' : 'Week'
        return [
          `<b>${labelPrefix}: ${w.weekStart} (${timeLabels[idx]})</b>`,
          `Classification: ${state}`,
          grain === 'daily' ? `Breach status: ${w.isNc ? 'Non-Compliant' : 'Compliant'}` : `Breach days: ${w.breachDays}`,
          ...lines
        ].join('<br/>')
      }
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    xAxis,
    yAxis,
    series
  }
}

