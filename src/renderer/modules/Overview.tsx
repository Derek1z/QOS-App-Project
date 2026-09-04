import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import { KpiCard } from '../components/KpiCard'
import TargetsModal from '../components/TargetsModal'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'

export default function Overview(): React.JSX.Element {
  const {
    technologyId,
    setTechnologyId,
    grain,
    setGrain,
    period,
    setPeriod,
    reportingRange,
    setModule,
    setTargetsModalOpen
  } = useAppStore()

  const [loading, setLoading] = useState(false)
  const [hasData] = useState(true)
  const [selectedKpiKey, setSelectedKpiKey] = useState<string>('totality')

  const techCode = technologyId === 2 ? '2G' : technologyId === 3 ? '3G' : '4G'

  // Reset KPI filter to 'totality' when technology changes
  useEffect(() => {
    setSelectedKpiKey('totality')
  }, [technologyId])

  // Core KPIs per technology for filtering
  const getCoreKpisForTech = () => {
    if (technologyId === 2) {
      return [
        { key: 'totality', label: '🌐 All Core KPIs (Totality)' },
        { key: '2g_cssr', label: '2G CSSR' },
        { key: '2g_cdr', label: '2G Call Drop Rate' },
        { key: 'tch_congestion', label: 'TCH Congestion' },
        { key: 'sdcch_congestion', label: 'SDCCH Congestion' }
      ]
    } else if (technologyId === 3) {
      return [
        { key: 'totality', label: '🌐 All Core KPIs (Totality)' },
        { key: '3g_cssr', label: '3G CSSR' },
        { key: '3g_cdr', label: '3G Call Drop Rate' },
        { key: '3g_dasr', label: '3G DASR' },
        { key: '3g_dl_power_congestion', label: 'DL Power Congestion' },
        { key: '3g_ul_ce_congestion', label: 'UL CE Congestion' }
      ]
    } else {
      return [
        { key: 'totality', label: '🌐 All Core KPIs (Totality)' },
        { key: '4g_cssr', label: '4G CSSR' },
        { key: '4g_cdr', label: '4G Call Drop Rate' },
        { key: '4g_dsaf', label: '4G DSAF' },
        { key: '4g_prb_util', label: '4G PRB Utilization' }
      ]
    }
  }

  const coreKpis = getCoreKpisForTech()

  const getNcMovementData = () => {
    // Multiplier/offset to simulate individual KPI vs totality
    const mult = selectedKpiKey === 'totality' ? 1.0 : 0.35
    if (grain === 'daily') {
      return [
        { label: 'Aug 01', newNc: Math.round(3 * mult), recurring: Math.round(2 * mult), persistent: Math.round(4 * mult), recovering: Math.round(2 * mult) },
        { label: 'Aug 02', newNc: Math.round(2 * mult), recurring: Math.round(3 * mult), persistent: Math.round(4 * mult), recovering: Math.round(1 * mult) },
        { label: 'Aug 03', newNc: Math.round(5 * mult), recurring: Math.round(2 * mult), persistent: Math.round(5 * mult), recovering: Math.round(2 * mult) },
        { label: 'Aug 04', newNc: Math.round(1 * mult), recurring: Math.round(2 * mult), persistent: Math.round(4 * mult), recovering: Math.round(3 * mult) },
        { label: 'Aug 05', newNc: Math.round(4 * mult), recurring: Math.round(1 * mult), persistent: Math.round(4 * mult), recovering: Math.round(2 * mult) },
        { label: 'Aug 06', newNc: Math.round(1 * mult), recurring: Math.round(1 * mult), persistent: Math.round(3 * mult), recovering: Math.round(3 * mult) },
        { label: 'Aug 07', newNc: Math.round(2 * mult), recurring: Math.round(2 * mult), persistent: Math.round(3 * mult), recovering: Math.round(2 * mult) }
      ]
    } else if (grain === 'weekly') {
      return [
        { label: 'Week 28', newNc: Math.round(12 * mult), recurring: Math.round(8 * mult), persistent: Math.round(14 * mult), recovering: Math.round(6 * mult) },
        { label: 'Week 29', newNc: Math.round(9 * mult), recurring: Math.round(7 * mult), persistent: Math.round(12 * mult), recovering: Math.round(8 * mult) },
        { label: 'Week 30', newNc: Math.round(7 * mult), recurring: Math.round(5 * mult), persistent: Math.round(10 * mult), recovering: Math.round(9 * mult) },
        { label: 'Week 31', newNc: Math.round(5 * mult), recurring: Math.round(4 * mult), persistent: Math.round(8 * mult), recovering: Math.round(7 * mult) },
        { label: 'Week 32', newNc: Math.round(3 * mult), recurring: Math.round(3 * mult), persistent: Math.round(6 * mult), recovering: Math.round(8 * mult) }
      ]
    } else {
      return [
        { label: 'May 2026', newNc: Math.round(38 * mult), recurring: Math.round(24 * mult), persistent: Math.round(45 * mult), recovering: Math.round(22 * mult) },
        { label: 'Jun 2026', newNc: Math.round(28 * mult), recurring: Math.round(18 * mult), persistent: Math.round(36 * mult), recovering: Math.round(26 * mult) },
        { label: 'Jul 2026', newNc: Math.round(20 * mult), recurring: Math.round(14 * mult), persistent: Math.round(26 * mult), recovering: Math.round(24 * mult) },
        { label: 'Aug 2026', newNc: Math.round(14 * mult), recurring: Math.round(10 * mult), persistent: Math.round(18 * mult), recovering: Math.round(20 * mult) }
      ]
    }
  }

  const getKpiBreachData = () => {
    const mult = selectedKpiKey === 'totality' ? 1.0 : 0.28
    if (grain === 'daily') {
      return [
        { label: 'Aug 01', totalBreaches: Math.round(24 * mult) },
        { label: 'Aug 02', totalBreaches: Math.round(18 * mult) },
        { label: 'Aug 03', totalBreaches: Math.round(31 * mult) },
        { label: 'Aug 04', totalBreaches: Math.round(14 * mult) },
        { label: 'Aug 05', totalBreaches: Math.round(22 * mult) },
        { label: 'Aug 06', totalBreaches: Math.round(12 * mult) },
        { label: 'Aug 07', totalBreaches: Math.round(16 * mult) }
      ]
    } else if (grain === 'weekly') {
      return [
        { label: 'Week 28', totalBreaches: Math.round(84 * mult) },
        { label: 'Week 29', totalBreaches: Math.round(71 * mult) },
        { label: 'Week 30', totalBreaches: Math.round(56 * mult) },
        { label: 'Week 31', totalBreaches: Math.round(42 * mult) },
        { label: 'Week 32', totalBreaches: Math.round(31 * mult) }
      ]
    } else {
      return [
        { label: 'May 2026', totalBreaches: Math.round(290 * mult) },
        { label: 'Jun 2026', totalBreaches: Math.round(224 * mult) },
        { label: 'Jul 2026', totalBreaches: Math.round(168 * mult) },
        { label: 'Aug 2026', totalBreaches: Math.round(118 * mult) }
      ]
    }
  }

  const [ncMovementData, setNcMovementData] = useState(getNcMovementData())
  const [kpiBreachData, setKpiBreachData] = useState(getKpiBreachData())

  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => {
      setNcMovementData(getNcMovementData())
      setKpiBreachData(getKpiBreachData())
      setLoading(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [grain, technologyId, reportingRange, selectedKpiKey])

  const getDynamicKpis = () => {
    if (technologyId === 2) {
      return [
        { name: '2G Call Connection Success Rate', isDerived: false, value: 98.4, unit: '%', targetStr: '≥ 98.0%', status: 'compliant' as const, trend: 'improving' as const, ncCount: 4, ncPct: 1.2 },
        { name: '2G Call Drop Rate', isDerived: false, value: 1.2, unit: '%', targetStr: '≤ 1.5%', status: 'compliant' as const, trend: 'improving' as const, ncCount: 3, ncPct: 0.9 },
        { name: 'TCH Congestion', isDerived: false, value: 1.8, unit: '%', targetStr: '≤ 1.0%', status: 'warning' as const, trend: 'worsening' as const, ncCount: 12, ncPct: 3.5 },
        { name: 'SDCCH Congestion', isDerived: false, value: 0.4, unit: '%', targetStr: '≤ 0.5%', status: 'compliant' as const, trend: 'stable' as const, ncCount: 2, ncPct: 0.6 }
      ]
    } else if (technologyId === 3) {
      return [
        { name: '3G Call Connection Success Rate', isDerived: false, value: 98.7, unit: '%', targetStr: '≥ 98.0%', status: 'compliant' as const, trend: 'improving' as const, ncCount: 2, ncPct: 0.8 },
        { name: '3G Call Drop Rate', isDerived: false, value: 1.4, unit: '%', targetStr: '≤ 2.0%', status: 'compliant' as const, trend: 'improving' as const, ncCount: 3, ncPct: 1.1 },
        { name: '3G Data Access Success Rate', isDerived: false, value: 97.9, unit: '%', targetStr: '≥ 97.0%', status: 'compliant' as const, trend: 'stable' as const, ncCount: 5, ncPct: 1.8 },
        { name: 'DL Power Congestion', isDerived: true, value: 142, unit: '', targetStr: '≤ 50', status: 'breach' as const, trend: 'improving' as const, ncCount: 14, ncPct: 5.2 },
        { name: 'UL CE Congestion', isDerived: true, value: 63, unit: '', targetStr: '≤ 30', status: 'warning' as const, trend: 'worsening' as const, ncCount: 8, ncPct: 3.0 },
        { name: 'PhyCh Failures', isDerived: true, value: null, unit: '', targetStr: '≤ 20', status: 'unavailable' as const, trend: 'stable' as const, ncCount: 0, ncPct: 0 }
      ]
    } else {
      return [
        { name: '4G Call Connection Success Rate', isDerived: false, value: 99.1, unit: '%', targetStr: '≥ 98.5%', status: 'compliant' as const, trend: 'improving' as const, ncCount: 2, ncPct: 0.5 },
        { name: '4G Call Drop Rate', isDerived: false, value: 0.8, unit: '%', targetStr: '≤ 1.0%', status: 'compliant' as const, trend: 'improving' as const, ncCount: 3, ncPct: 0.8 },
        { name: '4G Data Service Access Failure Rate', isDerived: false, value: 1.1, unit: '%', targetStr: '≤ 1.5%', status: 'compliant' as const, trend: 'stable' as const, ncCount: 4, ncPct: 1.0 },
        { name: '4G Peak Hour PRB Utilization', isDerived: false, value: 74.2, unit: '%', targetStr: '≤ 80.0%', status: 'compliant' as const, trend: 'improving' as const, ncCount: 11, ncPct: 2.8 }
      ]
    }
  }

  const kpiCards = getDynamicKpis()

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1400px', margin: '0 auto', color: 'var(--text)' }}>
      {/* Onboarding CTA Card (if empty workspace) */}
      {!hasData && (
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(30, 27, 75, 0.5), rgba(15, 23, 42, 0.9))',
            padding: '36px',
            borderRadius: '16px',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            textAlign: 'center',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)'
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🚀</div>
          <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#f8fafc', margin: '0 0 8px 0' }}>
            Get Started by Importing Telecom QoS Data
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-dim)', maxWidth: '560px', margin: '0 auto 20px auto' }}>
            Import CSV or multi-sheet XLSX performance counter files to unlock dynamic KPI intelligence, multi-grain breach analytics, and target management.
          </p>
          <button
            onClick={() => setModule('data-manager')}
            style={{
              padding: '10px 24px',
              background: 'linear-gradient(135deg, #059669, #10b981)',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 700,
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
            }}
          >
            Import 2G / 3G / 4G Data
          </button>
        </div>
      )}

      {/* Executive Control Bar: Technology, Granularity & Target Controls */}
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
          {/* Technology Pill Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Technology:
            </span>
            <div style={{ display: 'inline-flex', background: 'var(--bg-3)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              {[
                { id: 2, label: '2G' },
                { id: 3, label: '3G' },
                { id: 4, label: '4G' }
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTechnologyId(t.id)}
                  style={{
                    padding: '5px 16px',
                    fontSize: '12px',
                    fontWeight: 800,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    background: technologyId === t.id ? 'linear-gradient(135deg, #059669, #10b981)' : 'transparent',
                    color: technologyId === t.id ? '#ffffff' : 'var(--text-dim)',
                    boxShadow: technologyId === t.id ? '0 2px 6px rgba(16, 185, 129, 0.3)' : 'none'
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Granularity Pill Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Granularity:
            </span>
            <div style={{ display: 'inline-flex', background: 'var(--bg-3)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              {[
                { id: 'daily', label: 'Daily' },
                { id: 'weekly', label: 'Weekly' }
              ].map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGrain(g.id as 'daily' | 'weekly')}
                  style={{
                    padding: '5px 16px',
                    fontSize: '12px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    background: grain === g.id ? 'var(--accent)' : 'transparent',
                    color: grain === g.id ? '#ffffff' : 'var(--text-dim)'
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* Period Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Range:
            </span>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as any)}
              style={{
                background: 'var(--bg-3)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '5px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <option value="7d">Last 7 days</option>
              <option value="4w">Last 4 weeks</option>
              <option value="12w">Last 12 weeks</option>
              <option value="mtd">Month to date</option>
              <option value="3m">Last 3 months</option>
            </select>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={() => setTargetsModalOpen(true)}
          style={{
            padding: '6px 14px',
            background: 'var(--bg-3)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          🎯 Target & Worst-Cell Rules
        </button>
      </div>

      {/* Main Technology Health Score Banner */}
      {hasData && (
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
                <path
                  stroke="var(--bg-3)"
                  strokeWidth="3.5"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  stroke="#34d399"
                  strokeDasharray="92, 100"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <span style={{ position: 'absolute', fontSize: '18px', fontWeight: 800, color: '#f8fafc' }}>92%</span>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 800,
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: '#34d399',
                    border: '1px solid rgba(16, 185, 129, 0.3)'
                  }}
                >
                  {techCode}
                </span>
                <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                  {techCode} Network Health & Non-Compliance Summary
                </h2>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px', margin: '4px 0 0 0' }}>
                Active scope: <strong style={{ color: 'var(--text)', textTransform: 'capitalize' }}>{grain}</strong> grain · 380 Total Cells · 12 Non-Compliant (3 New NC, 3 Recurring, 6 Persistent, 8 Recovering)
              </p>
            </div>
          </div>

          <div>
            <button
              onClick={() => setTargetsModalOpen(true)}
              style={{
                padding: '8px 16px',
                fontSize: '12px',
                fontWeight: 600,
                background: 'var(--bg-3)',
                color: '#e2e8f0',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              Configure {techCode} Targets
            </button>
          </div>
        </div>
      )}

      {/* Dynamic KPI Cards Grid */}
      {hasData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.5px', textTransform: 'uppercase', margin: 0 }}>
              {techCode} Available KPI Metrics ({kpiCards.length})
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
              Prioritized by: Core KPIs → Configured Derived → Imported KPIs
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '16px'
            }}
          >
            {kpiCards.map((card, idx) => (
              <KpiCard
                key={idx}
                name={card.name}
                isDerived={card.isDerived}
                value={card.value}
                displayUnit={card.unit}
                targetStr={card.targetStr}
                status={card.status}
                trend={card.trend}
                ncCount={card.ncCount}
                ncPct={card.ncPct}
              />
            ))}
          </div>
        </div>
      )}

      {/* Core KPI vs Totality Filter Selector Bar */}
      {hasData && (
        <div
          style={{
            background: 'var(--bg-card)',
            padding: '12px 18px',
            borderRadius: '12px',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>🔍</span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#f8fafc' }}>
              Scope Movement &amp; Breaches By:
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {coreKpis.map((kpi) => {
              const active = selectedKpiKey === kpi.key
              return (
                <button
                  key={kpi.key}
                  onClick={() => setSelectedKpiKey(kpi.key)}
                  style={{
                    padding: '5px 12px',
                    fontSize: '11.5px',
                    fontWeight: active ? 700 : 500,
                    borderRadius: '6px',
                    border: active ? '1px solid #38bdf8' : '1px solid var(--border)',
                    background: active ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg)',
                    color: active ? '#38bdf8' : 'var(--text-dim)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {kpi.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Two Dedicated Charts: 1. NC Cell Movement Breakdown vs 2. KPI Breach Telemetry */}
      {hasData && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(540px, 1fr))', gap: '20px' }}>
          {/* Chart 1: NC Cell Movement Breakdown */}
          <div
            style={{
              position: 'relative',
              background: 'var(--bg-card)',
              padding: '20px 24px',
              borderRadius: '16px',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)'
            }}
          >
            {loading && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(11, 15, 23, 0.75)',
                  backdropFilter: 'blur(2px)',
                  zIndex: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#818cf8', fontSize: '13px', fontWeight: 600 }}>
                  <span>⏳</span> Querying {grain} NC Movement...
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🔄</span> {techCode} Non-Compliance (NC) Cell Movement ({grain.toUpperCase()})
                </h3>
                <p style={{ fontSize: '11.5px', color: 'var(--text-dim)', margin: '4px 0 0 0' }}>
                  Scope: <strong style={{ color: '#38bdf8' }}>{coreKpis.find((k) => k.key === selectedKpiKey)?.label}</strong> · Cell transitions (New NC, Recurring, Persistent, Recovering)
                </p>
              </div>
              <span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px', background: 'var(--bg)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
                Grain: <strong style={{ color: '#818cf8', textTransform: 'capitalize' }}>{grain}</strong>
              </span>
            </div>

            <div style={{ width: '100%', height: '260px', paddingTop: '10px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ncMovementData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px', color: '#f8fafc' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                  <Bar dataKey="newNc" name="New NC" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="recurring" name="Recurring NC" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="persistent" name="Persistent NC" stackId="a" fill="#8b5cf6" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="recovering" name="Recovering" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: KPI Threshold Breach Telemetry */}
          <div
            style={{
              position: 'relative',
              background: 'var(--bg-card)',
              padding: '20px 24px',
              borderRadius: '16px',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)'
            }}
          >
            {loading && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(11, 15, 23, 0.75)',
                  backdropFilter: 'blur(2px)',
                  zIndex: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#818cf8', fontSize: '13px', fontWeight: 600 }}>
                  <span>⏳</span> Querying {grain} Telemetry...
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>📊</span> {techCode} KPI Threshold Breach Telemetry ({grain.toUpperCase()})
                </h3>
                <p style={{ fontSize: '11.5px', color: 'var(--text-dim)', margin: '4px 0 0 0' }}>
                  Scope: <strong style={{ color: '#38bdf8' }}>{coreKpis.find((k) => k.key === selectedKpiKey)?.label}</strong> · Threshold violations
                </p>
              </div>
              <span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px', background: 'var(--bg)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
                Grain: <strong style={{ color: '#818cf8', textTransform: 'capitalize' }}>{grain}</strong>
              </span>
            </div>

            <div style={{ width: '100%', height: '260px', paddingTop: '10px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={kpiBreachData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="breachGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px', color: '#f8fafc' }}
                  />
                  <Area type="monotone" dataKey="totalBreaches" name="Total KPI Breaches" stroke="#ef4444" strokeWidth={2.5} fillOpacity={1} fill="url(#breachGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Targets Drawer Modal */}
      <TargetsModal />
    </div>
  )
}
