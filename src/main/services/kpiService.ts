import type { DuckDBConnection } from '@duckdb/node-api'
import type { Technology, KpiDefinition, KpiDefPatch, KpiDiscovery } from '../../../shared/api'
import { getCurrent } from '../workspace/manager'

/** spec §54a: per-technology KPI definition registry. The built-in sets define
 *  what each technology's Cell Intelligence / analysis reports; targets are
 *  editable on the KPI Definitions page; extra columns from imported sources
 *  can be mapped to any definition key. */

interface SeedDef {
  key: string
  label: string
  unit: string
  worseIsHigher: boolean
  target: number | null
  agg: 'avg' | 'sum' | 'max' | 'min'
  aliases: string[]
}

const SEEDS: Record<Technology, SeedDef[]> = {
  '2G': [
    { key: 'tch_congestion', label: 'TCH Congestion', unit: '%', worseIsHigher: true, target: 2, agg: 'avg', aliases: ['tch congestion', 'tch congestion (%)', 'tch congestion rate', 'congestion'] },
    { key: 'sdcch_congestion', label: 'SDCCH Congestion', unit: '%', worseIsHigher: true, target: 2, agg: 'avg', aliases: ['sdcch congestion', 'sdcch congestion (%)', 'sdcch congestion rate'] },
    { key: 'tch_availability', label: 'TCH Availability', unit: '%', worseIsHigher: false, target: 99.5, agg: 'avg', aliases: ['tch availability', 'tch availability (%)', 'availability'] },
    { key: 'drop_call_rate', label: 'Drop Call Rate', unit: '%', worseIsHigher: true, target: 1.5, agg: 'avg', aliases: ['drop call rate', 'call drop rate', 'dropped call rate (%)', 'drops (%)'] },
    { key: 'call_setup_success', label: 'Call Setup Success', unit: '%', worseIsHigher: false, target: 98.5, agg: 'avg', aliases: ['call setup success', 'cssr', 'call setup success rate (%)'] },
    { key: 'gprs_traffic', label: 'GPRS Traffic', unit: 'MB', worseIsHigher: false, target: null, agg: 'sum', aliases: ['gprs traffic', 'gprs traffic (mb)', 'gprs data volume'] },
    { key: 'gprs_throughput', label: 'GPRS/EDGE Throughput', unit: 'kbps', worseIsHigher: false, target: null, agg: 'avg', aliases: ['gprs throughput', 'gprs/edge throughput', 'throughput', 'dl throughput (kbps)', 'edge throughput'] },
    { key: 'connected_users', label: 'Connected Users', unit: '', worseIsHigher: false, target: null, agg: 'avg', aliases: ['connected users', 'users', 'active users', 'rrc connected ues'] }
  ],
  '3G': [
    { key: 'ce_utilization', label: 'CE Utilization', unit: '%', worseIsHigher: true, target: 70, agg: 'avg', aliases: ['ce utilization', 'ce utilization (%)', 'channel element utilization'] },
    { key: 'hsdpa_throughput', label: 'HSDPA Throughput', unit: 'kbps', worseIsHigher: false, target: null, agg: 'avg', aliases: ['hsdpa throughput', 'hsdpa throughput (kbps)', 'dl throughput (kbps)', 'throughput'] },
    { key: 'hsupa_throughput', label: 'HSUPA Throughput', unit: 'kbps', worseIsHigher: false, target: null, agg: 'avg', aliases: ['hsupa throughput', 'hsupa throughput (kbps)', 'ul throughput'] },
    { key: 'rrc_connection_success', label: 'RRC Connection Success', unit: '%', worseIsHigher: false, target: 98.5, agg: 'avg', aliases: ['rrc connection success', 'rrc setup success rate', 'cssr'] },
    { key: 'drop_call_rate', label: 'Drop Call Rate', unit: '%', worseIsHigher: true, target: 1.5, agg: 'avg', aliases: ['drop call rate', 'call drop rate', 'dropped call rate (%)'] },
    { key: 'data_volume', label: 'Data Volume', unit: 'MB', worseIsHigher: false, target: null, agg: 'sum', aliases: ['data volume', 'data volume (mb)', 'traffic (mb)', 'volume'] },
    { key: 'connected_users', label: 'Connected Users', unit: '', worseIsHigher: false, target: null, agg: 'avg', aliases: ['connected users', 'users', 'active users', 'rrc connected ues'] }
  ],
  '4G': [
    { key: 'prb_utilization', label: 'PRB Utilization', unit: '%', worseIsHigher: true, target: 80, agg: 'avg', aliases: ['prb utilization', 'prb', 'prb util', 'prb utilization (%)', '4g prb', 'peak hour traffic utilization'] },
    { key: 'dl_throughput', label: 'DL Throughput', unit: 'kbps', worseIsHigher: false, target: null, agg: 'avg', aliases: ['dl throughput', 'throughput', 'dl throughput (kbps)', 'e-utran ip throughput ue dl', 'e-utran ip throughput ue dl (kbps)'] },
    { key: 'connected_users', label: 'Connected Users', unit: '', worseIsHigher: false, target: null, agg: 'avg', aliases: ['connected users', 'users', 'rrc connected ues', 'rrc connected ues (avg)', 'active users'] },
    { key: 'data_volume', label: 'Data Volume', unit: 'MB', worseIsHigher: false, target: null, agg: 'sum', aliases: ['data volume', 'data volume (mb)', 'traffic (mb)', '4g data volume', 'volume'] },
    { key: 'availability', label: 'Availability', unit: '%', worseIsHigher: false, target: 99.5, agg: 'avg', aliases: ['availability', 'cell availability', 'availability (%)', '4g cell availability'] },
    { key: 'drop_call_rate', label: 'Drop Call Rate', unit: '%', worseIsHigher: true, target: 1.5, agg: 'avg', aliases: ['drop call rate', 'call drop rate', 'erab drop rate'] }
  ]
}

export function builtInSeeds(technology: Technology): SeedDef[] {
  return SEEDS[technology] ?? []
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function rowToDef(x: Record<string, unknown>): KpiDefinition {
  let headers: string[] = []
  try {
    const parsed = JSON.parse(String(x.source_headers ?? '[]'))
    headers = Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    /* ignore */
  }
  return {
    kpiId: Number(x.kpi_id),
    technology: (String(x.technology) === '2G' || String(x.technology) === '3G') ? (String(x.technology) as Technology) : '4G',
    key: String(x.kpi_key),
    label: String(x.label),
    unit: String(x.unit ?? ''),
    worseIsHigher: Boolean(x.worse_is_higher),
    target: x.target == null ? null : Number(x.target),
    agg: (['avg', 'sum', 'max', 'min'] as const).includes(String(x.agg) as never) ? (String(x.agg) as KpiDefinition['agg']) : 'avg',
    sourceHeaders: headers,
    isCustom: Boolean(x.is_custom),
    active: Boolean(x.active),
    sortOrder: Number(x.sort_order ?? 0),
    createdAt: String(x.created_at ?? ''),
    updatedAt: String(x.updated_at ?? '')
  }
}

/** The workspace's technology (workspace_meta, default 4G). */
export async function workspaceTechnology(conn: DuckDBConnection): Promise<Technology> {
  const r = await conn.runAndReadAll(
    `SELECT value FROM workspace_meta WHERE key = 'technology'`
  )
  const v = r.getRowObjects()[0]?.value
  return v === '2G' || v === '3G' ? (String(v) as Technology) : '4G'
}

/** Insert the built-in seed set for one technology (idempotent per key). */
export async function seedKpiDefs(conn: DuckDBConnection, technology: Technology): Promise<KpiDefinition[]> {
  for (let i = 0; i < SEEDS[technology].length; i++) {
    const s = SEEDS[technology][i]
    await conn.run(
      `INSERT INTO kpi_defs
         (technology, kpi_key, label, unit, worse_is_higher, target, agg,
          source_headers, is_custom, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, false, true, ?)
       ON CONFLICT (technology, kpi_key) DO UPDATE SET
         label = excluded.label,
         unit = excluded.unit,
         worse_is_higher = excluded.worse_is_higher,
         target = COALESCE(kpi_defs.target, excluded.target),
         agg = excluded.agg,
         source_headers = excluded.source_headers,
         updated_at = now()`,
      [technology, s.key, s.label, s.unit, s.worseIsHigher, s.target, s.agg,
        JSON.stringify(s.aliases), i]
    )
  }
  return listKpiDefs(conn, technology)
}

/** All active definitions for one technology (or every technology). */
export async function listKpiDefs(
  conn: DuckDBConnection,
  technology?: Technology
): Promise<KpiDefinition[]> {
  const where = technology ? `WHERE technology = ?` : ''
  const params: (string | number)[] = technology ? [technology] : []
  const r = await conn.runAndReadAll(
    `SELECT kpi_id, technology, kpi_key, label, unit, worse_is_higher, target, agg,
       source_headers, is_custom, active, sort_order,
       CAST(created_at AS VARCHAR) AS created_at, CAST(updated_at AS VARCHAR) AS updated_at
     FROM kpi_defs ${where}
     ORDER BY technology, sort_order, kpi_key`,
    params
  )
  return r.getRowObjects().map(rowToDef)
}

/** Insert or update a definition (matched on technology + key when the patch
 *  carries a key; otherwise on kpiId). */
export async function saveKpiDef(conn: DuckDBConnection, patch: KpiDefPatch): Promise<KpiDefinition> {
  const technology = (patch.technology === '2G' || patch.technology === '3G')
    ? patch.technology
    : (patch.technology ?? (await workspaceTechnology(conn)))
  const existing = await findByKeyOrId(conn, technology, patch)
  const now = new Date().toISOString()

  if (existing) {
    const id = existing.kpiId
    const merged = { ...existing, ...patch }
    await conn.run(
      `UPDATE kpi_defs SET
         label = ?, unit = ?, worse_is_higher = ?, target = ?, agg = ?,
         source_headers = ?, active = ?, updated_at = now()
       WHERE kpi_id = ?`,
      [
        merged.label, merged.unit, merged.worseIsHigher,
        merged.target, merged.agg,
        JSON.stringify(merged.sourceHeaders), merged.active, id
      ]
    )
    const back = await listKpiDefs(conn, merged.technology)
    const found = back.find((k) => k.kpiId === id)
    if (found) return found
    return { ...merged, kpiId: id, createdAt: existing.createdAt, updatedAt: now }
  }

  // new definition: key + label are required
  const key = (patch.key ?? '').trim()
  const label = (patch.label ?? '').trim()
  if (!key || !label) throw new Error('A new KPI needs both a key and a label')
  const sortR = await conn.runAndReadAll(
    `SELECT COALESCE(max(sort_order), -1) + 1 AS next FROM kpi_defs WHERE technology = ?`,
    [technology]
  )
  const sortOrder = Number(sortR.getRowObjects()[0].next)
  await conn.run(
    `INSERT INTO kpi_defs
       (technology, kpi_key, label, unit, worse_is_higher, target, agg,
        source_headers, is_custom, active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, true, ?, ?, ?, ?)`,
    [
      technology, key, label, patch.unit ?? '', patch.worseIsHigher ?? true,
      patch.target ?? null, patch.agg ?? 'avg',
      JSON.stringify(patch.sourceHeaders ?? []), patch.active ?? true, sortOrder,
      now, now
    ]
  )
  const back = await listKpiDefs(conn, technology)
  const found = back.find((k) => k.key === key)
  if (found) return found
  throw new Error('Failed to create KPI definition')
}

async function findByKeyOrId(
  conn: DuckDBConnection,
  technology: Technology,
  patch: KpiDefPatch
): Promise<KpiDefinition | null> {
  if (patch.kpiId != null) {
    const r = await conn.runAndReadAll(
      `SELECT kpi_id, technology, kpi_key, label, unit, worse_is_higher, target, agg,
         source_headers, is_custom, active, sort_order,
         CAST(created_at AS VARCHAR) AS created_at, CAST(updated_at AS VARCHAR) AS updated_at
       FROM kpi_defs WHERE kpi_id = ?`,
      [patch.kpiId]
    )
    const row = r.getRowObjects()[0]
    return row ? rowToDef(row) : null
  }
  if (patch.key) {
    const r = await conn.runAndReadAll(
      `SELECT kpi_id, technology, kpi_key, label, unit, worse_is_higher, target, agg,
         source_headers, is_custom, active, sort_order,
         CAST(created_at AS VARCHAR) AS created_at, CAST(updated_at AS VARCHAR) AS updated_at
       FROM kpi_defs WHERE technology = ? AND kpi_key = ?`,
      [technology, patch.key]
    )
    const row = r.getRowObjects()[0]
    return row ? rowToDef(row) : null
  }
  return null
}

export async function removeKpiDef(conn: DuckDBConnection, kpiId: number): Promise<void> {
  await conn.run(`DELETE FROM kpi_defs WHERE kpi_id = ?`, [kpiId])
  // orphaned values are harmless (left for history/audit), but drop weekly
  // rollups for the definition so analysis stops showing them
  await conn.run(`DELETE FROM agg_cell_kpi_weekly WHERE kpi_id = ?`, [kpiId])
}

/** Match source headers to KPI aliases (normalized) for import auto-mapping. */
export async function discoverKpiDefs(
  conn: DuckDBConnection,
  headers: string[],
  technology?: Technology
): Promise<KpiDiscovery> {
  const defs = await listKpiDefs(conn, technology)
  const aliasIndex = new Map<string, string>()
  for (const d of defs) {
    for (const a of [...d.sourceHeaders, d.label, d.key]) {
      const n = normalizeHeader(a)
      if (n && !aliasIndex.has(n)) aliasIndex.set(n, d.key)
    }
  }
  const mapping: Record<string, string> = {}
  let matched = 0
  for (const h of headers) {
    const key = aliasIndex.get(normalizeHeader(h))
    if (key) {
      mapping[h] = key
      matched++
    }
  }
  return {
    mapping,
    confidence: headers.length > 0 ? matched / headers.length : 0
  }
}

// --- convenience for IPC handlers (current workspace connection) ------------

function conn(): DuckDBConnection {
  const w = getCurrent()
  if (!w) throw new Error('No workspace is open')
  return w.connection
}

export function seedCurrent(technology?: Technology): Promise<KpiDefinition[]> {
  const c = conn()
  return seedKpiDefs(c, technology ?? '4G')
}

export function listCurrent(technology?: Technology): Promise<KpiDefinition[]> {
  return listKpiDefs(conn(), technology)
}

export function saveCurrent(patch: KpiDefPatch): Promise<KpiDefinition> {
  return saveKpiDef(conn(), patch)
}

export function removeCurrent(kpiId: number): Promise<void> {
  return removeKpiDef(conn(), kpiId)
}

export function discoverCurrent(headers: string[], technology?: Technology): Promise<KpiDiscovery> {
  return discoverKpiDefs(conn(), headers, technology)
}
