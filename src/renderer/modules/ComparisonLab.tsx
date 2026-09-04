import React, { useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { useAppStore } from '../store'
import type {
  CompareMetric, CompareScope, CompareSort, CompareView, ComparisonResult, ComparisonType, Technology
} from '../../../shared/api'
import Chart from '../lib/Chart'
import { rankingOption, rankRows } from '../lib/comparisonCharts'

const TYPES: Array<{ id: ComparisonType; label: string }> = [
  { id: 'period', label: 'Period vs Period' },
  { id: 'region', label: 'Region vs Region' }
]

const SCOPES: Array<{ id: CompareScope; label: string }> = [
  { id: 'cell', label: 'Cell' },
  { id: 'site', label: 'Site' },
  { id: 'district', label: 'District' },
  { id: 'region', label: 'Region' }
]

const TECH_METRICS: Record<Technology, Array<{ id: CompareMetric; label: string }>> = {
  '4G': [
    { id: 'prb', label: 'PRB Utilization' },
    { id: 'throughput', label: 'DL User Speed' },
    { id: 'users', label: 'Active Users' },
    { id: 'volume', label: 'Traffic Volume' },
    { id: 'availability', label: 'Availability' },
    { id: 'nc', label: 'Non-Compliance' }
  ],
  '3G': [
    { id: 'cssr_3g', label: '3G CSSR' },
    { id: 'call_drop_3g', label: '3G CDR' },
    { id: 'data_access_3g', label: '3G DASR' },
    { id: 'dl_power_cong_3g', label: 'DL Power Cong' },
    { id: 'ul_ce_cong_3g', label: 'UL CE Cong' }
  ],
  '2G': [
    { id: 'tch_congestion', label: 'TCH Congestion' },
    { id: 'sdcch_congestion', label: 'SDCCH Congestion' },
    { id: 'cssr_2g', label: 'Voice CSSR' },
    { id: 'call_drop_2g', label: 'Call Drop Rate' }
  ]
}

const VIEWS: Array<{ id: CompareView; label: string }> = [
  { id: 'actual', label: 'Actual Values' },
  { id: 'indexed', label: 'Indexed (% Base)' },
  { id: 'delta', label: 'Delta / Change' }
]

export default function ComparisonLab(): React.JSX.Element {
  const selectedTech = useAppStore((s) => s.selectedTech)
  const setSelectedTech = useAppStore((s) => s.setSelectedTech)
  const grain = useAppStore((s) => s.grain)
  const setGrain = useAppStore((s) => s.setGrain)

  const [tech, setTech] = useState<Technology>(selectedTech || '4G')
  const [type, setType] = useState<ComparisonType>('period')
  const [scope, setScope] = useState<CompareScope>('cell')
  const [metric, setMetric] = useState<CompareMetric>('prb')
  const [view, setView] = useState<CompareView>('actual')
  const [sort, setSort] = useState<CompareSort>('worst')
  const [result, setResult] = useState<ComparisonResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (selectedTech && selectedTech !== tech) {
      setTech(selectedTech)
    }
  }, [selectedTech])

  const activeMetrics = TECH_METRICS[tech] ?? TECH_METRICS['4G']

  useEffect(() => {
    if (!activeMetrics.some((m) => m.id === metric)) {
      setMetric(activeMetrics[0].id)
    }
  }, [tech, activeMetrics, metric])

  useEffect(() => {
    let alive = true
    setLoading(true)
    void (async () => {
      try {
        const r = await window.api.analytics.comparison({
          type,
          scope,
          metric,
          grain
        })
        if (alive) setResult(r)
      } catch {
        /* handle close */
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [type, scope, metric, grain, tech])

  const chartOption: EChartsOption | null = useMemo(() => {
    if (!result) return null
    const rows = rankRows(result, sort)
    return rankingOption(result, rows, view)
  }, [result, view, sort])

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
                  onClick={() => { setSelectedTech(t); setTech(t); }}
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

          {/* Grain Selector */}
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

          {/* Comparison Type */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Type:
            </span>
            <div style={{ display: 'inline-flex', background: 'var(--bg-3)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              {TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setType(t.id)}
                  style={{
                    padding: '5px 14px',
                    fontSize: '12px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    background: type === t.id ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                    color: type === t.id ? '#818cf8' : 'var(--text-dim)'
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ fontSize: '12px', color: 'var(--text-dim)', fontWeight: 600 }}>
          Scope: <strong style={{ color: '#f8fafc', textTransform: 'capitalize' }}>{scope}</strong>
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
              <path stroke="#818cf8" strokeDasharray="85, 100" strokeWidth="3.5" strokeLinecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            </svg>
            <span style={{ position: 'absolute', fontSize: '16px', fontWeight: 800, color: '#f8fafc' }}>Δ</span>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, background: 'rgba(129, 140, 248, 0.15)', color: '#818cf8', border: '1px solid rgba(129, 140, 248, 0.3)' }}>
                {tech}
              </span>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                Multi-Cell Side-by-Side Comparison Lab
              </h2>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px', margin: '4px 0 0 0' }}>
              Active Metric: <strong style={{ color: '#38bdf8' }}>{activeMetrics.find((m) => m.id === metric)?.label || metric}</strong> · Comparing {result?.rows.length ?? 0} entities across {type === 'period' ? '2 Time Periods' : '2 Regions'}.
            </p>
          </div>
        </div>
      </div>

      {/* Metric Pills selector */}
      <div style={{ background: 'var(--bg-card)', padding: '16px 20px', borderRadius: '14px', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '10px' }}>
          Select Comparison Metric:
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {activeMetrics.map((m) => (
            <button
              key={m.id}
              onClick={() => setMetric(m.id)}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 700,
                borderRadius: '8px',
                border: '1px solid var(--border)',
                cursor: 'pointer',
                background: metric === m.id ? 'linear-gradient(135deg, #059669, #10b981)' : 'var(--bg-3)',
                color: metric === m.id ? '#ffffff' : 'var(--text-dim)'
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ECharts Delta Ranking Visualization */}
      <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            Delta Distribution & Entity Ranking ({activeMetrics.find((m) => m.id === metric)?.label || metric})
          </h3>
          <div style={{ display: 'flex', gap: '6px' }}>
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  background: view === v.id ? 'var(--accent)' : 'var(--bg-3)',
                  color: view === v.id ? '#fff' : 'var(--text-dim)'
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        {chartOption ? (
          <Chart option={chartOption} height={360} />
        ) : (
          <div style={{ height: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
            {loading ? 'Loading comparison chart...' : 'No comparison data available.'}
          </div>
        )}
      </div>
    </div>
  )
}
