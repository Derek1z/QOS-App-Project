import type { DuckDBConnection } from '@duckdb/node-api'
import type { CanonicalField, MappingConfig } from '../../../shared/api'
import { FIELD_ORDER } from '../../../shared/api'

export interface FieldDef {
  field: CanonicalField
  label: string
  required: boolean
  aliases: string[]
}

/** Canonical fields and the aliases each source header may use (spec §11, §13). */
export const FIELDS: FieldDef[] = [
  {
    field: 'date',
    label: 'Date / Time',
    required: true,
    aliases: ['datetime', 'date', 'day', 'time', 'timestamp', 'date/time', 'date_time', 'report date', 'day (date)']
  },
  {
    field: 'cell',
    label: 'Cell',
    required: true,
    aliases: ['cell', 'cell id', 'cellid', 'cell name', 'cellname', 'lcell', 'cell_id', 'sector']
  },
  {
    field: 'district',
    label: 'District',
    required: false,
    aliases: ['district', 'district name', 'districtname', 'dist']
  },
  {
    field: 'region',
    label: 'Region',
    required: false,
    aliases: ['region', 'region name', 'regionname']
  },
  {
    field: 'site',
    label: 'Site / Base Station',
    required: false,
    aliases: ['basestation', 'base station', 'site', 'bts', 'site id', 'siteid', 'site name', 'site_id']
  },
  {
    field: 'prb',
    label: 'PRB Utilization (%)',
    required: false,
    aliases: [
      '4g peak hour traffic utilization_nca', 'prb utilization', 'prb', 'prb util',
      'peak hour traffic utilization', 'prb_utilization', 'prb utilisation', '4g prb',
      '4g peak hour traffic utilization',
      'peak hour traffic utilization nca',
      '4g peak hour traffic utilization std',
    ]
  },
  {
    field: 'users',
    label: 'Connected Users',
    required: false,
    aliases: [
      'rrc connected ues (avg)_std(#)', 'connected users', 'rrc connected ues',
      'rrc connected users', 'users', 'connected_users', 'rrc connected ues (avg)',
      'rrc connected ues avg',
      'rrc connected ues (avg) std',
      'connected ues (avg)',
    ]
  },
  {
    field: 'volume',
    label: 'Data Volume (MB)',
    required: false,
    aliases: [
      '4g data volume_std(mb)', 'data volume', 'data volume (mb)', 'data_volume_mb',
      'traffic', 'volume mb', '4g data volume', 'traffic (mb)',
      '4g data volume std',
      '4g data volume (mb)',
      'data volume std',
    ]
  },
  {
    field: 'availability',
    label: 'Availability (%)',
    required: false,
    aliases: [
      '4g cell availability_std(%)', 'availability', 'cell availability',
      'availability_pct', 'cell availability (%)', '4g cell availability',
      '4g cell availability std',
      'cell availability std',
      '4g cell availability (%)',
    ]
  },
  {
    field: 'throughput',
    label: 'DL Throughput (kbps)',
    required: false,
    aliases: [
      'e-utran ip throughput ue dl_std(kbps)', 'dl throughput', 'throughput',
      'e-utran ip throughput ue dl', 'dl_throughput_kbps', 'throughput dl',
      'eutran ip throughput ue dl', 'ip throughput',
      'e-utran ip throughput ue dl std',
      'eutran ip throughput ue dl std',
      'e-utran ip throughput ue dl (kbps)',
      'ip throughput ue dl',
    ]
  }
]

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const aliasIndex = new Map<string, CanonicalField>()
for (const f of FIELDS) {
  for (const a of f.aliases) aliasIndex.set(normalizeHeader(a), f.field)
}

/** Best-effort automatic mapping: source header name -> canonical field. */
export function autoMap(headers: string[]): Record<string, CanonicalField> {
  const mapping: Record<string, CanonicalField> = {}
  const used = new Set<CanonicalField>()
  for (const h of headers) {
    const f = aliasIndex.get(normalizeHeader(h))
    if (f && !used.has(f)) {
      mapping[h] = f
      used.add(f)
    }
  }
  return mapping
}

export function mappingConfidence(mapping: Record<string, CanonicalField>, headers: string[]): number {
  const values = Object.values(mapping)
  const hasDate = values.includes('date')
  const hasCell = values.includes('cell')
  if (!hasDate || !hasCell) return 0.2
  const kpis: CanonicalField[] = ['prb', 'users', 'volume', 'availability', 'throughput']
  const mappedKpis = kpis.filter((k) => values.includes(k)).length
  void headers
  return Math.round((0.5 + 0.5 * (mappedKpis / kpis.length)) * 100) / 100
}

/** Fingerprint of a source file: normalized header order + sorted header set (spec §13). */
export function makeFingerprint(headers: string[]): string {
  const norm = headers.map(normalizeHeader)
  const ordered = norm.join('|')
  const sorted = [...norm].sort().join(',')
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5
  for (const c of ordered) h1 = Math.imul(h1 ^ c.charCodeAt(0), 0x01000193) >>> 0
  for (const c of sorted) h2 = Math.imul(h2 ^ c.charCodeAt(0), 0x01000193) >>> 0
  return h1.toString(16) + '-' + h2.toString(16)
}

/** A remembered source profile: canonical columns + any KPI assignments the
 *  user accepted on the last import of this source (spec §13, §54a). */
export interface SourceProfile {
  columns: Record<string, CanonicalField>
  kpiColumns: Record<string, string>
}

export async function loadProfileConn(
  conn: DuckDBConnection,
  fingerprint: string
): Promise<SourceProfile | null> {
  const r = await conn.runAndReadAll(
    `SELECT profile FROM source_mapping_profiles WHERE fingerprint = ?`,
    [fingerprint]
  )
  const row = r.getRowObjects()[0]
  if (!row || !row.profile) return null
  try {
    const parsed = JSON.parse(String(row.profile)) as
      | SourceProfile
      | Record<string, CanonicalField>
    // profiles saved before KPI support store the plain canonical map
    if (parsed && !('columns' in parsed)) {
      return { columns: parsed as Record<string, CanonicalField>, kpiColumns: {} }
    }
    const p = parsed as SourceProfile
    return { columns: p.columns ?? {}, kpiColumns: p.kpiColumns ?? {} }
  } catch {
    return null
  }
}

export async function saveProfileConn(
  conn: DuckDBConnection,
  fingerprint: string,
  mapping: MappingConfig,
  confidence: number
): Promise<void> {
  await conn.run(
    `INSERT INTO source_mapping_profiles (fingerprint, profile, confidence, first_used, last_used)
     VALUES (?, ?, ?, now(), now())
     ON CONFLICT (fingerprint) DO UPDATE SET
       profile = excluded.profile,
       confidence = excluded.confidence,
       last_used = now()`,
    [fingerprint, JSON.stringify({ columns: mapping.columns, kpiColumns: mapping.kpiColumns ?? {} }), confidence]
  )
}

// Main-side wrappers that resolve the current workspace's connection live in
// importer.ts (mapping.ts stays electron-free so the import worker can bundle it).

export function mappedFields(mapping: Record<string, CanonicalField>): Set<CanonicalField> {
  return new Set(Object.values(mapping))
}

export function headersForField(
  header: string[],
  mapping: Record<string, CanonicalField>,
  field: CanonicalField
): string | null {
  return header.find((h) => mapping[h] === field) ?? null
}

export function orderedMappedRows(
  header: string[],
  rows: string[][],
  mapping: Record<string, CanonicalField>
): Array<Record<string, string | null>> {
  return rows.map((row) => {
    const out: Record<string, string | null> = {}
    for (const field of FIELD_ORDER) {
      const idx = header.findIndex((h) => mapping[h] === field)
      out[field] = idx >= 0 && row[idx] !== undefined ? row[idx] : null
    }
    return out
  })
}

