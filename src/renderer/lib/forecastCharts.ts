import type { EChartsOption } from 'echarts'
import type { ForecastSeries } from '../../../shared/api'
import { PALETTE, tooltipStyle, axisLabelStyle } from './Chart'

export function fmtFc(v: number | null, unit: string, kind: 'axis' | 'text' = 'text'): string {
  if (v == null) return '—'
  if (unit === 'kbps') return `${(v / 1024).toFixed(kind === 'axis' ? 0 : 1)} Mbps`
  if (unit === 'MB') return `${(v / 1024).toFixed(kind === 'axis' ? 0 : 1)} GB`
  if (unit === '%') return `${v.toFixed(1)}%`
  return Math.round(v).toLocaleString()
}

/** Actual (solid) + forecast (dashed) with a confidence band over the forecast
 *  weeks and a dashed threshold mark line. The band is drawn as a markArea
 *  spanning the forecast x-range between the min lower and max upper bounds. */
export function forecastChartOption(series: ForecastSeries): EChartsOption {
  const actual = series.points.filter((p) => p.kind === 'actual')
  const fcast = series.points.filter((p) => p.kind === 'forecast')
  const labels = series.points.map((p) => p.label)
  const firstFcIdx = actual.length
  const lowers = fcast.map((p) => p.lower).filter((v): v is number => v != null)
  const uppers = fcast.map((p) => p.upper).filter((v): v is number => v != null)
  const bandY = fcast.length > 0 && lowers.length > 0 && uppers.length > 0
    ? [Math.min(...lowers), Math.max(...uppers)]
    : null
  const threshold = series.threshold
  const markLine = threshold != null
    ? {
        silent: true,
        symbol: 'none' as const,
        label: {
          formatter: `threshold ${fmtFc(threshold, series.unit, 'axis')}`,
          color: PALETTE.danger,
          fontSize: 10,
          position: 'insideEndTop' as const
        },
        lineStyle: { type: 'dashed' as const, color: PALETTE.danger, width: 1 },
        data: [{ yAxis: threshold }]
      }
    : undefined

  return {
    backgroundColor: 'transparent',
    grid: { left: 46, right: 16, top: 28, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle(),
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params]
        const idx = Number(arr[0]?.dataIndex ?? 0)
        const pt = series.points[idx]
        if (!pt) return ''
        const isFc = pt.kind === 'forecast'
        const lines = [
          `<b>${pt.weekStart} (${pt.label})</b>`,
          `${series.label}: <b>${fmtFc(pt.value, series.unit)}</b>${isFc ? ' (forecast)' : ' (actual)'}`
        ]
        if (isFc && pt.lower != null && pt.upper != null) {
          lines.push(`Band: ${fmtFc(pt.lower, series.unit)} – ${fmtFc(pt.upper, series.unit)}`)
        }
        if (threshold != null) {
          lines.push(`Threshold: ${fmtFc(threshold, series.unit)}`)
        }
        return lines.join('<br/>')
      }
    },
    legend: {
      data: ['Actual', 'Forecast'],
      textStyle: { color: PALETTE.dim, fontSize: 11 },
      top: 0,
      right: 4,
      itemWidth: 14,
      itemHeight: 8
    },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisLabel: axisLabelStyle(),
      axisLine: { lineStyle: { color: PALETTE.border } }
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: {
        ...axisLabelStyle(),
        formatter: (v: number) => fmtFc(v, series.unit, 'axis')
      },
      splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
    },
    series: [
      {
        name: 'Actual',
        type: 'line',
        data: series.points.map((p) => (p.kind === 'actual' ? p.value : null)),
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: PALETTE.accent, width: 2 },
        itemStyle: { color: PALETTE.accent },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(56,189,248,0.22)' },
              { offset: 1, color: 'rgba(56,189,248,0.02)' }
            ]
          }
        },
        connectNulls: false,
        markLine
      },
      {
        name: 'Forecast',
        type: 'line',
        data: series.points.map((p, idx) => (p.kind === 'forecast' || idx === actual.length - 1 ? p.value : null)),
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: PALETTE.warn, width: 2, type: 'dashed' },
        itemStyle: { color: PALETTE.warn },
        markArea: bandY && firstFcIdx < series.points.length
          ? {
              silent: true,
              itemStyle: { color: 'rgba(251,191,36,0.10)', borderColor: 'rgba(251,191,36,0.35)', borderWidth: 1, borderType: 'dashed' },
              data: [[{ xAxis: series.points[firstFcIdx].label, yAxis: bandY[0] }, { xAxis: series.points[series.points.length - 1].label, yAxis: bandY[1] }]]
            }
          : undefined
      }
    ]
  }
}
