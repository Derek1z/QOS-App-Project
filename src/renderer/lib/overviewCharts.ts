import type { EChartsOption } from 'echarts'
import type { HealthComponentRow, NcMovementRow, Grain } from '../../../shared/api'
import { PALETTE, tooltipStyle, axisLabelStyle } from './Chart'

function normalizeDateStr(dateStr: string): string {
  if (!dateStr) return ''
  if (/^\d{8}$/.test(dateStr)) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
  }
  return dateStr
}

/** ISO week label (spec §19: W31-style, Monday–Sunday). */
export function weekLabel(dateStr: string): string {
  if (!dateStr) return ''
  if (/^W\d+$/i.test(dateStr)) return dateStr.toUpperCase()
  const norm = normalizeDateStr(dateStr)
  const d = new Date(norm + (norm.includes('T') ? '' : 'T00:00:00Z'))
  if (isNaN(d.getTime())) return dateStr
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)
  return isNaN(week) ? dateStr : 'W' + week
}

/** Multi-grain time label supporting daily (07-05), weekly (W27), and monthly (2026-07). */
export function formatTimeLabel(dateStr: string, grain: Grain = 'weekly'): string {
  if (!dateStr) return ''
  if (!/^\d{4}/.test(dateStr) && !/^\d{8}/.test(dateStr)) {
    return dateStr
  }
  const norm = normalizeDateStr(dateStr)
  if (grain === 'daily') {
    return norm.length >= 10 ? norm.slice(5, 10) : norm
  }
  if (grain === 'monthly') {
    return norm.slice(0, 7)
  }
  return weekLabel(norm)
}

/** Network Health Score line with a Watch threshold band + component tooltip. */
export function healthLineOption(network: HealthComponentRow[], grain: Grain = 'weekly'): EChartsOption {
  const timeLabels = network.map((w) => formatTimeLabel(w.asOf, grain))
  return {
    backgroundColor: 'transparent',
    grid: { left: 42, right: 14, top: 24, bottom: 26 },
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle(),
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params]
        const idx = Number(arr[0]?.dataIndex ?? 0)
        const row = network[idx]
        if (!row) return ''
        return [
          `<b>${row.asOf} (${timeLabels[idx]})</b>`,
          `Health score: <b>${row.score}</b>`,
          `Capacity: ${row.capacity}`,
          `Throughput: ${row.throughput}`,
          `Availability: ${row.availability}`,
          `NC recurrence: ${row.ncRecurrence}`,
          `Growth pressure: ${row.growth}`
        ].join('<br/>')
      }
    },
    xAxis: { type: 'category', data: timeLabels, axisLabel: axisLabelStyle(), axisLine: { lineStyle: { color: PALETTE.border } } },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: axisLabelStyle(),
      splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
    },
    series: [
      {
        type: 'line',
        data: network.map((w) => w.score),
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: PALETTE.accent, width: 2 },
        itemStyle: { color: PALETTE.accent },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(56,189,248,0.28)' },
              { offset: 1, color: 'rgba(56,189,248,0.02)' }
            ]
          }
        },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { formatter: 'Watch ≤ {c}', color: PALETTE.warn, fontSize: 10, position: 'insideEndTop' },
          lineStyle: { type: 'dashed', color: PALETTE.warn, width: 1 },
          data: [{ yAxis: 65 }]
        }
      }
    ]
  }
}

/** NC Movement: stacked area of lifecycle counts + NC-rate line with the
 *  district threshold (10%) marked on the secondary axis. */
export function ncMovementOption(movement: NcMovementRow[], grain: Grain = 'weekly'): EChartsOption {
  const timeLabels = movement.map((m) => formatTimeLabel(m.weekStart, grain))
  const stack = 'nc'
  const base = {
    type: 'line' as const,
    stack,
    smooth: 0.25,
    symbol: 'none',
    emphasis: { focus: 'series' as const },
    areaStyle: { opacity: 0.75 }
  }
  return {
    backgroundColor: 'transparent',
    grid: { left: 42, right: 44, top: 24, bottom: 26 },
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle(),
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params]
        const idx = Number(arr[0]?.dataIndex ?? 0)
        const row = movement[idx]
        if (!row) return ''
        const rate = row.ncRate != null ? `${row.ncRate}%` : '—'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lines = arr.map((p: any) => {
          const v = Number(p.value)
          const name = String(p.seriesName ?? '')
          if (name === 'NC rate') return `${p.marker ?? ''}NC rate: <b>${v}%</b>`
          return `${p.marker ?? ''}${name}: ${v}`
        })
        return [`<b>${row.weekStart} (${timeLabels[idx]})</b>`, ...lines, `Total cells: ${row.totalCells}`, `NC rate: <b>${rate}</b>`].join('<br/>')
      }
    },
    legend: {
      top: 0,
      textStyle: { color: PALETTE.dim, fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8,
      data: ['New NC', 'Recurring', 'Persistent', 'Recovering', 'NC rate']
    },
    xAxis: { type: 'category', data: timeLabels, axisLabel: axisLabelStyle(), axisLine: { lineStyle: { color: PALETTE.border } } },
    yAxis: [
      {
        type: 'value',
        name: 'cells',
        nameTextStyle: { color: PALETTE.faint, fontSize: 10 },
        axisLabel: axisLabelStyle(),
        splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
      },
      {
        type: 'value',
        name: 'NC %',
        nameTextStyle: { color: PALETTE.faint, fontSize: 10 },
        min: 0,
        max: 100,
        axisLabel: { ...axisLabelStyle(), formatter: '{value}%' },
        splitLine: { show: false }
      }
    ],
    series: [
      { ...base, name: 'New NC', data: movement.map((m) => m.newNc), lineStyle: { color: PALETTE.warn }, itemStyle: { color: PALETTE.warn } },
      { ...base, name: 'Recurring', data: movement.map((m) => m.recurring), lineStyle: { color: PALETTE.accent }, itemStyle: { color: PALETTE.accent } },
      { ...base, name: 'Persistent', data: movement.map((m) => m.persistent), lineStyle: { color: PALETTE.danger }, itemStyle: { color: PALETTE.danger } },
      { ...base, name: 'Recovering', data: movement.map((m) => m.recovering), lineStyle: { color: PALETTE.green }, itemStyle: { color: PALETTE.green } },
      {
        type: 'line',
        name: 'NC rate',
        yAxisIndex: 1,
        data: movement.map((m) => m.ncRate ?? 0),
        smooth: 0.3,
        symbol: 'none',
        lineStyle: { color: PALETTE.text, width: 1.5, type: 'dashed' },
        itemStyle: { color: PALETTE.text },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { formatter: 'District NC threshold {c}%', color: PALETTE.danger, fontSize: 10 },
          lineStyle: { type: 'dashed', color: PALETTE.danger, width: 1 },
          data: [{ yAxis: 10 }]
        }
      }
    ]
  }
}

const CORE_COLORS = [
  '#38bdf8', // Sky blue
  '#f87171', // Red
  '#fbbf24', // Amber
  '#a78bfa', // Violet
  '#34d399', // Emerald
  '#fb923c'  // Orange
]

/** Core KPI Breach Rates: multi-line trend of individual Core KPI NC rates over time. */
export function coreKpiNcRateOption(
  movement: NcMovementRow[],
  activeKpiKeys?: string[],
  grain: Grain = 'weekly'
): EChartsOption {
  const timeLabels = movement.map((m) => formatTimeLabel(m.weekStart, grain))

  const allKpiKeys = new Set<string>()
  const kpiLabels = new Map<string, string>()

  for (const m of movement) {
    if (m.coreKpiNcRates) {
      for (const [k, obj] of Object.entries(m.coreKpiNcRates)) {
        allKpiKeys.add(k)
        if (obj.label) kpiLabels.set(k, obj.label)
      }
    }
  }

  const keysToRender = Array.from(allKpiKeys).filter((k) => !activeKpiKeys || activeKpiKeys.length === 0 || activeKpiKeys.includes(k))

  const series = keysToRender.map((k, idx) => {
    const color = CORE_COLORS[idx % CORE_COLORS.length]
    const label = kpiLabels.get(k) || k
    const data = movement.map((m) => {
      const obj = m.coreKpiNcRates?.[k]
      return obj ? obj.ncRate : null
    })
    return {
      name: label,
      type: 'line' as const,
      data,
      smooth: 0.25,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { width: 2, color },
      itemStyle: { color },
      emphasis: { focus: 'series' as const }
    }
  })

  return {
    backgroundColor: 'transparent',
    grid: { left: 42, right: 14, top: 24, bottom: 26 },
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle(),
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params]
        const idx = Number(arr[0]?.dataIndex ?? 0)
        const row = movement[idx]
        if (!row) return ''
        const lines = arr.map((p: any) => {
          const v = p.value != null ? `${p.value}%` : '—'
          return `${p.marker ?? ''}${p.seriesName}: <b>${v}</b>`
        })
        return [`<b>${row.weekStart} (${timeLabels[idx]})</b>`, ...lines].join('<br/>')
      }
    },
    xAxis: {
      type: 'category',
      data: timeLabels,
      axisLabel: axisLabelStyle(),
      axisLine: { lineStyle: { color: PALETTE.border } }
    },
    yAxis: {
      type: 'value',
      min: 0,
      axisLabel: { ...axisLabelStyle(), formatter: '{value}%' },
      splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
    },
    series
  }
}

