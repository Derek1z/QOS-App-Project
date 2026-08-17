import { useAppStore } from '../store'

export default function StatusBar(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const summary = useAppStore((s) => s.summary)
  const grain = useAppStore((s) => s.grain)
  const error = useAppStore((s) => s.error)

  return (
    <footer className="status">
      <span className="status-path" title={workspace?.path}>
        {workspace ? workspace.path : 'No workspace open'}
      </span>
      {summary && (
        <>
          <span className="status-sep">·</span>
          <span className="status-stat">{summary.rowCount.toLocaleString()} rows</span>
        </>
      )}
      {summary?.rulesetVersion != null && (
        <>
          <span className="status-sep">·</span>
          <span className="status-stat">Ruleset v{summary.rulesetVersion}</span>
        </>
      )}
      <span className="status-sep">·</span>
      <span className="status-grain">Grain: {grain}</span>
      <span className="status-spacer" />
      {error && <span className="status-error">⚠ {error}</span>}
      <span>DuckDB · offline</span>
      <span className="status-sep">·</span>
      <span>v0.1.0</span>
      <span className="status-credit">Developed by Derrick Baalaboore ™</span>
    </footer>
  )
}
