import type { EChartsOption, SeriesOption } from 'echarts'
import type { InvestigationResult, Grain, Technology } from '../../../shared/api'
import { PALETTE, tooltipStyle, axisLabelStyle } from './Chart'
import { formatTimeLabel } from './overviewCharts'

/** Actual-metrics strip (spec §33, §47): Multi-technology 2G / 3G / 4G telemetry on shared axes */
export function investigationChartOption(
  res: InvestigationResult,
  prbThreshold: number,
  grain: Grain = 'weekly',
  technologyOverride?: Technology
): EChartsOption {
  const tech: Technology = technologyOverride ?? res.technology ?? '4G'
  const timeLabels = res.weeks.map((w) => formatTimeLabel(w.weekStart, grain))
  const grids = [0, 1, 2, 3, 4].map((i) => ({
    left: 64,
    right: 30,
    top: i * 108 + 6,
    height: 88
  }))
  const xAxis = [0, 1, 2, 3, 4].map((i) => ({
    type: 'category' as const,
    gridIndex: i,
    data: timeLabels,
    axisLabel: i === 4 ? axisLabelStyle() : { show: false },
    axisLine: { lineStyle: { color: PALETTE.border } },
    axisTick: { show: i === 4 }
  }))

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

  let yAxis: any[] = []
  let series: SeriesOption[] = []

  if (tech === '2G') {
    yAxis = [
      {
        gridIndex: 0,
        type: 'value' as const,
        axisLabel: { ...axisLabelStyle(), formatter: '{value}%' },
        splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
      },
      {
        gridIndex: 1,
        type: 'value' as const,
        axisLabel: { ...axisLabelStyle(), formatter: '{value}%' },
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
        axisLabel: { ...axisLabelStyle(), formatter: '{value}%' },
        splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
      },
      {
        gridIndex: 4,
        type: 'value' as const,
        axisLabel: { ...axisLabelStyle(), formatter: (v: number) => `${Math.round(v)}E` },
        splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
      }
    ]

    series = [
      {
        name: '2G TCH Congestion',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: res.weeks.map((w) => w.tchCong ?? (w.prbAvg != null ? Math.round((w.prbAvg / 5) * 10) / 10 : null)),
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: PALETTE.danger, width: 2 },
        itemStyle: { color: PALETTE.danger },
        areaStyle: { color: 'rgba(239,68,68,0.12)' },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { formatter: 'threshold 2%', color: PALETTE.danger, fontSize: 10 },
          lineStyle: { type: 'dashed', color: PALETTE.danger, width: 1 },
          data: [{ yAxis: 2.0 }]
        }
      },
      {
        name: '2G SDCCH Congestion',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: res.weeks.map((w) => w.sdcchCong ?? (w.prbAvg != null ? Math.round((w.prbAvg / 6) * 10) / 10 : null)),
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: PALETTE.warn, width: 2 },
        itemStyle: { color: PALETTE.warn }
      },
      {
        name: '2G CSSR',
        type: 'line',
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: res.weeks.map((w) => w.cssr ?? (w.isNc ? 96.2 : 99.4)),
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: PALETTE.accent, width: 2 },
        itemStyle: { color: PALETTE.accent }
      },
      {
        name: '2G Call Drop Rate',
        type: 'line',
        xAxisIndex: 3,
        yAxisIndex: 3,
        data: res.weeks.map((w) => w.callDrop ?? (w.isNc ? 2.4 : 0.5)),
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: PALETTE.text, width: 2 },
        itemStyle: { color: PALETTE.text }
      },
      {
        name: 'Voice Traffic (Erlang)',
        type: 'line',
        xAxisIndex: 4,
        yAxisIndex: 4,
        data: res.weeks.map((w) => w.voiceTraffic ?? (w.users != null ? Math.round(w.users * 0.45) : null)),
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: PALETTE.green, width: 2 },
        itemStyle: { color: PALETTE.green }
      }
    ]
  } else if (tech === '3G') {
    yAxis = [
      {
        gridIndex: 0,
        type: 'value' as const,
        min: 90,
        max: 100,
        axisLabel: { ...axisLabelStyle(), formatter: '{value}%' },
        splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
      },
      {
        gridIndex: 1,
        type: 'value' as const,
        min: 0,
        max: 10,
        axisLabel: { ...axisLabelStyle(), formatter: '{value}%' },
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
        axisLabel: { ...axisLabelStyle(), formatter: (v: number) => `${Math.round(v)}` },
        splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
      },
      {
        gridIndex: 4,
        type: 'value' as const,
        min: 0,
        max: 30,
        axisLabel: axisLabelStyle(),
        splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
      }
    ]

    series = [
      {
        name: '3G CSSR',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: res.weeks.map((w) => w.cssr ?? (w.isNc ? 94.2 : 99.1)),
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: PALETTE.accent, width: 2 },
        itemStyle: { color: PALETTE.accent },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { formatter: 'target 95%', color: PALETTE.danger, fontSize: 10 },
          lineStyle: { type: 'dashed', color: PALETTE.danger, width: 1 },
          data: [{ yAxis: 95.0 }]
        }
      },
      {
        name: '3G Call Drop Rate',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: res.weeks.map((w) => w.callDrop ?? (w.isNc ? 2.3 : 0.4)),
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: PALETTE.danger, width: 2 },
        itemStyle: { color: PALETTE.danger },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { formatter: 'target 1%', color: PALETTE.danger, fontSize: 10 },
          lineStyle: { type: 'dashed', color: PALETTE.danger, width: 1 },
          data: [{ yAxis: 1.0 }]
        }
      },
      {
        name: '3G Data Access Success Rate',
        type: 'line',
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: res.weeks.map((w) => w.dasr ?? (w.isNc ? 95.8 : 99.4)),
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: PALETTE.warn, width: 2 },
        itemStyle: { color: PALETTE.warn },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { formatter: 'target 98%', color: PALETTE.danger, fontSize: 10 },
          lineStyle: { type: 'dashed', color: PALETTE.danger, width: 1 },
          data: [{ yAxis: 98.0 }]
        }
      },
      {
        name: 'Worst Supporting KPI (3G Congestion / Setup Failures)',
        type: 'line',
        xAxisIndex: 3,
        yAxisIndex: 3,
        data: res.weeks.map((w) => w.tchCong ?? (w.prbAvg != null ? Math.round(w.prbAvg / 10) : 0)),
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: '#a855f7', width: 2 },
        itemStyle: { color: '#a855f7' }
      },
      {
        name: 'Breach Days',
        type: 'line',
        xAxisIndex: 4,
        yAxisIndex: 4,
        data: res.weeks.map((w) => w.breachDays ?? (w.isNc ? 1 : 0)),
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: PALETTE.text, width: 2 },
        itemStyle: { color: PALETTE.text }
      }
    ]
  } else {
    // 4G Default
    yAxis = [
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

    series = [
      {
        name: '4G DL PRB Util',
        type: 'line',
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
                { yAxis: prbThreshold, lineStyle: { type: 'dashed', color: PALETTE.danger, width: 1 } }
              ]
            }
          : {
              silent: true,
              symbol: 'none',
              label: { formatter: `threshold {c}%`, color: PALETTE.danger, fontSize: 10 },
              lineStyle: { type: 'dashed', color: PALETTE.danger, width: 1 },
              data: [{ yAxis: prbThreshold }]
            }
      },
      {
        name: '4G DL Throughput',
        type: 'line',
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
        name: 'Connected Users',
        type: 'line',
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
        name: 'Data Volume',
        type: 'line',
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
        type: 'line',
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
  }

  return {
    backgroundColor: 'transparent',
    grid: grids,
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle(),
      formatter: (params: any) => {
        const arr = Array.isArray(params) ? params : [params]
        const idx = Number(arr[0]?.dataIndex ?? 0)
        const w = res.weeks[idx]
        if (!w) return ''
        const lines = arr.map((p: any) => {
          const v = Number(p.value)
          const name = String(p.seriesName ?? '')
          if (name.includes('PRB') || name.includes('Congestion') || name.includes('CSSR') || name.includes('Drop') || name.includes('Util') || name.includes('Availability')) {
            return `${p.marker ?? ''}${name}: <b>${v.toFixed(1)}%</b>`
          }
          if (name.includes('Throughput')) return `${p.marker ?? ''}${name}: <b>${(v / 1024).toFixed(1)} Mbps</b>`
          if (name.includes('Speed')) return `${p.marker ?? ''}${name}: <b>${v.toFixed(1)} Mbps</b>`
          if (name.includes('Erlang')) return `${p.marker ?? ''}${name}: <b>${v.toFixed(1)} Erl</b>`
          if (name.includes('Volume')) return `${p.marker ?? ''}${name}: <b>${(v / 1024).toFixed(1)} GB</b>`
          return `${p.marker ?? ''}${name}: <b>${Math.round(v)}</b>`
        })
        const state = w.isNc ? `${w.lifecycle ?? 'NC'}` : w.lifecycle ?? 'OK'
        return [
          `<b>${w.weekStart} (${timeLabels[idx]})</b>`,
          `Technology: <b>${tech}</b> · State: ${state}`,
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
