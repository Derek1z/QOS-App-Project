import React, { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { MapChart } from 'echarts/charts'
import { TooltipComponent, VisualMapContinuousComponent, GeoComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { GHANA_REGIONS_GEOJSON } from '../lib/ghanaRegions'
import { GHANA_DISTRICTS_GEOJSON } from '../lib/ghanaDistricts'
import { useAppStore } from '../store'
import type { DistrictMapRow, RegionMapRow, Technology } from '../../../shared/api'

echarts.use([MapChart, TooltipComponent, VisualMapContinuousComponent, GeoComponent, CanvasRenderer])

try { echarts.registerMap('ghana', GHANA_REGIONS_GEOJSON as any) } catch { /* registered */ }
try { echarts.registerMap('ghanaDistricts', GHANA_DISTRICTS_GEOJSON as any) } catch { /* registered */ }

export default function GhanaMap(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const grain = useAppStore((s) => s.grain)
  const setGrain = useAppStore((s) => s.setGrain)
  const selectedTech = useAppStore((s) => s.selectedTech)
  const setSelectedTech = useAppStore((s) => s.setSelectedTech)

  const [tech, setTech] = useState<Technology>(selectedTech || '4G')
  const [level, setLevel] = useState<'region' | 'district'>('region')
  const [regions, setRegions] = useState<RegionMapRow[]>([])
  const [districts, setDistricts] = useState<DistrictMapRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (selectedTech && selectedTech !== tech) {
      setTech(selectedTech)
    }
  }, [selectedTech])

  useEffect(() => {
    let alive = true
    setLoading(true)
    void (async () => {
      try {
        const regRes = await window.api.analytics.regionMap(tech, grain)
        if (!alive) return
        setRegions(regRes)
        if (regRes.length > 0) {
          const distRes = await window.api.analytics.regionDistricts(regRes[0].id, tech, grain)
          if (alive) setDistricts(distRes)
        }
      } catch {
        /* close */
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [grain, tech])

  useEffect(() => {
    if (!containerRef.current) return
    let chart = chartRef.current
    if (!chart) {
      chart = echarts.init(containerRef.current)
      chartRef.current = chart
    }

    const dataList = level === 'region' ? regions : districts
    const mapData = dataList.map((r) => ({
      name: r.name,
      value: r.healthScore != null ? Math.round(r.healthScore) : 80
    }))

    const opt: EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: '{b}: Health Score {c}%'
      },
      visualMap: {
        min: 40,
        max: 100,
        text: ['High', 'Low'],
        realtime: false,
        calculable: true,
        inRange: {
          color: ['#ef4444', '#f59e0b', '#38bdf8', '#10b981']
        },
        textStyle: { color: '#93a1b5' }
      },
      series: [
        {
          name: 'Ghana QoS Health',
          type: 'map',
          map: level === 'region' ? 'ghana' : 'ghanaDistricts',
          roam: true,
          label: {
            show: level === 'region',
            color: '#f8fafc',
            fontSize: 10,
            fontWeight: 'bold'
          },
          itemStyle: {
            areaColor: '#1e293b',
            borderColor: '#334155',
            borderWidth: 1
          },
          emphasis: {
            itemStyle: { areaColor: '#3b82f6' },
            label: { color: '#ffffff' }
          },
          data: mapData
        }
      ]
    }

    chart.setOption(opt)

    const handleResize = () => chart?.resize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [regions, districts, level])

  const nationalHealth = regions.length > 0 ? Math.round(regions.reduce((acc, r) => acc + (r.healthScore ?? 80), 0) / regions.length) : 88

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1400px', margin: '0 auto', color: 'var(--text)' }}>
      {/* Executive Control Bar */}
      <div
        style={{
          background: 'var(--bg-card)',
          padding: '14px 20px',
          borderRadius: '12px',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {/* Technology Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Technology:
            </span>
            <div style={{ display: 'inline-flex', background: 'var(--bg-3)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              {(['2G', '3G', '4G'] as Technology[]).map((t) => (
                <button
                  key={t}
                  onClick={() => void setSelectedTech(t)}
                  style={{
                    padding: '5px 16px',
                    fontSize: '12px',
                    fontWeight: 800,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    background: tech === t ? 'linear-gradient(135deg, #059669, #10b981)' : 'transparent',
                    color: tech === t ? '#ffffff' : 'var(--text-dim)',
                    boxShadow: tech === t ? '0 2px 6px rgba(16, 185, 129, 0.3)' : 'none'
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Granularity Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Granularity:
            </span>
            <div style={{ display: 'inline-flex', background: 'var(--bg-3)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              {['daily', 'weekly'].map((g) => (
                <button
                  key={g}
                  onClick={() => setGrain(g as any)}
                  style={{
                    padding: '5px 14px',
                    fontSize: '12px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    background: grain === g ? 'var(--accent)' : 'transparent',
                    color: grain === g ? '#ffffff' : 'var(--text-dim)'
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          {/* Map Hierarchy Level */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              View Level:
            </span>
            <div style={{ display: 'inline-flex', background: 'var(--bg-3)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              {[
                { id: 'region', label: '16 Regions' },
                { id: 'district', label: '261 Districts' }
              ].map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLevel(l.id as any)}
                  style={{
                    padding: '5px 14px',
                    fontSize: '12px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    background: level === l.id ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                    color: level === l.id ? '#818cf8' : 'var(--text-dim)'
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Executive Banner Card */}
      <div
        style={{
          background: 'var(--bg-card)',
          padding: '20px 24px',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '20px',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ position: 'relative', width: '80px', height: '80px', minWidth: '80px', minHeight: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="80" height="80" viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)', width: '80px', height: '80px' }}>
              <path stroke="var(--bg-3)" strokeWidth="3.5" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              <path stroke="#10b981" strokeDasharray="88, 100" strokeWidth="3.5" strokeLinecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            </svg>
            <span style={{ position: 'absolute', fontSize: '18px', fontWeight: 800, color: '#f8fafc' }}>{nationalHealth}%</span>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                {tech} GHANA
              </span>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                Ghana Regional & District Geographic Health Choropleth Map
              </h2>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px', margin: '4px 0 0 0' }}>
              Active Granularity: <strong style={{ color: 'var(--text)' }}>{grain}</strong> grain · Showing {level === 'region' ? `${regions.length} Administrative Regions` : `${districts.length} Districts`}.
            </p>
          </div>
        </div>
      </div>

      {/* Main ECharts Map Container */}
      <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', marginBottom: '16px' }}>
          Ghana Interactive Health Map ({level === 'region' ? '16 Regions' : '261 Districts'})
        </h3>
        <div ref={containerRef} style={{ height: '520px', width: '100%' }} />
      </div>

      {/* Regional Performance Table */}
      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', padding: '20px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#f8fafc', marginBottom: '16px' }}>Regional Quality & Breach Ranking</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-3)', borderBottom: '1px solid var(--border)', color: 'var(--text-dim)', textTransform: 'uppercase', fontSize: '11px' }}>
                <th style={{ padding: '10px 14px' }}>Region Name</th>
                <th style={{ padding: '10px 14px' }}>Health Score</th>
                <th style={{ padding: '10px 14px' }}>Total Cells</th>
                <th style={{ padding: '10px 14px' }}>Non-Compliant</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>Breach Ratio</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((reg) => (
                <tr key={reg.name} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 14px', fontWeight: 700, color: '#f8fafc' }}>{reg.name}</td>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flex: 1, height: '6px', background: 'var(--bg-3)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, reg.healthScore ?? 80)}%`, height: '100%', background: (reg.healthScore ?? 80) > 75 ? '#34d399' : '#fbbf24' }} />
                      </div>
                      <span style={{ fontWeight: 800, fontSize: '12px', color: '#f8fafc' }}>{Math.round(reg.healthScore ?? 80)}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 14px', color: 'var(--text-dim)' }}>{reg.cells}</td>
                  <td style={{ padding: '12px 14px', color: '#f87171', fontWeight: 700 }}>{reg.ncCells}</td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>
                    {reg.cells > 0 ? `${((reg.ncCells / reg.cells) * 100).toFixed(1)}%` : '0.0%'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
