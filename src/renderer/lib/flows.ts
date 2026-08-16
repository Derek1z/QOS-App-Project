import { useAppStore, emit } from '../store'
import type { CreateWorkspaceChoice } from '../store'

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function refreshWorkspaceState(): Promise<void> {
  const st = useAppStore.getState()
  const info = await window.api.workspace.info()
  st.setWorkspace(info)
  st.setSummary(info ? await window.api.analytics.summary() : null)
  const app = await window.api.appState.get()
  st.setRecent(app.recentWorkspaces)
}

export async function openWorkspaceFlow(path?: string): Promise<void> {
  const st = useAppStore.getState()
  const p = path ?? (await window.api.workspace.pickOpen())
  if (!p) return
  st.setBusy(true)
  st.setError(null)
  try {
    await window.api.workspace.open(p)
    await refreshWorkspaceState()
    emit('WORKSPACE_CHANGED')
  } catch (e) {
    st.setError(errMsg(e))
  } finally {
    st.setBusy(false)
  }
}

// Suggest a default workspace name from the creation history: the most recent
// name, suffixed (_2, _3, …) until it doesn't collide with a previous one.
function suggestWorkspaceName(created: Array<{ name: string }> | undefined): string {
  if (!created || created.length === 0) return ''
  const used = new Set(created.map((c) => c.name))
  const base = created[0].name
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

export async function createWorkspaceFlow(name?: string): Promise<void> {
  const st = useAppStore.getState()
  // remember the last folder + technology so the next creation is pre-filled
  const app = await window.api.appState.get()
  const dir = await window.api.workspace.pickDirectory()
  if (!dir) return
  // Electron does not implement window.prompt() (it returns null), so name and
  // technology are collected by an in-app modal instead.
  const defaultName = name ?? suggestWorkspaceName(app.createdWorkspaces)
  const choice = await new Promise<CreateWorkspaceChoice | null>((resolve) => {
    useAppStore.getState().openCreatePrompt(defaultName, app.lastTechnology, resolve)
  })
  if (!choice) return
  const finalName = choice.name.trim()
  if (!finalName) return
  st.setBusy(true)
  st.setError(null)
  try {
    await window.api.workspace.create(dir, finalName, choice.tech)
    // remember the choices + creation history for next time
    const created = [
      { name: finalName, technology: choice.tech, createdAt: new Date().toISOString() },
      ...(app.createdWorkspaces ?? [])
    ].slice(0, 8)
    await window.api.appState.set({
      lastTechnology: choice.tech,
      lastWorkspaceDir: dir,
      createdWorkspaces: created
    })
    await refreshWorkspaceState()
    emit('WORKSPACE_CHANGED')
  } catch (e) {
    st.setError(errMsg(e))
  } finally {
    st.setBusy(false)
  }
}

export async function closeWorkspaceFlow(): Promise<void> {
  const st = useAppStore.getState()
  st.setBusy(true)
  st.setError(null)
  try {
    await window.api.workspace.close()
    await refreshWorkspaceState()
    emit('WORKSPACE_CHANGED')
  } catch (e) {
    st.setError(errMsg(e))
  } finally {
    st.setBusy(false)
  }
}

export async function reopenReadOnlyFlow(): Promise<void> {
  const ws = useAppStore.getState().workspace
  if (!ws) return
  const st = useAppStore.getState()
  st.setBusy(true)
  st.setError(null)
  try {
    await window.api.workspace.open(ws.path, { readOnly: true })
    await refreshWorkspaceState()
    emit('WORKSPACE_CHANGED')
  } catch (e) {
    st.setError(errMsg(e))
  } finally {
    st.setBusy(false)
  }
}
