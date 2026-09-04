import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { useAppStore, on } from '../store'
import type {
  ActionStatus, EntityOption, InvestigationReport, InvestigationResult,
  InvestigationScope, Technology
} from '../../../shared/api'
import Chart from '../lib/Chart'
import { investigationChartOption } from '../lib/investigationCharts'

const SCOPES: Array<{ id: InvestigationScope; label: string }> = [
  { id: 'cell', label: 'Cell Scope' },
  { id: 'site', label: 'Site Scope' },
  { id: 'district', label: 'District Scope' }
]

const STATUSES: ActionStatus[] = [
  'Unreviewed',
  'Investigating',
  'Escalated',
  'Optimization in progress',
  'Monitoring',
  'Resolved',
  'Deferred'
]

const TECH_CHECKLISTS: Record<Technology, string[]> = {
  '4G': [
    'Confirm 4G DL PRB utilization breach days & peak hour load',
    'Review 4G DL user throughput against the 10.0 Mbps benchmark',
    'Audit Random Access / PRACH root sequence indices for preamble collisions',
    'Inspect MIMO antenna electrical/mechanical down-tilts and VSWR feeder alarms',
    'Compare against co-located site sibling sectors (peer check)',
    'Verify S1-U / X2 backhaul latency, packet loss, and buffer utilization',
    'Mark the intervention week once physical or parameter changes are applied'
  ],
  '3G': [
    'Confirm 3G DL Power Congestion and UL CE Congestion event counts',
    'Audit Physical Channel (PhyCh) setup failures and Radio Link Sync Loss abnormal drops',
    'Inspect 3G Call Setup Success (CSSR) and Data Access Success (DASR)',
    'Check Scrambling Code (PSC) reuse distance and neighbor clashes',
    'Verify Iub transmission link capacity and NodeB credit congestion',
    'Compare against co-located 3G carrier siblings on the same NodeB',
    'Mark the intervention week once RF optimization is committed'
  ],
  '2G': [
    'Confirm 2G TCH Congestion (%) and SDCCH signalling congestion rates',
    'Audit Frequency Plan & BCCH/TCH co-channel / adjacent channel interference',
    'Inspect 2G TCH Call Drop Rate (%) and Handover Success Rate (HOSR)',
    'Check TRX hardware faults, combiner loss, and VSWR return-loss alarms',
    'Review Handover Hysteresis, Power Control, and PBGT threshold parameters',
    'Compare against co-located 2G sectors on the same BTS site',
    'Mark the intervention week once frequency or antenna retuning is completed'
  ]
}

function fmtV(v: number | null, unit: string): string {
  if (v == null) return '—'
  if (unit === 'kbps') return `${(v / 1024).toFixed(1)} Mbps`
  if (unit === 'Mbps') return `${v.toFixed(1)} Mbps`
  if (unit === 'Erl') return `${v.toFixed(1)} Erl`
  if (unit === 'MB') return `${(v / 1024).toFixed(1)} GB`
  if (unit === '%' || unit === 'pp') return `${v.toFixed(1)}%`
  return Math.round(v).toLocaleString()
}

export default function InvestigationWorkspace(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const grain = useAppStore((s) => s.grain)
  const setGrain = useAppStore((s) => s.setGrain)
  const period = useAppStore((s) => s.period)
  const setPeriod = useAppStore((s) => s.setPeriod)
  const target = useAppStore((s) => s.investigationTarget)
  const setTarget = useAppStore((s) => s.setInvestigationTarget)
  const selectedTech = useAppStore((s) => s.selectedTech)
  const setSelectedTech = useAppStore((s) => s.setSelectedTech)

  const [tech, setTech] = useState<Technology>(selectedTech || '4G')
  const [scope, setScope] = useState<InvestigationScope>('cell')
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<EntityOption[]>([])
  const [selected, setSelected] = useState<EntityOption | null>(null)
  const [result, setResult] = useState<InvestigationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [, setError] = useState<string | null>(null)
  const [prbThreshold, setPrbThreshold] = useState(80)
  const [intervention, setIntervention] = useState('')
  const [statusDraft, setStatusDraft] = useState({ status: '', owner: '', externalTicket: '', targetReviewDate: '' })
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const [, setReport] = useState<InvestigationReport | null>(null)
  const [activeTab, setActiveTab] = useState<'evidence' | 'rca' | 'peers' | 'workflow'>('evidence')
  const [rcaModalOpen, setRcaModalOpen] = useState(false)

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (selectedTech && selectedTech !== tech) {
      setTech(selectedTech)
    }
  }, [selectedTech])

  const load = useCallback(
    async (ent: EntityOption | null, iv: string, scopeOverride?: InvestigationScope, techOverride?: Technology): Promise<void> => {
      if (!ent) {
        setResult(null)
        return
      }
      const s = scopeOverride ?? scope
      const activeTech = techOverride ?? tech
      setLoading(true)
      setError(null)
      try {
        const r = await window.api.investigation.get(s, ent.id, {
          interventionWeek: iv || undefined,
          grain,
          period,
          technology: activeTech
        })
        setResult(r)
        if (r) {
          setIntervention(r.interventionWeek ?? '')
          setStatusDraft({
            status: r.status.status ?? '',
            owner: r.status.owner ?? '',
            externalTicket: r.status.externalTicket ?? '',
            targetReviewDate: r.status.targetReviewDate ?? ''
          })
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [scope, grain, period, tech]
  )

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    if (dropdownOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }, [dropdownOpen])

  useEffect(() => {
    setDropdownOpen(false)
  }, [tech, workspace?.path])

  useEffect(() => {
    const off = on('WORKSPACE_CHANGED', () => setDropdownOpen(false))
    return () => off()
  }, [])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      void (async () => {
        try {
          const opts = await window.api.investigation.search(scope, query.trim() || undefined, tech)
          setOptions(opts)

          if (!selected && opts.length > 0 && !target) {
            const top = opts[0]
            setSelected(top)
            void load(top, '', undefined, tech)
          }
        } catch {
          setOptions([])
        }
      })()
    }, query === '' ? 0 : 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [scope, query, selected, target, load, tech])

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
    if (!target) return
    const ent: EntityOption = { id: target.id, name: target.name, path: target.path ?? [] }
    setScope(target.scope)
    setQuery('')
    setDropdownOpen(false)
    setSelected(ent)
    void load(ent, '', target.scope, tech)
    setTarget(null)
  }, [target, load, setTarget, tech])

  const chartOption: EChartsOption | null = useMemo(
    () => (result && result.weeks.length > 0 ? investigationChartOption(result, prbThreshold, grain, tech) : null),
    [result, prbThreshold, grain, tech]
  )

  async function pick(ent: EntityOption): Promise<void> {
    setQuery('')
    setDropdownOpen(false)
    setSelected(ent)
    await load(ent, '')
  }

  async function saveStatus(): Promise<void> {
    if (!selected) return
    setSaving(true)
    try {
      await window.api.investigation.setStatus(scope, selected.id, {
        status: (statusDraft.status || null) as ActionStatus | null,
        owner: statusDraft.owner || null,
        externalTicket: statusDraft.externalTicket || null,
        targetReviewDate: statusDraft.targetReviewDate || null
      })
      await load(selected, intervention)
    } finally {
      setSaving(false)
    }
  }

  async function addNote(): Promise<void> {
    if (!selected || !note.trim()) return
    await window.api.investigation.addNote(scope, selected.id, note.trim())
    setNote('')
    await load(selected, intervention)
  }

  async function exportReport(): Promise<void> {
    if (!selected) return
    const rep = await window.api.investigation.exportReport(scope, selected.id)
    if (rep) setReport(rep)
  }

  const topHypothesis = result?.hypotheses && result.hypotheses.length > 0 ? result.hypotheses[0] : null

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1400px', margin: '0 auto', color: 'var(--text)' }}>
      {/* Executive Control Bar: Technology, Granularity, Scope & Target Controls */}
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

          {/* Granularity Selector */}
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

          {/* Scope Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Scope:
            </span>
            <div style={{ display: 'inline-flex', background: 'var(--bg-3)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              {SCOPES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setScope(s.id)}
                  style={{
                    padding: '5px 14px',
                    fontSize: '12px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    background: scope === s.id ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                    color: scope === s.id ? '#818cf8' : 'var(--text-dim)'
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Period Range Select */}
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
            </select>
          </div>
        </div>

        {/* Entity Picker Popover Trigger */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            style={{
              padding: '6px 14px',
              background: 'linear-gradient(135deg, #1e1b4b, #312e81)',
              color: '#ffffff',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            🔍 {selected ? selected.name : 'Select Entity to Investigate'} ▼
          </button>

          {dropdownOpen && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: '6px',
                width: '340px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '12px',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
                zIndex: 1000
              }}
            >
              <input
                ref={searchInputRef}
                type="text"
                placeholder={`Search ${tech} ${scope} name or ID...`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-3)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  fontSize: '12px',
                  marginBottom: '10px'
                }}
              />
              <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {options.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--text-dim)', textAlign: 'center', padding: '12px' }}>
                    No matching {tech} {scope}s found
                  </div>
                ) : (
                  options.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => void pick(opt)}
                      style={{
                        padding: '8px 12px',
                        textAlign: 'left',
                        background: selected?.id === opt.id ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                        color: selected?.id === opt.id ? '#38bdf8' : 'var(--text)',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: selected?.id === opt.id ? 700 : 500
                      }}
                    >
                      {opt.name}
                      {opt.path && <div style={{ fontSize: '10px', color: 'var(--text-dim)' }}>{opt.path}</div>}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Executive Banner Card for Active Entity */}
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
                stroke={result?.current?.lifecycle?.includes('Persistent') || result?.current?.lifecycle?.includes('Chronic') ? '#f87171' : result?.current?.lifecycle?.includes('Recurring') ? '#fbbf24' : '#34d399'}
                strokeDasharray="85, 100"
                strokeWidth="3.5"
                strokeLinecap="round"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <span style={{ position: 'absolute', fontSize: '16px', fontWeight: 800, color: '#f8fafc' }}>
              {result?.weeks ? `${Math.max(0, ...result.weeks.map((w) => w.prbAvg ?? 0)).toFixed(0)}%` : '—'}
            </span>
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
                {tech}
              </span>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                {selected ? selected.name : 'Select a Cell for Investigation'}
              </h2>
              {result?.current?.lifecycle && (
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    background: result.current.lifecycle.includes('Persistent') || result.current.lifecycle.includes('Chronic') ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                    color: result.current.lifecycle.includes('Persistent') || result.current.lifecycle.includes('Chronic') ? '#f87171' : '#fbbf24',
                    border: '1px solid rgba(239, 68, 68, 0.3)'
                  }}
                >
                  {result.current.lifecycle}
                </span>
              )}
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px', margin: '4px 0 0 0' }}>
              {selected?.path ? `Path: ${Array.isArray(selected.path) ? selected.path.join(' > ') : selected.path} · ` : ''}
              Active scope: <strong style={{ color: 'var(--text)' }}>{grain}</strong> grain · Primary KPI: <strong style={{ color: '#38bdf8' }}>DL PRB Utilization (%)</strong>
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => setRcaModalOpen(true)}
            style={{
              padding: '8px 16px',
              fontSize: '12px',
              fontWeight: 700,
              background: 'linear-gradient(135deg, #059669, #10b981)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
            }}
          >
            🔍 Expand RCA Donut Modal
          </button>
          <button
            onClick={() => void exportReport()}
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
            📄 Export Report
          </button>
        </div>
      </div>

      {/* 4-Stat Metric Summary Cards Grid */}
      {result && (() => {
        const breachWeeks = result.weeks.filter((w) => w.isNc).length
        const breachRatioPct = result.weeks.length > 0 ? (breachWeeks / result.weeks.length) * 100 : 0
        const worstVal = Math.max(0, ...result.weeks.map((w) => w.prbAvg ?? 0))
        let consec = 0
        for (let i = result.weeks.length - 1; i >= 0; i--) {
          if (result.weeks[i].isNc) consec++
          else break
        }
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
            <div style={{ background: 'var(--bg-card)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Worst Period Value</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#f87171', margin: '4px 0' }}>
                {worstVal > 0 ? `${worstVal.toFixed(1)}%` : '—'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Target: ≤ {prbThreshold}%</div>
            </div>

            <div style={{ background: 'var(--bg-card)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Breach Count & Ratio</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#fbbf24', margin: '4px 0' }}>
                {breachWeeks} / {result.weeks.length} <span style={{ fontSize: '14px', fontWeight: 600 }}>({breachRatioPct.toFixed(0)}%)</span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Consecutive breaches: {consec}</div>
            </div>

            <div style={{ background: 'var(--bg-card)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Primary RCA Diagnosis</div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#38bdf8', margin: '6px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {topHypothesis ? topHypothesis.title : 'No anomaly detected'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Confidence: {topHypothesis ? `${topHypothesis.confidence} (${topHypothesis.score}%)` : '100%'}</div>
            </div>

            <div style={{ background: 'var(--bg-card)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Action Status</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#34d399', margin: '4px 0' }}>
                {result.status.status || 'Unreviewed'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Owner: {result.status.owner || 'Unassigned'}</div>
            </div>
          </div>
        )
      })()}

      {/* Main Investigation Sub-Tabs Navigation */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
        {[
          { id: 'evidence', label: '📊 Telemetry & Evidence' },
          { id: 'rca', label: '🔍 Root Cause Analysis (RCA)' },
          { id: 'peers', label: '🌐 Peer Sibling Check' },
          { id: 'workflow', label: '📋 Action Workflow & Notes' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 700,
              border: 'none',
              background: activeTab === tab.id ? 'var(--accent)' : 'transparent',
              color: activeTab === tab.id ? '#0f172a' : 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sub-Tab 1: Telemetry & Evidence */}
      {activeTab === 'evidence' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                {tech} Primary Telemetry Timeline ({grain === 'daily' ? 'Daily Dates' : 'ISO Weeks'})
              </h3>
              <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Threshold Line: {prbThreshold}%</span>
            </div>
            {chartOption ? (
              <Chart option={chartOption} height={360} />
            ) : (
              <div style={{ height: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
                {loading ? 'Loading Telemetry...' : 'No telemetry data available for selected entity.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sub-Tab 2: Root Cause Analysis */}
      {activeTab === 'rca' && result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
          {result.hypotheses.map((h, i) => (
            <div key={i} style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>Hypothesis #{i + 1}</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: h.score > 75 ? '#f87171' : '#fbbf24' }}>
                  {h.confidence} ({h.score}%)
                </span>
              </div>
              <h4 style={{ fontSize: '15px', fontWeight: 800, color: '#f8fafc', margin: '0 0 8px 0' }}>{h.title}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-dim)', lineHeight: '1.5' }}>
                {h.verdict}: {h.supporting?.join('; ') || 'Evidence supports anomaly findings'}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Sub-Tab 3: Peer Check */}
      {activeTab === 'peers' && result && (
        <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '16px' }}>Co-located Sibling Sectors</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            {result.peers.map((peer, i) => (
              <div key={i} style={{ background: 'var(--bg-3)', padding: '14px 16px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>{peer.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
                  PRB Avg: {peer.prbAvg !== null ? `${peer.prbAvg.toFixed(1)}%` : '—'} | Health: {peer.healthScore ?? '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-Tab 4: Workflow & Notes */}
      {activeTab === 'workflow' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '16px' }}>Remediation Status</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>Action Status</label>
              <select
                value={statusDraft.status}
                onChange={(e) => setStatusDraft({ ...statusDraft, status: e.target.value })}
                style={{ background: 'var(--bg-3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px' }}
              >
                {STATUSES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
              <button
                onClick={() => void saveStatus()}
                disabled={saving}
                style={{ padding: '10px', background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
              >
                {saving ? 'Saving...' : 'Save Remediation Status'}
              </button>
            </div>
          </div>

          <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '16px' }}>Audit Notes & Log</h3>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <input
                type="text"
                placeholder="Add investigation note..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ flex: 1, background: 'var(--bg-3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px' }}
              />
              <button
                onClick={() => void addNote()}
                style={{ padding: '8px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expandable RCA Donut Modal */}
      {rcaModalOpen && result && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '24px'
          }}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '20px',
              padding: '28px',
              maxWidth: '640px',
              width: '100%',
              boxShadow: '0 20px 50px rgba(0,0,0,0.6)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>🔍 Root Cause Analysis Drill-Down</h3>
              <button onClick={() => setRcaModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: '20px', cursor: 'pointer' }}>✕</button>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '20px' }}>
              RCA Severity Distribution for <strong style={{ color: '#f8fafc' }}>{selected?.name}</strong> across active telemetry parameters.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
              <svg width="180" height="180" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="var(--bg-3)" strokeWidth="4" />
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#f87171" strokeWidth="4" strokeDasharray="50, 100" strokeDashoffset="25" />
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#fbbf24" strokeWidth="4" strokeDasharray="30, 100" strokeDashoffset="-25" />
                <circle cx="18" cy="18" r="15.915" fill="none" stroke="#38bdf8" strokeWidth="4" strokeDasharray="20, 100" strokeDashoffset="-55" />
              </svg>
            </div>
            <button
              onClick={() => setRcaModalOpen(false)}
              style={{ width: '100%', padding: '12px', background: 'var(--bg-3)', color: '#fff', border: '1px solid var(--border)', borderRadius: '10px', fontWeight: 700, cursor: 'pointer', marginTop: '16px' }}
            >
              Close Drill-Down Modal
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
