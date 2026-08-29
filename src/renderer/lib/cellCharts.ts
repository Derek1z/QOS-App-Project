import type { EChartsOption, SeriesOption } from 'echarts'
import type { CellDetail, Grain, Technology } from '../../../shared/api'
import { PALETTE, tooltipStyle, axisLabelStyle } from './Chart'
import { formatTimeLabel } from './overviewCharts'

import type { CellKpiValue } from '../../../shared/api'

const COLOR_CYCLES = [PALETTE.warn, PALETTE.accent, PALETTE.green, '#a855f7']

function resolveKpiSeriesData(detail: CellDetail, key: string): (number | null)[] {
  const k = key.toLowerCase()
  if (k === 'prb_utilization' || k === 'prb') return detail.weeks.map((w) => w.prbAvg)
  if (k === 'dl_throughput_kbps' || k === 'throughput' || k === 'hsdpa_throughput') return detail.weeks.map((w) => w.throughputKbps)
  if (k === 'data_volume_mb' || k === 'volume') return detail.weeks.map((w) => w.volumeMb)
  if (k === 'availability_pct' || k === 'availability') return detail.weeks.map((w) => w.availability)
  
  if (detail.extraKpiTrends) {
    if (detail.extraKpiTrends[key]) return detail.extraKpiTrends[key]
    const matched = Object.keys(detail.extraKpiTrends).find(
      (ek) => ek.toLowerCase() === k || ek.toLowerCase().includes(k) || k.includes(ek.toLowerCase())
    )
    if (matched) return detail.extraKpiTrends[matched]
  }
  return detail.weeks.map(() => null)
}

/** Aligned multi-grid layout (spec §68): Core KPIs or dynamic active KPI cards
 *  on shared axes with linked cursors — one chart instance, four grids. */
export function cellDetailOption(
  detail: CellDetail,
  prbThreshold: number,
  grain: Grain = 'weekly',
  technology: Technology = '4G',
  activeKpis?: CellKpiValue[]
): EChartsOption {
  const timeLabels = detail.weeks.map((w) => formatTimeLabel(w.weekStart, grain))

  const selectedCards = activeKpis && activeKpis.length > 0 ? activeKpis.slice(0, 4) : null
  const gridCount = selectedCards ? Math.min(4, Math.max(1, selectedCards.length)) : 4

  const grids = Array.from({ length: gridCount }, (_, i) => ({
    left: 64,
    right: 30,
    top: i * 118 + 6,
    height: 96
  }))

  const xAxis = Array.from({ length: gridCount }, (_, i) => ({
    type: 'category' as const,
    gridIndex: i,
    data: timeLabels,
    axisLabel: i === gridCount - 1 ? axisLabelStyle() : { show: false },
    axisLine: { lineStyle: { color: PALETTE.border } },
    axisTick: { show: i === gridCount - 1 }
  }))

  const is4G = technology === '4G'
  const is3G = technology === '3G'

  let yAxis: EChartsOption['yAxis'] = []
  let series: SeriesOption[] = []

  if (selectedCards) {
    yAxis = selectedCards.map((kpi, i) => {
      const isPct = kpi.unit === '%' || kpi.key.includes('utilization') || kpi.key.includes('availability')
      return {
        gridIndex: i,
        type: 'value' as const,
        scale: true,
        minInterval: isPct ? 0.1 : 1,
        min: isPct
          ? (kpi.unit === '%' && !kpi.worseIsHigher ? 90 : 0)
          : (value: { min: number; max: number }) => (value.min === value.max ? Math.max(0, value.min - 1) : undefined),
        max: isPct
          ? 100
          : (value: { min: number; max: number }) => (value.min === value.max ? value.max + 1 : undefined),
        axisLabel: {
          ...axisLabelStyle(),
          formatter: (v: number) =>
            isPct ? `${v.toFixed(1)}%` : kpi.unit === 'kbps' ? `${(v / 1024).toFixed(1)}M` : kpi.unit === 'MB' ? `${(v / 1024).toFixed(1)}G` : `${v}`
        },
        splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
      }
    })

    series = selectedCards.map((kpi, i) => {
      const data = resolveKpiSeriesData(detail, kpi.key)
      const color = COLOR_CYCLES[i % COLOR_CYCLES.length]
      return {
        name: kpi.label,
        type: 'line' as const,
        xAxisIndex: i,
        yAxisIndex: i,
        data,
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color, width: 2 },
        itemStyle: { color },
        markLine:
          kpi.target != null
            ? {
                silent: true,
                symbol: 'none',
                label: { formatter: `target ${kpi.target} ${kpi.unit}`, color: PALETTE.danger, fontSize: 10 },
                lineStyle: { type: 'dashed', color: PALETTE.danger, width: 1 },
                data: [{ yAxis: kpi.target }]
              }
            : undefined
      }
    })
  } else {
    // Default core KPI series
    yAxis = is4G
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
            axisLabel: { ...axisLabelStyle(), formatter: (v: number) => `${(v / 1024).toFixed(1)}M` },
            splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
          },
          {
            gridIndex: 1,
            type: 'value' as const,
            axisLabel: { ...axisLabelStyle(), formatter: (v: number) => `${(v / 1024).toFixed(1)}G` },
            splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
          },
          {
            gridIndex: 2,
            type: 'value' as const,
            min: 90,
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
            min: 90,
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

    series = is4G
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
            name: 'HSDPA Throughput',
            type: 'line' as const,
            xAxisIndex: 0,
            yAxisIndex: 0,
            data: detail.weeks.map((w) => w.throughputKbps),
            smooth: 0.25,
            symbol: 'circle',
            symbolSize: 5,
            lineStyle: { color: PALETTE.accent, width: 2 },
            itemStyle: { color: PALETTE.accent },
            areaStyle: { color: 'rgba(56,189,248,0.12)' },
            markLine: {
              silent: true,
              symbol: 'none',
              label: { formatter: `target 2.0 Mbps`, color: PALETTE.danger, fontSize: 10 },
              lineStyle: { type: 'dashed', color: PALETTE.danger, width: 1 },
              data: [{ yAxis: 2000 }]
            }
          },
          {
            name: 'Data Volume',
            type: 'line' as const,
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: detail.weeks.map((w) => w.volumeMb),
            smooth: 0.25,
            symbol: 'circle',
            symbolSize: 5,
            lineStyle: { color: PALETTE.warn, width: 2 },
            itemStyle: { color: PALETTE.warn }
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
            itemStyle: { color: PALETTE.green },
            markLine: {
              silent: true,
              symbol: 'none',
              label: { formatter: `target 99.5%`, color: PALETTE.danger, fontSize: 10 },
              lineStyle: { type: 'dashed', color: PALETTE.danger, width: 1 },
              data: [{ yAxis: 99.5 }]
            }
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
  }

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
          if (isNaN(v) || p.value == null) {
            return `${p.marker ?? ''}${name}: <b>—</b>`
          }
          if (name.includes('utilization') || name.includes('Utilization') || name.includes('Congestion') || name.includes('Availability') || name.includes('%')) {
            return `${p.marker ?? ''}${name}: <b>${v.toFixed(1)}%</b>`
          }
          if (name.includes('throughput') || name.includes('Throughput') || name.includes('Speed')) {
            return `${p.marker ?? ''}${name}: <b>${(v / 1024).toFixed(1)} Mbps</b>`
          }
          if (name.includes('Volume') || name.includes('volume') || name.includes('MB')) {
            return `${p.marker ?? ''}${name}: <b>${v >= 1024 ? (v / 1024).toFixed(1) + ' GB' : v.toFixed(1) + ' MB'}</b>`
          }
          return `${p.marker ?? ''}${name}: <b>${v.toLocaleString()}</b>`
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

