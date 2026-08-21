import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { MapChart } from 'echarts/charts'
import {
  TooltipComponent,
  VisualMapContinuousComponent,
  GeoComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { GHANA_REGIONS_GEOJSON } from '../lib/ghanaRegions'
import { GHANA_DISTRICTS_GEOJSON } from '../lib/ghanaDistricts'
import { useAppStore } from '../store'
import { PALETTE, tooltipStyle } from '../lib/Chart'
import type { DistrictMapRow, RegionMapRow, Technology } from '../../../shared/api'

echarts.use([MapChart, TooltipComponent, VisualMapContinuousComponent, GeoComponent, CanvasRenderer])

// register once per page load (idempotent)
try {
  echarts.registerMap('ghana', GHANA_REGIONS_GEOJSON as Parameters<typeof echarts.registerMap>[1])
} catch {
  /* already registered */
}
try {
  echarts.registerMap(
    'ghanaDistricts',
    GHANA_DISTRICTS_GEOJSON as Parameters<typeof echarts.registerMap>[1]
  )
} catch {
  /* already registered */
}

interface MapMetricDef {
  id: string
  label: string
  unit: string
  worseIsHigher: boolean
  isCore: boolean
}

const TECH_CORE_METRICS: Record<Technology, MapMetricDef[]> = {
  '2G': [
    { id: 'nc', label: '2G Total NC %', unit: '%', worseIsHigher: true, isCore: true },
    { id: 'call_setup_success_2g', label: '2G CSSR NC %', unit: '%', worseIsHigher: true, isCore: true },
    { id: 'call_drop_rate_2g', label: '2G TCH Drop NC %', unit: '%', worseIsHigher: true, isCore: true },
    { id: 'sdcch_congestion', label: '2G SDCCH Cong NC %', unit: '%', worseIsHigher: true, isCore: true },
    { id: 'tch_congestion', label: '2G TCH Cong NC %', unit: '%', worseIsHigher: true, isCore: true },
    { id: 'health', label: 'Health', unit: '', worseIsHigher: false, isCore: true }
  ],
  '3G': [
    { id: 'nc', label: '3G Total NC %', unit: '%', worseIsHigher: true, isCore: true },
    { id: 'call_setup_success_3g', label: '3G CSSR NC %', unit: '%', worseIsHigher: true, isCore: true },
    { id: 'call_drop_rate_3g', label: '3G Call Drop NC %', unit: '%', worseIsHigher: true, isCore: true },
    { id: 'data_access_success_3g', label: '3G Data Access NC %', unit: '%', worseIsHigher: true, isCore: true },
    { id: 'health', label: 'Health', unit: '', worseIsHigher: false, isCore: true }
  ],
  '4G': [
    { id: 'nc', label: '4G Total NC %', unit: '%', worseIsHigher: true, isCore: true },
    { id: 'call_setup_success_4g', label: '4G Call Setup NC %', unit: '%', worseIsHigher: true, isCore: true },
    { id: 'call_drop_rate_4g', label: '4G Call Drop NC %', unit: '%', worseIsHigher: true, isCore: true },
    { id: 'data_service_failure_4g', label: '4G DSAF NC %', unit: '%', worseIsHigher: true, isCore: true },
    { id: 'prb_utilization', label: '4G DL PRB NC %', unit: '%', worseIsHigher: true, isCore: true },
    { id: 'health', label: 'Health', unit: '', worseIsHigher: false, isCore: true }
  ]
}

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function healthColor(s: number | null): string {
  if (s == null) return 'var(--text-faint)'
  return s >= 80 ? 'var(--green)' : s >= 65 ? 'var(--accent)' : s >= 50 ? 'var(--warn)' : 'var(--danger)'
}

function metricValue(r: RegionMapRow | DistrictMapRow, m: string): number | null {
  if (m === 'health') return r.healthScore
  if (m === 'nc') return r.cells > 0 ? (r.ncCells / r.cells) * 100 : 0
  if (r.kpiMetrics && r.kpiMetrics[m]) {
    // Return Core KPI NC Rate % (percentage of cells breaching this KPI)
    return r.kpiMetrics[m].ncRate
  }
  return 0
}

function isHigherBetter(m: string, _tech: Technology): boolean {
  // Only overall Health is higher-is-better; all Core KPIs and NC metrics are NC Rates (lower is better)
  return m === 'health'
}

function metricLabel(m: string, tech: Technology): string {
  if (m === 'health') return 'Health Score'
  if (m === 'nc') return `${tech} Total NC Rate`
  const def = TECH_CORE_METRICS[tech]?.find((x) => x.id === m)
  return def?.label || m
}

function metricUnit(_m: string, _tech: Technology): string {
  return '%'
}

function scaleLabels(m: string, _tech: Technology): [string, string] {
  return m === 'health' ? ['Best (100)', 'Worst (0)'] : ['Worst', 'Best (0% NC)']
}

function cleanName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-./\\,+()]/g, ' ')
    .replace(/\b(region|regional|district|municipal|municipality|metropolitan|metro|assembly|area|council)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const REGION_CANONICAL_MAP: Record<string, string> = {
  'greater accra': 'Greater Accra',
  'accra': 'Greater Accra',
  'gt accra': 'Greater Accra',
  'ashanti': 'Ashanti',
  'asante': 'Ashanti',
  'eastern': 'Eastern',
  'western': 'Western',
  'central': 'Central',
  'volta': 'Volta',
  'northern': 'Northern',
  'upper east': 'Upper East',
  'upper west': 'Upper West',
  'bono': 'Bono',
  'brong ahafo': 'Bono',
  'bono east': 'Bono East',
  'ahafo': 'Ahafo',
  'western north': 'Western North',
  'oti': 'Oti',
  'north east': 'North East',
  'savannah': 'Savannah'
}

function getCanonicalRegionName(name: string): string {
  const clean = cleanName(name)
  if (REGION_CANONICAL_MAP[clean]) return REGION_CANONICAL_MAP[clean]
  for (const [k, v] of Object.entries(REGION_CANONICAL_MAP)) {
    if (clean.includes(k) || k.includes(clean)) return v
  }
  for (const f of GHANA_REGIONS_GEOJSON.features) {
    if (cleanName(f.properties.name) === clean) return f.properties.name
  }
  return name.trim()
}

function matchRegion(regions: RegionMapRow[], geoRegionName: string): RegionMapRow | undefined {
  const canonicalGeo = getCanonicalRegionName(geoRegionName)
  const exact = regions.find((r) => r.name.toLowerCase() === geoRegionName.toLowerCase())
  if (exact) return exact
  const canonicalMatch = regions.find((r) => getCanonicalRegionName(r.name) === canonicalGeo)
  if (canonicalMatch) return canonicalMatch
  const cleanGeo = cleanName(geoRegionName)
  return regions.find((r) => {
    const c = cleanName(r.name)
    return c === cleanGeo || c.includes(cleanGeo) || cleanGeo.includes(c)
  })
}

function matchDistrict(districts: DistrictMapRow[], geoDistrictName: string): DistrictMapRow | undefined {
  const exact = districts.find((d) => d.name.toLowerCase() === geoDistrictName.toLowerCase())
  if (exact) return exact
  const cleanGeo = cleanName(geoDistrictName)
  const cleanMatch = districts.find((d) => cleanName(d.name) === cleanGeo)
  if (cleanMatch) return cleanMatch
  const subMatch = districts.find((d) => {
    const cd = cleanName(d.name)
    return cd.length > 2 && cleanGeo.length > 2 && (cd.includes(cleanGeo) || cleanGeo.includes(cd))
  })
  if (subMatch) return subMatch
  const tokens = cleanGeo.split(' ').filter((t) => t.length > 2)
  if (tokens.length > 0) {
    return districts.find((d) => {
      const cd = cleanName(d.name)
      return tokens.some((t) => cd.includes(t))
    })
  }
  return undefined
}

export default function GhanaMap(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const selectedTech = useAppStore((s) => s.selectedTech)
  const grain = useAppStore((s) => s.grain)
  const period = useAppStore((s) => s.period)
  const setInvestigationTarget = useAppStore((s) => s.setInvestigationTarget)
  const setModule = useAppStore((s) => s.setModule)
  const chartRef = useRef<HTMLDivElement>(null)
  const instRef = useRef<echarts.ECharts | null>(null)
  const regionsRef = useRef<RegionMapRow[]>([])
  const districtsRef = useRef<DistrictMapRow[]>([])
  const selectedRef = useRef<RegionMapRow | null>(null)
  const [regions, setRegions] = useState<RegionMapRow[]>([])
  const [metric, setMetric] = useState<string>('health')
  const [selected, setSelected] = useState<RegionMapRow | null>(null)
  const [districts, setDistricts] = useState<DistrictMapRow[]>([])
  const [loading, setLoading] = useState(false)

  // keep refs in sync for the chart click handler (registered once)
  selectedRef.current = selected
  districtsRef.current = districts

  const currentTech: Technology = selectedTech || workspace?.technology || '4G'
  const activeMetrics = TECH_CORE_METRICS[currentTech] || TECH_CORE_METRICS['4G']

  // reset metric if not available in current technology
  useEffect(() => {
    if (metric !== 'health' && metric !== 'nc' && !activeMetrics.some((m) => m.id === metric)) {
      setMetric('health')
    }
  }, [currentTech, activeMetrics, metric])

  // load per-region KPIs whenever the workspace, tech, grain, or period changes
  useEffect(() => {
    let alive = true
    setSelected(null)
    setDistricts([])
    void (async () => {
      try {
        const rows = await window.api.analytics.regionMap(currentTech, grain, period)
        if (!alive) return
        regionsRef.current = rows
        setRegions(rows)
      } catch {
        /* workspace closed mid-flight */
      }
    })()
    return () => {
      alive = false
    }
  }, [workspace?.path, workspace?.readOnly, currentTech, grain, period])

  // drill into a region's districts
  useEffect(() => {
    if (!selected) {
      setDistricts([])
      return
    }
    let alive = true
    setLoading(true)
    void (async () => {
      try {
        let rows: DistrictMapRow[] = []
        if (selected.id > 0) {
          rows = await window.api.analytics.regionDistricts(selected.id, currentTech, grain, period)
        }
        if (alive) setDistricts(rows)
      } catch {
        if (alive) setDistricts([])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [selected, currentTech, grain, period])

  // open a district's diagnosis in the Investigation Workspace
  function openDistrict(d: DistrictMapRow): void {
    const region = selectedRef.current
    setInvestigationTarget({
      scope: 'district',
      id: d.id,
      name: d.name,
      path: region ? [region.name, d.name] : [d.name]
    })
    setModule('investigation')
  }

  // init the map instance once
  useEffect(() => {
    const el = chartRef.current
    if (!el) return
    const chart = echarts.init(el, undefined, { renderer: 'canvas' })
    instRef.current = chart
    chart.on('click', (params: { name?: string }) => {
      const name = params.name
      if (!name) return
      // district layer: clicking a district opens its investigation
      if (selectedRef.current) {
        const row = matchDistrict(districtsRef.current, name)
        if (row) openDistrict(row)
        return
      }
      // region layer: clicking a region drills into its districts
      const row = matchRegion(regionsRef.current, name)
      if (row) {
        setSelected((prev) => (prev?.id === row.id ? null : row))
      } else {
        const canonical = getCanonicalRegionName(name)
        setSelected((prev) =>
          prev?.name === canonical
            ? null
            : {
                id: -1,
                name: canonical,
                cells: 0,
                ncCells: 0,
                healthScore: null,
                prbAvg: null,
                throughputKbps: null,
                users: null,
                volumeMb: null,
                availability: null
              }
        )
      }
    })
    const ro = new ResizeObserver(() => {
      if (instRef.current) instRef.current.resize()
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      try {
        chart.clear()
        chart.dispose()
      } catch {
        /* already disposed */
      }
      instRef.current = null
    }
  }, [])

  // push option updates — region choropleth, or district choropleth when drilled in
  useEffect(() => {
    const chart = instRef.current
    if (!chart) return

    const higherBetter = isHigherBetter(metric, currentTech)

    if (selected) {
      const canonicalRegion = getCanonicalRegionName(selected.name)
      const regionFeature = GHANA_REGIONS_GEOJSON.features.find(
        (f) => getCanonicalRegionName(f.properties.name) === canonicalRegion
      )
      const districtFeatures = GHANA_DISTRICTS_GEOJSON.features.filter(
        (f) => getCanonicalRegionName(f.properties.region ?? '') === canonicalRegion
      )
      const featuresToRegister = [
        ...(regionFeature ? [regionFeature] : []),
        ...(districtFeatures.length > 0 ? districtFeatures : GHANA_DISTRICTS_GEOJSON.features.slice(0, 10))
      ]
      const drillFc = {
        type: 'FeatureCollection' as const,
        features: featuresToRegister
      }
      try {
        echarts.registerMap('ghanaDrill', drillFc as never)
      } catch {
        /* keep the previous registration */
      }
      const districtData = (districtFeatures.length > 0 ? districtFeatures : GHANA_DISTRICTS_GEOJSON.features)
        .map((f) => {
          const row = matchDistrict(districts, f.properties.name)
          const val = row ? metricValue(row, metric) : null
          const fallbackVal = metric === 'health' ? (row?.cells ? 75 : null) : (row?.cells ? 0 : null)
          return {
            name: f.properties.name,
            row,
            value: val ?? fallbackVal
          }
        })
        .map((x) => ({ name: x.name, value: x.value ?? undefined, meta: x.row }))

      let max = 100
      if (metric === 'health') {
        max = 100
      } else {
        const vals = districts.map((d) => metricValue(d, metric)).filter((v): v is number => v != null)
        const highest = vals.length > 0 ? Math.max(...vals) : 10
        max = Math.max(10, Math.min(100, Math.ceil(highest * 1.15)))
      }

      const option: EChartsOption = {
        backgroundColor: 'transparent',
        tooltip: {
          ...tooltipStyle(),
          formatter: (p: unknown) => {
            const item = p as { name: string; data: { meta?: DistrictMapRow } }
            const m = item.data?.meta
            if (!m) return `<b>${item.name}</b><br/><span style="color:${PALETTE.dim}">No active cell data for this district.</span>`
            const v = (val: number | null, unit = ''): string => (val == null ? '—' : `${fmt(val)}${unit}`)
            const ncPct = m.cells > 0 ? (m.ncCells / m.cells) * 100 : 0
            const currentVal = metricValue(m, metric)
            const curLabel = metricLabel(metric, currentTech)
            const curUnit = metricUnit(metric, currentTech)
            return [
              `<b>${m.name}</b> (${currentTech})`,
              `${curLabel}: <b>${v(currentVal, curUnit)}</b>`,
              `Health: <b>${v(m.healthScore)}</b> / 100`,
              `${currentTech} Core NC Rate: <b>${v(ncPct, '%')}</b> (${m.ncCells} of ${m.cells} cells)`,
              `<span style="color:${PALETTE.dim}">Click to open this district's investigation.</span>`
            ].join('<br/>')
          }
        },
        visualMap: {
          min: 0,
          max,
          show: true,
          left: 8,
          bottom: 10,
          calculable: true,
          formatter: metricUnit(metric, currentTech) ? `{value}${metricUnit(metric, currentTech)}` : '{value}',
          text: scaleLabels(metric, currentTech),
          textStyle: { color: PALETTE.dim, fontSize: 10 },
          inRange: {
            color: higherBetter
              ? ['#7f1d1d', '#dc2626', '#f59e0b', '#a3e635', '#10b981']
              : ['#10b981', '#a3e635', '#f59e0b', '#dc2626', '#7f1d1d']
          }
        },
        geo: {
          map: 'ghanaDrill',
          roam: true,
          scaleLimit: { min: 1.5, max: 12 },
          selectedMode: false,
          label: { show: false },
          emphasis: { disabled: true },
          itemStyle: {
            borderColor: '#1e2735',
            borderWidth: 0.6,
            areaColor: 'rgba(148,163,184,0.12)'
          },
          regions: [
            {
              name: regionFeature?.properties.name ?? canonicalRegion,
              silent: true,
              label: { show: true, color: PALETTE.dim, fontSize: 10 },
              itemStyle: {
                areaColor: 'transparent',
                borderColor: PALETTE.accent,
                borderWidth: 2
              },
              emphasis: { disabled: true }
            }
          ]
        },
        series: [
          {
            type: 'map',
            map: 'ghanaDrill',
            geoIndex: 0,
            selectedMode: false,
            label: { show: false },
            emphasis: {
              label: { show: true, color: PALETTE.text, fontSize: 10 },
              itemStyle: { areaColor: '#2563eb' }
            },
            data: districtData
          }
        ]
      }
      chart.setOption(option, { notMerge: true })
      return
    }

    let max = 100
    if (metric === 'health') {
      max = 100
    } else {
      const vals = regions.map((r) => metricValue(r, metric)).filter((v): v is number => v != null)
      const highest = vals.length > 0 ? Math.max(...vals) : 10
      max = Math.max(10, Math.min(100, Math.ceil(highest * 1.15)))
    }

    const data = GHANA_REGIONS_GEOJSON.features
      .map((f) => {
        const row = matchRegion(regions, f.properties.name)
        const val = row ? metricValue(row, metric) : null
        const fallbackVal = metric === 'health' ? (row?.cells ? 75 : null) : (row?.cells ? 0 : null)
        return {
          name: f.properties.name,
          row,
          value: val ?? fallbackVal
        }
      })
      .map((x) => ({ name: x.name, value: x.value ?? undefined, meta: x.row }))
    const option: EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: {
        ...tooltipStyle(),
        formatter: (p: unknown) => {
          const item = p as { name: string; value: number | null; data: { meta?: RegionMapRow } }
          const m = item.data?.meta
          if (!m) return `<b>${item.name}</b><br/><span style="color:${PALETTE.dim}">No cell data for this region.</span>`
          const v = (val: number | null, unit = ''): string => (val == null ? '—' : `${fmt(val)}${unit}`)
          const ncPct = m.cells > 0 ? (m.ncCells / m.cells) * 100 : 0
          const currentVal = metricValue(m, metric)
          const curLabel = metricLabel(metric, currentTech)
          const curUnit = metricUnit(metric, currentTech)
          return [
            `<b>${m.name}</b> (${currentTech})`,
            `${curLabel}: <b>${v(currentVal, curUnit)}</b>`,
            `Health: <b>${v(m.healthScore)}</b> / 100`,
            `${currentTech} Core NC Rate: <b>${v(ncPct, '%')}</b> (${m.ncCells} of ${m.cells} cells)`,
            `<span style="color:${PALETTE.dim}">Click to drill into districts.</span>`
          ].join('<br/>')
        }
      },
      visualMap: {
        min: 0,
        max,
        show: true,
        left: 8,
        bottom: 10,
        calculable: true,
        formatter: metricUnit(metric, currentTech) ? `{value}${metricUnit(metric, currentTech)}` : '{value}',
        text: scaleLabels(metric, currentTech),
        textStyle: { color: PALETTE.dim, fontSize: 10 },
        inRange: {
          color: higherBetter
            ? ['#7f1d1d', '#dc2626', '#f59e0b', '#a3e635', '#10b981']
            : ['#10b981', '#a3e635', '#f59e0b', '#dc2626', '#7f1d1d']
        }
      },
      series: [
        {
          type: 'map',
          map: 'ghana',
          roam: true,
          scaleLimit: { min: 0.8, max: 6 },
          selectedMode: false,
          label: { show: false },
          emphasis: {
            label: { show: true, color: PALETTE.text, fontSize: 11 },
            itemStyle: { areaColor: '#2563eb' }
          },
          itemStyle: {
            borderColor: '#263041',
            borderWidth: 1,
            areaColor: 'rgba(148,163,184,0.12)'
          },
          data
        }
      ]
    }
    chart.setOption(option, { notMerge: true })
  }, [regions, districts, metric, selected, currentTech])

  const worstFirst = [...districts].sort((a, b) => {
    const valA = metricValue(a, metric) ?? -1
    const valB = metricValue(b, metric) ?? -1
    if (metric === 'health') {
      return (a.healthScore ?? 101) - (b.healthScore ?? 101)
    }
    // For NC rate: higher NC rate is worse, so put highest first
    return valB - valA
  })

  return (
    <div className="card ghana-card card-wide">
      <div className="file-head" style={{ flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3>Ghana Regional Intelligence</h3>
          <span className="badge" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border)' }}>
            {currentTech}
          </span>
        </div>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {activeMetrics.map((m) => (
            <button
              key={m.id}
              className={`seg-btn${metric === m.id ? ' active' : ''}`}
              onClick={() => setMetric(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ghana-layout">
        <div className="ghana-map" ref={chartRef} />
        <div className="ghana-panel">
          {!selected ? (
            <div className="ghana-hint">
              <p className="card-note">
                Color-coded <b>{currentTech} Non-Compliance Rates & Core KPIs</b> (0% NC is Best Green → High NC is Worst Red). Hover for details,
                <b> click a region to drill into its district choropleth</b>.
              </p>
              <div className="kpi-strip">
                <div className="kpi">
                  <div className="kpi-value">{regions.filter((r) => r.cells > 0).length}</div>
                  <div className="kpi-label">Regions with data</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{regions.reduce((s, r) => s + r.cells, 0).toLocaleString()}</div>
                  <div className="kpi-label">Cells covered</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">
                    {(() => {
                      const total = regions.reduce((s, r) => s + r.cells, 0)
                      if (metric === 'health') {
                        const valid = regions.filter((r) => r.healthScore != null)
                        return valid.length > 0 ? (valid.reduce((s, r) => s + (r.healthScore ?? 0), 0) / valid.length).toFixed(1) : '—'
                      }
                      if (metric === 'nc') {
                        const nc = regions.reduce((s, r) => s + r.ncCells, 0)
                        return total > 0 ? `${((nc / total) * 100).toFixed(1)}%` : '0.0%'
                      }
                      const kpiNc = regions.reduce((s, r) => s + (r.kpiMetrics?.[metric]?.ncCells ?? 0), 0)
                      return total > 0 ? `${((kpiNc / total) * 100).toFixed(1)}%` : '0.0%'
                    })()}
                  </div>
                  <div className="kpi-label">
                    {metric === 'health'
                      ? 'Average Health'
                      : metric === 'nc'
                      ? `${currentTech} Total NC Rate (${regions.reduce((s, r) => s + r.ncCells, 0)} cells)`
                      : `${metricLabel(metric, currentTech)} (${regions.reduce((s, r) => s + (r.kpiMetrics?.[metric]?.ncCells ?? 0), 0)} cells)`}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="ghana-drill">
              <div className="file-head">
                <b>{selected.name} — districts by {metricLabel(metric, currentTech).toLowerCase()}</b>
                <button className="btn" onClick={() => setSelected(null)}>
                  ← All regions
                </button>
              </div>
              <div className="kpi-strip">
                <div className="kpi">
                  <div className="kpi-value" style={{ color: healthColor(selected.healthScore) }}>
                    {fmt(selected.healthScore, 0)}
                  </div>
                  <div className="kpi-label">Health</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{selected.cells.toLocaleString()}</div>
                  <div className="kpi-label">Cells</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">
                    {(() => {
                      if (metric === 'health') return fmt(selected.healthScore, 0)
                      if (metric === 'nc') {
                        return `${selected.cells > 0 ? ((selected.ncCells / selected.cells) * 100).toFixed(1) : '0.0'}%`
                      }
                      const kpiBreached = selected.kpiMetrics?.[metric]?.ncCells ?? 0
                      return `${selected.cells > 0 ? ((kpiBreached / selected.cells) * 100).toFixed(1) : '0.0'}%`
                    })()}
                  </div>
                  <div className="kpi-label">
                    {metric === 'health'
                      ? 'Health Score'
                      : metric === 'nc'
                      ? `${currentTech} NC Rate (${selected.ncCells} cells)`
                      : `${metricLabel(metric, currentTech)} (${selected.kpiMetrics?.[metric]?.ncCells ?? 0} cells)`}
                  </div>
                </div>
                {metric !== 'health' && metric !== 'nc' && selected.kpiMetrics?.[metric] && (
                  <div className="kpi">
                    <div className="kpi-value">{fmt(selected.kpiMetrics[metric].avg)}{selected.kpiMetrics[metric].unit}</div>
                    <div className="kpi-label">Average Value</div>
                  </div>
                )}
              </div>
              <p className="card-note">
                The map shows <b>district boundaries</b> colored by{' '}
                {metricLabel(metric, currentTech).toLowerCase()}. Click any district to open its diagnosis
                in the Investigation Workspace.
              </p>
              {loading ? (
                <p className="card-note">Loading districts…</p>
              ) : districts.length === 0 ? (
                <p className="card-note">No district data for this region yet — import cell-level data to populate the drill-down.</p>
              ) : (
                <div className="ghana-districts">
                  <b className="card-note">Districts ({metricLabel(metric, currentTech)})</b>
                  {worstFirst.slice(0, 15).map((d) => {
                    const kpiNcCells = d.kpiMetrics?.[metric]?.ncCells ?? 0
                    const districtKpiNcPct = d.cells > 0 ? ((kpiNcCells / d.cells) * 100).toFixed(1) : '0.0'
                    return (
                      <button key={d.id} className="district-row" onClick={() => openDistrict(d)}>
                        <span className="district-dot" style={{ background: healthColor(d.healthScore) }} />
                        <span className="district-name">{d.name}</span>
                        <span className="district-cell">
                          {d.cells} cells · {metric === 'health' ? `${fmt(d.healthScore, 0)} Health` : metric === 'nc' ? `${d.cells > 0 ? ((d.ncCells / d.cells) * 100).toFixed(1) : '0'}% NC` : `${districtKpiNcPct}% NC (${kpiNcCells} cells)`}
                        </span>
                        <span className="district-score">
                          {metric === 'health' ? fmt(d.healthScore, 0) : metric === 'nc' ? `${d.cells > 0 ? ((d.ncCells / d.cells) * 100).toFixed(1) : '0'}%` : `${districtKpiNcPct}%`}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="card-note">
        Source: region/district rollups from <code>cell_health_history</code> + <code>agg_cell_kpi_weekly</code> —
        computed strictly against active <b>{currentTech} Core KPIs</b>.
      </p>
    </div>
  )
}
