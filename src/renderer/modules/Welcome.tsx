import { useAppStore } from '../store'
import { openWorkspaceFlow, createWorkspaceFlow } from '../lib/flows'
import type { RecentWorkspace } from '../../../shared/api'

export default function Welcome(): React.JSX.Element {
  const recent = useAppStore((s) => s.recent)
  const busy = useAppStore((s) => s.busy)

  return (
    <div className="welcome">
      <div className="welcome-hero">
        <div className="welcome-logo">📡</div>
        <h1>2G/3G/4G QoS Network Intelligence</h1>
        <p>
          Portable telecom QoS analytics workstation. Open a <code>.qosdb</code> workspace or create
          a new one to begin.
        </p>
      </div>
      <div className="welcome-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void openWorkspaceFlow()}>
          Locate Workspace
        </button>
        <button className="btn" disabled={busy} onClick={() => void createWorkspaceFlow()}>
          Create New Workspace
        </button>
        {recent.length > 0 && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => recent[0] && void openWorkspaceFlow(recent[0].path)}
          >
            Open Recent
          </button>
        )}
      </div>
      {recent.length > 0 && (
        <div className="recent">
          <div className="recent-title">Recent workspaces</div>
          {recent.map((r: RecentWorkspace) => (
            <button key={r.path} className="recent-item" onClick={() => void openWorkspaceFlow(r.path)}>
              <span className="recent-name">{r.name}</span>
              <span className="recent-path">{r.path}</span>
              <span className="recent-when">{new Date(r.lastOpened).toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
