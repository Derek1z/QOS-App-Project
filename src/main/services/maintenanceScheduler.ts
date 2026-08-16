/** Scheduled workspace maintenance (spec §58): runs integrity checks and
 *  raw-archive purges (plus any other enabled actions) on a configurable
 *  cadence, persisting each run to maintenance_runs and to the notes_events
 *  audit trail. Settings live per-workspace in the single-row
 *  maintenance_settings table (id = 1). */

import * as ws from '../workspace/manager'
import { runMaintenance } from './maintenanceService'
import type {
  MaintenanceAction, MaintenanceResult, MaintenanceScheduleSettings,
  ScheduledMaintenanceRun, ScheduledRunResult
} from '../../../shared/api'

/** Actions that may be scheduled. 'storage' is a manual read-only analysis. */
const SCHEDULABLE: MaintenanceAction[] = ['integrity', 'optimize', 'rebuild', 'compact', 'purge']
const DEFAULT_ACTIONS: MaintenanceAction[] = ['integrity', 'purge']

function esc(s: string): string {
  return s.replace(/'/g, "''")
}

function toIso(v: unknown): string | null {
  if (v == null) return null
  const s = String(v)
  return s ? new Date(s).toISOString() : null
}

function parseActions(v: unknown): MaintenanceAction[] {
  try {
    const parsed = JSON.parse(String(v ?? '[]'))
    if (Array.isArray(parsed)) {
      const a = parsed.filter((x: unknown): x is MaintenanceAction => SCHEDULABLE.includes(x as MaintenanceAction))
      if (a.length) return a
    }
  } catch {
    /* fall through */
  }
  return [...DEFAULT_ACTIONS]
}

type CurrentWs = NonNullable<ReturnType<typeof ws.getCurrent>>

function requireCurrent(): CurrentWs {
  const cur = ws.getCurrent()
  if (!cur) throw new Error('No workspace is open')
  return cur
}

export function hydrateSettings(row: Record<string, unknown>): MaintenanceScheduleSettings {
  const enabled = row.enabled === true || String(row.enabled) === 'true'
  const runOnOpen = row.run_on_open === true || String(row.run_on_open) === 'true'
  const cadenceHours = Math.max(1, Math.min(168, Number(row.cadence_hours ?? 24) || 24))
  const actions = parseActions(row.actions)
  const lastRunAt = toIso(row.last_run_at)
  const lastOk = row.last_ok == null ? null : row.last_ok === true || String(row.last_ok) === 'true'
  const lastSummary = row.last_summary ? String(row.last_summary) : null
  let nextRunAt: string | null = null
  if (enabled) {
    const base = lastRunAt ? new Date(lastRunAt).getTime() : Date.now()
    nextRunAt = new Date(base + cadenceHours * 3_600_000).toISOString()
  }
  return { enabled, cadenceHours, actions, runOnOpen, lastRunAt, lastOk, lastSummary, nextRunAt }
}

export async function getSchedule(): Promise<MaintenanceScheduleSettings> {
  const cur = requireCurrent()
  const r = await cur.connection.runAndReadAll(`SELECT * FROM maintenance_settings WHERE id = 1`)
  const row = r.getRowObjects()[0]
  if (!row) throw new Error('Maintenance settings are missing from this workspace')
  return hydrateSettings(row)
}

export async function setSchedule(patch: {
  enabled?: boolean
  cadenceHours?: number
  actions?: MaintenanceAction[]
  runOnOpen?: boolean
}): Promise<MaintenanceScheduleSettings> {
  const cur = requireCurrent()
  if (cur.readOnly) throw new Error('Workspace is read-only — scheduler settings are blocked')
  const prev = await getSchedule()
  const enabled = patch.enabled ?? prev.enabled
  const runOnOpen = patch.runOnOpen ?? prev.runOnOpen
  const cadenceHours = Math.max(1, Math.min(168, patch.cadenceHours ?? prev.cadenceHours))
  const actions = patch.actions ? (patch.actions.filter((a) => SCHEDULABLE.includes(a)) || []) : prev.actions
  const finalActions = actions.length ? actions : [...DEFAULT_ACTIONS]
  await cur.connection.run(
    `UPDATE maintenance_settings SET enabled = ${enabled ? 1 : 0}, cadence_hours = ${cadenceHours}, ` +
    `actions = '${esc(JSON.stringify(finalActions))}', run_on_open = ${runOnOpen ? 1 : 0}, updated_at = now() WHERE id = 1`
  )
  return getSchedule()
}

/** Run the enabled scheduled actions immediately (manual "Run now"). */
export async function runScheduled(): Promise<ScheduledRunResult> {
  const cur = requireCurrent()
  if (cur.readOnly) {
    return { ok: false, ran: false, results: [], summary: 'Skipped — workspace is read-only', skippedReason: 'readonly' }
  }
  const sched = await getSchedule()
  if (!sched.enabled) {
    return { ok: false, ran: false, results: [], summary: 'Skipped — the scheduler is disabled', skippedReason: 'disabled' }
  }
  const actions = sched.actions.length ? sched.actions : [...DEFAULT_ACTIONS]
  const t0 = Date.now()
  const results: MaintenanceResult[] = []
  for (const a of actions) {
    results.push(await runMaintenance(a))
  }
  const ok = results.every((r) => r.ok)
  const failed = results.filter((r) => !r.ok)
  const summary = ok
    ? `Scheduled maintenance passed: ${results.length} action(s) — ${results.map((r) => `${r.action} ${(r.durationMs / 1000).toFixed(1)}s`).join(', ')}.`
    : `Scheduled maintenance had ${failed.length} failure(s): ${failed.map((r) => `${r.action}: ${r.message}`).join('; ')}`
  const durationMs = Date.now() - t0
  const curNow = ws.getCurrent() ?? cur
  await curNow.connection.run(
    `INSERT INTO maintenance_runs (ran_at, ok, actions, summary, duration_ms) ` +
    `VALUES (now(), ${ok ? 1 : 0}, '${esc(JSON.stringify(actions))}', '${esc(summary)}', ${durationMs})`
  )
  await curNow.connection.run(
    `UPDATE maintenance_settings SET last_run_at = now(), last_ok = ${ok ? 1 : 0}, ` +
    `last_summary = '${esc(summary)}', updated_at = now() WHERE id = 1`
  )
  // audit trail: surfaced in the Investigation timeline alongside other events
  await curNow.connection.run(
    `INSERT INTO notes_events (entity_type, kind, note, author) VALUES ('workspace', 'maintenance_run', '${esc(summary)}', 'system')`
  )
  return { ok, ran: true, results, summary }
}

/** Run if enabled and the cadence window has elapsed. No-op otherwise. */
export async function maybeRunScheduled(): Promise<ScheduledRunResult> {
  const cur = ws.getCurrent()
  if (!cur) {
    return { ok: false, ran: false, results: [], summary: 'Skipped — no workspace is open', skippedReason: 'noworkspace' }
  }
  if (cur.readOnly) {
    return { ok: false, ran: false, results: [], summary: 'Skipped — workspace is read-only', skippedReason: 'readonly' }
  }
  const sched = await getSchedule()
  if (!sched.enabled) {
    return { ok: false, ran: false, results: [], summary: 'Skipped — the scheduler is disabled', skippedReason: 'disabled' }
  }
  if (sched.nextRunAt && new Date(sched.nextRunAt).getTime() > Date.now()) {
    return { ok: false, ran: false, results: [], summary: `Not due until ${sched.nextRunAt}`, skippedReason: 'notdue' }
  }
  return runScheduled()
}

// --- timer: keep scheduled maintenance running while the app is up ---

let timer: ReturnType<typeof setInterval> | null = null
let inFlight = false

export function startScheduler(intervalMs = 60_000): void {
  if (timer) return
  timer = setInterval(() => {
    if (inFlight) return
    inFlight = true
    void maybeRunScheduled()
      .catch(() => undefined)
      .finally(() => {
        inFlight = false
      })
  }, intervalMs)
  timer.unref?.()
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export async function scheduleHistory(limit = 20): Promise<ScheduledMaintenanceRun[]> {
  const cur = requireCurrent()
  const n = Math.max(1, Math.min(100, limit))
  const r = await cur.connection.runAndReadAll(
    `SELECT run_id, ran_at, ok, actions, summary, duration_ms FROM maintenance_runs ORDER BY run_id DESC LIMIT ${n}`
  )
  return r.getRowObjects().map((row: Record<string, unknown>) => ({
    runId: Number(row.run_id),
    ranAt: toIso(row.ran_at) ?? String(row.ran_at),
    ok: row.ok === true || String(row.ok) === 'true',
    actions: parseActions(row.actions),
    summary: String(row.summary ?? ''),
    durationMs: Number(row.duration_ms ?? 0)
  }))
}
