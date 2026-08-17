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
