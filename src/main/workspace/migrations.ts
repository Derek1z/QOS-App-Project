import type { DuckDBConnection } from '@duckdb/node-api'

/**
 * Versioned workspace migrations (spec 2026-10-10-versioned-migrations).
 *
 * Every workspace stores one integer `schema_version` in workspace_meta. A
 * writable open runs the migrations above it, in order, once, after a backup;
 * a workspace saved by a newer app (version above LATEST) opens read-only.
 *
 * Rule for schema changes: change SCHEMA_SQL (new workspaces) AND append
 * migration LATEST + 1 (existing workspaces). Never edit or reorder a
 * migration that has shipped. The schema-parity test fails when only one side
 * changes.
 */

export interface Migration {
  version: number
  name: string
  /** Returns true when it changed data that needs the aggregates + intelligence recompute. */
  up(conn: DuckDBConnection): Promise<boolean | void>
  /** Temp views a read-only open needs while the workspace is older than this step. */
  readOnlyShim?(conn: DuckDBConnection): Promise<void>
}

/** A non-negative integer string is that version; anything else (incl. the old '1.0.0') is 0. */
export function parseSchemaVersion(value: unknown): number {
  const s = value == null ? '' : String(value).trim()
  return /^\d+$/.test(s) ? Number(s) : 0
}

async function getMeta(conn: DuckDBConnection, key: string): Promise<string | null> {
  const v = (await conn.runAndReadAll(`SELECT value FROM workspace_meta WHERE key = ?`, [key])).getRowObjects()[0]?.value
  return v == null ? null : String(v)
}

async function setMeta(conn: DuckDBConnection, key: string, value: string): Promise<void> {
  await conn.run(
    `INSERT INTO workspace_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value]
  )
}

export async function readSchemaVersion(conn: DuckDBConnection): Promise<number> {
  return parseSchemaVersion(await getMeta(conn, 'schema_version'))
}

const failure = (m: { version: number; name: string } | undefined, backupPath: string | null, cause: unknown): Error => {
  const where = m ? `step ${m.version} (${m.name})` : 'the final recompute'
  const copy = backupPath ?? 'the backups folder'
  const e = new Error(`Upgrading this workspace failed at ${where}. A copy from before the upgrade is in ${copy}.`)
  ;(e as Error & { cause?: unknown }).cause = cause
  return e
}

/** Run every migration above `from`, in order, after one backup. Versions are
 *  recorded after each step, except while a requested recompute is still
 *  outstanding: `recompute_pending` then marks it, and the next run finishes it
 *  even when no step reports a change. */
export async function runMigrations(
  conn: DuckDBConnection,
  list: Migration[],
  from: number,
  opts: { backup(): Promise<string>; recompute(conn: DuckDBConnection): Promise<void> }
): Promise<{ ran: number[]; backupPath: string | null; recomputed: boolean }> {
  const pending = list.filter((m) => m.version > from).sort((a, b) => a.version - b.version)
  const pendingFlag = await getMeta(conn, 'recompute_pending')
  if (pending.length === 0 && pendingFlag == null) return { ran: [], backupPath: null, recomputed: false }

  let backupPath: string | null = null
  if (pending.length > 0) {
    try {
      backupPath = await opts.backup()
    } catch (e) {
      throw new Error(
        `Upgrading this workspace was not started: the backup failed (${e instanceof Error ? e.message : String(e)}). Nothing was changed.`
      )
    }
  }

  let asker = pendingFlag != null ? list.find((m) => m.version === Number(pendingFlag)) : undefined
  let recomputeOutstanding = pendingFlag != null
  const ran: number[] = []
  for (const m of pending) {
    let wants: boolean | void
    try {
      wants = await m.up(conn)
    } catch (e) {
      throw failure(m, backupPath, e)
    }
    ran.push(m.version)
    if (wants === true) {
      asker = m
      recomputeOutstanding = true
      await setMeta(conn, 'recompute_pending', String(m.version))
    }
    if (!recomputeOutstanding) await setMeta(conn, 'schema_version', String(m.version))
  }

  if (!recomputeOutstanding) return { ran, backupPath, recomputed: false }
  try {
    await opts.recompute(conn)
  } catch (e) {
    throw failure(asker, backupPath, e)
  }
  await conn.run(`DELETE FROM workspace_meta WHERE key = 'recompute_pending'`)
  const last = pending.at(-1)?.version ?? from
  await setMeta(conn, 'schema_version', String(Math.max(last, from)))
  return { ran, backupPath, recomputed: true }
}

/** A read-only open of an older workspace: the stand-ins its missing steps
 *  provide (temp views only; nothing is written to the file). */
export async function runReadOnlyShims(conn: DuckDBConnection, list: Migration[], from: number): Promise<void> {
  for (const m of [...list].sort((a, b) => a.version - b.version)) {
    if (m.version > from && m.readOnlyShim) await m.readOnlyShim(conn)
  }
}
