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
  betterDirection: 'higher_is_better' | 'lower_is_better'
  category: 'Congestion' | 'Accessibility' | 'Retainability' | 'Integrity' | 'Availability' | 'Mobility'
  target: number | null
  warningThreshold: number | null
  criticalThreshold: number | null
  agg: 'avg' | 'sum' | 'max' | 'min'
  isCore: boolean
  supportsCongestionAnalysis: boolean
  supportsPersistentNc: boolean
  showInExecutiveView: boolean
  decimalPrecision: number
  aliases: string[]
}

const SEEDS: Record<Technology, SeedDef[]> = {
  '2G': [
    {
      key: 'tch_congestion',
      label: 'TCH Congestion',
      unit: '%',
      worseIsHigher: true,
      betterDirection: 'lower_is_better',
      category: 'Congestion',
      target: 2.0,
      warningThreshold: 1.5,
      criticalThreshold: 3.0,
      agg: 'avg',
      isCore: true,
      supportsCongestionAnalysis: true,
      supportsPersistentNc: true,
      showInExecutiveView: true,
      decimalPrecision: 2,
      aliases: ['tch congestion', 'tch congestion (%)', 'tch congestion rate', 'congestion', 'tch blocking', 'tch block rate', 'tch cong', 'traffic channel congestion', '2g tch congestion', '2g congestion', 'tch_congestion_rate', 'tch_blocking_rate']
    },
    {
      key: 'sdcch_congestion',
      label: 'SDCCH Congestion',
      unit: '%',
      worseIsHigher: true,
      betterDirection: 'lower_is_better',
      category: 'Congestion',
      target: 2.0,
      warningThreshold: 1.5,
      criticalThreshold: 3.0,
      agg: 'avg',
      isCore: true,
      supportsCongestionAnalysis: true,
      supportsPersistentNc: true,
      showInExecutiveView: true,
      decimalPrecision: 2,
      aliases: ['sdcch congestion', 'sdcch congestion (%)', 'sdcch congestion rate', 'sdcch blocking', 'sdcch block rate', 'sdcch cong', 'signalling congestion', '2g sdcch congestion', 'sdcch_congestion_rate', 'sdcch_blocking_rate']
    },
    {
      key: 'call_setup_success_2g',
      label: '2G Call Connection Success Rate',
      unit: '%',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Accessibility',
      target: 98.5,
      warningThreshold: 99.0,
      criticalThreshold: 95.0,
      agg: 'avg',
      isCore: true,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: true,
      showInExecutiveView: true,
      decimalPrecision: 2,
      aliases: ['2g call connection success rate', '2g call connection success', '2g cssr', 'call connection success rate', 'call setup success', 'call setup success rate', 'cssr', 'call setup success rate (%)', '2g call setup success rate', '2g call setup success', 'call setup success (%)', 'tch call setup success rate', 'call_setup_success']
    },
    {
      key: 'call_drop_rate_2g',
      label: '2G Call Drop Rate',
      unit: '%',
      worseIsHigher: true,
      betterDirection: 'lower_is_better',
      category: 'Retainability',
      target: 1.5,
      warningThreshold: 1.0,
      criticalThreshold: 2.5,
      agg: 'avg',
      isCore: true,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: true,
      showInExecutiveView: true,
      decimalPrecision: 2,
      aliases: ['2g call drop rate', '2g drop call rate', 'call drop rate', 'drop call rate', 'dropped call rate (%)', 'drops (%)', '2g cdr', 'cdr', 'call drop rate (%)', 'tch drop rate', 'tch drop call rate', 'drop_call_rate']
    },
    {
      key: 'tch_availability',
      label: 'TCH Availability',
      unit: '%',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Availability',
      target: 99.5,
      warningThreshold: 99.0,
      criticalThreshold: 95.0,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 2,
      aliases: ['tch availability', 'tch availability (%)', 'availability', '2g availability', 'cell availability']
    },
    {
      key: 'gprs_traffic',
      label: 'GPRS Traffic',
      unit: 'MB',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Integrity',
      target: null,
      warningThreshold: null,
      criticalThreshold: null,
      agg: 'sum',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 1,
      aliases: ['gprs traffic', 'gprs traffic (mb)', 'gprs data volume', '2g data volume', '2g traffic (mb)']
    },
    {
      key: 'gprs_throughput',
      label: 'GPRS/EDGE Throughput',
      unit: 'kbps',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Integrity',
      target: null,
      warningThreshold: null,
      criticalThreshold: null,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 1,
      aliases: ['gprs throughput', 'gprs/edge throughput', 'throughput', 'dl throughput (kbps)', 'edge throughput', '2g throughput']
    },
    {
      key: 'connected_users',
      label: 'Connected Users',
      unit: '',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Integrity',
      target: null,
      warningThreshold: null,
      criticalThreshold: null,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 0,
      aliases: ['connected users', 'users', 'active users', '2g users', 'subscribers', 'rrc connected ues']
    }
  ],
  '3G': [
    {
      key: 'call_setup_success_3g',
      label: '3G Call Connection Success Rate',
      unit: '%',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Accessibility',
      target: 98.5,
      warningThreshold: 99.0,
      criticalThreshold: 95.0,
      agg: 'avg',
      isCore: true,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: true,
      showInExecutiveView: true,
      decimalPrecision: 2,
      aliases: ['3g call connection success rate', '3g call connection success', '3g cssr', 'rrc connection success', 'rrc setup success rate', '3g call setup success rate', 'rrc connection setup success rate', '3g call setup success', 'rrc success rate', 'rrc_success_rate', 'rrc_connection_success', 'cssr']
    },
    {
      key: 'call_drop_rate_3g',
      label: '3G Call Drop Rate',
      unit: '%',
      worseIsHigher: true,
      betterDirection: 'lower_is_better',
      category: 'Retainability',
      target: 1.5,
      warningThreshold: 1.0,
      criticalThreshold: 2.5,
      agg: 'avg',
      isCore: true,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: true,
      showInExecutiveView: true,
      decimalPrecision: 2,
      aliases: ['3g call drop rate', '3g drop call rate', '3g cdr', 'cs drop call rate', '3g voice drop rate', 'dropped call rate (%)', '3g call drop rate (%)', 'cs call drop rate', 'rrc drop rate', 'drop_call_rate']
    },
    {
      key: 'data_access_success_3g',
      label: '3G Data Access Success Rate',
      unit: '%',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Accessibility',
      target: 98.0,
      warningThreshold: 98.5,
      criticalThreshold: 95.0,
      agg: 'avg',
      isCore: true,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: true,
      showInExecutiveView: true,
      decimalPrecision: 2,
      aliases: ['3g data access success rate', '3g data access success', '3g dasr', 'data access success rate', 'hsdpa access success rate', 'ps setup success rate', 'packet service access success rate', '3g ps setup success rate', 'hsdpa setup success rate', 'ps cssr', '3g ps cssr', 'data_access_success']
    },
    {
      key: 'ce_utilization',
      label: 'CE Utilization',
      unit: '%',
      worseIsHigher: true,
      betterDirection: 'lower_is_better',
      category: 'Congestion',
      target: 70.0,
      warningThreshold: 65.0,
      criticalThreshold: 85.0,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: true,
      supportsPersistentNc: true,
      showInExecutiveView: false,
      decimalPrecision: 2,
      aliases: ['ce utilization', 'ce utilization (%)', 'channel element utilization', 'ce utilisation', '3g ce utilization', 'ce_utilization']
    },
    {
      key: 'hsdpa_throughput',
      label: 'HSDPA Throughput',
      unit: 'kbps',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Integrity',
      target: null,
      warningThreshold: null,
      criticalThreshold: null,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 1,
      aliases: ['hsdpa throughput', 'hsdpa throughput (kbps)', 'dl throughput (kbps)', 'throughput', '3g dl throughput', '3g throughput']
    },
    {
      key: 'hsupa_throughput',
      label: 'HSUPA Throughput',
      unit: 'kbps',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Integrity',
      target: null,
      warningThreshold: null,
      criticalThreshold: null,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 1,
      aliases: ['hsupa throughput', 'hsupa throughput (kbps)', 'ul throughput', '3g ul throughput']
    },
    {
      key: 'data_volume',
      label: 'Data Volume',
      unit: 'MB',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Integrity',
      target: null,
      warningThreshold: null,
      criticalThreshold: null,
      agg: 'sum',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 1,
      aliases: ['data volume', 'data volume (mb)', 'traffic (mb)', 'volume', '3g data volume', '3g traffic']
    },
    {
      key: 'peak_hour_traffic_utilization_3g',
      label: '3G Peak Hour Traffic Utilization',
      unit: '%',
      worseIsHigher: true,
      betterDirection: 'lower_is_better',
      category: 'Congestion',
      target: 80.0,
      warningThreshold: 75.0,
      criticalThreshold: 90.0,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: true,
      supportsPersistentNc: true,
      showInExecutiveView: false,
      decimalPrecision: 2,
      aliases: [
        '3g peak hour traffic utilization', '3g peak hour traffic utilization_nca',
        '3g peak hour traffic utilization std', '3g peak hour traffic utilization_std(%)',
        '3g utilization', '3g traffic utilization', 'peak hour traffic utilization',
        'peak hour traffic utilization_nca', 'peak hour traffic utilization std',
        'peak hour traffic utilization (%)', '3g peak hour traffic utilization (%)',
        '3g traffic utilization (%)', 'utilization (%)', 'utilization'
      ]
    },
    {
      key: 'availability_3g',
      label: '3G Cell Availability',
      unit: '%',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Availability',
      target: 99.5,
      warningThreshold: 99.0,
      criticalThreshold: 95.0,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 2,
      aliases: [
        '3g cell availability', '3g cell availability_std(%)', '3g cell availability (%)',
        '3g availability', '3g cell availability std', 'utran cell availability',
        'cell availability', 'cell availability (%)', 'availability'
      ]
    },
    {
      key: 'connected_users',
      label: 'Connected Users',
      unit: '',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Integrity',
      target: null,
      warningThreshold: null,
      criticalThreshold: null,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 0,
      aliases: ['connected users', 'users', 'active users', '3g users', 'rrc connected ues']
    }
  ],
  '4G': [
    {
      key: 'call_setup_success_4g',
      label: '4G Call Connection Success Rate',
      unit: '%',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Accessibility',
      target: 98.5,
      warningThreshold: 99.0,
      criticalThreshold: 95.0,
      agg: 'avg',
      isCore: true,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: true,
      showInExecutiveView: true,
      decimalPrecision: 2,
      aliases: ['4g call connection success rate', '4g call connection success', '4g cssr', 'volte setup success', 'volte cssr', 'e-rab setup success rate', 'erab setup success rate', '4g call setup success rate', 'volte call connection success rate', 'volte call setup success', 'e-rab setup success', 'erab setup success', 'volte call setup success rate (%)', '4g call setup success rate (%)', 'volte_setup_success']
    },
    {
      key: 'call_drop_rate_4g',
      label: '4G Call Drop Rate',
      unit: '%',
      worseIsHigher: true,
      betterDirection: 'lower_is_better',
      category: 'Retainability',
      target: 1.5,
      warningThreshold: 1.0,
      criticalThreshold: 2.5,
      agg: 'avg',
      isCore: true,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: true,
      showInExecutiveView: true,
      decimalPrecision: 2,
      aliases: ['4g call drop rate', '4g drop call rate', 'volte drop call rate', 'volte call drop rate', 'e-rab drop rate', 'erab drop rate', '4g cdr', 'ims drop rate', 'volte drop rate', '4g call drop rate (%)', 'volte call drop rate (%)', 'e-rab drop rate (%)', 'drop_call_rate', 'volte_drop_call_rate']
    },
    {
      key: 'data_service_failure_4g',
      label: '4G Data Service Access Failure Rate',
      unit: '%',
      worseIsHigher: true,
      betterDirection: 'lower_is_better',
      category: 'Accessibility',
      target: 1.0,
      warningThreshold: 0.8,
      criticalThreshold: 2.0,
      agg: 'avg',
      isCore: true,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: true,
      showInExecutiveView: true,
      decimalPrecision: 2,
      aliases: ['4g data service access failure rate', 'data service access failure rate', '4g dsaf', 'dsaf', 'ps access failure rate', 'e-rab setup failure rate', 'packet service access failure rate', 'data accessibility failure rate', 'data failure rate', '4g data failure rate', '4g data service access failure rate (%)', 'data service access failure rate (%)', 'data_service_failure']
    },
    {
      key: 'prb_utilization',
      label: '4G Peak Hour PRB Utilization',
      unit: '%',
      worseIsHigher: true,
      betterDirection: 'lower_is_better',
      category: 'Congestion',
      target: 80.0,
      warningThreshold: 75.0,
      criticalThreshold: 90.0,
      agg: 'avg',
      isCore: true,
      supportsCongestionAnalysis: true,
      supportsPersistentNc: true,
      showInExecutiveView: true,
      decimalPrecision: 2,
      aliases: ['4g peak hour prb utilization', 'peak hour prb utilization', 'peak hour prb utilisation', 'prb utilization', 'prb utilisation', '4g peak hour traffic utilization_nca', 'prb', 'prb util', 'prb utilization (%)', '4g prb', 'dl prb utilization', 'peak hour traffic utilization', '4g peak hour traffic utilization', 'peak hour traffic utilization nca', '4g peak hour traffic utilization std', '4g peak hour traffic utilization_nca(%)', 'prb_utilization', 'prb_utilisation', 'dl_prb_utilization']
    },
    {
      key: 'dl_throughput',
      label: 'DL Throughput',
      unit: 'kbps',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Integrity',
      target: null,
      warningThreshold: null,
      criticalThreshold: null,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 1,
      aliases: ['dl throughput', 'throughput', 'dl throughput (kbps)', 'e-utran ip throughput ue dl', 'e-utran ip throughput ue dl (kbps)', 'e-utran ip throughput ue dl_std(kbps)', '4g throughput', 'eutran ip throughput ue dl', 'ip throughput ue dl']
    },
    {
      key: 'connected_users',
      label: 'Connected Users',
      unit: '',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Integrity',
      target: null,
      warningThreshold: null,
      criticalThreshold: null,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 0,
      aliases: ['connected users', 'users', 'rrc connected ues', 'rrc connected ues (avg)', 'active users', 'rrc connected ues (avg)_std(#)', 'connected_users', '4g connected users', '4g users']
    },
    {
      key: 'data_volume',
      label: 'Data Volume',
      unit: 'MB',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Integrity',
      target: null,
      warningThreshold: null,
      criticalThreshold: null,
      agg: 'sum',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 1,
      aliases: ['data volume', 'data volume (mb)', 'traffic (mb)', '4g data volume', 'volume', '4g data volume_std(mb)', 'data_volume_mb', '4g traffic', 'traffic']
    },
    {
      key: 'availability',
      label: 'Availability',
      unit: '%',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Availability',
      target: 99.5,
      warningThreshold: 99.0,
      criticalThreshold: 95.0,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 2,
      aliases: ['availability', 'cell availability', 'availability (%)', '4g cell availability', '4g cell availability_std(%)', 'availability_pct', 'cell availability (%)']
    },
    {
      key: 'mos',
      label: 'MOS (Voice Quality)',
      unit: 'MOS',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Integrity',
      target: 3.5,
      warningThreshold: 3.8,
      criticalThreshold: 3.0,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 2,
      aliases: ['mos', 'mean opinion score', 'voice quality (mos)', 'mos score', 'volte mos']
    },
    {
      key: 'vqi',
      label: 'VQI (Voice Quality Index)',
      unit: 'VQI',
      worseIsHigher: false,
      betterDirection: 'higher_is_better',
      category: 'Integrity',
      target: 3.5,
      warningThreshold: 3.8,
      criticalThreshold: 3.0,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 2,
      aliases: ['vqi', 'voice quality index', 'vqi score', 'volte vqi']
    },
    {
      key: 'rtp_jitter',
      label: 'RTP Jitter',
      unit: 'ms',
      worseIsHigher: true,
      betterDirection: 'lower_is_better',
      category: 'Integrity',
      target: 20.0,
      warningThreshold: 10.0,
      criticalThreshold: 30.0,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 1,
      aliases: ['rtp jitter', 'jitter', 'rtp jitter (ms)', 'jitter (ms)', 'packet jitter', 'volte jitter']
    },
    {
      key: 'rtp_packet_loss',
      label: 'RTP Packet Loss',
      unit: '%',
      worseIsHigher: true,
      betterDirection: 'lower_is_better',
      category: 'Integrity',
      target: 1.0,
      warningThreshold: 0.5,
      criticalThreshold: 2.0,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: false,
      showInExecutiveView: false,
      decimalPrecision: 2,
      aliases: ['rtp packet loss', 'packet loss', 'packet loss (%)', 'volte packet loss', 'rtp loss']
    },
    {
      key: 'volte_drop_call_rate',
      label: 'VoLTE Call Drop Rate',
      unit: '%',
      worseIsHigher: true,
      betterDirection: 'lower_is_better',
      category: 'Retainability',
      target: 1.5,
      warningThreshold: 1.0,
      criticalThreshold: 2.5,
      agg: 'avg',
      isCore: false,
      supportsCongestionAnalysis: false,
      supportsPersistentNc: true,
      showInExecutiveView: false,
      decimalPrecision: 2,
      aliases: ['volte drop call rate', 'volte call drop rate', 'volte cdr', 'volte drop rate', 'volte drop call rate (%)']
    }
  ]
}

export function normalizeTechnology(v: string | null | undefined): Technology {
  return v === '2G' || v === '3G' ? (v as Technology) : '4G'
}

export function builtInSeeds(technology: Technology): SeedDef[] {
  return SEEDS[technology] ?? []
}

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/utilisation/g, 'utilization')
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
  const worseIsHigher = Boolean(x.worse_is_higher)
  const betterDirection = (String(x.better_direction ?? '') === 'higher_is_better' || !worseIsHigher)
    ? 'higher_is_better'
    : 'lower_is_better'
  const category = (['Congestion', 'Accessibility', 'Retainability', 'Integrity', 'Availability', 'Mobility'] as const).includes(String(x.category) as never)
    ? (String(x.category) as KpiDefinition['category'])
    : 'Congestion'

  return {
    kpiId: Number(x.kpi_id),
    technology: normalizeTechnology(String(x.technology)),
    key: String(x.kpi_key),
    label: String(x.label),
    unit: String(x.unit ?? ''),
    worseIsHigher,
    betterDirection,
    category,
    target: x.target == null ? null : Number(x.target),
    warningThreshold: x.warning_threshold == null ? null : Number(x.warning_threshold),
    criticalThreshold: x.critical_threshold == null ? null : Number(x.critical_threshold),
    agg: (['avg', 'sum', 'max', 'min'] as const).includes(String(x.agg) as never) ? (String(x.agg) as KpiDefinition['agg']) : 'avg',
    isCore: Boolean(x.is_core),
    supportsCongestionAnalysis: Boolean(x.supports_congestion),
    supportsPersistentNc: Boolean(x.supports_persistent_nc ?? true),
    showInExecutiveView: Boolean(x.show_in_executive ?? true),
    decimalPrecision: Number(x.decimal_precision ?? 1),
    sourceHeaders: headers,
    aliases: headers,
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
  return normalizeTechnology(v == null ? null : String(v))
}
/** Insert the built-in seed set for one technology (idempotent per key). */
export async function seedKpiDefs(conn: DuckDBConnection, technology: Technology): Promise<KpiDefinition[]> {
  for (let i = 0; i < SEEDS[technology].length; i++) {
    const s = SEEDS[technology][i]
    const safeTech = technology.replace(/'/g, "''")
    const safeKey = s.key.replace(/'/g, "''")
    const safeLabel = s.label.replace(/'/g, "''")
    const safeUnit = s.unit.replace(/'/g, "''")
    const safeCat = s.category.replace(/'/g, "''")
    const safeBetter = s.betterDirection.replace(/'/g, "''")
    const safeAgg = s.agg.replace(/'/g, "''")
    const targetVal = s.target == null ? 'NULL' : Number(s.target)
    const warnVal = s.warningThreshold == null ? 'NULL' : Number(s.warningThreshold)
    const critVal = s.criticalThreshold == null ? 'NULL' : Number(s.criticalThreshold)
    const precVal = Number(s.decimalPrecision ?? 1)
    const aliasesJson = JSON.stringify(s.aliases).replace(/'/g, "''")

    await conn.run(
      `INSERT INTO kpi_defs
         (technology, kpi_key, label, unit, worse_is_higher, better_direction, category,
          target, warning_threshold, critical_threshold, agg, is_core, supports_congestion,
          supports_persistent_nc, show_in_executive, decimal_precision,
          source_headers, is_custom, active, sort_order)
       VALUES ('${safeTech}', '${safeKey}', '${safeLabel}', '${safeUnit}', ${s.worseIsHigher}, '${safeBetter}', '${safeCat}',
               ${targetVal}, ${warnVal}, ${critVal}, '${safeAgg}', ${s.isCore}, ${s.supportsCongestionAnalysis},
               ${s.supportsPersistentNc}, ${s.showInExecutiveView}, ${precVal},
               '${aliasesJson}', false, true, ${i})
       ON CONFLICT (technology, kpi_key) DO UPDATE SET
         label = excluded.label,
         unit = excluded.unit,
         worse_is_higher = excluded.worse_is_higher,
         better_direction = excluded.better_direction,
         category = excluded.category,
         target = COALESCE(kpi_defs.target, excluded.target),
         warning_threshold = COALESCE(kpi_defs.warning_threshold, excluded.warning_threshold),
         critical_threshold = COALESCE(kpi_defs.critical_threshold, excluded.critical_threshold),
         agg = excluded.agg,
         is_core = excluded.is_core,
         supports_congestion = excluded.supports_congestion,
         supports_persistent_nc = excluded.supports_persistent_nc,
         show_in_executive = excluded.show_in_executive,
         decimal_precision = excluded.decimal_precision,
         source_headers = excluded.source_headers,
         updated_at = now()`
    )
  }
  return listKpiDefs(conn, technology)
}

/** All active definitions for one technology (or every technology). */
export async function listKpiDefs(
  conn: DuckDBConnection,
  technology?: Technology
): Promise<KpiDefinition[]> {
  const where = technology ? `WHERE technology = '${technology.replace(/'/g, "''")}'` : ''
  const r = await conn.runAndReadAll(
    `SELECT kpi_id, technology, kpi_key, label, unit, worse_is_higher, better_direction,
       category, target, warning_threshold, critical_threshold, agg,
       is_core, supports_congestion, supports_persistent_nc, show_in_executive, decimal_precision,
       source_headers, is_custom, active, sort_order,
       CAST(created_at AS VARCHAR) AS created_at, CAST(updated_at AS VARCHAR) AS updated_at
     FROM kpi_defs ${where}
     ORDER BY technology, sort_order, kpi_key`
  )
  const rows = r.getRowObjects().map(rowToDef)
  if (rows.length === 0 && technology && SEEDS[technology]?.length > 0) {
    return seedKpiDefs(conn, technology)
  }
  return rows
}

export function isKpiBreached(
  val: number | null | undefined,
  target: number | null | undefined,
  worseIsHigher: boolean
): boolean {
  if (val == null || target == null || !Number.isFinite(val)) return false
  return worseIsHigher ? val > target : val < target
}

/** Insert or update a definition (matched on technology + key when the patch
 *  carries a key; otherwise on kpiId). */
export async function saveKpiDef(conn: DuckDBConnection, patch: KpiDefPatch): Promise<KpiDefinition> {
  const technology = (patch.technology === '2G' || patch.technology === '3G')
    ? patch.technology
    : (patch.technology ?? (await workspaceTechnology(conn)))
  const existing = await findByKeyOrId(conn, technology, patch)
  const now = new Date().toISOString()

  const worseIsHigher = patch.worseIsHigher ?? existing?.worseIsHigher ?? true
  const betterDirection = patch.betterDirection ?? (worseIsHigher ? 'lower_is_better' : 'higher_is_better')
  const category = patch.category ?? existing?.category ?? 'Congestion'
  const isCore = patch.isCore ?? existing?.isCore ?? false
  const supportsCongestion = patch.supportsCongestionAnalysis ?? existing?.supportsCongestionAnalysis ?? false
  const supportsPersistentNc = patch.supportsPersistentNc ?? existing?.supportsPersistentNc ?? true
  const showInExecutive = patch.showInExecutiveView ?? existing?.showInExecutiveView ?? true
  const decimalPrecision = patch.decimalPrecision ?? existing?.decimalPrecision ?? 1

  if (existing) {
    const id = existing.kpiId
    const merged = { ...existing, ...patch }
    const safeLabel = merged.label.replace(/'/g, "''")
    const safeUnit = (merged.unit ?? '').replace(/'/g, "''")
    const safeBetter = betterDirection.replace(/'/g, "''")
    const safeCat = category.replace(/'/g, "''")
    const safeAgg = (merged.agg ?? 'avg').replace(/'/g, "''")
    const targetVal = merged.target == null ? 'NULL' : Number(merged.target)
    const warnVal = merged.warningThreshold == null ? 'NULL' : Number(merged.warningThreshold)
    const critVal = merged.criticalThreshold == null ? 'NULL' : Number(merged.criticalThreshold)
    const headersJson = JSON.stringify(merged.sourceHeaders ?? []).replace(/'/g, "''")

    await conn.run(
      `UPDATE kpi_defs SET
         label = '${safeLabel}', unit = '${safeUnit}', worse_is_higher = ${worseIsHigher}, better_direction = '${safeBetter}', category = '${safeCat}',
         target = ${targetVal}, warning_threshold = ${warnVal}, critical_threshold = ${critVal}, agg = '${safeAgg}',
         is_core = ${isCore}, supports_congestion = ${supportsCongestion}, supports_persistent_nc = ${supportsPersistentNc}, show_in_executive = ${showInExecutive}, decimal_precision = ${decimalPrecision},
         source_headers = '${headersJson}', active = ${Boolean(merged.active)}, updated_at = now()
       WHERE kpi_id = ${id}`
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
  const safeTech = technology.replace(/'/g, "''")
  const sortR = await conn.runAndReadAll(
    `SELECT COALESCE(max(sort_order), -1) + 1 AS next FROM kpi_defs WHERE technology = '${safeTech}'`
  )
  const sortOrder = Number(sortR.getRowObjects()[0].next)
  const safeKey = key.replace(/'/g, "''")
  const safeLabel = label.replace(/'/g, "''")
  const safeUnit = (patch.unit ?? '').replace(/'/g, "''")
  const safeBetter = betterDirection.replace(/'/g, "''")
  const safeCat = category.replace(/'/g, "''")
  const safeAgg = (patch.agg ?? 'avg').replace(/'/g, "''")
  const targetVal = patch.target == null ? 'NULL' : Number(patch.target)
  const warnVal = patch.warningThreshold == null ? 'NULL' : Number(patch.warningThreshold)
  const critVal = patch.criticalThreshold == null ? 'NULL' : Number(patch.criticalThreshold)
  const headersJson = JSON.stringify(patch.sourceHeaders ?? []).replace(/'/g, "''")

  await conn.run(
    `INSERT INTO kpi_defs
       (technology, kpi_key, label, unit, worse_is_higher, better_direction, category,
        target, warning_threshold, critical_threshold, agg, is_core, supports_congestion,
        supports_persistent_nc, show_in_executive, decimal_precision,
        source_headers, is_custom, active, sort_order, created_at, updated_at)
     VALUES ('${safeTech}', '${safeKey}', '${safeLabel}', '${safeUnit}', ${worseIsHigher}, '${safeBetter}', '${safeCat}',
             ${targetVal}, ${warnVal}, ${critVal}, '${safeAgg}', ${isCore}, ${supportsCongestion},
             ${supportsPersistentNc}, ${showInExecutive}, ${decimalPrecision},
             '${headersJson}', true, ${patch.active ?? true}, ${sortOrder}, '${now}', '${now}')`
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
      `SELECT kpi_id, technology, kpi_key, label, unit, worse_is_higher, better_direction,
         category, target, warning_threshold, critical_threshold, agg,
         is_core, supports_congestion, supports_persistent_nc, show_in_executive, decimal_precision,
         source_headers, is_custom, active, sort_order,
         CAST(created_at AS VARCHAR) AS created_at, CAST(updated_at AS VARCHAR) AS updated_at
       FROM kpi_defs WHERE kpi_id = ${Number(patch.kpiId)}`
    )
    const row = r.getRowObjects()[0]
    return row ? rowToDef(row) : null
  }
  if (patch.key) {
    const safeTech = technology.replace(/'/g, "''")
    const safeKey = patch.key.replace(/'/g, "''")
    const r = await conn.runAndReadAll(
      `SELECT kpi_id, technology, kpi_key, label, unit, worse_is_higher, better_direction,
         category, target, warning_threshold, critical_threshold, agg,
         is_core, supports_congestion, supports_persistent_nc, show_in_executive, decimal_precision,
         source_headers, is_custom, active, sort_order,
         CAST(created_at AS VARCHAR) AS created_at, CAST(updated_at AS VARCHAR) AS updated_at
       FROM kpi_defs WHERE technology = '${safeTech}' AND kpi_key = '${safeKey}'`
    )
    const row = r.getRowObjects()[0]
    return row ? rowToDef(row) : null
  }
  return null
}

export async function removeKpiDef(conn: DuckDBConnection, kpiId: number): Promise<void> {
  const numKpiId = Number(kpiId)
  await conn.run(`DELETE FROM kpi_defs WHERE kpi_id = ${numKpiId}`)
  // orphaned values are harmless (left for history/audit), but drop weekly
  // rollups for the definition so analysis stops showing them
  await conn.run(`DELETE FROM agg_cell_kpi_weekly WHERE kpi_id = ${numKpiId}`)
}

/** Word-set overlap (Jaccard) on normalized headers — 1.0 for identical. */
function tokenSimilarity(a: string, b: string): number {
  const na = normalizeHeader(a).split(' ').filter(Boolean)
  const nb = normalizeHeader(b).split(' ').filter(Boolean)
  if (na.length === 0 || nb.length === 0) return 0
  const setB = new Set(nb)
  let inter = 0
  for (const t of na) if (setB.has(t)) inter++
  const union = na.length + nb.length - inter
  return union > 0 ? inter / union : 0
}

/** Match source headers to KPI aliases for import auto-mapping: exact alias
 *  match first, then a fuzzy token-overlap fallback against every alias,
 *  label and key of the technology's definitions (spec §54a). */
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
  // fuzzy candidates: per KPI, the best-scoring alias for a given header
  const candidates = new Map<string, { key: string; score: number; exact: boolean }>()
  for (const d of defs) {
    for (const a of [...d.sourceHeaders, d.label, d.key]) {
      const n = normalizeHeader(a)
      if (!n) continue
      for (const h of headers) {
        const sim = n === normalizeHeader(h) ? 1 : tokenSimilarity(n, normalizeHeader(h))
        if (sim < 0.5) continue
        const prev = candidates.get(h)
        if (!prev || sim > prev.score || (sim === prev.score && !prev.exact)) {
          candidates.set(h, { key: d.key, score: sim, exact: sim === 1 })
        }
      }
    }
  }
  const mapping: Record<string, string> = {}
  let matched = 0
  for (const h of headers) {
    // exact alias wins outright
    const exact = aliasIndex.get(normalizeHeader(h))
    if (exact) {
      mapping[h] = exact
      matched++
      continue
    }
    const fuzzy = candidates.get(h)
    if (fuzzy) {
      mapping[h] = fuzzy.key
      matched++
    }
  }
  return {
    mapping,
    confidence: headers.length > 0 ? matched / headers.length : 0
  }
}

export async function resetKpiDefsToDefaults(
  conn: DuckDBConnection,
  technology?: Technology
): Promise<KpiDefinition[]> {
  const techs: Technology[] = technology ? [technology] : ['2G', '3G', '4G']
  for (const tech of techs) {
    const seeds = SEEDS[tech] ?? []
    for (const seed of seeds) {
      const safeTech = tech.replace(/'/g, "''")
      const safeKey = seed.key.replace(/'/g, "''")
      const safeBetter = seed.betterDirection.replace(/'/g, "''")
      const targetVal = seed.target == null ? 'NULL' : Number(seed.target)
      const warnVal = seed.warningThreshold == null ? 'NULL' : Number(seed.warningThreshold)
      const critVal = seed.criticalThreshold == null ? 'NULL' : Number(seed.criticalThreshold)

      await conn.run(`
        UPDATE kpi_defs SET
          target = ${targetVal},
          warning_threshold = ${warnVal},
          critical_threshold = ${critVal},
          better_direction = '${safeBetter}',
          worse_is_higher = ${seed.worseIsHigher},
          updated_at = now()
        WHERE technology = '${safeTech}' AND kpi_key = '${safeKey}'
      `)
    }
  }
  return listKpiDefs(conn, technology)
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

export function resetCurrent(technology?: Technology): Promise<KpiDefinition[]> {
  return resetKpiDefsToDefaults(conn(), technology)
}


