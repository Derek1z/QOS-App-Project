import { existsSync, statSync, copyFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import * as ws from '../workspace/manager'
import { backupsDir, snapshotsDir } from '../paths'
import type {
  CreateSnapshotOpts, SnapshotComparison, SnapshotComparisonKpi, WorkspaceInfo, WorkspaceSnapshot
} from '../../../shared/api'

/** Workspace snapshots (spec §7): analytical point-in-time copies of the
 *  .qosdb file stored under backups/snapshots/ and tracked in the
 *  workspace_snapshots table. Not a disaster-recovery mechanism — for that the
 *  automatic pre-import backups + a pre-restore safety copy exist. */

function rowToSnapshot(row: Record<string, unknown>): WorkspaceSnapshot {
  const path = row.path ? String(row.path) : ''
  let sizeBytes = 0
  if (path && existsSync(path)) {
    try {
      sizeBytes = statSync(path).size
    } catch {
      /* file gone */
    }
  }
  return {
    snapshotId: Number(row.snapshot_id),
    name: String(row.name ?? ''),
    reason: row.reason ? String(row.reason) : null,
    notes: row.notes ? String(row.notes) : null,
    createdAt: String(row.created_at ?? ''),
    sizeBytes,
    path
  }
}

const SNAPSHOT_SELECT = `
  SELECT CAST(snapshot_id AS DOUBLE) AS snapshot_id, name, reason, notes,
         CAST(created_at AS VARCHAR) AS created_at, path
  FROM workspace_snapshots`

function requireWritable(): void {
  const cur = ws.getCurrent()
  if (!cur) throw new Error('No workspace is open')
  if (cur.readOnly) throw new Error('Workspace is read-only — this action is blocked')
}

function stamp(): string {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
}

async function findRow(snapshotId: number): Promise<{
  snapshot_id: number
  name: string
  reason: string | null
  notes: string | null
  created_at: string
  path: string
} | null> {
  const cur = ws.getCurrent()
  if (!cur) return null
  const r = await cur.connection.runAndReadAll(
    `${SNAPSHOT_SELECT} WHERE snapshot_id = ?`,
    [snapshotId]
  )
  const row = r.getRowObjects()[0]
  return row
    ? {
        snapshot_id: Number(row.snapshot_id),
        name: String(row.name ?? ''),
        reason: row.reason ? String(row.reason) : null,
        notes: row.notes ? String(row.notes) : null,
        created_at: String(row.created_at ?? ''),
        path: row.path ? String(row.path) : ''
      }
    : null
}

export async function listSnapshots(): Promise<WorkspaceSnapshot[]> {
  const cur = ws.getCurrent()
  if (!cur) return []
  const r = await cur.connection.runAndReadAll(`${SNAPSHOT_SELECT} ORDER BY created_at DESC`)
  return r.getRowObjects().map(rowToSnapshot)
}

export async function createSnapshot(name: string, opts: CreateSnapshotOpts = {}): Promise<WorkspaceSnapshot> {
  requireWritable()
  const cur = ws.getCurrent()!
  const safeName = (name.trim() || `Snapshot ${new Date().toLocaleDateString()}`)
    .replace(/[\\/:*?"<>|]+/g, '_')
  mkdirSync(snapshotsDir(), { recursive: true })
  const path = join(snapshotsDir(), `${safeName}-${stamp()}.qosdb`)

  // A snapshot must be a clean point-in-time copy: Windows locks open DuckDB
  // files, so close the handle, copy, reopen (the worker-import pattern).
  await ws.closeWorkspace()
  let copied = false
  try {
    copyFileSync(cur.path, path)
    copied = true
  } finally {
    await ws.openWorkspace(cur.path)
  }
  if (!copied) throw new Error('Snapshot failed — the workspace was reopened unchanged')

  const conn = ws.getCurrent()!.connection
  await conn.run(
    `INSERT INTO workspace_snapshots (name, reason, notes, created_at, path)
     VALUES (?, ?, ?, now(), ?)`,
    [safeName, opts.reason?.trim() || null, opts.notes?.trim() || null, path]
  )
  const max = await conn.runAndReadAll(
    `SELECT max(snapshot_id) AS id FROM workspace_snapshots`
  )
  const id = Number(max.getRowObjects()[0]?.id ?? 0)
  const r = await conn.runAndReadAll(`${SNAPSHOT_SELECT} WHERE snapshot_id = ?`, [id])
  return rowToSnapshot(r.getRowObjects()[0])
}

export async function restoreSnapshot(snapshotId: number): Promise<WorkspaceInfo> {
  requireWritable()
  const cur = ws.getCurrent()!
  const row = await findRow(snapshotId)
  if (!row) throw new Error('Snapshot not found')
  if (!row.path || !existsSync(row.path)) {
    throw new Error(`Snapshot file is missing: ${row.path}`)
  }

  // Spec §58: create a backup first for state-altering repair operations. The
  // safety copy uses a pre-restore- prefix so backup rotation never touches it.
  mkdirSync(backupsDir(), { recursive: true })
  const safety = join(backupsDir(), `pre-restore-${cur.name}-${stamp()}.qosdb`)

  await ws.closeWorkspace()
  let ok = false
  try {
    copyFileSync(cur.path, safety)
    copyFileSync(row.path, cur.path)
    ok = true
  } finally {
    await ws.openWorkspace(cur.path)
  }
  if (!ok) {
    throw new Error('Restore failed — a pre-restore backup was written to backups/')
  }

  try {
    const noteMsg = `Restored snapshot "${row.name}" (${row.path}); pre-restore backup: ${safety}`.replace(/'/g, "''")
    await ws.getCurrent()!.connection.run(
      `INSERT INTO notes_events (entity_type, kind, note, author)
       VALUES ('workspace', 'snapshot_restore', '${noteMsg}', 'system')`
    )
  } catch {
    /* audit write is best-effort */
  }
  return (await ws.getCurrentInfo())!
}

export async function removeSnapshot(snapshotId: number): Promise<void> {
  requireWritable()
  const cur = ws.getCurrent()!
  const row = await findRow(snapshotId)
  if (!row) throw new Error('Snapshot not found')
  if (row.path) {
    try {
      unlinkSync(row.path)
    } catch {
      /* already gone */
    }
  }
  await cur.connection.run(
    `DELETE FROM workspace_snapshots WHERE snapshot_id = ${snapshotId}`
  )
}

// --- snapshot comparison (spec §7) ------------------------------------------

/** KPI summary of one snapshot file, opened read-only (snapshots are static
 *  .qosdb copies — the live workspace never needs to be touched). */
const SNAPSHOT_KPI_SQL = `
  SELECT
    (SELECT count(*) FROM fact_cell_daily) AS rows,
    (SELECT count(*) FROM dim_cell) AS cells,
    (SELECT count(*) FROM dim_site) AS sites,
    (SELECT count(*) FROM dim_district) AS districts,
    (SELECT count(*) FROM dim_region) AS regions,
    (SELECT count(*) FROM agg_cell_weekly WHERE is_nc) AS nc_cells,
    (SELECT count(*) FROM agg_cell_weekly) AS weekly_rows,
    (SELECT avg(prb_utilization) FROM fact_cell_daily) AS avg_prb,
    (SELECT sum(data_volume_mb) FROM fact_cell_daily) AS total_volume_mb,
    (SELECT sum(connected_users) FROM fact_cell_daily) AS total_users,
    (SELECT avg(dl_throughput_kbps) FROM fact_cell_daily) AS avg_throughput_kbps,
    (SELECT avg(availability_pct) FROM fact_cell_daily) AS avg_availability,
    (SELECT max(version) FROM ruleset) AS ruleset_version,
    (SELECT avg(health_score) FROM cell_health_history
      WHERE date_id = (SELECT max(date_id) FROM cell_health_history)) AS health_score
`

const SNAPSHOT_KPIS: Array<{ key: string; label: string; unit: string; worseIsHigher: boolean }> = [
  { key: 'rows', label: 'Observed rows', unit: '', worseIsHigher: false },
  { key: 'cells', label: 'Cells', unit: '', worseIsHigher: false },
  { key: 'avg_prb', label: 'Avg PRB utilization', unit: '%', worseIsHigher: true },
  { key: 'avg_availability', label: 'Availability', unit: '%', worseIsHigher: false },
  { key: 'avg_throughput_kbps', label: 'DL throughput', unit: 'kbps', worseIsHigher: false },
  { key: 'total_users', label: 'Connected users', unit: '', worseIsHigher: false },
  { key: 'total_volume_mb', label: 'Data volume', unit: 'MB', worseIsHigher: false },
  { key: 'nc_cells', label: 'Weekly NC cells', unit: '', worseIsHigher: true },
  { key: 'health_score', label: 'Avg cell health score', unit: '', worseIsHigher: false },
  { key: 'ruleset_version', label: 'Ruleset version', unit: '', worseIsHigher: false }
]

async function snapshotKpis(path: string): Promise<Record<string, number | null>> {
  const instance = await DuckDBInstance.create(path, { access_mode: 'READ_ONLY' })
  try {
    const conn = await instance.connect()
    try {
      const r = await conn.runAndReadAll(SNAPSHOT_KPI_SQL)
      const row = r.getRowObjects()[0] ?? {}
      const out: Record<string, number | null> = {}
      for (const k of SNAPSHOT_KPIS) out[k.key] = row[k.key] == null ? null : Number(row[k.key])
      return out
    } finally {
      try {
        conn.closeSync()
      } catch {
        /* ignore */
      }
    }
  } finally {
    try {
      instance.closeSync()
    } catch {
      /* ignore */
    }
  }
}

export async function compareSnapshots(aId: number, bId: number): Promise<SnapshotComparison> {
  const cur = ws.getCurrent()
  if (!cur) throw new Error('No workspace is open')
  const a = await findRow(aId)
  const b = await findRow(bId)
  if (!a || !b) throw new Error('One of the snapshots was not found')
  if (!a.path || !existsSync(a.path) || !b.path || !existsSync(b.path)) {
    throw new Error('A snapshot file is missing — it may have been deleted')
  }
  const [ka, kb] = await Promise.all([snapshotKpis(a.path), snapshotKpis(b.path)])
  const kpis: SnapshotComparisonKpi[] = SNAPSHOT_KPIS.map((k) => {
    const va = ka[k.key]
    const vb = kb[k.key]
    const delta = va == null || vb == null ? null : Math.round((vb - va) * 100) / 100
    const deltaPct = va == null || vb == null || va === 0 ? null : Math.round(((vb - va) / Math.abs(va)) * 1000) / 10
    return { key: k.key, label: k.label, unit: k.unit, a: va, b: vb, delta, deltaPct, worseIsHigher: k.worseIsHigher }
  })
  return {
    a: { snapshotId: a.snapshot_id, name: a.name, createdAt: a.created_at },
    b: { snapshotId: b.snapshot_id, name: b.name, createdAt: b.created_at },
    kpis
  }
}
