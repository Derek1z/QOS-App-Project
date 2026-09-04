import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import {
  openWorkspaceFlow,
  closeWorkspaceFlow
} from '../lib/flows'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function WorkspaceModule(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const recent = useAppStore((s) => s.recent)

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '13px', fontWeight: 800, color: '#f8fafc' }}>
            {workspace ? workspace.name : 'No Active Workspace'}
          </span>
          {workspace?.readOnly && (
            <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 800, background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
              READ ONLY
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => void openWorkspaceFlow()}
            style={{ padding: '6px 14px', background: 'var(--bg-3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
          >
            📂 Open Workspace
          </button>
          {workspace && (
            <button
              onClick={() => void closeWorkspaceFlow()}
              style={{ padding: '6px 14px', background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
            >
              ✕ Close Workspace
            </button>
          )}
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
              <path stroke="#10b981" strokeDasharray="100, 100" strokeWidth="3.5" strokeLinecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            </svg>
            <span style={{ position: 'absolute', fontSize: '16px', fontWeight: 800, color: '#f8fafc' }}>v2.0</span>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                {workspace?.technology ?? '4G'}
              </span>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                Workspace Infrastructure & Threshold Governance
              </h2>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px', margin: '4px 0 0 0' }}>
              Active Database: <code style={{ color: '#38bdf8' }}>{workspace?.path ?? 'None'}</code> · Size: {workspace ? fmtBytes(workspace.sizeBytes) : '0 B'}
            </p>
          </div>
        </div>
      </div>

      {/* Recent Workspaces Card */}
      <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '16px', border: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#f8fafc', marginBottom: '16px' }}>Recent Workspaces</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
          {recent.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontSize: '12px' }}>No recent workspaces logged.</div>
          ) : (
            recent.map((r) => (
              <div key={r.path} style={{ background: 'var(--bg-3)', padding: '14px 16px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>{r.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px', wordBreak: 'break-all' }}>{r.path}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
