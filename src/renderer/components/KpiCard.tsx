import React from 'react'

export interface KpiCardProps {
  name: string
  isDerived?: boolean
  value: number | null
  displayUnit: string
  targetStr?: string
  status: 'compliant' | 'warning' | 'breach' | 'unavailable'
  trend: 'improving' | 'worsening' | 'stable'
  ncCount?: number
  ncPct?: number
  persistentNcCount?: number
}

export const KpiCard: React.FC<KpiCardProps> = ({
  name,
  isDerived,
  value,
  displayUnit,
  targetStr,
  status,
  trend,
  ncCount,
  ncPct
}) => {
  const statusBorder =
    status === 'compliant'
      ? '1px solid rgba(52, 211, 153, 0.3)'
      : status === 'warning'
      ? '1px solid rgba(251, 191, 36, 0.4)'
      : status === 'breach'
      ? '1px solid rgba(248, 113, 113, 0.4)'
      : '1px solid var(--border)'

  const statusBg =
    status === 'compliant'
      ? 'rgba(16, 185, 129, 0.06)'
      : status === 'warning'
      ? 'rgba(245, 158, 11, 0.08)'
      : status === 'breach'
      ? 'rgba(239, 68, 68, 0.08)'
      : 'var(--bg-card)'

  const trendColor =
    trend === 'worsening' ? '#f87171' : trend === 'improving' ? '#34d399' : '#93a1b5'

  return (
    <div
      style={{
        background: statusBg,
        border: statusBorder,
        borderRadius: '12px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: '140px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>
          {name}
        </span>
        {isDerived && (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: '4px',
              background: 'rgba(99, 102, 241, 0.2)',
              color: '#818cf8',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              whiteSpace: 'nowrap'
            }}
          >
            DERIVED KPI
          </span>
        )}
      </div>

      <div style={{ margin: '10px 0' }}>
        <div style={{ fontSize: '22px', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.5px' }}>
          {value !== null ? `${value.toFixed(2)}${displayUnit ? ' ' + displayUnit : ''}` : 'Data unavailable'}
        </div>
        {targetStr && <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>Target: {targetStr}</div>}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11.5px',
          paddingTop: '8px',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)'
        }}
      >
        <span style={{ color: trendColor, fontWeight: 600 }}>
          {trend === 'improving' ? '↓ Improving' : trend === 'worsening' ? '↑ Worsening' : '→ Stable'}
        </span>
        {ncCount !== undefined && (
          <span style={{ color: 'var(--text-dim)' }}>
            NC: <strong style={{ color: 'var(--text)' }}>{ncCount}</strong> ({ncPct?.toFixed(1)}%)
          </span>
        )}
      </div>
    </div>
  )
}
