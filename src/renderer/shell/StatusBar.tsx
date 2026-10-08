import { useAppStore } from '../store'

export default function StatusBar(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const summary = useAppStore((s) => s.summary)
  const grain = useAppStore((s) => s.grain)
  const error = useAppStore((s) => s.error)
  const switchingTo = useAppStore((s) => s.switchingTo)

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
      {switchingTo && (
        <span className="status-busy" role="status">⟳ Opening the {switchingTo} workspace…</span>
      )}
      {error && <span className="status-error">⚠ {error}</span>}
      <span>DuckDB · v2.0 Engine</span>
      <span className="status-sep">·</span>
      <span>v2.0.0</span>
      <span className="status-credit">Developed by Derrick Baalaboore ™</span>
    </footer>
  )
}
