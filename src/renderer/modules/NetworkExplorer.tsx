import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import type {
  CellDetail,
  ExplorerBreadcrumb,
  ExplorerLevel,
  ExplorerNode,
  ExplorerResult,
  Grain,
  Technology
} from '../../../shared/api'
import { LIFECYCLE_STYLE, type Lifecycle } from '../../../shared/lifecycle'
import Chart from '../lib/Chart'
import { cellDetailOption } from '../lib/cellCharts'

const LEVEL_LABEL: Record<ExplorerLevel, string> = {
  region: 'Region',
  district: 'District',
  site: 'BTS Site',
  cell: 'Sector Cell'
}

const LEVEL_ICON: Record<ExplorerLevel, string> = {
  region: '🌍',
  district: '🏙️',
  site: '📡',
  cell: '📶'
}

const CHILD_LEVEL: Record<Exclude<ExplorerLevel, 'cell'>, ExplorerLevel> = {
  region: 'district',
  district: 'site',
  site: 'cell'
}

function healthColor(s: number | null): string {
  if (s == null) return '#64748b'
  if (s >= 80) return '#34d399'
  if (s >= 65) return '#fbbf24'
  return '#f87171'
}

function healthStatus(s: number | null): { label: string; color: string; bg: string } {
  if (s == null) return { label: 'Unknown', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' }
  if (s >= 80) return { label: 'Optimal', color: '#34d399', bg: 'rgba(52, 211, 153, 0.15)' }
  if (s >= 65) return { label: 'Degraded', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)' }
  return { label: 'Critical', color: '#f87171', bg: 'rgba(248, 113, 113, 0.15)' }
}

const fmtPct = (v: number | null): string => (v == null ? '—' : `${v.toFixed(1)}%`)
const fmtMbps = (v: number | null): string => (v == null ? '—' : `${(v / 1024).toFixed(1)} Mbps`)
const fmtG = (v: number | null): string =>
  v == null ? '—' : v >= 1024 * 1024 ? `${(v / (1024 * 1024)).toFixed(1)} TB` : `${(v / 1024).toFixed(1)} GB`
const fmtN = (v: number | null): string => (v == null ? '—' : Math.round(v).toLocaleString())

export default function NetworkExplorer(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const grain = useAppStore((s) => s.grain)
  const setGrain = useAppStore((s) => s.setGrain)
  const selectedTech = useAppStore((s) => s.selectedTech)
  const setSelectedTech = useAppStore((s) => s.setSelectedTech)
  const setInvestigationTarget = useAppStore((s) => s.setInvestigationTarget)
  const setModule = useAppStore((s) => s.setModule)
  const togglePin = useAppStore((s) => s.togglePin)
  const isPinned = useAppStore((s) => s.isPinned)

  const explorerState = useAppStore((s) => s.explorerState)
  const setExplorerState = useAppStore((s) => s.setExplorerState)

  const level = explorerState.level || 'region'
  const parentId = explorerState.parentId ?? null
  const q = explorerState.search || ''

  const setLevel = (l: ExplorerLevel) => setExplorerState({ level: l })
  const setParentId = (p: number | null) => setExplorerState({ parentId: p })
  const setQ = (s: string) => setExplorerState({ search: s })

  const [result, setResult] = useState<ExplorerResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'nc' | 'healthy' | 'critical'>('all')
  const [viewMode, setViewMode] = useState<'grid' | 'matrix'>('grid')

  const [detail, setDetail] = useState<CellDetail | null>(null)
  const [selectedCellNode, setSelectedCellNode] = useState<ExplorerNode | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [prbThreshold, setPrbThreshold] = useState(80)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(
    async (lvl: ExplorerLevel, pid: number | null, query: string): Promise<void> => {
      setLoading(true)
      try {
        const r = await window.api.analytics.explorer(lvl, pid, { q: query.trim() || undefined })
        setResult(r)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void load(level, parentId, q), q === '' ? 0 : 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [workspace?.path, level, parentId, q, load, selectedTech, grain])

  useEffect(() => {
    void (async () => {
      try {
        const rules = await window.api.rules.get()
        if (rules) setPrbThreshold(rules.prbThresholdPct)
      } catch {
        /* keep default */
      }
    })()
  }, [workspace?.path])

  useEffect(() => {
    if (detailOpen && selectedCellNode) {
      void (async () => {
        setDetailLoading(true)
        try {
          const d = await window.api.analytics.cellDetail(selectedCellNode.id, grain)
          if (d) setDetail(d)
        } finally {
          setDetailLoading(false)
        }
      })()
    }
  }, [grain, selectedCellNode, detailOpen])

  function drill(node: ExplorerNode): void {
    if (node.level === 'cell') {
      setSelectedCellNode(node)
      setDetailOpen(true)
      return
    }
    const nextLevel = CHILD_LEVEL[node.level]
    setQ('')
    setLevel(nextLevel)
    setParentId(node.id)
  }

  function jumpTo(crumb: ExplorerBreadcrumb): void {
    setQ('')
    setLevel(crumb.level)
    setParentId(crumb.id)
  }

  function jumpToRoot(): void {
    setQ('')
    setLevel('region')
    setParentId(null)
  }

  function handleInvestigateCell(node: ExplorerNode): void {
    const breadcrumbNames = (result?.breadcrumb ?? []).map((b) => b.name)
    setInvestigationTarget({
      id: node.id,
      name: node.name,
      scope: node.level,
      path: [...breadcrumbNames, node.name]
    })
    setModule('investigation')
  }

  const nodes = (result?.nodes ?? []).filter((n) => {
    if (statusFilter === 'nc') return n.ncCells > 0 || n.isNc
    if (statusFilter === 'healthy') return n.ncCells === 0 && !n.isNc
    if (statusFilter === 'critical') return n.severity === 'Critical' || (n.healthScore != null && n.healthScore < 65)
    return true
  })

  const totalNodesCount = result?.nodes?.length ?? 0
  const totalCellsCount = result?.totalCells ?? 0
  const ncCellsCount = result?.ncCells ?? 0
  const ncPct = totalCellsCount > 0 ? ((ncCellsCount / totalCellsCount) * 100).toFixed(1) : '0.0'
  const avgHealth =
    totalNodesCount > 0
      ? ((result?.nodes ?? []).reduce((acc, curr) => acc + (curr.healthScore ?? 100), 0) / totalNodesCount).toFixed(1)
      : '100'
  const totalVolume = (result?.nodes ?? []).reduce((acc, curr) => acc + (curr.volumeMb ?? 0), 0)
  const avgSpeed =
    totalNodesCount > 0
      ? (result?.nodes ?? []).reduce((acc, curr) => acc + (curr.throughputKbps ?? 0), 0) / totalNodesCount
      : 0

  const isCellLevel = level === 'cell'
  const is4G = selectedTech === '4G'
  const is3G = selectedTech === '3G'

  const chartOption = detail ? cellDetailOption(detail, prbThreshold, grain, selectedTech) : null

  return (
    <div
      style={{
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        maxWidth: '1500px',
        margin: '0 auto',
        color: 'var(--text)'
      }}
    >
      {/* 1. Header Control Bar */}
      <div
        style={{
          background: 'var(--bg-card)',
          padding: '16px 22px',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '14px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '22px'
            }}
          >
            🌐
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                Network Topology & Hierarchy Explorer
              </h2>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '3px 9px',
                  borderRadius: '6px',
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)'
                }}
              >
                {LEVEL_LABEL[level]} Tier
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', margin: '2px 0 0 0' }}>
              Multi-Level Physical & Logical Rollup: Region → District → BTS Site → Sector Cell
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Technology Selector */}
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-3)',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid var(--border)'
            }}
          >
            {(['2G', '3G', '4G'] as Technology[]).map((t) => (
              <button
                key={t}
                onClick={() => setSelectedTech(t)}
                style={{
                  padding: '5px 14px',
                  fontSize: '11px',
                  fontWeight: 800,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  background: selectedTech === t ? 'linear-gradient(135deg, #059669, #10b981)' : 'transparent',
                  color: selectedTech === t ? '#ffffff' : 'var(--text-dim)',
                  boxShadow: selectedTech === t ? '0 2px 6px rgba(16, 185, 129, 0.3)' : 'none'
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Granularity Selector */}
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-3)',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid var(--border)'
            }}
          >
            {(['daily', 'weekly'] as Grain[]).map((g) => (
              <button
                key={g}
                onClick={() => setGrain(g)}
                style={{
                  padding: '5px 14px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  background: grain === g ? 'var(--accent)' : 'transparent',
                  color: grain === g ? '#0f172a' : 'var(--text-dim)'
                }}
              >
                {g === 'daily' ? 'Daily' : 'Weekly'}
              </button>
            ))}
          </div>

          {/* View Mode Switcher */}
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-3)',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid var(--border)'
            }}
          >
            <button
              onClick={() => setViewMode('grid')}
              style={{
                padding: '5px 12px',
                fontSize: '11px',
                fontWeight: 700,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'grid' ? 'var(--accent)' : 'transparent',
                color: viewMode === 'grid' ? '#0f172a' : 'var(--text-dim)'
              }}
            >
              ☷ Cards Grid
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              style={{
                padding: '5px 12px',
                fontSize: '11px',
                fontWeight: 700,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'matrix' ? 'var(--accent)' : 'transparent',
                color: viewMode === 'matrix' ? '#0f172a' : 'var(--text-dim)'
              }}
            >
              📋 Matrix
            </button>
          </div>
        </div>
      </div>

      {/* 2. Top Executive Scorecards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
        {/* Scope Inventory */}
        <div
          style={{
            background: 'var(--bg-card)',
            padding: '20px',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}
        >
          <div>
            <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Scope Inventory ({selectedTech})
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#f8fafc', margin: '6px 0' }}>
              {totalNodesCount.toLocaleString()} <span style={{ fontSize: '14px', fontWeight: 600, color: '#38bdf8' }}>{LEVEL_LABEL[level]}s</span>
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
            Rollup: <strong style={{ color: '#f8fafc' }}>{totalCellsCount.toLocaleString()} cells</strong> in active scope
          </div>
        </div>

        {/* Composite Health Score with Circular Gauge */}
        <div
          style={{
            background: 'var(--bg-card)',
            padding: '20px',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}
        >
          <div>
            <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Composite Health Score
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: healthColor(Number(avgHealth)), margin: '6px 0' }}>
              {avgHealth} <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-dim)' }}>/ 100</span>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: healthStatus(Number(avgHealth)).bg,
                  color: healthStatus(Number(avgHealth)).color
                }}
              >
                {healthStatus(Number(avgHealth)).label}
              </span>
            </div>
          </div>
          <div style={{ position: 'relative', width: '64px', height: '64px', minWidth: '64px' }}>
            <svg width="64" height="64" viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)' }}>
              <path
                stroke="var(--bg-3)"
                strokeWidth="3.5"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                stroke={healthColor(Number(avgHealth))}
                strokeDasharray={`${Math.min(100, Math.max(0, Number(avgHealth)))}, 100`}
                strokeWidth="3.5"
                strokeLinecap="round"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 800,
                color: '#f8fafc'
              }}
            >
              {Math.round(Number(avgHealth))}%
            </div>
          </div>
        </div>

        {/* Non-Compliant Ratio */}
        <div
          style={{
            background: 'var(--bg-card)',
            padding: '20px',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}
        >
          <div>
            <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Non-Compliant Ratio
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: ncCellsCount > 0 ? '#f87171' : '#34d399', margin: '6px 0' }}>
              {ncCellsCount.toLocaleString()} <span style={{ fontSize: '14px', fontWeight: 600 }}>({ncPct}%)</span>
            </div>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: '4px',
                background: ncCellsCount > 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                color: ncCellsCount > 0 ? '#f87171' : '#34d399',
                border: ncCellsCount > 0 ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)'
              }}
            >
              {ncCellsCount > 0 ? `${ncCellsCount} cells requiring intervention` : 'All cells compliant'}
            </span>
          </div>
        </div>

        {/* Payload Volume & Speed */}
        <div
          style={{
            background: 'var(--bg-card)',
            padding: '20px',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}
        >
          <div>
            <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Payload Volume & Throughput
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#38bdf8', margin: '6px 0' }}>
              {fmtG(totalVolume)}
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
            Average Speed: <strong style={{ color: '#f8fafc' }}>{(avgSpeed / 1024).toFixed(1)} Mbps</strong>
          </div>
        </div>
      </div>

      {/* 3. Interactive 4-Tier Hierarchy Breadcrumb & Filter Bar */}
      <div
        style={{
          background: 'var(--bg-card)',
          padding: '12px 20px',
          borderRadius: '14px',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {[
            { id: 'region' as ExplorerLevel, icon: '🌍', label: '1. Regions' },
            { id: 'district' as ExplorerLevel, icon: '🏙️', label: '2. Districts' },
            { id: 'site' as ExplorerLevel, icon: '📡', label: '3. BTS Sites' },
            { id: 'cell' as ExplorerLevel, icon: '📶', label: '4. Sector Cells' }
          ].map((tier, idx) => {
            const isCurrent = level === tier.id
            return (
              <React.Fragment key={tier.id}>
                {idx > 0 && <span style={{ color: 'var(--text-dim)', fontSize: '12px' }}>───›</span>}
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    borderRadius: '8px',
                    background: isCurrent ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-3)',
                    border: isCurrent ? '1px solid #38bdf8' : '1px solid var(--border)',
                    color: isCurrent ? '#38bdf8' : 'var(--text-dim)',
                    fontSize: '12px',
                    fontWeight: isCurrent ? 800 : 600,
                    boxShadow: isCurrent ? '0 0 12px rgba(56, 189, 248, 0.25)' : 'none'
                  }}
                >
                  <span>{tier.icon}</span>
                  <span>{tier.label}</span>
                </div>
              </React.Fragment>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          {[
            { id: 'all', label: 'All Assets' },
            { id: 'nc', label: '⚠️ Non-Compliant' },
            { id: 'healthy', label: '✅ Compliant' },
            { id: 'critical', label: '🔥 Critical' }
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id as any)}
              style={{
                padding: '5px 12px',
                fontSize: '11px',
                fontWeight: 700,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                background: statusFilter === f.id ? 'var(--accent)' : 'var(--bg-3)',
                color: statusFilter === f.id ? '#0f172a' : 'var(--text-dim)'
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4. Breadcrumb Navigation & Search Filter */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            onClick={jumpToRoot}
            style={{
              background: level === 'region' ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-3)',
              color: level === 'region' ? '#38bdf8' : 'var(--text-dim)',
              border: level === 'region' ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid var(--border)',
              borderRadius: '6px',
              padding: '5px 12px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            🌍 National Network
          </button>

          {(result?.breadcrumb ?? []).map((b, i) => (
            <React.Fragment key={`${b.level}-${b.id}`}>
              <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>›</span>
              <button
                onClick={() => jumpTo(b)}
                style={{
                  background: i === (result?.breadcrumb?.length ?? 0) - 1 ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-3)',
                  color: i === (result?.breadcrumb?.length ?? 0) - 1 ? '#38bdf8' : 'var(--text-dim)',
                  border:
                    i === (result?.breadcrumb?.length ?? 0) - 1
                      ? '1px solid rgba(56, 189, 248, 0.3)'
                      : '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '5px 12px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                {LEVEL_ICON[b.level]} {b.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ position: 'relative' }}>
            <span
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '12px',
                color: 'var(--text-dim)'
              }}
            >
              🔍
            </span>
            <input
              type="text"
              placeholder={`Filter ${LEVEL_LABEL[level].toLowerCase()}s...`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{
                background: 'var(--bg-3)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '6px 12px 6px 30px',
                fontSize: '12px',
                width: '240px',
                outline: 'none'
              }}
            />
          </div>
          {q && (
            <button
              onClick={() => setQ('')}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 5. Error Alert if any */}
      {error && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '12px',
            padding: '12px 16px',
            color: '#f87171',
            fontSize: '13px'
          }}
        >
          <strong>Notice:</strong> {error}
        </div>
      )}

      {/* 6. Loading State */}
      {loading ? (
        <div
          style={{
            background: 'var(--bg-card)',
            padding: '60px 20px',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            textAlign: 'center',
            color: 'var(--text-dim)'
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
            Loading {LEVEL_LABEL[level]} Topology...
          </div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>
            Aggregating performance telemetry for {selectedTech} ({grain})
          </div>
        </div>
      ) : nodes.length === 0 ? (
        /* Empty State */
        <div
          style={{
            background: 'var(--bg-card)',
            padding: '60px 20px',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            textAlign: 'center',
            color: 'var(--text-dim)'
          }}
        >
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>🔎</div>
          <div style={{ fontSize: '16px', fontWeight: 800, color: '#f8fafc' }}>No matching assets found</div>
          <p style={{ fontSize: '13px', margin: '6px 0 16px 0' }}>
            No {LEVEL_LABEL[level].toLowerCase()}s match the filter &ldquo;{statusFilter}&rdquo; {q ? `and search query &ldquo;${q}&rdquo;` : ''}.
          </p>
          <button
            onClick={() => {
              setStatusFilter('all')
              setQ('')
            }}
            style={{
              padding: '8px 18px',
              background: 'var(--accent)',
              color: '#0f172a',
              fontSize: '12px',
              fontWeight: 700,
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            Reset Filters
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        /* 7. CARDS GRID VIEW */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
          {nodes.map((n) => {
            const hColor = healthColor(n.healthScore)
            const hStat = healthStatus(n.healthScore)
            return (
              <div
                key={`${level}-${n.id}`}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: '16px',
                  border: n.ncCells > 0 || n.isNc ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid var(--border)',
                  padding: '18px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '14px',
                  boxShadow: '0 4px 14px rgba(0, 0, 0, 0.2)',
                  transition: 'transform 0.15s ease, border-color 0.15s ease'
                }}
              >
                {/* Card Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        background: 'var(--bg-3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '18px'
                      }}
                    >
                      {LEVEL_ICON[n.level]}
                    </div>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.3px' }}>
                        {n.name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '1px' }}>
                        {LEVEL_LABEL[n.level]}
                      </div>
                    </div>
                  </div>

                  {/* Health Score Badge */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 10px',
                      borderRadius: '8px',
                      background: hStat.bg,
                      border: `1px solid ${hColor}40`
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 800, color: hColor }}>
                      {n.healthScore ?? '—'}
                    </span>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: hColor, textTransform: 'uppercase' }}>
                      {hStat.label}
                    </span>
                  </div>
                </div>

                {/* Health Score Mini Progress Bar */}
                {n.healthScore != null && (
                  <div style={{ width: '100%', height: '4px', background: 'var(--bg-3)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(100, Math.max(0, n.healthScore))}%`,
                        height: '100%',
                        background: hColor,
                        transition: 'width 0.3s ease'
                      }}
                    />
                  </div>
                )}

                {/* Key Metrics Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                    background: 'var(--bg-3)',
                    padding: '12px',
                    borderRadius: '12px',
                    border: '1px solid var(--border)',
                    fontSize: '11.5px'
                  }}
                >
                  <div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}>
                      {isCellLevel ? 'Compliance' : 'NC Cells'}
                    </div>
                    <div style={{ fontWeight: 800, color: n.ncCells > 0 || n.isNc ? '#f87171' : '#34d399', marginTop: '2px' }}>
                      {isCellLevel
                        ? n.isNc
                          ? 'Non-Compliant'
                          : 'Compliant'
                        : `${n.ncCells} / ${n.cells} cells (${((n.ncCells / Math.max(1, n.cells)) * 100).toFixed(0)}%)`}
                    </div>
                  </div>

                  <div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}>
                      {is4G ? 'PRB Util' : is3G ? '3G Util' : 'TCH Cong'}
                    </div>
                    <div style={{ fontWeight: 800, color: '#f8fafc', marginTop: '2px' }}>
                      {fmtPct(n.prbAvg)}
                    </div>
                  </div>

                  <div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}>
                      Throughput
                    </div>
                    <div style={{ fontWeight: 800, color: '#38bdf8', marginTop: '2px' }}>
                      {fmtMbps(n.throughputKbps)}
                    </div>
                  </div>

                  <div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}>
                      Availability
                    </div>
                    <div
                      style={{
                        fontWeight: 800,
                        color: n.availability != null && n.availability < 98 ? '#fbbf24' : '#34d399',
                        marginTop: '2px'
                      }}
                    >
                      {fmtPct(n.availability)}
                    </div>
                  </div>

                  {is4G && n.users != null && (
                    <div>
                      <div style={{ color: 'var(--text-dim)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}>
                        Active Users
                      </div>
                      <div style={{ fontWeight: 800, color: '#f8fafc', marginTop: '2px' }}>{fmtN(n.users)}</div>
                    </div>
                  )}

                  {is4G && n.volumeMb != null && (
                    <div>
                      <div style={{ color: 'var(--text-dim)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}>
                        Data Volume
                      </div>
                      <div style={{ fontWeight: 800, color: '#f8fafc', marginTop: '2px' }}>{fmtG(n.volumeMb)}</div>
                    </div>
                  )}

                  {isCellLevel && n.lifecycle && (
                    <div style={{ gridColumn: 'span 2', display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 800,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: LIFECYCLE_STYLE[(n.lifecycle as Lifecycle) ?? 'Healthy']?.bg ?? LIFECYCLE_STYLE.Healthy.bg,
                          color: LIFECYCLE_STYLE[(n.lifecycle as Lifecycle) ?? 'Healthy']?.color ?? LIFECYCLE_STYLE.Healthy.color
                        }}
                      >
                        {n.lifecycle}
                      </span>
                      {n.severity && (
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background:
                              n.severity === 'Critical'
                                ? 'rgba(239, 68, 68, 0.2)'
                                : n.severity === 'High'
                                ? 'rgba(251, 191, 36, 0.2)'
                                : 'rgba(148, 163, 184, 0.2)',
                            color:
                              n.severity === 'Critical'
                                ? '#f87171'
                                : n.severity === 'High'
                                ? '#fbbf24'
                                : '#94a3b8'
                          }}
                        >
                          {n.severity}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Action Buttons */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    onClick={() => drill(n)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.15), rgba(56, 189, 248, 0.05))',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span>
                      {isCellLevel
                        ? 'Inspect Telemetry ↗'
                        : `Explore ${CHILD_LEVEL[n.level as Exclude<ExplorerLevel, 'cell'>]}s ›`}
                    </span>
                  </button>

                  <button
                    onClick={() => handleInvestigateCell(n)}
                    title="Send to Deep Investigation Workspace"
                    style={{
                      padding: '8px 12px',
                      background: 'var(--bg-3)',
                      color: 'var(--text-dim)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span>🎯</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* 8. HIGH-DENSITY MATRIX VIEW */
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            overflow: 'hidden',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.2)'
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ background: 'var(--bg-3)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '12px 16px', color: 'var(--text-dim)', fontWeight: 800, fontSize: '11px', textTransform: 'uppercase' }}>
                    {LEVEL_LABEL[level]} Name
                  </th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-dim)', fontWeight: 800, fontSize: '11px', textTransform: 'uppercase' }}>
                    Health Score
                  </th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-dim)', fontWeight: 800, fontSize: '11px', textTransform: 'uppercase' }}>
                    NC Ratio
                  </th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-dim)', fontWeight: 800, fontSize: '11px', textTransform: 'uppercase' }}>
                    {is4G ? 'PRB Util' : is3G ? '3G Util' : 'TCH Cong'}
                  </th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-dim)', fontWeight: 800, fontSize: '11px', textTransform: 'uppercase' }}>
                    Throughput
                  </th>
                  {is4G && (
                    <>
                      <th style={{ padding: '12px 16px', color: 'var(--text-dim)', fontWeight: 800, fontSize: '11px', textTransform: 'uppercase' }}>
                        Users
                      </th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-dim)', fontWeight: 800, fontSize: '11px', textTransform: 'uppercase' }}>
                        Volume
                      </th>
                    </>
                  )}
                  <th style={{ padding: '12px 16px', color: 'var(--text-dim)', fontWeight: 800, fontSize: '11px', textTransform: 'uppercase' }}>
                    Availability
                  </th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-dim)', fontWeight: 800, fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n, idx) => {
                  const hColor = healthColor(n.healthScore)
                  return (
                    <tr
                      key={`${level}-${n.id}`}
                      onClick={() => drill(n)}
                      style={{
                        background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        cursor: 'pointer',
                        transition: 'background 0.1s ease'
                      }}
                    >
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>{LEVEL_ICON[n.level]}</span>
                          <span style={{ fontWeight: 700, color: '#f8fafc' }}>{n.name}</span>
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: 800, color: hColor, minWidth: '32px' }}>{n.healthScore ?? '—'}</span>
                          {n.healthScore != null && (
                            <div style={{ width: '60px', height: '4px', background: 'var(--bg-3)', borderRadius: '2px', overflow: 'hidden' }}>
                              <div style={{ width: `${n.healthScore}%`, height: '100%', background: hColor }} />
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {isCellLevel ? (
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background: n.isNc ? 'rgba(239, 68, 68, 0.15)' : 'rgba(52, 211, 153, 0.15)',
                              color: n.isNc ? '#f87171' : '#34d399'
                            }}
                          >
                            {n.isNc ? 'Non-Compliant' : 'Compliant'}
                          </span>
                        ) : (
                          <span style={{ fontWeight: 700, color: n.ncCells > 0 ? '#f87171' : '#34d399' }}>
                            {n.ncCells} / {n.cells}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 600 }}>{fmtPct(n.prbAvg)}</td>
                      <td style={{ padding: '12px 16px', color: '#38bdf8', fontWeight: 700 }}>{fmtMbps(n.throughputKbps)}</td>
                      {is4G && (
                        <>
                          <td style={{ padding: '12px 16px' }}>{fmtN(n.users)}</td>
                          <td style={{ padding: '12px 16px' }}>{fmtG(n.volumeMb)}</td>
                        </>
                      )}
                      <td style={{ padding: '12px 16px', color: n.availability != null && n.availability < 98 ? '#fbbf24' : '#34d399' }}>
                        {fmtPct(n.availability)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '6px' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              drill(n)
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              background: 'rgba(56, 189, 248, 0.15)',
                              border: '1px solid rgba(56, 189, 248, 0.3)',
                              color: '#38bdf8',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            {isCellLevel ? 'Inspect ↗' : 'Drill ›'}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleInvestigateCell(n)
                            }}
                            title="Investigate"
                            style={{
                              padding: '4px 8px',
                              borderRadius: '6px',
                              background: 'var(--bg-3)',
                              border: '1px solid var(--border)',
                              color: 'var(--text-dim)',
                              fontSize: '11px',
                              cursor: 'pointer'
                            }}
                          >
                            🎯
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 9. Cell Telemetry & Analytics Slide-Out Modal / Drawer */}
      {detailOpen && selectedCellNode && (
        <div
          onClick={() => setDetailOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            justifyContent: 'flex-end'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(760px, 92vw)',
              height: '100%',
              background: '#0b1329',
              borderLeft: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-10px 0 40px rgba(0, 0, 0, 0.6)',
              overflowY: 'auto',
              padding: '28px'
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', paddingBottom: '20px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '24px' }}>📶</span>
                  <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                    {selectedCellNode.name}
                  </h3>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
                  {[detail?.site, detail?.district, detail?.region].filter(Boolean).join(' · ') || 'Sector Cell Detail'}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => {
                    togglePin({
                      id: `cell:${selectedCellNode.id}`,
                      type: 'cell',
                      name: selectedCellNode.name,
                      detail: detail?.site ?? undefined
                    })
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    background: isPinned(`cell:${selectedCellNode.id}`) ? 'rgba(251, 191, 36, 0.2)' : 'var(--bg-3)',
                    border: isPinned(`cell:${selectedCellNode.id}`) ? '1px solid #fbbf24' : '1px solid var(--border)',
                    color: isPinned(`cell:${selectedCellNode.id}`) ? '#fbbf24' : 'var(--text-dim)',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {isPinned(`cell:${selectedCellNode.id}`) ? '⭐ Pinned' : '☆ Pin'}
                </button>

                <button
                  onClick={() => handleInvestigateCell(selectedCellNode)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #059669, #10b981)',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)'
                  }}
                >
                  <span>🎯 Investigate</span>
                </button>

                <button
                  onClick={() => setDetailOpen(false)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '8px',
                    background: 'var(--bg-3)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-dim)',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Status & Priority Row */}
            {detail?.current && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', padding: '16px 0' }}>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background: LIFECYCLE_STYLE[(detail.current.lifecycle as Lifecycle) ?? 'Healthy']?.bg ?? LIFECYCLE_STYLE.Healthy.bg,
                    color: LIFECYCLE_STYLE[(detail.current.lifecycle as Lifecycle) ?? 'Healthy']?.color ?? LIFECYCLE_STYLE.Healthy.color
                  }}
                >
                  {detail.current.lifecycle}
                </span>

                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background:
                      detail.current.severity === 'Critical'
                        ? 'rgba(239, 68, 68, 0.2)'
                        : detail.current.severity === 'High'
                        ? 'rgba(251, 191, 36, 0.2)'
                        : 'rgba(148, 163, 184, 0.2)',
                    color:
                      detail.current.severity === 'Critical'
                        ? '#f87171'
                        : detail.current.severity === 'High'
                        ? '#fbbf24'
                        : '#94a3b8'
                  }}
                >
                  {detail.current.severity} Severity
                </span>

                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background:
                      detail.current.trend === 'Worsening'
                        ? 'rgba(239, 68, 68, 0.2)'
                        : detail.current.trend === 'Improving'
                        ? 'rgba(52, 211, 153, 0.2)'
                        : 'rgba(148, 163, 184, 0.2)',
                    color:
                      detail.current.trend === 'Worsening'
                        ? '#f87171'
                        : detail.current.trend === 'Improving'
                        ? '#34d399'
                        : '#94a3b8'
                  }}
                >
                  Trend: {detail.current.trend ?? '—'}
                </span>

                {detail.current.priorityScore != null && (
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 800,
                      padding: '4px 10px',
                      borderRadius: '6px',
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8'
                    }}
                  >
                    Priority {detail.current.priorityScore} ({detail.current.priorityBand})
                  </span>
                )}
              </div>
            )}

            {/* Telemetry Charts */}
            <div style={{ flex: 1, minHeight: '420px', marginTop: '10px' }}>
              {detailLoading ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-dim)' }}>
                  Loading {grain} telemetry charts...
                </div>
              ) : chartOption ? (
                <div
                  style={{
                    background: 'var(--bg-card)',
                    borderRadius: '14px',
                    border: '1px solid var(--border)',
                    padding: '16px'
                  }}
                >
                  <Chart option={chartOption} height={460} />
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-dim)' }}>
                  No historical telemetry found for this cell.
                </div>
              )}
            </div>

            {/* ISO Week / Period NC Strip */}
            {detail?.weeks && detail.weeks.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Timeline Compliance Strip
                </div>
                <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '6px' }}>
                  {detail.weeks.map((w) => (
                    <div
                      key={w.weekStart}
                      title={`${w.weekStart}: ${w.lifecycle} · ${w.severity}`}
                      style={{
                        flex: '0 0 28px',
                        height: '28px',
                        borderRadius: '6px',
                        background: w.isNc ? 'rgba(239, 68, 68, 0.25)' : 'rgba(52, 211, 153, 0.2)',
                        border: w.isNc ? '1px solid #f87171' : '1px solid #34d399',
                        color: w.isNc ? '#f87171' : '#34d399',
                        fontSize: '10px',
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      {LIFECYCLE_STYLE[w.lifecycle as Lifecycle]?.short ?? '·'}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
