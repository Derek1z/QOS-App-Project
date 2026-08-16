import { useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { useAppStore } from '../store'
import type { HealthMatrixResult, HealthScope } from '../../../shared/api'
import Chart, { PALETTE, tooltipStyle, axisLabelStyle } from '../lib/Chart'
import { weekLabel } from '../lib/overviewCharts'

const SCOPES: Array<{ id: HealthScope; label: string }> = [
  { id: 'cell', label: 'Cell' },
  { id: 'site', label: 'Site' },
  { id: 'district', label: 'District' },
  { id: 'region', label: 'Region' }
]

const WEEK_OPTIONS = [4, 8, 12, 26]

export default function HealthMatrix(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const [scope, setScope] = useState<HealthScope>('cell')
  const [weeks, setWeeks] = useState(12)
  const [sort, setSort] = useState<'worst' | 'name'>('worst')
  const [matrix, setMatrix] = useState<HealthMatrixResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setError(null)
    void (async () => {
      try {
        const m = await window.api.analytics.healthMatrix(scope, { weeks, sort })
        if (alive) setMatrix(m)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [workspace?.path, workspace?.readOnly, scope, weeks, sort])

  const option: EChartsOption | null = useMemo(() => {
    if (!matrix || matrix.rows.length === 0 || matrix.weeks.length === 0) return null
    const data: Array<[number, number, number]> = []
    matrix.rows.forEach((r, y) => {
      r.scores.forEach((v, x) => {
        if (v != null) data.push([x, y, v])
      })
    })
    const names = matrix.rows.map((r) => r.name)
    return {
      backgroundColor: 'transparent',
      grid: { left: 110, right: 60, top: 8, bottom: 30 },
      tooltip: {
        ...tooltipStyle(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params
          if (!p || p.value == null || !Array.isArray(p.value)) return ''
          const x = Number(p.value[0])
          const y = Number(p.value[1])
          const score = Number(p.value[2])
          const name = names[y] ?? '—'
          const wk = matrix.weeks[x] ?? '—'
          const band = score >= 80 ? 'Good' : score >= 65 ? 'OK' : score >= 50 ? 'Watch' : 'Poor'
          return `<b>${name}</b><br/>${wk} (${weekLabel(wk)})<br/>Health: <b>${score}</b> · ${band}`
        }
      },
      xAxis: {
        type: 'category',
        data: matrix.weeks.map((w) => weekLabel(w)),
        axisLabel: axisLabelStyle(),
        axisLine: { lineStyle: { color: PALETTE.border } },
        splitArea: { show: true, areaStyle: { color: ['rgba(38,48,65,0.15)', 'rgba(0,0,0,0)'] } }
      },
      yAxis: {
        type: 'category',
        data: names,
        inverse: true,
        axisLabel: { ...axisLabelStyle(), fontSize: 10 },
        axisLine: { show: false },
        splitArea: { show: false }
      },
      visualMap: {
        min: 0,
        max: 100,
        calculable: true,
        orient: 'vertical',
        right: 0,
        top: 'center',
        itemHeight: 160,
        textStyle: { color: PALETTE.dim, fontSize: 10 },
        inRange: { color: [PALETTE.danger, PALETTE.warn, PALETTE.accent, PALETTE.green] }
      },
      series: [
        {
          type: 'heatmap',
          data,
          label: { show: false },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.6)' } }
        }
      ]
    }
  }, [matrix])

  const height = matrix && matrix.rows.length > 0 ? Math.max(220, Math.min(520, matrix.rows.length * 18 + 70)) : 220

  return (
    <div className="module">
      <div className="module-head">
        <h2>Health Matrix</h2>
        <span className="module-workspace">{workspace?.name}</span>
      </div>

      <div className="row-actions filter-row">
        <span className="filter-label">Rows</span>
        <div className="seg">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              className={`seg-btn${scope === s.id ? ' active' : ''}`}
              onClick={() => setScope(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="filter-label">Columns</span>
        <div className="seg">
          {WEEK_OPTIONS.map((w) => (
            <button
              key={w}
              className={`seg-btn${weeks === w ? ' active' : ''}`}
              onClick={() => setWeeks(w)}
            >
              {w}w
            </button>
          ))}
        </div>
        <span className="filter-label">Sort</span>
        <div className="seg">
          <button className={`seg-btn${sort === 'worst' ? ' active' : ''}`} onClick={() => setSort('worst')}>
            Worst first
          </button>
          <button className={`seg-btn${sort === 'name' ? ' active' : ''}`} onClick={() => setSort('name')}>
            A–Z
          </button>
        </div>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {!matrix || matrix.rows.length === 0 ? (
        <div className="card placeholder-card">
          <div className="placeholder-icon">🧭</div>
          <h3>Health Matrix</h3>
          <p className="card-note">
            No health history yet — import data and the analytics engine builds weekly health
            scores for every cell automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="card">
            <Chart option={option} height={height} />
            <p className="card-note">
              Weekly health score per {scope} — worst first by default. Colors: green ≥ 80,
              blue ≥ 65, amber ≥ 50, red below. Hover any cell for the exact score and week.
              Scores are the transparent cell-health components rolled up per entity (M2 engine).
            </p>
          </div>
          <div className="card">
            <h3>Worst this week</h3>
            <div className="preview-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{SCOPES.find((s) => s.id === scope)?.label}</th>
                    {matrix.weeks.length > 0 && <th>{weekLabel(matrix.weeks[matrix.weeks.length - 1])}</th>}
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.slice(0, 10).map((r) => {
                    const latest = r.scores[r.scores.length - 1]
                    const color = latest == null ? 'var(--text-faint)' : latest >= 80 ? 'var(--green)' : latest >= 65 ? 'var(--accent)' : latest >= 50 ? 'var(--warn)' : 'var(--danger)'
                    return (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td style={{ color, fontWeight: 700 }}>{latest ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
