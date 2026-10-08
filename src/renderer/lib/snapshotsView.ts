/** Helpers for the workspace snapshots panel (Workspace Settings). */

/** "2026-10-08 10:19:42.123" or an ISO string → "08/10/2026 10:19" (as stored, no time-zone shift). */
export function fmtDateTime(ts: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(ts ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : '—'
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** Whether a KPI's change between two snapshots is an improvement, in the KPI's own direction. */
export function deltaTone(k: { delta: number | null; worseIsHigher: boolean }): 'better' | 'worse' | 'same' | 'none' {
  if (k.delta == null || !Number.isFinite(k.delta)) return 'none'
  if (k.delta === 0) return 'same'
  return (k.delta > 0) === k.worseIsHigher ? 'worse' : 'better'
}

export function snapshotNameProblem(name: string): string | null {
  const n = name.trim()
  if (n === '') return 'Give the snapshot a name'
  if (n.length > 80) return 'Keep the name under 80 characters'
  return null
}

/** A KPI value in the snapshot comparison: whole numbers as counts, else two decimals. */
export function fmtSnapValue(v: number | null, unit: string): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const n = Number.isInteger(v) ? v.toLocaleString('en-US') : Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2)
  return unit === '%' ? `${n}%` : unit ? `${n} ${unit}` : n
}
