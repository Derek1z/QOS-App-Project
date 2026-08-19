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
import type { DistrictMapRow, RegionMapRow } from '../../../shared/api'

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

type Metric = 'health' | 'prb' | 'nc'

const METRICS: Array<{ id: Metric; label: string }> = [
  { id: 'health', label: 'Health' },
  { id: 'nc', label: 'NC Rate %' },
  { id: 'prb', label: 'PRB %' }
]

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function healthColor(s: number | null): string {
  if (s == null) return 'var(--text-faint)'
  return s >= 80 ? 'var(--green)' : s >= 65 ? 'var(--accent)' : s >= 50 ? 'var(--warn)' : 'var(--danger)'
}

function metricValue(r: RegionMapRow | DistrictMapRow, m: Metric): number | null {
  if (m === 'health') return r.healthScore
  if (m === 'prb') return r.prbAvg
  // 'nc' represents percentage of non-compliant cells (lower is better)
  return r.cells > 0 ? (r.ncCells / r.cells) * 100 : 0
}

function metricLabel(m: Metric): string {
  return m === 'prb' ? 'PRB %' : m === 'nc' ? 'NC Rate %' : 'Health'
}

// visualMap text labels: [top (high values), bottom (low values)]. Health is
// higher-better; PRB utilization and NC rate % are higher-worse (lower is better),
// so the red end sits at the top.
function scaleLabels(m: Metric): [string, string] {
  return m === 'health' ? ['Best (100)', 'Worst (0)'] : ['Worst', 'Best (0%)']
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
  const setInvestigationTarget = useAppStore((s) => s.setInvestigationTarget)
  const setModule = useAppStore((s) => s.setModule)
  const chartRef = useRef<HTMLDivElement>(null)
  const instRef = useRef<echarts.ECharts | null>(null)
  const regionsRef = useRef<RegionMapRow[]>([])
  const districtsRef = useRef<DistrictMapRow[]>([])
  const selectedRef = useRef<RegionMapRow | null>(null)
  const [regions, setRegions] = useState<RegionMapRow[]>([])
  const [metric, setMetric] = useState<Metric>('health')
  const [selected, setSelected] = useState<RegionMapRow | null>(null)
  const [districts, setDistricts] = useState<DistrictMapRow[]>([])
  const [loading, setLoading] = useState(false)

  // keep refs in sync for the chart click handler (registered once)
  selectedRef.current = selected
  districtsRef.current = districts

  // load per-region KPIs whenever the workspace changes
  useEffect(() => {
    let alive = true
    setSelected(null)
    setDistricts([])
    void (async () => {
      try {
        const rows = await window.api.analytics.regionMap()
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
  }, [workspace?.path, workspace?.readOnly])

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
          rows = await window.api.analytics.regionDistricts(selected.id)
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
  }, [selected])

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

    if (selected) {
      const canonicalRegion = getCanonicalRegionName(selected.name)
      // district choropleth: the selected region's ADM2 boundaries colored by metric,
      // with the parent region's boundary drawn on top as an outline so users keep
      // geographic context while drilled in. Both live in ONE registered map so the
      // outline stays perfectly aligned with the districts during roam/zoom.
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
      const max = metric === 'health' ? 100 : metric === 'prb' ? 100 : Math.max(10, Math.min(100, Math.ceil(Math.max(1, ...districts.map((d) => d.cells > 0 ? (d.ncCells / d.cells) * 100 : 0)) * 1.15)))
      // health is higher-better; PRB utilization and NC Rate % are higher-worse (lower is better)
      const higherBetter = metric === 'health'
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
            return [
              `<b>${m.name}</b>`,
              `Health <b>${v(m.healthScore)}</b> / 100`,
              `NC Rate <b>${v(ncPct, '%')}</b> (${m.ncCells} of ${m.cells} cells)`,
              `PRB <b>${v(m.prbAvg, '%')}</b> · Avail <b>${v(m.availability, '%')}</b>`,
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
          formatter: metric === 'health' ? '{value}' : '{value}%',
          text: scaleLabels(metric),
          textStyle: { color: PALETTE.dim, fontSize: 10 },
          inRange: {
            color: higherBetter
              ? ['#7f1d1d', '#dc2626', '#f59e0b', '#a3e635', '#10b981']
              : ['#10b981', '#a3e635', '#f59e0b', '#dc2626', '#7f1d1d']
          }
        },
        // a shared geo draws the whole drill map (district polygons + the parent
        // region's outline), and the map series colors the district data onto it.
        // One geo means the outline stays perfectly aligned while zooming/panning.
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
          // the parent region renders as a labelled outline for geographic context
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

    const max = metric === 'health' ? 100 : metric === 'prb' ? 100 : Math.max(10, Math.min(100, Math.ceil(Math.max(1, ...regions.map((r) => r.cells > 0 ? (r.ncCells / r.cells) * 100 : 0)) * 1.15)))
    // health is higher-better; PRB utilization and NC Rate % are higher-worse (lower is better)
    const higherBetter = metric === 'health'
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
          return [
            `<b>${m.name}</b>`,
            `Health <b>${v(m.healthScore)}</b> / 100`,
            `NC Rate <b>${v(ncPct, '%')}</b> (${m.ncCells} of ${m.cells} cells)`,
            `PRB <b>${v(m.prbAvg, '%')}</b> · Avail <b>${v(m.availability, '%')}</b>`,
            `Throughput <b>${v(m.throughputKbps == null ? null : m.throughputKbps / 1024, ' Mbps')}</b>`,
            `Users <b>${fmt(m.users, 0)}</b> · Volume <b>${fmt((m.volumeMb ?? 0) / 1024, 1)} GB</b>`,
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
        formatter: metric === 'health' ? '{value}' : '{value}%',
        text: scaleLabels(metric),
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
  }, [regions, districts, metric, selected])

  const worstFirst = [...districts].sort((a, b) => (a.healthScore ?? 101) - (b.healthScore ?? 101))

  return (
    <div className="card ghana-card card-wide">
      <div className="file-head">
        <h3>Ghana Regional Intelligence</h3>
        <div className="seg">
          {METRICS.map((m) => (
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
                Color-coded <b>region health</b> (best green → worst red).{' '}
                <b>PRB % and NC Rate % are reversed — higher = worse (red)</b> (lower is better), since high
                utilization and higher non-compliance rates represent network degradation. Hover for details,
                <b> click a region to drill into its district choropleth</b>.
              </p>
              <div className="kpi-strip">
                <div className="kpi">
                  <div className="kpi-value">{regions.filter((r) => r.healthScore != null).length}</div>
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
                      const nc = regions.reduce((s, r) => s + r.ncCells, 0)
                      return total > 0 ? `${((nc / total) * 100).toFixed(1)}%` : '0.0%'
                    })()}
                  </div>
                  <div className="kpi-label">Network NC Rate ({regions.reduce((s, r) => s + r.ncCells, 0)} cells)</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="ghana-drill">
              <div className="file-head">
                <b>{selected.name} — districts by {metricLabel(metric).toLowerCase()}</b>
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
                    {selected.cells > 0 ? `${((selected.ncCells / selected.cells) * 100).toFixed(1)}%` : '0.0%'}
                  </div>
                  <div className="kpi-label">NC Rate ({selected.ncCells} cells)</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{fmt(selected.prbAvg)}%</div>
                  <div className="kpi-label">PRB</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{fmt(selected.availability, 2)}%</div>
                  <div className="kpi-label">Availability</div>
                </div>
              </div>
              <p className="card-note">
                The map shows <b>district boundaries</b> colored by{' '}
                {metricLabel(metric).toLowerCase()} (lower is better for PRB & NC Rate). Click any district to open its diagnosis
                in the Investigation Workspace.
              </p>
              {loading ? (
                <p className="card-note">Loading districts…</p>
              ) : districts.length === 0 ? (
                <p className="card-note">No district data for this region yet — import cell-level data to populate the drill-down.</p>
              ) : (
                <div className="ghana-districts">
                  <b className="card-note">Districts ({metricLabel(metric)})</b>
                  {worstFirst.slice(0, 15).map((d) => (
                    <button key={d.id} className="district-row" onClick={() => openDistrict(d)}>
                      <span className="district-dot" style={{ background: healthColor(d.healthScore) }} />
                      <span className="district-name">{d.name}</span>
                      <span className="district-cell">
                        {d.cells} cells · {d.cells > 0 ? `${((d.ncCells / d.cells) * 100).toFixed(1)}%` : '0%'} NC
                      </span>
                      <span className="district-score">{fmt(d.healthScore, 0)}</span>
                      <span className="district-prb">{fmt(d.prbAvg)}%</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="card-note">
        Source: region/district rollups from <code>cell_health_history</code> + <code>agg_cell_weekly</code> —
        the same methodology as the Health Matrix. District drill-down uses the same rollups at district scope.
      </p>
    </div>
  )
}
