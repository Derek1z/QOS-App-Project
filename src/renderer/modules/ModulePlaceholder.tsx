import { useAppStore } from '../store'
import { ALL_MODULES } from '../modules'

export default function ModulePlaceholder(): React.JSX.Element | null {
  const moduleId = useAppStore((s) => s.module)
  const def = ALL_MODULES.find((m) => m.id === moduleId)
  if (!def) return null
  return (
    <div className="module">
      <div className="module-head">
        <h2>{def.label}</h2>
      </div>
      <div className="card placeholder-card">
        <div className="placeholder-icon">{def.icon}</div>
        <h3>{def.label}</h3>
        <p>{def.blurb}</p>
        <p className="card-note">
          This module is on the roadmap and arrives with Milestone M{def.milestone}.
        </p>
      </div>
    </div>
  )
}
