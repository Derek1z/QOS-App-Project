import { useAppStore, emit } from '../store'
import type { CreateWorkspaceChoice } from '../store'
import type { Technology } from '../../../shared/api'
import { planTechSwitch } from './techSwitch'

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
    // the open may have closed the previous workspace before failing
    await refreshWorkspaceState().catch(() => {})
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

/** A 2G/3G/4G button (spec §4.2): open the most recent workspace of that
 *  technology, or offer to create one. True when the workspace changed. */
let switchInFlight = false

export async function switchTechnologyFlow(target: Technology): Promise<boolean> {
  const st = useAppStore.getState()
  const ws = st.workspace
  if (ws && ws.technology === target) return false
  // one switch at a time: a second click must not start a second open (the
  // status bar keeps showing which workspace is on its way)
  if (switchInFlight) return false
  switchInFlight = true
  st.setSwitchingTo(target)
  try {
    return await runTechSwitch(target)
  } finally {
    switchInFlight = false
    useAppStore.getState().setSwitchingTo(null)
  }
}

async function runTechSwitch(target: Technology): Promise<boolean> {
  const st = useAppStore.getState()
  const ws = st.workspace
  try {
    const found = await window.api.workspace.findRecent(target, ws?.path)
    const plan = planTechSwitch(target, ws ? { technology: ws.technology, path: ws.path } : null, found)
    if (plan.kind === 'none') return false
    if (plan.kind === 'open') {
      await openWorkspaceFlow(plan.path)
    } else {
      st.setSwitchingTo(null) // the create prompt and dialog are the feedback here
      if (!window.confirm(`No ${plan.technology} workspace yet — create one?`)) return false
      await createWorkspaceFlow(undefined, plan.technology)
    }
  } catch (e) {
    st.setError(errMsg(e))
    return false
  }
  const now = useAppStore.getState().workspace
  if (now == null || now.path === ws?.path) return false
  if (now.technology !== target) {
    // an older workspace corrected on open (its data is another technology)
    useAppStore.getState().setError(
      `${now.name} holds ${now.technology} data, so it opened as a ${now.technology} workspace.`
    )
    return false
  }
  return true
}

export async function createWorkspaceFlow(name?: string, preselectedTech?: Technology): Promise<void> {
  const st = useAppStore.getState()
  // remember the last folder + technology so the next creation is pre-filled
  const app = await window.api.appState.get()
  const dir = await window.api.workspace.pickDirectory()
  if (!dir) return
  // Electron does not implement window.prompt() (it returns null), so name and
  // technology are collected by an in-app modal instead. The default technology
  // is the one remembered for this folder, falling back to the global last one.
  const defaultName = name ?? suggestWorkspaceName(app.createdWorkspaces)
  const defaultTech = preselectedTech ?? app.technologyByDir?.[dir] ?? app.lastTechnology
  const choice = await new Promise<CreateWorkspaceChoice | null>((resolve) => {
    useAppStore.getState().openCreatePrompt(defaultName, defaultTech, resolve)
  })
  if (!choice) return
  const finalName = choice.name.trim()
  if (!finalName) return
  st.setBusy(true)
  st.setError(null)
  try {
    await window.api.workspace.create(dir, finalName, choice.tech)
    // remember the choices + creation history for next time; the technology is
    // keyed per folder so each project folder keeps its own default
    const created = [
      { name: finalName, technology: choice.tech, createdAt: new Date().toISOString() },
      ...(app.createdWorkspaces ?? [])
    ].slice(0, 8)
    await window.api.appState.set({
      lastTechnology: choice.tech,
      lastWorkspaceDir: dir,
      technologyByDir: { ...(app.technologyByDir ?? {}), [dir]: choice.tech },
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
