import type { EChartsOption } from 'echarts'
import type { InvestigationResult, Grain, Technology } from '../../../shared/api'
import { latestComplete, periodLabel } from '../../../shared/periods'
import { PALETTE, tooltipStyle, axisLabelStyle } from './Chart'
import { formatTimeLabel } from './overviewCharts'

export interface TelemetryMetricConfig {
  id: string
  label: string
  shortLabel: string
  unit: string
  target: number | null
  targetLabel: string | null
  color: string
  areaColor: string
  currentValue: number | null
  formattedCurrent: string
  data: Array<number | null>
}

/** Returns the complete list of available telemetry metrics for the active technology */
export function getAvailableTelemetryMetrics(
  res: InvestigationResult,
  tech: Technology,
  prbThreshold: number
): TelemetryMetricConfig[] {
  const latestWeek = latestComplete(res.weeks)
  const latestIdx = latestWeek ? res.weeks.indexOf(latestWeek) : -1

  if (tech === '2G') {
    // imported values only (honest-forecasting spec §8): a KPI that was not imported is a gap
    const tchData = res.weeks.map((w) => w.tchCong ?? null)
    const sdcchData = res.weeks.map((w) => w.sdcchCong ?? null)
    const cssrData = res.weeks.map((w) => w.cssr ?? null)
    const dropData = res.weeks.map((w) => w.callDrop ?? null)
    const voiceData = res.weeks.map((w) => w.voiceTraffic ?? null)

    const latestTch = (latestIdx >= 0 ? tchData[latestIdx] : null) ?? null
    const latestSdcch = (latestIdx >= 0 ? sdcchData[latestIdx] : null) ?? null
    const latestCssr = (latestIdx >= 0 ? cssrData[latestIdx] : null) ?? null
    const latestDrop = (latestIdx >= 0 ? dropData[latestIdx] : null) ?? null
    const latestVoice = (latestIdx >= 0 ? voiceData[latestIdx] : null) ?? null

    return [
      {
        id: 'tch_cong',
        label: '2G TCH Congestion (%)',
        shortLabel: 'TCH Congestion',
        unit: '%',
        target: 2.0,
        targetLabel: 'Target ≤ 2.0%',
        color: '#f87171',
        areaColor: 'rgba(248, 113, 113, 0.15)',
        currentValue: latestTch,
        formattedCurrent: latestTch != null ? `${latestTch.toFixed(1)}%` : '—',
        data: tchData
      },
      {
        id: 'sdcch_cong',
        label: '2G SDCCH Congestion (%)',
        shortLabel: 'SDCCH Congestion',
        unit: '%',
        target: 1.5,
        targetLabel: 'Target ≤ 1.5%',
        color: '#fbbf24',
        areaColor: 'rgba(251, 191, 36, 0.15)',
        currentValue: latestSdcch,
        formattedCurrent: latestSdcch != null ? `${latestSdcch.toFixed(1)}%` : '—',
        data: sdcchData
      },
      {
        id: 'cssr_2g',
        label: '2G Voice CSSR (%)',
        shortLabel: 'Voice CSSR',
        unit: '%',
        target: 98.0,
        targetLabel: 'Target ≥ 98.0%',
        color: '#38bdf8',
        areaColor: 'rgba(56, 189, 248, 0.15)',
        currentValue: latestCssr,
        formattedCurrent: latestCssr != null ? `${latestCssr.toFixed(1)}%` : '—',
        data: cssrData
      },
      {
        id: 'call_drop_2g',
        label: '2G Call Drop Rate (%)',
        shortLabel: 'Call Drop Rate',
        unit: '%',
        target: 1.0,
        targetLabel: 'Target ≤ 1.0%',
        color: '#f43f5e',
        areaColor: 'rgba(244, 63, 94, 0.15)',
        currentValue: latestDrop,
        formattedCurrent: latestDrop != null ? `${latestDrop.toFixed(1)}%` : '—',
        data: dropData
      },
      {
        id: 'voice_traffic',
        label: 'Voice Traffic (Erlang)',
        shortLabel: 'Voice Traffic',
        unit: 'Erl',
        target: null,
        targetLabel: null,
        color: '#34d399',
        areaColor: 'rgba(52, 211, 153, 0.15)',
        currentValue: latestVoice,
        formattedCurrent: latestVoice != null ? `${Math.round(latestVoice)} Erl` : '—',
        data: voiceData
      }
    ]
  }

  if (tech === '3G') {
    const cssrData = res.weeks.map((w) => w.cssr ?? null)
    const dropData = res.weeks.map((w) => w.callDrop ?? null)
    const dasrData = res.weeks.map((w) => w.dataAccess ?? w.dasr ?? null)
    // the column the user mapped to "PRB / Traffic Utilization (%)" at import
    const congData = res.weeks.map((w) => w.trafficUtil ?? w.prbAvg ?? null)
    const breachData = res.weeks.map((w) => w.breachDays ?? null)

    const latestCssr = (latestIdx >= 0 ? cssrData[latestIdx] : null) ?? null
    const latestDrop = (latestIdx >= 0 ? dropData[latestIdx] : null) ?? null
    const latestDasr = (latestIdx >= 0 ? dasrData[latestIdx] : null) ?? null
    const latestCong = (latestIdx >= 0 ? congData[latestIdx] : null) ?? null
    const latestBreach = (latestIdx >= 0 ? breachData[latestIdx] : null) ?? null

    return [
      {
        id: 'cssr_3g',
        label: '3G Call Setup Success (CSSR %)',
        shortLabel: '3G CSSR',
        unit: '%',
        target: 95.0,
        targetLabel: 'Target ≥ 95.0%',
        color: '#38bdf8',
        areaColor: 'rgba(56, 189, 248, 0.15)',
        currentValue: latestCssr,
        formattedCurrent: latestCssr != null ? `${latestCssr.toFixed(1)}%` : '—',
        data: cssrData
      },
      {
        id: 'call_drop_3g',
        label: '3G Call Drop Rate (%)',
        shortLabel: 'Call Drop Rate',
        unit: '%',
        target: 1.0,
        targetLabel: 'Target ≤ 1.0%',
        color: '#f87171',
        areaColor: 'rgba(248, 113, 113, 0.15)',
        currentValue: latestDrop,
        formattedCurrent: latestDrop != null ? `${latestDrop.toFixed(1)}%` : '—',
        data: dropData
      },
      {
        id: 'dasr_3g',
        label: '3G Data Access Success (DASR %)',
        shortLabel: 'Data Access',
        unit: '%',
        target: 98.0,
        targetLabel: 'Target ≥ 98.0%',
        color: '#fbbf24',
        areaColor: 'rgba(251, 191, 36, 0.15)',
        currentValue: latestDasr,
        formattedCurrent: latestDasr != null ? `${latestDasr.toFixed(1)}%` : '—',
        data: dasrData
      },
      {
        id: 'cong_3g',
        label: '3G Peak Traffic Utilization (%)',
        shortLabel: 'Traffic Util',
        unit: '%',
        target: null,
        targetLabel: null,
        color: '#a855f7',
        areaColor: 'rgba(168, 85, 247, 0.15)',
        currentValue: latestCong,
        formattedCurrent: latestCong != null ? `${latestCong.toFixed(1)}%` : '—',
        data: congData
      },
      {
        id: 'breach_days_3g',
        label: 'Breach Days Count',
        shortLabel: 'Breach Days',
        unit: 'Days',
        target: null,
        targetLabel: null,
        color: '#94a3b8',
        areaColor: 'rgba(148, 163, 184, 0.15)',
        currentValue: latestBreach,
        formattedCurrent: latestBreach != null ? `${latestBreach} Days` : '—',
        data: breachData
      }
    ]
  }

  // 4G Default
  const prbData = res.weeks.map((w) => w.prbAvg)
  const tpData = res.weeks.map((w) => (w.throughputKbps != null ? Math.round((w.throughputKbps / 1024) * 10) / 10 : null))
  const usersData = res.weeks.map((w) => w.users)
  const volData = res.weeks.map((w) => (w.volumeMb != null ? Math.round((w.volumeMb / 1024) * 10) / 10 : null))
  const availData = res.weeks.map((w) => w.availability)

  const latestPrb = latestWeek?.prbAvg ?? null
  const latestTp = latestWeek?.throughputKbps != null ? Math.round((latestWeek.throughputKbps / 1024) * 10) / 10 : null
  const latestUsers = latestWeek?.users ?? null
  const latestVol = latestWeek?.volumeMb != null ? Math.round((latestWeek.volumeMb / 1024) * 10) / 10 : null
  const latestAvail = latestWeek?.availability ?? null

  return [
    {
      id: 'prb',
      label: '4G DL PRB Utilization (%)',
      shortLabel: 'PRB Utilization',
      unit: '%',
      target: prbThreshold,
      targetLabel: `Target ≤ ${prbThreshold}%`,
      color: '#fbbf24',
      areaColor: 'rgba(251, 191, 36, 0.15)',
      currentValue: latestPrb,
      formattedCurrent: latestPrb != null ? `${latestPrb.toFixed(1)}%` : '—',
      data: prbData
    },
    {
      id: 'throughput',
      label: 'DL User Speed (Mbps)',
      shortLabel: 'DL Speed',
      unit: 'Mbps',
      target: 10.0,
      targetLabel: 'Benchmark ≥ 10.0 Mbps',
      color: '#38bdf8',
      areaColor: 'rgba(56, 189, 248, 0.15)',
      currentValue: latestTp,
      formattedCurrent: latestTp != null ? `${latestTp.toFixed(1)} Mbps` : '—',
      data: tpData
    },
    {
      id: 'users',
      label: 'Active Connected Users',
      shortLabel: 'Active Users',
      unit: 'Users',
      target: null,
      targetLabel: null,
      color: '#34d399',
      areaColor: 'rgba(52, 211, 153, 0.15)',
      currentValue: latestUsers,
      formattedCurrent: latestUsers != null ? `${Math.round(latestUsers).toLocaleString()}` : '—',
      data: usersData
    },
    {
      id: 'volume',
      label: 'Traffic Volume (GB)',
      shortLabel: 'Traffic Volume',
      unit: 'GB',
      target: null,
      targetLabel: null,
      color: '#a855f7',
      areaColor: 'rgba(168, 85, 247, 0.15)',
      currentValue: latestVol,
      formattedCurrent: latestVol != null ? `${latestVol.toFixed(1)} GB` : '—',
      data: volData
    },
    {
      id: 'availability',
      label: 'Cell Availability (%)',
      shortLabel: 'Availability',
      unit: '%',
      target: 99.5,
      targetLabel: 'Target ≥ 99.5%',
      color: '#94a3b8',
      areaColor: 'rgba(148, 163, 184, 0.15)',
      currentValue: latestAvail,
      formattedCurrent: latestAvail != null ? `${latestAvail.toFixed(1)}%` : '—',
      data: availData
    }
  ]
}

/** Mode 1: Spacious, Beautiful Hero Metric Chart (Height: 380px) */
export function heroMetricChartOption(
  res: InvestigationResult,
  metricKey: string,
  prbThreshold: number,
  grain: Grain = 'weekly',
  technologyOverride?: Technology
): EChartsOption {
  const tech: Technology = technologyOverride ?? res.technology ?? '4G'
  const metrics = getAvailableTelemetryMetrics(res, tech, prbThreshold)
  const activeMetric = metrics.find((m) => m.id === metricKey) ?? metrics[0]
  const timeLabels = res.weeks.map((w) => periodLabel(formatTimeLabel(w.weekStart, grain), grain, w.weekStart, w))

  const interventionIdx = res.interventionWeek
    ? res.weeks.findIndex((w) => w.weekStart === res.interventionWeek)
    : -1

  const markLineData: any[] = []
  if (activeMetric.target != null) {
    markLineData.push({
      yAxis: activeMetric.target,
      label: {
        formatter: `${activeMetric.targetLabel ?? 'Threshold'}`,
        color: '#f87171',
        fontSize: 11,
        position: 'end'
      },
      lineStyle: { type: 'dashed', color: '#f87171', width: 1.5 }
    })
  }

  if (interventionIdx >= 0) {
    markLineData.push({
      xAxis: interventionIdx,
      label: {
        formatter: 'Intervention',
        color: PALETTE.warn,
        fontSize: 11,
        position: 'end'
      },
      lineStyle: { type: 'dashed', color: PALETTE.warn, width: 1.5 }
    })
  }

  return {
    backgroundColor: 'transparent',
    grid: {
      left: 54,
      right: 36,
      top: 40,
      bottom: 36,
      containLabel: true
    },
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle(),
      formatter: (params: any) => {
        const arr = Array.isArray(params) ? params : [params]
        const idx = Number(arr[0]?.dataIndex ?? 0)
        const w = res.weeks[idx]
        if (!w) return ''
        const val = arr[0]?.value
        const formattedVal =
          val != null ? `${Number(val).toFixed(1)} ${activeMetric.unit}` : '—'
        const state = w.isNc ? `${w.lifecycle ?? 'NC'}` : w.lifecycle ?? 'Normal'
        const stateColor = w.isNc ? '#f87171' : '#34d399'

        return `
          <div style="font-weight: 800; font-size: 13px; color: #f8fafc; margin-bottom: 6px;">
            ${w.weekStart} (${timeLabels[idx]})
          </div>
          <div style="font-size: 11px; color: var(--text-dim); margin-bottom: 8px;">
            Technology: <strong style="color: #38bdf8">${tech}</strong> · State: <strong style="color: ${stateColor}">${state}</strong>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 12px;">
            <span style="display: flex; align-items: center; gap: 6px;">
              <span style="width: 8px; height: 8px; border-radius: 50%; background: ${activeMetric.color}"></span>
              ${activeMetric.shortLabel}:
            </span>
            <strong style="color: #f8fafc; font-size: 14px;">${formattedVal}</strong>
          </div>
          ${
            activeMetric.targetLabel
              ? `<div style="font-size: 10px; color: var(--text-dim); margin-top: 4px; border-top: 1px solid var(--border); padding-top: 4px;">
                  Benchmark: ${activeMetric.targetLabel}
                </div>`
              : ''
          }
        `
      }
    },
    xAxis: {
      type: 'category',
      data: timeLabels,
      axisLabel: { ...axisLabelStyle(), color: '#cbd5e1', fontSize: 11 },
      axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.12)' } },
      axisTick: { alignWithLabel: true, lineStyle: { color: 'rgba(255, 255, 255, 0.12)' } }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        ...axisLabelStyle(),
        formatter: (v: number) => `${Math.round(v)}${activeMetric.unit === '%' ? '%' : ''}`
      },
      splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.06)' } },
      axisLine: { show: false }
    },
    series: [
      {
        name: activeMetric.shortLabel,
        type: 'line',
        data: activeMetric.data,
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: activeMetric.color, width: 3 },
        itemStyle: {
          color: activeMetric.color,
          borderWidth: 2,
          borderColor: '#0f172a'
        },
        areaStyle: {
          color: activeMetric.areaColor
        },
        markLine: markLineData.length > 0 ? { silent: true, symbol: 'none', data: markLineData } : undefined
      }
    ]
  }
}

/** Mode 2: Multi-Chart Standalone Card Option (Height: 220px) */
export function standaloneKpiChartOption(
  res: InvestigationResult,
  metric: TelemetryMetricConfig,
  grain: Grain = 'weekly'
): EChartsOption {
  const timeLabels = res.weeks.map((w) => periodLabel(formatTimeLabel(w.weekStart, grain), grain, w.weekStart, w))
  const markLineData: any[] = []
  if (metric.target != null) {
    markLineData.push({
      yAxis: metric.target,
      label: { show: false },
      lineStyle: { type: 'dashed', color: '#f87171', width: 1 }
    })
  }

  return {
    backgroundColor: 'transparent',
    grid: {
      left: 42,
      right: 18,
      top: 18,
      bottom: 24,
      containLabel: true
    },
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle(),
      formatter: (params: any) => {
        const arr = Array.isArray(params) ? params : [params]
        const idx = Number(arr[0]?.dataIndex ?? 0)
        const val = arr[0]?.value
        return `${timeLabels[idx]}: <b>${val != null ? `${Number(val).toFixed(1)} ${metric.unit}` : '—'}</b>`
      }
    },
    xAxis: {
      type: 'category',
      data: timeLabels,
      axisLabel: { ...axisLabelStyle(), fontSize: 9 },
      axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.08)' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        ...axisLabelStyle(),
        fontSize: 9,
        formatter: (v: number) => `${Math.round(v)}${metric.unit === '%' ? '%' : ''}`
      },
      splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.04)' } },
      axisLine: { show: false }
    },
    series: [
      {
        name: metric.shortLabel,
        type: 'line',
        data: metric.data,
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { color: metric.color, width: 2 },
        itemStyle: { color: metric.color },
        areaStyle: { color: metric.areaColor },
        markLine: markLineData.length > 0 ? { silent: true, symbol: 'none', data: markLineData } : undefined
      }
    ]
  }
}

/** Mode 3: Dual-Axis Correlation Chart Option (Height: 380px) */
export function correlationChartOption(
  res: InvestigationResult,
  prbThreshold: number,
  grain: Grain = 'weekly',
  technologyOverride?: Technology
): EChartsOption {
  const tech: Technology = technologyOverride ?? res.technology ?? '4G'
  const metrics = getAvailableTelemetryMetrics(res, tech, prbThreshold)
  const loadMetric = metrics[0] // Primary load metric
  const perfMetric = metrics[1] // Performance / Speed / Drop metric
  const timeLabels = res.weeks.map((w) => periodLabel(formatTimeLabel(w.weekStart, grain), grain, w.weekStart, w))

  return {
    backgroundColor: 'transparent',
    legend: {
      data: [loadMetric.shortLabel, perfMetric.shortLabel],
      top: 6,
      textStyle: { color: '#cbd5e1', fontSize: 12 }
    },
    grid: {
      left: 54,
      right: 54,
      top: 50,
      bottom: 36,
      containLabel: true
    },
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
          return `<div style="display: flex; justify-content: space-between; gap: 16px;">
            <span>${p.marker} ${p.seriesName}:</span>
            <strong>${v.toFixed(1)}</strong>
          </div>`
        })
        return `
          <div style="font-weight: 800; margin-bottom: 6px;">${w.weekStart} (${timeLabels[idx]})</div>
          ${lines.join('')}
        `
      }
    },
    xAxis: {
      type: 'category',
      data: timeLabels,
      axisLabel: { ...axisLabelStyle(), color: '#cbd5e1', fontSize: 11 },
      axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.12)' } },
      axisTick: { alignWithLabel: true }
    },
    yAxis: [
      {
        type: 'value',
        name: loadMetric.shortLabel,
        nameTextStyle: { color: loadMetric.color, fontSize: 11 },
        axisLabel: { ...axisLabelStyle(), formatter: `{value}${loadMetric.unit === '%' ? '%' : ''}` },
        splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.06)' } },
        axisLine: { show: false }
      },
      {
        type: 'value',
        name: perfMetric.shortLabel,
        nameTextStyle: { color: perfMetric.color, fontSize: 11 },
        axisLabel: { ...axisLabelStyle(), formatter: `{value} ${perfMetric.unit}` },
        splitLine: { show: false },
        axisLine: { show: false }
      }
    ],
    series: [
      {
        name: loadMetric.shortLabel,
        type: 'line',
        yAxisIndex: 0,
        data: loadMetric.data,
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: loadMetric.color, width: 3 },
        itemStyle: { color: loadMetric.color }
      },
      {
        name: perfMetric.shortLabel,
        type: 'line',
        yAxisIndex: 1,
        data: perfMetric.data,
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: perfMetric.color, width: 3 },
        itemStyle: { color: perfMetric.color }
      }
    ]
  }
}

/** Legacy wrapper preserved for backwards compatibility */
export function investigationChartOption(
  res: InvestigationResult,
  prbThreshold: number,
  grain: Grain = 'weekly',
  technologyOverride?: Technology
): EChartsOption {
  return heroMetricChartOption(res, 'prb', prbThreshold, grain, technologyOverride)
}

