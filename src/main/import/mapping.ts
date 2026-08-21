import type { DuckDBConnection } from '@duckdb/node-api'
import type { CanonicalField, MappingConfig, Technology } from '../../../shared/api'
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
    aliases: [
      'datetime', 'date', 'day', 'time', 'timestamp', 'date/time', 'date_time',
      'report date', 'reporting date', 'day (date)', 'measurement date', 'start time',
      'start_time', 'period start time', 'period_start_time', 'interval start time',
      'date (yyyy-mm-dd)', 'date(yyyy-mm-dd)', 'time stamp', 'dt', 'report_date',
      'measurement time'
    ]
  },
  {
    field: 'cell',
    label: 'Cell',
    required: true,
    aliases: [
      'cell', 'cell id', 'cellid', 'cell name', 'cellname', 'lcell', 'cell_id', 'sector',
      'ucell', 'u_cell', '3g cell', '3g cell name', '2g cell', '2g cell name', '4g cell',
      '4g cell name', 'wcdma cell', 'umts cell', 'cell_name', 'cell_identity', 'cgi',
      'ci', 'source cell'
    ]
  },
  {
    field: 'district',
    label: 'District',
    required: false,
    aliases: ['district', 'district name', 'districtname', 'dist', 'admin district', 'municipality', 'lga', 'district_name']
  },
  {
    field: 'region',
    label: 'Region',
    required: false,
    aliases: ['region', 'region name', 'regionname', 'admin region', 'province', 'province name', 'region_name', 'state']
  },
  {
    field: 'site',
    label: 'Site / Base Station',
    required: false,
    aliases: [
      'basestation', 'base station', 'base station name', 'bs name', 'site', 'site id', 'siteid',
      'site name', 'site_name', 'bts', 'bts name', 'btsname', 'bts id', 'btsid',
      'nodeb', 'node b', 'nodeb name', 'nodeb id', 'node_b', 'node_b_name', 'wbts', 'wbts name',
      'enodeb', 'enodeb name', 'enodeb id', 'enb', 'enb name', 'ne name', 'nename', 'cell site',
      '3g site', '2g site', '4g site', 'rnc', 'rnc name', 'bsc', 'bsc name', 'bsc_name',
      '2g bts', '2g site name', 'site_id'
    ]
  },
  {
    field: 'prb',
    label: 'PRB / Traffic Utilization (%)',
    required: false,
    aliases: [
      '4g peak hour traffic utilization_nca', '4g peak hour traffic utilization',
      '4g peak hour traffic utilization std', '4g peak hour traffic utilization_std(%)',
      '4g prb', 'prb utilization', 'prb', 'prb util', 'peak hour traffic utilization',
      'prb_utilization', 'prb utilisation', 'peak hour traffic utilization nca',
      'peak hour traffic utilization std', 'peak hour traffic utilization (%)',
      'utilization', 'utilization (%)',
      '3g peak hour traffic utilization_nca', '3g peak hour traffic utilization',
      '3g peak hour traffic utilization std', '3g peak hour traffic utilization_std(%)',
      '3g peak hour traffic utilization (%)', '3g utilization', '3g traffic utilization',
      '3g traffic utilization (%)', 'ce utilization', 'ce utilization (%)',
      'power utilization', 'power utilization (%)', 'dl power utilization',
      'carrier power utilization', '3g congestion', 'traffic utilization',
      'traffic utilization (%)', 'traffic utilization_std(%)',
      '2g tch congestion', '2g tch congestion (%)', 'tch congestion', 'tch congestion (%)',
      'tch congestion_std(%)', 'tch congestion rate', 'sdcch congestion',
      'sdcch congestion (%)', '2g sdcch congestion', '2g congestion', '2g congestion (%)',
      'tch blocking', 'tch block rate', 'traffic channel congestion', 'signalling congestion'
    ]
  },
  {
    field: 'users',
    label: 'Connected Users',
    required: false,
    aliases: [
      'rrc connected ues (avg)_std(#)', 'connected users', 'rrc connected ues',
      'rrc connected users', 'users', 'connected_users', 'rrc connected ues (avg)',
      'rrc connected ues avg', 'rrc connected ues (avg) std', 'connected ues (avg)',
      '3g connected ues (avg)_std(#)', '3g connected users', '3g connected ues',
      '3g connected ues (avg)', '3g connected ues avg', '3g users', 'hsdpa users',
      'hsupa users', 'hspa users', 'active users', 'total connected users',
      'subscribers', 'simultaneous users', 'average users', 'avg connected users',
      'rrc connected users (3g)', 'total active users',
      '2g users', '2g connected users', 'erlang', 'erlangs', 'carried traffic (erl)',
      'voice traffic (erl)', 'traffic (erl)'
    ]
  },
  {
    field: 'volume',
    label: 'Data Volume (MB)',
    required: false,
    aliases: [
      '4g data volume_std(mb)', 'data volume', 'data volume (mb)', 'data_volume_mb',
      'traffic', 'volume mb', '4g data volume', 'traffic (mb)',
      '4g data volume std', '4g data volume (mb)', 'data volume std',
      '3g data volume_std(mb)', '3g data volume', '3g data volume (mb)',
      '3g traffic', '3g traffic (mb)', '3g data volume std', 'ps data volume',
      'ps traffic', 'hspa data volume', 'hsdpa data volume', 'total data volume (mb)',
      'total traffic (mb)', 'total data volume',
      '2g gprs traffic', 'gprs traffic', 'gprs traffic (mb)', 'gprs data volume',
      '2g data volume', '2g data volume (mb)', '2g traffic', '2g traffic (mb)',
      '2g data volume std', 'edge traffic', 'edge data volume (mb)', 'data traffic (mb)'
    ]
  },
  {
    field: 'availability',
    label: 'Availability (%)',
    required: false,
    aliases: [
      '4g cell availability_std(%)', 'availability', 'cell availability',
      'availability_pct', 'cell availability (%)', '4g cell availability',
      '4g cell availability std', 'cell availability std', '4g cell availability (%)',
      '3g cell availability_std(%)', '3g cell availability', '3g cell availability (%)',
      '3g availability', '3g cell availability std', 'utran cell availability',
      'utran cell availability (%)',
      '2g availability', '2g cell availability', '2g cell availability (%)',
      '2g cell availability_std(%)', '2g tch availability', 'tch availability',
      'tch availability (%)', 'tch available rate', 'tch availability_std(%)',
      'network availability', 'radio network availability'
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
      'e-utran ip throughput ue dl std', 'eutran ip throughput ue dl std',
      'e-utran ip throughput ue dl (kbps)', 'ip throughput ue dl',
      '3g dl throughput_std(kbps)', '3g dl throughput', '3g throughput',
      '3g dl throughput (kbps)', '3g user dl throughput', 'hsdpa throughput',
      'hsdpa throughput (kbps)', 'hsdpa throughput_std(kbps)', 'hsdpa user dl throughput',
      'user dl throughput', 'user dl throughput (kbps)', 'user throughput dl',
      'user throughput dl (kbps)', '3g ip throughput', 'downlink throughput',
      'dl throughput (kbps)',
      'gprs throughput', 'edge throughput', 'gprs/edge throughput', '2g throughput',
      '2g dl throughput', '2g throughput (kbps)', 'gprs throughput (kbps)'
    ]
  }
]


/** Infer the source technology from its headers, filename, or sheet name.
 *  Uses prioritized signals: Explicit Tech column -> Sheet/Filename -> KPI signatures. */
export function detectTechnology(
  headers: string[],
  filename = '',
  sampleRows: string[][] = []
): Technology | null {
  const normHeaders = headers.map(normalizeHeader)
  const allHeadersStr = normHeaders.join(' ')
  const normFile = normalizeHeader(filename)

  // 1. Explicit Technology column inspection
  const techColIdx = normHeaders.findIndex((h) =>
    ['technology', 'tech', 'rat', 'system', 'network tech'].includes(h)
  )
  if (techColIdx >= 0 && sampleRows.length > 0) {
    for (const row of sampleRows) {
      const val = (row[techColIdx] ?? '').trim().toUpperCase()
      if (/\b(2G|GSM)\b/.test(val)) return '2G'
      if (/\b(3G|UMTS|WCDMA)\b/.test(val)) return '3G'
      if (/\b(4G|LTE|VOLTE)\b/.test(val)) return '4G'
    }
  }

  // 2. Sheet name / Filename signals
  if (/\b(2g|gsm|bts)\b/.test(normFile)) return '2G'
  if (/\b(3g|umts|wcdma|nodeb)\b/.test(normFile)) return '3G'
  if (/\b(4g|lte|volte|enodeb)\b/.test(normFile)) return '4G'

  // 3. KPI Signature matching (high confidence exact signatures)
  let score2G = 0
  let score3G = 0
  let score4G = 0

  if (/\b(tch|sdcch|gprs|bts|cell id cgi|tch congestion|sdcch congestion)\b/.test(allHeadersStr)) score2G += 3
  if (/2g\s+(call|drop|cssr|cdr|congestion)/.test(allHeadersStr)) score2G += 4

  if (/\b(hsdpa|hsupa|nodeb|wcdma|umts|ce utilization|channel element|dasr)\b/.test(allHeadersStr)) score3G += 3
  if (/3g\s+(call|drop|cssr|cdr|data access)/.test(allHeadersStr)) score3G += 4
  if (/rrc\s+(connection|setup|success)/.test(allHeadersStr)) score3G += 2

  if (/\b(enodeb|enb|lte|e utran|prb utilization|prb utilisation|volte|mos|vqi|rtp jitter|ims|erab|e rab)\b/.test(allHeadersStr)) score4G += 3
  if (/4g\s+(call|drop|cssr|cdr|prb|data service|traffic utilization)/.test(allHeadersStr)) score4G += 4

  if (score2G > score3G && score2G > score4G) return '2G'
  if (score3G > score2G && score3G > score4G) return '3G'
  if (score4G > score2G && score4G > score3G) return '4G'

  return null
}

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/utilisation/g, 'utilization')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Normalize a raw geo value the way matching does (trim, lowercase, collapse whitespace). */
export function normalizeGeoValue(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Apply user-accepted value aliases for a geo field: returns the remapped
 *  value, or the original when no alias matches. Alias keys are normalized
 *  values (see normalizeGeoValue). */
export function aliasGeoValue(
  aliases: Partial<Record<CanonicalField, Record<string, string>>> | undefined,
  field: CanonicalField,
  raw: string
): string {
  const m = aliases?.[field]
  if (!m) return raw
  return m[normalizeGeoValue(raw)] ?? raw
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

export function mappingConfidence(
  mapping: Record<string, CanonicalField>,
  headers: string[],
  kpiMapping: Record<string, string> = {}
): number {
  const values = Object.values(mapping)
  const hasDate = values.includes('date')
  const hasCell = values.includes('cell')
  if (!hasDate || !hasCell) return 0.2

  const mappedKpiCount = Object.keys(kpiMapping).length +
    values.filter((v) => ['prb', 'users', 'volume', 'availability', 'throughput'].includes(v)).length

  const score = 0.5 + Math.min(0.5, (mappedKpiCount / Math.max(3, headers.length - 2)) * 0.5)
  return Math.round(score * 100) / 100
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

