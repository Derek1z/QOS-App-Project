import type { EChartsOption } from 'echarts'
import type {
  CompareMetric, CompareSort, CompareView, ComparisonResult, ComparisonRow
} from '../../../shared/api'
import { PALETTE, tooltipStyle, axisLabelStyle } from './Chart'

export function formatCompare(metric: CompareMetric, v: number | null): string {
  if (v == null) return '—'
  if (metric === 'throughput') return `${(v / 1024).toFixed(1)} Mbps`
  if (metric === 'volume') return `${(v / 1024).toFixed(1)} GB`
  if (metric === 'prb' || metric === 'availability') return `${v.toFixed(1)}%`
  return Math.round(v).toLocaleString()
}

/** Difference ranking (spec §42): worst change first by default. For metrics
 *  where higher is worse (PRB, NC) the biggest rise leads; otherwise the
 *  biggest drop. Rows without a baseline always sort last. */
export function rankRows(result: ComparisonResult, sort: CompareSort): ComparisonRow[] {
  const kpi = result.kpis.find((k) => k.metric === result.metric)
  const worse = kpi?.worseIsHigher ?? false
  if (sort === 'name') return result.rows.slice().sort((a, b) => a.name.localeCompare(b.name))
  const withDelta = result.rows.filter((r) => r.delta != null)
  const noDelta = result.rows.filter((r) => r.delta == null)
  withDelta.sort((a, b) => {
    const da = a.delta as number
    const db = b.delta as number
    const cmp = worse ? db - da : da - db
    return sort === 'best' ? -cmp : cmp
  })
  return [...withDelta, ...noDelta]
}

const TRANSITION_LABEL: Record<string, string> = {
  nc: 'Still NC',
  new: 'New NC',
  recovered: 'Recovered',
  ok: 'Not NC'
}

/** Horizontal bar ranking: Actual shows both periods as grouped bars, Indexed
 *  expresses the current period as % of the baseline (mark at 100), Delta plots
 *  the change (mark at 0, colored better/worse for the selected metric). */
export function rankingOption(
  result: ComparisonResult,
  rows: ComparisonRow[],
  view: CompareView
): EChartsOption {
  const names = rows.map((r) => r.name)
  const kpi = result.kpis.find((k) => k.metric === result.metric)
  const worse = kpi?.worseIsHigher ?? false
  const fmt = (v: number | null): string => formatCompare(result.metric, v)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tooltip: any = {
    trigger: 'axis',
    ...tooltipStyle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    formatter: (params: any) => {
      const arr = Array.isArray(params) ? params : [params]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = (arr[0]?.data as any)?.row as ComparisonRow | undefined
      if (!row) return ''
      const lines = [
        `<b>${row.name}</b>`,
        `${result.aLabel}: <b>${fmt(row.current)}</b>`,
        `${result.bLabel}: <b>${fmt(row.previous)}</b>`
      ]
      if (view === 'indexed' && row.current != null && row.previous != null && row.previous !== 0) {
        lines.push(`Index: <b>${Math.round((row.current / row.previous) * 1000) / 10}</b> (baseline = 100)`)
      }
      if (row.delta != null) {
        const arrow = row.delta >= 0 ? '▲' : '▼'
        lines.push(`Delta: <b>${arrow} ${fmt(row.delta)}</b>`)
        if (row.deltaPct != null) lines.push(`Change: <b>${row.deltaPct >= 0 ? '+' : ''}${row.deltaPct}%</b>`)
      } else {
        lines.push('No data in the baseline period')
      }
      if (row.transition) lines.push(`NC transition: <b>${TRANSITION_LABEL[row.transition] ?? row.transition}</b>`)
      return lines.join('<br/>')
    }
  }

  const base = {
    backgroundColor: 'transparent',
    grid: { left: 120, right: 64, top: 34, bottom: 26 },
    tooltip,
    xAxis: {
      type: 'value' as const,
      axisLabel: axisLabelStyle(),
      splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
    },
    yAxis: {
      type: 'category' as const,
      data: names,
      inverse: true,
      axisLabel: { ...axisLabelStyle(), fontSize: 10 },
      axisLine: { show: false },
      axisTick: { show: false }
    }
  }

  if (view === 'actual') {
    return {
      ...base,
      legend: {
        data: [result.bLabel, result.aLabel],
        top: 2,
        textStyle: { color: PALETTE.dim, fontSize: 11 },
        itemWidth: 12,
        itemHeight: 8
      },
      series: [
        {
          name: result.bLabel,
          type: 'bar',
          data: rows.map((r) => ({ value: r.previous, row: r })),
          itemStyle: { color: PALETTE.dim, opacity: 0.4 },
          barMaxWidth: 16
        },
        {
          name: result.aLabel,
          type: 'bar',
          data: rows.map((r) => ({ value: r.current, row: r })),
          itemStyle: { color: PALETTE.accent },
          barMaxWidth: 16
        }
      ]
    }
  }

  if (view === 'indexed') {
    return {
      ...base,
      series: [
        {
          name: 'Index',
          type: 'bar',
          data: rows.map((r) => ({
            value:
              r.current != null && r.previous != null && r.previous !== 0
                ? Math.round((r.current / r.previous) * 1000) / 10
                : null,
            row: r
          })),
          itemStyle: { color: PALETTE.green },
          barMaxWidth: 16,
          markLine: {
            silent: true,
            symbol: 'none',
            label: { color: PALETTE.dim, fontSize: 10, formatter: 'baseline 100' },
            lineStyle: { type: 'dashed', color: PALETTE.dim, width: 1 },
            data: [{ xAxis: 100 }]
          }
        }
      ]
    }
  }

  // delta view
  return {
    ...base,
    series: [
      {
        name: 'Delta',
        type: 'bar',
        data: rows.map((r) => {
          let color = 'transparent'
          if (r.delta != null) {
            const better = worse ? r.delta < 0 : r.delta > 0
            color = better ? PALETTE.green : PALETTE.danger
          }
          return { value: r.delta, row: r, itemStyle: { color } }
        }),
        barMaxWidth: 16,
        markLine: {
          silent: true,
          symbol: 'none',
          label: { color: PALETTE.dim, fontSize: 10, formatter: 'no change' },
          lineStyle: { type: 'dashed', color: PALETTE.dim, width: 1 },
          data: [{ xAxis: 0 }]
        }
      }
    ]
  }
}
