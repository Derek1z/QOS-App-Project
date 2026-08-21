import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import type { CellDetail, Grain, Technology } from '../../../shared/api'
import Chart from '../lib/Chart'
import { cellDetailOption } from '../lib/cellCharts'

export default function CellCompareModal(): React.JSX.Element | null {
  const compareCellIds = useAppStore((s) => s.compareCellIds)
  const setCompareCellIds = useAppStore((s) => s.setCompareCellIds)
  const grain = useAppStore((s) => s.grain)
  const selectedTech = useAppStore((s) => s.selectedTech)
  const [detailA, setDetailA] = useState<CellDetail | null>(null)
  const [detailB, setDetailB] = useState<CellDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!compareCellIds) {
      setDetailA(null)
      setDetailB(null)
      return
    }
    let alive = true
    setLoading(true)
    void (async () => {
      try {
        const [a, b] = await Promise.all([
          window.api.analytics.cellDetail(compareCellIds[0], grain),
          window.api.analytics.cellDetail(compareCellIds[1], grain)
        ])
        if (alive) {
          setDetailA(a)
          setDetailB(b)
        }
      } catch (err) {
        console.error('Failed to load compare cell details:', err)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [compareCellIds, grain])

  if (!compareCellIds) return null

  const optA = detailA ? cellDetailOption(detailA, 80, grain, selectedTech) : null
  const optB = detailB ? cellDetailOption(detailB, 80, grain, selectedTech) : null

  return (
    <div className="cell-compare-modal-backdrop" onClick={() => setCompareCellIds(null)}>
      <div className="cell-compare-modal-content glass-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px' }}>⚖️</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px' }}>Side-by-Side Cell Comparison</h3>
              <span className="card-note">Comparing Sector & Cluster Metrics ({grain.toUpperCase()} grain)</span>
            </div>
          </div>
          <button className="btn btn-dim" onClick={() => setCompareCellIds(null)}>✕ Close</button>
        </div>

        {loading && <div className="notice">Loading cell performance data…</div>}

        {!loading && detailA && detailB && (
          <>
            <div className="cell-compare-grid">
              <div className="cell-compare-pane">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h4 style={{ margin: 0, color: 'var(--accent)' }}>{detailA.cellName}</h4>
                  <span className="chip chip-dim">{detailA.site ?? '—'} · {detailA.district ?? '—'}</span>
                </div>
                <div className="drawer-analytics-grid" style={{ marginBottom: '10px' }}>
                  <div className="drawer-stat-card">
                    <span className="drawer-stat-label">Observed</span>
                    <span className="drawer-stat-val">{detailA.weeks.length}</span>
                  </div>
                  <div className="drawer-stat-card">
                    <span className="drawer-stat-label">Lifecycle</span>
                    <span className="drawer-stat-val" style={{ color: detailA.current?.lifecycle === 'Healthy' ? 'var(--green)' : 'var(--danger)' }}>
                      {detailA.current?.lifecycle ?? '—'}
                    </span>
                  </div>
                  <div className="drawer-stat-card">
                    <span className="drawer-stat-label">Severity</span>
                    <span className="drawer-stat-val">{detailA.current?.severity ?? 'Normal'}</span>
                  </div>
                </div>
                {optA && <Chart option={optA} height={380} />}
              </div>

              <div className="cell-compare-pane">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h4 style={{ margin: 0, color: '#10b981' }}>{detailB.cellName}</h4>
                  <span className="chip chip-dim">{detailB.site ?? '—'} · {detailB.district ?? '—'}</span>
                </div>
                <div className="drawer-analytics-grid" style={{ marginBottom: '10px' }}>
                  <div className="drawer-stat-card">
                    <span className="drawer-stat-label">Observed</span>
                    <span className="drawer-stat-val">{detailB.weeks.length}</span>
                  </div>
                  <div className="drawer-stat-card">
                    <span className="drawer-stat-label">Lifecycle</span>
                    <span className="drawer-stat-val" style={{ color: detailB.current?.lifecycle === 'Healthy' ? 'var(--green)' : 'var(--danger)' }}>
                      {detailB.current?.lifecycle ?? '—'}
                    </span>
                  </div>
                  <div className="drawer-stat-card">
                    <span className="drawer-stat-label">Severity</span>
                    <span className="drawer-stat-val">{detailB.current?.severity ?? 'Normal'}</span>
                  </div>
                </div>
                {optB && <Chart option={optB} height={380} />}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
