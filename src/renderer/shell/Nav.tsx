import { useAppStore, emit } from '../store'
import { MODULE_GROUPS } from '../modules'

export default function Nav(): React.JSX.Element {
  const module = useAppStore((s) => s.module)
  const setModule = useAppStore((s) => s.setModule)

  return (
    <nav className="nav">
      <div className="nav-brand">
        <span className="nav-logo">📡</span>
        <div>
          <div className="nav-title">2G/3G/4G QoS</div>
          <div className="nav-subtitle">Network Intelligence</div>
        </div>
      </div>
      {MODULE_GROUPS.map((group) => (
        <div key={group.title} className="nav-group">
          <div className="nav-group-title">{group.title}</div>
          {group.items.map((m) => (
            <button
              key={m.id}
              className={`nav-item${module === m.id ? ' active' : ''}`}
              title={m.blurb}
              onClick={() => {
                setModule(m.id)
                emit('MODULE_CHANGED')
              }}
            >
              <span className="nav-icon">{m.icon}</span>
              <span className="nav-label">{m.label}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}
