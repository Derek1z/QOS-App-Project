import type { DynamicKpiCardData, Grain, NcMovementRow, TechHealthCard } from '../../../shared/api'
import { formatTimeLabel } from './overviewCharts'
import { periodLabel } from '../../../shared/periods'

/** Pure shaping of the executive-overview data (getExecutiveOverview +
 *  getNcMovement) into what the Overview cards, banner and charts render. */

export type CardStatus = 'compliant' | 'warning' | 'breach' | 'unavailable'
export type CardTrend = 'improving' | 'worsening' | 'stable'

export interface OverviewKpiCard {
  key: string
  name: string
  isDerived: boolean
  value: number | null
  displayUnit: string
  targetStr: string | undefined
  status: CardStatus
  trend: CardTrend
  worseIsHigher: boolean
  ncCount: number
  ncPct: number
}

export const TOTALITY = { key: 'totality', label: '🌐 All Core KPIs (Totality)' }

/** Arrow for the direction the value moved: improving is up for a
 *  higher-is-better KPI (CSSR) and down for a lower-is-better one (drop rate). */
export function trendArrow(trend: CardTrend, worseIsHigher: boolean): '↑' | '↓' | '→' {
  if (trend === 'stable') return '→'
  return (trend === 'improving') !== worseIsHigher ? '↑' : '↓'
}

export function targetLabel(target: number | null, worseIsHigher: boolean, unit: string): string | undefined {
  if (target == null) return undefined
  const suffix = !unit ? '' : unit === '%' ? '%' : ` ${unit}`
  return `${worseIsHigher ? '≤' : '≥'} ${target}${suffix}`
}

const STATUS: Record<DynamicKpiCardData['complianceStatus'], CardStatus> = {
  compliant: 'compliant',
  warning: 'warning',
  non_compliant: 'breach',
  unavailable: 'unavailable'
}

export function toKpiCardProps(c: DynamicKpiCardData): OverviewKpiCard {
  return {
    key: c.key,
    name: c.label,
    isDerived: c.isDerived,
    value: c.currentValue,
    displayUnit: c.unit,
    targetStr: targetLabel(c.target, c.worseIsHigher, c.unit),
    status: STATUS[c.complianceStatus],
    trend: c.trend === 'unknown' ? 'stable' : c.trend,
    worseIsHigher: c.worseIsHigher,
    ncCount: c.nonCompliantCellCount,
    ncPct: c.nonCompliantCellPct ?? 0
  }
}

export function movementSeries(
  rows: NcMovementRow[],
  grain: Grain
): Array<{ label: string; complete: boolean; newNc: number; recurring: number; intermittent: number; persistent: number; chronic: number; recovering: number }> {
  return rows.map((r) => ({
    label: periodLabel(formatTimeLabel(r.weekStart, grain), grain, r.weekStart, r),
    complete: r.complete !== false,
    newNc: r.newNc,
    recurring: r.recurring,
    intermittent: r.intermittent,
    persistent: r.persistent,
    chronic: r.chronic,
    recovering: r.recovering
  }))
}

/** Breached cells per period: summed over every core KPI for the totality
 *  view (a cell breaching two KPIs counts twice), or for one KPI. */
export function breachSeries(
  rows: NcMovementRow[],
  kpiKey: string,
  grain: Grain
): Array<{ label: string; complete: boolean; totalBreaches: number }> {
  return rows.map((r) => ({
    label: periodLabel(formatTimeLabel(r.weekStart, grain), grain, r.weekStart, r),
    complete: r.complete !== false,
    totalBreaches: kpiKey === TOTALITY.key
      ? Object.values(r.coreKpiNcRates ?? {}).reduce((sum, k) => sum + k.breachedCells, 0)
      : r.coreKpiNcRates?.[kpiKey]?.breachedCells ?? 0
  }))
}

export function kpiFilterOptions(rows: NcMovementRow[]): Array<{ key: string; label: string }> {
  const seen = new Map<string, string>()
  for (const r of rows) {
    for (const k of Object.values(r.coreKpiNcRates ?? {})) {
      if (!seen.has(k.key)) seen.set(k.key, k.label)
    }
  }
  return [TOTALITY, ...[...seen].map(([key, label]) => ({ key, label }))]
}

export function bannerSummary(
  tech: TechHealthCard | undefined,
  latest: NcMovementRow | undefined
): { healthPct: number | null; cells: number; ncCells: number; newNc: number; recurring: number; intermittent: number; persistent: number; chronic: number; recovering: number } {
  const cells = tech?.cellCount ?? 0
  return {
    healthPct: tech && cells > 0 ? tech.healthScore : null,
    cells,
    ncCells: tech?.ncCellCount ?? 0,
    newNc: latest?.newNc ?? 0,
    recurring: latest?.recurring ?? 0,
    intermittent: latest?.intermittent ?? 0,
    persistent: latest?.persistent ?? 0,
    chronic: latest?.chronic ?? 0,
    recovering: latest?.recovering ?? 0
  }
}
