import type { CompareMetric, Technology } from './api'

export interface CompareMetricDef {
  metric: CompareMetric
  label: string
  unit: string
  worseIsHigher: boolean
}

/** Comparison Lab metrics per technology, first = default. One list for the
 *  page's buttons and the query, so the two can never ask for different ids.
 *  Ids that are not a core column (prb, throughput, users, volume,
 *  availability, nc) are kpi_defs keys of that technology. */
export const COMPARE_METRICS: Record<Technology, CompareMetricDef[]> = {
  '4G': [
    { metric: 'prb', label: 'PRB utilization', unit: '%', worseIsHigher: true },
    { metric: 'throughput', label: 'DL throughput', unit: 'kbps', worseIsHigher: false },
    { metric: 'users', label: 'Connected users', unit: '', worseIsHigher: false },
    { metric: 'volume', label: 'Data volume', unit: 'MB', worseIsHigher: false },
    { metric: 'availability', label: 'Availability', unit: '%', worseIsHigher: false },
    { metric: 'nc', label: 'NC cells', unit: '', worseIsHigher: true }
  ],
  '3G': [
    { metric: 'call_setup_success_3g', label: '3G CSSR', unit: '%', worseIsHigher: false },
    { metric: 'call_drop_rate_3g', label: '3G Call Drop Rate', unit: '%', worseIsHigher: true },
    { metric: 'data_access_success_3g', label: '3G Data Access', unit: '%', worseIsHigher: false },
    { metric: '3g_dl_power_congestion', label: 'DL Power Congestion', unit: 'events', worseIsHigher: true },
    { metric: '3g_ul_ce_congestion', label: 'UL CE Congestion', unit: 'events', worseIsHigher: true },
    { metric: 'throughput', label: 'HSDPA Throughput', unit: 'kbps', worseIsHigher: false },
    { metric: 'availability', label: '3G Availability', unit: '%', worseIsHigher: false },
    { metric: 'nc', label: 'NC cells', unit: '', worseIsHigher: true }
  ],
  '2G': [
    { metric: 'tch_congestion', label: 'TCH Congestion', unit: '%', worseIsHigher: true },
    { metric: 'sdcch_congestion', label: 'SDCCH Congestion', unit: '%', worseIsHigher: true },
    { metric: 'call_setup_success_2g', label: '2G Voice CSSR', unit: '%', worseIsHigher: false },
    { metric: 'call_drop_rate_2g', label: '2G Call Drop Rate', unit: '%', worseIsHigher: true },
    { metric: 'throughput', label: 'GPRS Throughput', unit: 'kbps', worseIsHigher: false },
    { metric: 'availability', label: 'TCH Availability', unit: '%', worseIsHigher: false },
    { metric: 'nc', label: 'NC cells', unit: '', worseIsHigher: true }
  ]
}
