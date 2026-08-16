import { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import { openWorkspaceFlow, createWorkspaceFlow } from '../lib/flows'
import type { AppStateData, RecentWorkspace, Technology } from '../../../shared/api'

export default function Welcome(): React.JSX.Element {
  const recent = useAppStore((s) => s.recent)
  const busy = useAppStore((s) => s.busy)
  const error = useAppStore((s) => s.error)
  const setError = useAppStore((s) => s.setError)
  // remembered choices + lock state are loaded per visit so the screen always
  // reflects what the Create/Open flows will actually do
  const [recall, setRecall] = useState<Pick<AppStateData, 'lastTechnology' | 'lastWorkspaceDir' | 'createdWorkspaces'> | null>(null)
  const [recallTech, setRecallTech] = useState<Technology | undefined>(undefined)
  const [recallDir, setRecallDir] = useState<string | undefined>(undefined)
  const [locked, setLocked] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const app = await window.api.appState.get()
        if (!alive) return
        setRecall({
          lastTechnology: app.lastTechnology,
          lastWorkspaceDir: app.lastWorkspaceDir,
          createdWorkspaces: app.createdWorkspaces
        })
        setRecallTech(app.lastTechnology)
        setRecallDir(app.lastWorkspaceDir)
      } catch {
        /* appState unavailable — skip the recall line */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      const entries: Record<string, boolean> = {}
      for (const r of recent) {
        try {
          const res = await window.api.workspace.isLocked(r.path)
          entries[r.path] = res.locked
        } catch {
          entries[r.path] = false
        }
      }
      if (alive) setLocked(entries)
    })()
    return () => {
      alive = false
    }
  }, [recent])

  const createdCount = recall?.createdWorkspaces?.length ?? 0

  async function setDefaultTech(t: Technology): Promise<void> {
    setRecallTech(t)
    const app = await window.api.appState.get()
    // remember per folder when one is chosen, so each project keeps its own
    // technology default
    await window.api.appState.set({
      lastTechnology: t,
      ...(recallDir
        ? { technologyByDir: { ...(app.technologyByDir ?? {}), [recallDir]: t } }
        : {})
    })
  }

  async function changeDefaultDir(): Promise<void> {
    const dir = await window.api.workspace.pickDirectory()
    if (!dir) return
    setRecallDir(dir)
    // switching folders switches to that folder's remembered technology
    const app = await window.api.appState.get()
    const folderTech = app.technologyByDir?.[dir]
    if (folderTech) setRecallTech(folderTech)
    await window.api.appState.set({ lastWorkspaceDir: dir })
  }

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
      {recall && (
        <div className="welcome-recall">
          <div className="welcome-recall-head">
            <span className="welcome-recall-label">Defaults for new workspaces</span>
            <span className="welcome-recall-controls">
              <div className="tech-seg seg welcome-tech-seg" title="Default technology for new workspaces">
                {(['2G', '3G', '4G'] as Technology[]).map((t) => (
                  <button
                    key={t}
                    className={`seg-btn${recallTech === t ? ' active' : ''}`}
                    onClick={() => void setDefaultTech(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <button
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() => void createWorkspaceFlow()}
              >
                Create workspace now
              </button>
            </span>
          </div>
          <div className="welcome-recall-dir">
            <span>Folder:</span>
            <code title={recallDir ?? 'app default'}>{recallDir ?? 'app default'}</code>
            <button className="btn btn-sm" onClick={() => void changeDefaultDir()}>
              Change…
            </button>
          </div>
          {createdCount > 0 && (
            <>
              <div className="welcome-history-title">Recently created</div>
              <div className="welcome-history">
                {(recall.createdWorkspaces ?? []).slice(0, 5).map((c) => (
                  <div key={c.createdAt + c.name} className="welcome-history-row">
                    <span className="recent-name">{c.name}</span>
                    <span className="badge">{c.technology}</span>
                    <span className="recent-when">{new Date(c.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {error && (
        <div className="welcome-error" role="alert">
          <div className="welcome-error-icon">⚠️</div>
          <div className="welcome-error-body">
            <div className="welcome-error-title">That didn't work</div>
            <div className="welcome-error-msg">{error}</div>
            <div className="welcome-error-hint">
              Check that the chosen folder is writable and not locked by another copy of the app,
              then try again — or open a different workspace instead.
            </div>
          </div>
          <button className="btn btn-sm" onClick={() => setError(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
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
            <button
              key={r.path}
              className={`recent-item${locked[r.path] ? ' locked' : ''}`}
              onClick={() => void openWorkspaceFlow(r.path)}
              title={locked[r.path] ? 'Currently open in another instance — this copy can only read it' : undefined}
            >
              <span className="recent-name">{r.name}</span>
              <span className="recent-path">{r.path}</span>
              <span className="recent-when">{new Date(r.lastOpened).toLocaleString()}</span>
              {locked[r.path] && (
                <span className="recent-lock" title="Open in another instance">
                  🔒
                </span>
              )}
            </button>
          ))}
          {Object.values(locked).some(Boolean) && (
            <div className="recent-lock-note">
              🔒 Locked workspaces are open in another running copy — you can only open them
              read-only there; this instance will refuse to write.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
