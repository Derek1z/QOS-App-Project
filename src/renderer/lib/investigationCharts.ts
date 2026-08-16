import type { EChartsOption, SeriesOption } from 'echarts'
import type { InvestigationResult } from '../../../shared/api'
import { PALETTE, tooltipStyle, axisLabelStyle } from './Chart'
import { weekLabel } from './overviewCharts'

/** Actual-metrics strip (spec §33, §47): PRB / Throughput / Users / Volume /
 *  Availability on shared week axes, with the intervention week marked. */
export function investigationChartOption(res: InvestigationResult, prbThreshold: number): EChartsOption {
  const weeks = res.weeks.map((w) => weekLabel(w.weekStart))
  const grids = [0, 1, 2, 3, 4].map((i) => ({
    left: 64,
    right: 30,
    top: i * 108 + 6,
    height: 88
  }))
  const xAxis = [0, 1, 2, 3, 4].map((i) => ({
    type: 'category' as const,
    gridIndex: i,
    data: weeks,
    axisLabel: i === 4 ? axisLabelStyle() : { show: false },
    axisLine: { lineStyle: { color: PALETTE.border } },
    axisTick: { show: i === 4 }
  }))
  const yAxis = [
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
      axisLabel: { ...axisLabelStyle(), formatter: (v: number) => `${Math.round(v / 1024)}M` },
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
    },
    {
      gridIndex: 4,
      type: 'value' as const,
      min: 98,
      max: 100,
      axisLabel: { ...axisLabelStyle(), formatter: '{value}%' },
      splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
    }
  ]
  const interventionIdx = res.interventionWeek ? res.weeks.findIndex((w) => w.weekStart === res.interventionWeek) : -1
  const interventionMark = interventionIdx >= 0
    ? {
        silent: true,
        symbol: 'none',
        label: { color: PALETTE.warn, fontSize: 10, formatter: 'intervention' },
        lineStyle: { type: 'dashed' as const, color: PALETTE.warn, width: 1 },
        data: [{ xAxis: interventionIdx }]
      }
    : undefined

  const series: SeriesOption[] = [
    {
      name: 'PRB utilization',
      type: 'line' as const,
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: res.weeks.map((w) => w.prbAvg),
      smooth: 0.25,
      symbol: 'circle',
      symbolSize: 5,
      lineStyle: { color: PALETTE.warn, width: 2 },
      itemStyle: { color: PALETTE.warn },
      areaStyle: { color: 'rgba(251,191,36,0.12)' },
      markLine: interventionMark
        ? {
            ...interventionMark,
            data: [
              ...(interventionMark.data ?? []),
              { yAxis: prbThreshold, lineStyle: { type: 'dashed' as const, color: PALETTE.danger, width: 1 } }
            ]
          }
        : {
            silent: true,
            symbol: 'none',
            label: { formatter: `threshold {c}%`, color: PALETTE.danger, fontSize: 10 },
            lineStyle: { type: 'dashed' as const, color: PALETTE.danger, width: 1 },
            data: [{ yAxis: prbThreshold }]
          }
    },
    {
      name: 'DL throughput',
      type: 'line' as const,
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: res.weeks.map((w) => w.throughputKbps),
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
      data: res.weeks.map((w) => w.users),
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
      data: res.weeks.map((w) => w.volumeMb),
      smooth: 0.25,
      symbol: 'circle',
      symbolSize: 5,
      lineStyle: { color: PALETTE.text, width: 2 },
      itemStyle: { color: PALETTE.text }
    },
    {
      name: 'Availability',
      type: 'line' as const,
      xAxisIndex: 4,
      yAxisIndex: 4,
      data: res.weeks.map((w) => w.availability),
      smooth: 0.25,
      symbol: 'circle',
      symbolSize: 5,
      lineStyle: { color: PALETTE.accent, width: 2 },
      itemStyle: { color: PALETTE.accent }
    }
  ]

  return {
    backgroundColor: 'transparent',
    grid: grids,
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any) => {
        const arr = Array.isArray(params) ? params : [params]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const idx = Number((arr[0] as any)?.dataIndex ?? 0)
        const w = res.weeks[idx]
        if (!w) return ''
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lines = arr.map((p: any) => {
          const v = Number(p.value)
          const name = String(p.seriesName ?? '')
          if (name === 'PRB utilization') return `${p.marker ?? ''}${name}: <b>${v}%</b>`
          if (name === 'DL throughput') return `${p.marker ?? ''}${name}: <b>${(v / 1024).toFixed(1)} Mbps</b>`
          if (name === 'Data volume') return `${p.marker ?? ''}${name}: <b>${(v / 1024).toFixed(1)} GB</b>`
          if (name === 'Availability') return `${p.marker ?? ''}${name}: <b>${v.toFixed(1)}%</b>`
          return `${p.marker ?? ''}${name}: <b>${Math.round(v)}</b>`
        })
        const state = w.isNc ? `${w.lifecycle ?? 'NC'}` : w.lifecycle ?? 'OK'
        return [
          `<b>${w.weekStart} (${weeks[idx]})</b>`,
          `State: ${state}`,
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
