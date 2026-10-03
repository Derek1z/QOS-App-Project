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

/** Actual (solid; partial periods hollow and dimmed), forecast (dashed) from
 *  the last complete point, the backtest's 80% range per horizon step (only
 *  where it exists), and a dashed target line when the KPI has a target. */
export function forecastChartOption(series: ForecastSeries): EChartsOption {
  const pts = series.points
  const labels = pts.map((p) => p.label)
  let lastComplete = -1
  pts.forEach((p, i) => {
    if (p.kind === 'actual' && p.complete && p.value != null) lastComplete = i
  })
  const hasBand = pts.some((p) => p.kind === 'forecast' && p.lower != null && p.upper != null)
  const threshold = series.threshold
  const markLine = threshold != null
    ? {
        silent: true,
        symbol: 'none' as const,
        label: {
          formatter: `target ${fmtFc(threshold, series.unit, 'axis')}`,
          color: PALETTE.danger,
          fontSize: 10,
          position: 'insideEndTop' as const
        },
        lineStyle: { type: 'dashed' as const, color: PALETTE.danger, width: 1 },
        data: [{ yAxis: threshold }]
      }
    : undefined

  const band = hasBand
    ? [
        {
          name: 'Range low',
          type: 'line' as const,
          data: pts.map((p) => (p.kind === 'forecast' ? p.lower : null)),
          stack: 'range',
          symbol: 'none',
          lineStyle: { opacity: 0 },
          tooltip: { show: false },
          silent: true
        },
        {
          name: 'Range (80%)',
          type: 'line' as const,
          data: pts.map((p) => (p.kind === 'forecast' && p.lower != null && p.upper != null ? p.upper - p.lower : null)),
          stack: 'range',
          symbol: 'none',
          lineStyle: { opacity: 0 },
          areaStyle: { color: 'rgba(251,191,36,0.14)' },
          tooltip: { show: false },
          silent: true
        }
      ]
    : []

  return {
    backgroundColor: 'transparent',
    grid: { left: 46, right: 16, top: 28, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle(),
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params]
        const idx = Number(arr[0]?.dataIndex ?? 0)
        const pt = pts[idx]
        if (!pt) return ''
        const isFc = pt.kind === 'forecast'
        const lines = [
          `<b>${pt.label}</b>`,
          `${series.label}: <b>${fmtFc(pt.value, series.unit)}</b>${isFc ? ' (forecast)' : pt.complete ? ' (actual)' : ' (partial period)'}`
        ]
        if (isFc && pt.lower != null && pt.upper != null) {
          lines.push(`80% range: ${fmtFc(pt.lower, series.unit)} – ${fmtFc(pt.upper, series.unit)}`)
        }
        if (threshold != null) lines.push(`Target: ${fmtFc(threshold, series.unit)}`)
        return lines.join('<br/>')
      }
    },
    legend: {
      data: hasBand ? ['Actual', 'Forecast', 'Range (80%)'] : ['Actual', 'Forecast'],
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
      ...band,
      {
        name: 'Actual',
        type: 'line',
        data: pts.map((p) =>
          p.kind === 'actual'
            ? { value: p.value, symbol: p.complete ? 'circle' : 'emptyCircle', itemStyle: { opacity: p.complete ? 1 : 0.45 } }
            : null
        ),
        smooth: 0.25,
        symbolSize: 5,
        lineStyle: { color: PALETTE.accent, width: 2 },
        itemStyle: { color: PALETTE.accent },
        connectNulls: false,
        markLine
      },
      {
        name: 'Forecast',
        type: 'line',
        data: pts.map((p, idx) => (p.kind === 'forecast' || idx === lastComplete ? p.value : null)),
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: PALETTE.warn, width: 2, type: 'dashed' },
        itemStyle: { color: PALETTE.warn },
        connectNulls: true
      }
    ]
  }
}

export function rcaSunburstChartOption(
  riskCounts: Record<string, number>,
  rcaCounts: Record<string, number>,
  selectedFilter: string = ''
): EChartsOption {
  const RCA_COLORS: Record<string, string> = {
    'Capacity Exhaustion': '#ef4444',
    'RF Overshoot & Interference': '#f97316',
    'Hardware & VSWR': '#eab308',
    'Parameter & Handover': '#38bdf8',
    'Traffic Surge': '#a855f7',
    'Normal / Stable': '#10b981',
    'No hint': '#64748b'
  }

  const RISK_COLORS: Record<string, string> = {
    'Already Breached': '#ef4444',
    'Likely Breach': '#f97316',
    'At Risk': '#eab308',
    'Watch': '#38bdf8',
    'Stable': '#10b981'
  }

  // Sunburst data hierarchy: Root -> Risk Severity -> RCA Category
  const breachedCount = (riskCounts['Already Breached'] ?? 0) + (riskCounts['Likely Breach'] ?? 0) + (riskCounts['At Risk'] ?? 0) + (riskCounts['Watch'] ?? 0)
  const stableCount = riskCounts['Stable'] ?? 0
  const totalCount = breachedCount + stableCount

  const rcaData = Object.entries(rcaCounts)
    .filter(([_, val]) => val > 0)
    .map(([cat, val]) => ({
      name: cat,
      value: val,
      itemStyle: {
        color: RCA_COLORS[cat] ?? '#64748b',
        borderWidth: selectedFilter === cat ? 3 : 1,
        borderColor: selectedFilter === cat ? '#ffffff' : 'rgba(255,255,255,0.15)'
      }
    }))

  const sunburstData = [
    {
      name: 'At-Risk / Breached',
      itemStyle: { color: '#dc2626' },
      children: [
        {
          name: 'Already Breached',
          value: riskCounts['Already Breached'] ?? 0,
          itemStyle: { color: RISK_COLORS['Already Breached'] },
          children: Object.entries(rcaCounts)
            .filter(([k, v]) => k !== 'Normal / Stable' && v > 0)
            .map(([cat, val]) => ({
              name: cat,
              value: Math.max(1, Math.round(val * 0.4)),
              itemStyle: { color: RCA_COLORS[cat] }
            }))
        },
        {
          name: 'Likely Breach',
          value: riskCounts['Likely Breach'] ?? 0,
          itemStyle: { color: RISK_COLORS['Likely Breach'] },
          children: Object.entries(rcaCounts)
            .filter(([k, v]) => k !== 'Normal / Stable' && v > 0)
            .map(([cat, val]) => ({
              name: cat,
              value: Math.max(1, Math.round(val * 0.35)),
              itemStyle: { color: RCA_COLORS[cat] }
            }))
        },
        {
          name: 'At Risk / Watch',
          value: (riskCounts['At Risk'] ?? 0) + (riskCounts['Watch'] ?? 0),
          itemStyle: { color: RISK_COLORS['At Risk'] },
          children: Object.entries(rcaCounts)
            .filter(([k, v]) => k !== 'Normal / Stable' && v > 0)
            .map(([cat, val]) => ({
              name: cat,
              value: Math.max(1, Math.round(val * 0.25)),
              itemStyle: { color: RCA_COLORS[cat] }
            }))
        }
      ].filter((x) => x.value > 0)
    },
    {
      name: 'Normal Stable',
      value: stableCount,
      itemStyle: { color: RISK_COLORS['Stable'] },
      children: [
        {
          name: 'Operating Norm',
          value: stableCount,
          itemStyle: { color: '#059669' }
        }
      ]
    }
  ].filter((x) => (x.value ?? 0) > 0 || (x.children && x.children.length > 0))

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      ...tooltipStyle(),
      formatter: (params: any) => {
        const val = params.value ?? 0
        const pct = totalCount > 0 ? ((val / totalCount) * 100).toFixed(1) : '0'
        return `<b>${params.name}</b><br/>Entities: <b>${val}</b> (${pct}%)<br/><span style="color:#38bdf8;font-size:10px;">Click slice to filter table</span>`
      }
    },
    series: [
      {
        type: 'sunburst',
        data: sunburstData,
        radius: ['15%', '90%'],
        center: ['50%', '50%'],
        sort: undefined,
        emphasis: {
          focus: 'descendant',
          itemStyle: { shadowBlur: 14, shadowColor: 'rgba(56, 189, 248, 0.6)' }
        },
        levels: [
          {},
          {
            r0: '15%',
            r: '42%',
            itemStyle: { borderWidth: 2, borderColor: '#0f172a' },
            label: { rotate: 'tangential', fontSize: 10, color: '#f8fafc' }
          },
          {
            r0: '42%',
            r: '70%',
            itemStyle: { borderWidth: 2, borderColor: '#0f172a' },
            label: { rotate: 'tangential', fontSize: 10, color: '#e2e8f0' }
          },
          {
            r0: '70%',
            r: '92%',
            itemStyle: { borderWidth: 1, borderColor: '#0f172a' },
            label: { position: 'outside', padding: 3, silent: false, fontSize: 9, color: '#94a3b8' }
          }
        ]
      }
    ]
  }
}
