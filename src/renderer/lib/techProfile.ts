import type { Technology } from '../../../shared/api'

/** Technology-specific terminology and labels (spec §13 grain/tech awareness).
 *  The internal data model is shared (Tech → Region → District → Site → Cell →
 *  DateTime → KPI → Value); only the *presentation* vocabulary changes per
 *  technology. */
export interface TechProfile {
  /** access network name: GSM / UMTS / LTE / VoLTE */
  network: string
  /** the base-station term users know this technology by */
  siteTerm: string
  /** label for the sites count card */
  siteCountLabel: string
  /** cell term (universal, kept for symmetry) */
  cellTerm: string
  /** utilization KPI name for this technology */
  utilizationLabel: string
  /** technology carries VoLTE voice KPIs (4G) */
  volte?: boolean
}

export const TECH_PROFILE: Record<Technology, TechProfile> = {
  '2G': {
    network: 'GSM',
    siteTerm: 'BTS',
    siteCountLabel: 'BTS sites',
    cellTerm: 'Cell',
    utilizationLabel: 'TCH utilization'
  },
  '3G': {
    network: 'UMTS',
    siteTerm: 'NodeB',
    siteCountLabel: 'NodeB sites',
    cellTerm: 'Cell',
    utilizationLabel: 'CE utilization'
  },
  '4G': {
    network: 'LTE',
    siteTerm: 'eNodeB',
    siteCountLabel: 'eNodeB sites',
    cellTerm: 'Cell',
    utilizationLabel: 'Avg PRB',
    /** 4G carries VoLTE voice KPIs (MOS/VQI/RTP) alongside data */
    volte: true
  },
}

export function techProfile(technology: Technology | undefined): TechProfile {
  return TECH_PROFILE[technology ?? '4G'] ?? TECH_PROFILE['4G']
}

/** Compact number formatting to prevent card overflow (e.g. 105.4M, 265.2k, 4,697). */
export function fmtCompactNumber(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + 'B'
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M'
  if (abs >= 100_000) return (v / 1_000).toFixed(1) + 'k'
  return Math.round(v).toLocaleString()
}

/** Compact data volume formatting (e.g. 30.18 TB, 11.78 GB, 500 MB). */
export function fmtCompactVolume(mb: number | null | undefined): string {
  if (mb == null || isNaN(mb)) return '—'
  const abs = Math.abs(mb)
  if (abs >= 1_000_000_000) return (mb / 1_000_000_000).toFixed(2) + ' PB'
  if (abs >= 1_000_000) return (mb / 1_000_000).toFixed(2) + ' TB'
  if (abs >= 1_000) return (mb / 1_000).toFixed(1) + ' GB'
  return Math.round(mb).toLocaleString() + ' MB'
}

/** Compact rate and throughput formatting (e.g. 19.2 Mbps, 1.4 Gbps). */
export function fmtCompactRate(kbps: number | null | undefined): string {
  if (kbps == null || isNaN(kbps)) return '—'
  const abs = Math.abs(kbps)
  if (abs >= 1_000_000) return (kbps / 1_000_000).toFixed(2) + ' Gbps'
  if (abs >= 1_000) return (kbps / 1_000).toFixed(1) + ' Mbps'
  return Math.round(kbps).toLocaleString() + ' kbps'
}
