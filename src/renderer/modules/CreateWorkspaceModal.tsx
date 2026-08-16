import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import type { Technology } from '../../../shared/api'

export default function CreateWorkspaceModal(): React.JSX.Element | null {
  const prompt = useAppStore((s) => s.createPrompt)
  const answer = useAppStore((s) => s.answerCreatePrompt)
  const [name, setName] = useState('')
  const [tech, setTech] = useState<Technology>('4G')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (prompt) {
      setName(prompt.defaultName)
      // pre-fill with the most recently used technology
      setTech(prompt.defaultTech ?? '4G')
      const t = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
  }, [prompt])

  if (!prompt) return null

  const submit = (): void => {
    if (name.trim()) answer({ name: name.trim(), tech })
  }

  return (
    <div className="palette-overlay" onMouseDown={() => answer(null)}>
      <div className="palette" style={{ padding: 16 }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Create workspace</div>
          <button className="btn btn-sm" onClick={() => answer(null)} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
            Workspace name
            <input
              ref={inputRef}
              className="input"
              value={name}
              placeholder="My_Network"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') answer(null)
              }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
            Network technology
            <select className="input" value={tech} onChange={(e) => setTech(e.target.value as Technology)}>
              <option value="2G">2G (GSM)</option>
              <option value="3G">3G (UMTS)</option>
              <option value="4G">4G (LTE)</option>
            </select>
          </label>
          <div className="row-actions">
            <button className="btn btn-primary" disabled={!name.trim()} onClick={submit}>
              Create
            </button>
            <button className="btn" onClick={() => answer(null)}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
