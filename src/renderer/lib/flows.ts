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

export async function createWorkspaceFlow(name?: string): Promise<void> {
  const st = useAppStore.getState()
  // remember the last folder + technology so the next creation is pre-filled
  const app = await window.api.appState.get()
  const dir = await window.api.workspace.pickDirectory()
  if (!dir) return
  // Electron does not implement window.prompt() (it returns null), so name and
  // technology are collected by an in-app modal instead.
  const choice = await new Promise<CreateWorkspaceChoice | null>((resolve) => {
    useAppStore.getState().openCreatePrompt(name ?? '', app.lastTechnology, resolve)
  })
  if (!choice) return
  const finalName = choice.name.trim()
  if (!finalName) return
  st.setBusy(true)
  st.setError(null)
  try {
    await window.api.workspace.create(dir, finalName, choice.tech)
    // remember the choices for next time
    await window.api.appState.set({ lastTechnology: choice.tech, lastWorkspaceDir: dir })
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
