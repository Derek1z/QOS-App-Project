import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirs, exportsDir } from '../paths'
import { getCurrent } from '../workspace/manager'
import { getRules } from '../analytics/rules'
import type {
  InvestigationScope, InvestigationResult, InvestigationStatus, EvidenceKpi,
  DiagnosisFinding, Hypothesis, DiagnosticHypothesis, InvestigationEvent, BeforeAfterMetric,
  InvestigationWeek, InvestigationPeer, EntityOption, ActionStatus, PerfMetric,
  Lifecycle, Trend, Severity, PriorityBand, Technology, Grain, PeriodId
} from '../../../shared/api'
import { runDiagnosticEngine } from '../analytics/investigation/engine'
import type { DiagnosticContext } from '../analytics/investigation/types'

/** M4 Investigation Workspace (spec §47–50): deterministic, evidence-based
 *  diagnosis with calibrated language; notes/events; before/after; report export.
 *  Hypotheses are descriptive, never causal (§40, §48). */

function ws() {
  const w = getCurrent()
  if (!w) throw new Error('No workspace is open')
  return w
}

const METRICS: Array<{ metric: PerfMetric | 'nc'; label: string; unit: string; worseIsHigher: boolean }> = [
  { metric: 'prb', label: 'PRB utilization', unit: '%', worseIsHigher: true },
  { metric: 'throughput', label: 'DL throughput', unit: 'kbps', worseIsHigher: false },
  { metric: 'users', label: 'Connected users', unit: '', worseIsHigher: false },
  { metric: 'volume', label: 'Data volume', unit: 'MB', worseIsHigher: false },
  { metric: 'availability', label: 'Availability', unit: '%', worseIsHigher: false },
  { metric: 'nc', label: 'NC cells', unit: '', worseIsHigher: true }
]

const round2 = (v: number): number => Math.round(v * 100) / 100
const round1 = (v: number): number => Math.round(v * 10) / 10

function fmt(v: number | null, unit: string): string {
  if (v == null) return '—'
  if (unit === 'kbps') return `${(v / 1024).toFixed(1)} Mbps`
  if (unit === 'MB') return `${(v / 1024).toFixed(1)} GB`
  if (unit === '%' || unit === 'pp') return `${v.toFixed(1)}${unit === '%' ? '%' : 'pp'}`
  return Math.round(v).toLocaleString()
}

function valueOf(w: InvestigationWeek | undefined, m: PerfMetric | 'nc'): number | null {
  if (!w) return null
  switch (m) {
    case 'prb':
      return w.prbAvg
    case 'throughput':
      return w.throughputKbps
    case 'users':
      return w.users
    case 'volume':
      return w.volumeMb
    case 'availability':
      return w.availability
    case 'nc':
      return w.isNc ? 1 : 0
    default:
      return null
  }
}

/** Searchable entity picker for the workspace (§47: Cell / Site / District). */
export async function searchEntities(scope: InvestigationScope, q = ''): Promise<EntityOption[]> {
  const conn = ws().connection
  const query = q.trim()
  const escQ = query ? query.trim().replace(/'/g, "''") : ''

  if (scope === 'cell') {
    const whereClause = escQ
      ? `WHERE (c.name ILIKE '%${escQ}%' OR COALESCE(s.name,'') ILIKE '%${escQ}%' OR COALESCE(d.name,'') ILIKE '%${escQ}%' OR COALESCE(rg.name,'') ILIKE '%${escQ}%')`
      : ''
    const r = await conn.runAndReadAll(
      `SELECT c.cell_id AS id, c.name AS name, rg.name AS r, d.name AS d, s.name AS s,
              l.severity AS severity, l.lifecycle AS lifecycle, COALESCE(p.score, 0) AS prio_score
       FROM dim_cell c
       LEFT JOIN dim_site s ON s.site_id = c.site_id
       LEFT JOIN dim_district d ON d.district_id = c.district_id
       LEFT JOIN dim_region rg ON rg.region_id = c.region_id
       LEFT JOIN cell_nc_lifecycle l ON l.cell_id = c.cell_id AND l.grain = 'weekly'
         AND l.period_start = (SELECT max(period_start) FROM cell_nc_lifecycle WHERE grain = 'weekly')
       LEFT JOIN cell_priority_history p ON p.cell_id = c.cell_id AND p.mode = 'balanced'
         AND p.as_of = (SELECT max(as_of) FROM cell_priority_history)
       ${whereClause}
       ORDER BY
         CASE l.severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Watch' THEN 3 ELSE 4 END,
         CASE l.lifecycle WHEN 'Chronic NC' THEN 1 WHEN 'Persistent NC' THEN 2 WHEN 'Recurring NC' THEN 3 WHEN 'New NC' THEN 4 ELSE 5 END,
         COALESCE(p.score, 0) DESC,
         c.name
       LIMIT 100`
    )
    return r.getRowObjects().map((x) => {
      const path = [x.r, x.d, x.s].filter((v): v is string => v != null && v !== '')
      path.push(String(x.name ?? ''))
      return {
        id: Number(x.id),
        name: String(x.name ?? ''),
        path,
        severity: (x.severity as Severity) || undefined,
        lifecycle: (x.lifecycle as Lifecycle) || undefined,
        score: x.prio_score != null ? Number(x.prio_score) : undefined
      }
    })
  }

  const base: Record<'site' | 'district' | 'region', { select: string; from: string; where: (esc: string) => string }> = {
    region: {
      select: `rg.region_id AS id, rg.name AS name, NULL AS r, NULL AS d`,
      from: `dim_region rg`,
      where: (esc: string) => `rg.name ILIKE '%${esc}%'`
    },
    site: {
      select: `s.site_id AS id, s.name AS name, rg.name AS r, d.name AS d`,
      from: `dim_site s
             LEFT JOIN dim_district d ON d.district_id = s.district_id
             LEFT JOIN dim_region rg ON rg.region_id = d.region_id`,
      where: (esc: string) => `(s.name ILIKE '%${esc}%' OR COALESCE(d.name,'') ILIKE '%${esc}%' OR COALESCE(rg.name,'') ILIKE '%${esc}%')`
    },
    district: {
      select: `d.district_id AS id, d.name AS name, rg.name AS r, NULL AS d`,
      from: `dim_district d LEFT JOIN dim_region rg ON rg.region_id = d.region_id`,
      where: (esc: string) => `(d.name ILIKE '%${esc}%' OR COALESCE(rg.name,'') ILIKE '%${esc}%')`
    }
  }
  const b = base[scope]
  const r = await conn.runAndReadAll(
    `SELECT ${b.select} FROM ${b.from} ${escQ ? `WHERE ${b.where(escQ)}` : ''} ORDER BY name LIMIT 50`
  )
  return r.getRowObjects().map((x) => {
    const path = [x.r, x.d].filter((v): v is string => v != null && v !== '')
    path.push(String(x.name ?? ''))
    return { id: Number(x.id), name: String(x.name ?? ''), path }
  })
}

export async function getInvestigation(
  scope: InvestigationScope,
  entityId: number,
  opts: { interventionWeek?: string; grain?: Grain; period?: PeriodId } = {}
): Promise<InvestigationResult | null> {
  const conn = ws().connection
  const rules = await getRules(conn)
  const threshold = rules?.prbThresholdPct ?? 80
  const numEntityId = Number(entityId)
  const grain: Grain = opts.grain === 'daily' || opts.grain === 'monthly' ? opts.grain : 'weekly'
  const aggTable = grain === 'daily' ? 'agg_cell_daily' : grain === 'monthly' ? 'agg_cell_monthly' : 'agg_cell_weekly'
  const dateCol = grain === 'daily' ? 'w.date' : grain === 'monthly' ? 'w.month_start' : 'w.week_start'

  // 1. identity + hierarchy path
  const dimSql: Record<InvestigationScope, string> = {
    region: `SELECT rg.name AS name, NULL AS s, NULL AS d, NULL AS r
             FROM dim_region rg
             WHERE rg.region_id = ${numEntityId}`,
    cell: `SELECT c.name AS name, s.name AS s, d.name AS d, rg.name AS r
           FROM dim_cell c
           LEFT JOIN dim_site s ON s.site_id = c.site_id
           LEFT JOIN dim_district d ON d.district_id = c.district_id
           LEFT JOIN dim_region rg ON rg.region_id = c.region_id
           WHERE c.cell_id = ${numEntityId}`,
    site: `SELECT s.name AS name, d.name AS d, rg.name AS r
           FROM dim_site s
           LEFT JOIN dim_district d ON d.district_id = s.district_id
           LEFT JOIN dim_region rg ON rg.region_id = d.region_id
           WHERE s.site_id = ${numEntityId}`,
    district: `SELECT d.name AS name, rg.name AS r, NULL AS s
               FROM dim_district d
               LEFT JOIN dim_region rg ON rg.region_id = d.region_id
               WHERE d.district_id = ${numEntityId}`
  }
  const dimR = await conn.runAndReadAll(dimSql[scope])
  const dim = dimR.getRowObjects()[0]
  if (!dim) return null
  const path = [dim.r, dim.d, dim.s].filter((v): v is string => v != null && v !== '')
  path.push(String(dim.name ?? ''))
  const entityName = String(dim.name ?? '')
  const idCol = scope === 'cell' ? 'c.cell_id' : `c.${scope}_id`
  const join = scope === 'cell' ? '' : 'JOIN dim_cell c ON c.cell_id = w.cell_id'
  const filter = scope === 'cell' ? `w.cell_id = ${numEntityId}` : `c.${scope}_id = ${numEntityId}`

  // 2. time series (site/district roll up from cell aggregates)
  const wkR = await conn.runAndReadAll(
    scope === 'cell'
      ? `SELECT CAST(${dateCol} AS VARCHAR) AS week_start, w.prb_avg, w.dl_throughput_kbps_avg AS thr,
                w.connected_users_sum AS usr, w.data_volume_mb_sum AS vol, w.availability_pct_avg AS avail,
                w.is_nc, l.lifecycle
         FROM ${aggTable} w
         LEFT JOIN cell_nc_lifecycle l
           ON l.cell_id = w.cell_id AND l.period_start = ${dateCol}
           AND l.grain = '${grain}' AND l.ruleset_version = (SELECT max(version) FROM ruleset)
         WHERE w.cell_id = ${numEntityId} ORDER BY ${dateCol}`
      : `SELECT CAST(${dateCol} AS VARCHAR) AS week_start, avg(w.prb_avg) AS prb_avg,
                avg(w.dl_throughput_kbps_avg) AS thr, sum(w.connected_users_sum) AS usr,
                sum(w.data_volume_mb_sum) AS vol, avg(w.availability_pct_avg) AS avail,
                sum(w.is_nc) > 0 AS is_nc, NULL AS lifecycle
         FROM ${aggTable} w ${join}
         WHERE ${filter} GROUP BY ${dateCol} ORDER BY ${dateCol}`
  )
  const weeks: InvestigationWeek[] = wkR.getRowObjects().map((x) => ({
    weekStart: String(x.week_start ?? ''),
    prbAvg: x.prb_avg == null ? null : Number(x.prb_avg),
    throughputKbps: x.thr == null ? null : Number(x.thr),
    users: x.usr == null ? null : Number(x.usr),
    volumeMb: x.vol == null ? null : Number(x.vol),
    availability: x.avail == null ? null : Number(x.avail),
    isNc: Boolean(x.is_nc),
    lifecycle: x.lifecycle ? (String(x.lifecycle) as Lifecycle) : null
  }))
  const last = weeks[weeks.length - 1]
  const prev = weeks[weeks.length - 2]

  // 3. current classification + priority (cell scope; rollup pseudo-current otherwise)
  let current: InvestigationResult['current'] = null
  if (scope === 'cell') {
    const curR = await conn.runAndReadAll(
      `SELECT CAST(l.period_start AS VARCHAR) AS week_start, l.lifecycle, l.trend, l.severity,
              l.prb_avg, l.is_nc, p.score, p.band
       FROM cell_nc_lifecycle l
       LEFT JOIN cell_priority_history p
         ON p.cell_id = l.cell_id AND p.mode = 'balanced' AND p.as_of = l.period_start
       WHERE l.cell_id = ${numEntityId} AND l.grain = '${grain}'
         AND l.ruleset_version = (SELECT max(version) FROM ruleset)
         AND l.period_start = (SELECT max(period_start) FROM cell_nc_lifecycle WHERE cell_id = ${numEntityId} AND grain = '${grain}')
       LIMIT 1`
    )
    const row = curR.getRowObjects()[0]
    if (row) {
      current = {
        weekStart: String(row.week_start ?? ''),
        lifecycle: row.lifecycle ? (String(row.lifecycle) as Lifecycle) : null,
        trend: row.trend ? (String(row.trend) as Trend) : null,
        severity: row.severity ? (String(row.severity) as Severity) : null,
        priorityScore: row.score == null ? null : Number(row.score),
        priorityBand: row.band ? (String(row.band) as PriorityBand) : null,
        prbAvg: row.prb_avg == null ? null : Number(row.prb_avg),
        isNc: Boolean(row.is_nc)
      }
    }
  }
  if (!current && last) {
    current = {
      weekStart: last.weekStart,
      lifecycle: null,
      trend: null,
      severity: null,
      priorityScore: null,
      priorityBand: null,
      prbAvg: last.prbAvg,
      isNc: last.isNc
    }
  }

  // 4. KPI evidence strip: latest week vs previous
  const evidence: EvidenceKpi[] = METRICS.map((m) => {
    const cur = valueOf(last, m.metric)
    const pv = valueOf(prev, m.metric)
    let delta: number | null = null
    let deltaPct: number | null = null
    if (cur != null && pv != null) {
      delta = cur - pv
      if (pv !== 0) deltaPct = (delta / Math.abs(pv)) * 100
    }
    return {
      metric: m.metric,
      label: m.label,
      unit: m.unit,
      worseIsHigher: m.worseIsHigher,
      current: cur == null ? null : round2(cur),
      previous: pv == null ? null : round2(pv),
      delta: delta == null ? null : round2(delta),
      deltaPct: deltaPct == null ? null : round1(deltaPct)
    }
  })
  const kpi = (m: PerfMetric | 'nc'): EvidenceKpi => evidence.find((e) => e.metric === m)!

  // 5. deterministic findings with calibrated language (§48)
  const findings: DiagnosisFinding[] = []
  const f = (id: string, level: DiagnosisFinding['level'], phrase: DiagnosisFinding['phrase'], text: string): void => {
    findings.push({ id, level, phrase, text })
  }
  let ncStreak = 0
  for (let i = weeks.length - 1; i >= 0 && weeks[i].isNc; i--) ncStreak++
  const isNc = last?.isNc ?? false
  const prbK = kpi('prb')
  const thrK = kpi('throughput')
  const usrK = kpi('users')
  const volK = kpi('volume')
  const avK = kpi('availability')

  if (prbK.current != null && prbK.current >= threshold) {
    f('prb_high', 'evidence', 'consistent with',
      `PRB utilization of ${fmt(prbK.current, '%')} is at or above the ${threshold}% ruleset threshold.`)
  }
  if (prbK.delta != null && prbK.delta >= 3) {
    f('prb_rising', 'suggestion', 'suggests',
      `PRB rose ${fmt(prbK.delta, 'pp')} week-over-week — demand is building.`)
  }
  if (thrK.deltaPct != null && thrK.deltaPct <= -10) {
    f('thr_drop', 'suggestion', 'suggests',
      `DL throughput fell ${Math.abs(round1(thrK.deltaPct))}% week-over-week — a user-experience impact is plausible.`)
  }
  if (usrK.deltaPct != null && usrK.deltaPct >= 10) {
    f('users_growth', 'evidence', 'consistent with',
      `Connected users grew ${round1(usrK.deltaPct)}% week-over-week.`)
  }
  if (volK.deltaPct != null && volK.deltaPct >= 10) {
    f('volume_growth', 'evidence', 'consistent with',
      `Data volume grew ${round1(volK.deltaPct)}% week-over-week.`)
  }
  if (avK.current != null && avK.current < 99.5) {
    f('avail_low', 'suggestion', 'suggests',
      `Availability of ${fmt(avK.current, '%')} is below the 99.5% engineering expectation.`)
  }
  if (ncStreak >= 2) {
    f('persistent', 'evidence', 'evidence supports',
      `${entityName} has been classified NC for ${ncStreak} consecutive weeks (${current?.lifecycle ?? 'NC'}).`)
  }
  if (isNc && ncStreak === 1) {
    f('entered_nc', 'evidence', 'evidence supports',
      `The entity entered NC status this week (${current?.lifecycle ?? 'NC'}).`)
  }
  if (!isNc && weeks.some((w) => w.isNc)) {
    f('recovered', 'evidence', 'evidence supports',
      `Classified ${current?.lifecycle ?? 'Healthy'} after previous NC activity — the trajectory is improving.`)
  }
  f('conclusion', 'conclusion', 'evidence supports',
    isNc
      ? `Deterministic conclusion: active ${current?.lifecycle ?? 'NC'} concern` +
        (current?.priorityScore != null ? ` with priority ${current.priorityScore} (${current.priorityBand ?? ''})` : '') +
        '.'
      : `Deterministic conclusion: no active NC classification` +
        (weeks.filter((w) => w.isNc).length > 0
          ? ` — recent history includes ${weeks.filter((w) => w.isNc).length} NC week(s); monitor for recurrence.`
          : ' — the entity is stable under the active ruleset.'))

  // 6. Run modular diagnostic heuristics engine
  const kpiMap = new Map<string, number | null>()
  if (last?.prbAvg != null) kpiMap.set('prb_utilization', last.prbAvg)

  if (scope === 'cell' && last?.weekStart) {
    try {
      const kpiRows = await conn.runAndReadAll(
        `SELECT k.kpi_key, w.avg_value
         FROM agg_cell_kpi_weekly w
         JOIN kpi_defs k ON k.kpi_id = w.kpi_id
         WHERE w.cell_id = ${numEntityId} AND CAST(w.week_start AS VARCHAR) = '${last.weekStart.replace(/'/g, "''")}'`
      )
      for (const r of kpiRows.getRowObjects()) {
        if (r.kpi_key != null) kpiMap.set(String(r.kpi_key), r.avg_value == null ? null : Number(r.avg_value))
      }
    } catch {
      /* ignore if extra kpis table is empty */
    }
  }

  const techR = await conn.runAndReadAll(`SELECT value FROM workspace_meta WHERE key = 'technology'`)
  const wsTech = (String(techR.getRowObjects()[0]?.value ?? '4G') as Technology)

  const diagCtx: DiagnosticContext = {
    technology: wsTech,
    entityName,
    isNc,
    ncStreak,
    weeks,
    latestWeek: last,
    previousWeek: prev,
    evidence,
    kpiMap,
    thresholds: {
      prb: rules?.prbThresholdPct ?? 80,
      tchCongestion: rules?.tchCongestionThresholdPct ?? 2.0,
      sdcchCongestion: rules?.sdcchCongestionThresholdPct ?? 2.0,
      cssr: rules?.cssrThresholdPct ?? 98.5,
      callDrop: rules?.callDropThresholdPct ?? 1.5,
      dataAccess: rules?.dataAccessThresholdPct ?? 98.0,
      dataFailure: rules?.dataServiceFailureThresholdPct ?? 1.0,
      persistentWeeks: rules?.persistentWeeks ?? 3,
      chronicWeeks: rules?.chronicWeeks ?? 7
    }
  }

  const hypotheses: DiagnosticHypothesis[] = runDiagnosticEngine(diagCtx)

  // 7. events: derived classification/priority changes + stored notes/status events
  const events: InvestigationEvent[] = []
  if (scope === 'cell') {
    const lifeR = await conn.runAndReadAll(
      `SELECT CAST(period_start AS VARCHAR) AS week_start, lifecycle, severity
       FROM cell_nc_lifecycle
       WHERE cell_id = ${numEntityId} AND grain = 'weekly' AND ruleset_version = (SELECT max(version) FROM ruleset)
       ORDER BY period_start`
    )
    let prevLife: string | null = null
    for (const row of lifeR.getRowObjects()) {
      const life = String(row.lifecycle ?? '')
      if (prevLife && life !== prevLife) {
        events.push({
          id: -events.length - 1,
          occurredAt: String(row.week_start ?? ''),
          kind: 'classification_change',
          note: `Lifecycle ${prevLife} → ${life} (severity ${String(row.severity ?? 'Normal')})`,
          author: 'engine'
        })
      }
      prevLife = life
    }
    const prR = await conn.runAndReadAll(
      `SELECT CAST(as_of AS VARCHAR) AS as_of, score FROM cell_priority_history
       WHERE cell_id = ${numEntityId} AND mode = 'balanced' ORDER BY as_of`
    )
    const prRows = prR.getRowObjects()
    for (let i = 1; i < prRows.length; i++) {
      const d = Number(prRows[i].score) - Number(prRows[i - 1].score)
      if (Math.abs(d) >= 5) {
        events.push({
          id: -events.length - 1,
          occurredAt: String(prRows[i].as_of ?? ''),
          kind: 'priority_change',
          note: `Priority ${Number(prRows[i - 1].score)} → ${Number(prRows[i].score)} (Δ ${d >= 0 ? '+' : ''}${Math.round(d)})`,
          author: 'engine'
        })
      }
    }
  }
  const safeScope = scope.replace(/'/g, "''")
  const neR = await conn.runAndReadAll(
    `SELECT CAST(event_id AS DOUBLE) AS event_id, CAST(occurred_at AS VARCHAR) AS occurred_at, kind, note, author
     FROM notes_events WHERE entity_type = '${safeScope}' AND entity_id = ${numEntityId}
     ORDER BY occurred_at DESC, event_id DESC LIMIT 40`
  )
  for (const x of neR.getRowObjects()) {
    events.push({
      id: Number(x.event_id),
      occurredAt: String(x.occurred_at ?? ''),
      kind: String(x.kind ?? ''),
      note: x.note ? String(x.note) : null,
      author: x.author ? String(x.author) : null
    })
  }
  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id - a.id)

  // 8. action status (§44)
  const stR = await conn.runAndReadAll(
    `SELECT status, owner, external_ticket, CAST(target_review_date AS VARCHAR) AS target_review_date,
            CAST(updated_at AS VARCHAR) AS updated_at
     FROM entity_action_status WHERE entity_type = '${safeScope}' AND entity_id = ${numEntityId}`
  )
  const stRow = stR.getRowObjects()[0]
  const status: InvestigationStatus = stRow
    ? {
        status: stRow.status ? (String(stRow.status) as ActionStatus) : null,
        owner: stRow.owner ? String(stRow.owner) : null,
        externalTicket: stRow.external_ticket ? String(stRow.external_ticket) : null,
        targetReviewDate: stRow.target_review_date ? String(stRow.target_review_date) : null,
        updatedAt: stRow.updated_at ? String(stRow.updated_at) : null
      }
    : { status: null, owner: null, externalTicket: null, targetReviewDate: null, updatedAt: null }

  // 9. before/after windows (§50) — default intervention at the midpoint
  let interventionWeek = opts.interventionWeek ?? null
  if (!interventionWeek && weeks.length > 1) {
    interventionWeek = weeks[Math.floor(weeks.length / 2)].weekStart
  }
  const beforeW = weeks.filter((w) => interventionWeek == null || w.weekStart < interventionWeek).slice(-8)
  const afterW = weeks.filter((w) => interventionWeek == null || w.weekStart >= interventionWeek).slice(0, 8)
  const avgOf = (list: InvestigationWeek[], m: PerfMetric | 'nc'): number | null => {
    const vs = list.map((w) => valueOf(w, m)).filter((v): v is number => v != null)
    if (vs.length === 0) return null
    if (m === 'users' || m === 'volume') return vs.reduce((s, v) => s + v, 0)
    return vs.reduce((s, v) => s + v, 0) / vs.length
  }
  const beforeAfter: BeforeAfterMetric[] = METRICS.map((m) => {
    const b = avgOf(beforeW, m.metric)
    const a = avgOf(afterW, m.metric)
    const deltaPct = b == null || a == null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100
    const improved = b == null || a == null ? null : m.worseIsHigher ? a < b : a > b
    return {
      metric: m.metric,
      label: m.label,
      unit: m.unit,
      before: b == null ? null : round2(b),
      after: a == null ? null : round2(a),
      deltaPct: deltaPct == null ? null : round1(deltaPct),
      improved
    }
  })

  // 10. peer comparison: same-scope siblings, worst health first
  let peers: InvestigationPeer[] = []
  if (scope === 'cell') {
    const pR = await conn.runAndReadAll(
      `SELECT c2.name AS name, w.prb_avg, w.dl_throughput_kbps_avg AS thr, h.health_score, w.is_nc AS nc
       FROM dim_cell c2
       LEFT JOIN agg_cell_weekly w ON w.cell_id = c2.cell_id
         AND w.week_start = (SELECT max(week_start) FROM agg_cell_weekly)
       LEFT JOIN cell_health_history h ON h.cell_id = c2.cell_id
         AND h.date_id = (SELECT max(date_id) FROM cell_health_history)
       WHERE c2.site_id = (SELECT site_id FROM dim_cell WHERE cell_id = ${numEntityId})
       ORDER BY h.health_score ASC NULLS LAST, c2.cell_id LIMIT 10`
    )
    peers = pR.getRowObjects().map((x) => ({
      name: String(x.name ?? ''),
      prbAvg: x.prb_avg == null ? null : Number(x.prb_avg),
      throughputKbps: x.thr == null ? null : Number(x.thr),
      healthScore: x.health_score == null ? null : Number(x.health_score),
      ncCells: Number(x.nc ?? 0)
    }))
  } else {
    const t = scope === 'site' ? 'dim_site' : 'dim_district'
    const idC = scope === 'site' ? 'site_id' : 'district_id'
    const parentC = scope === 'site' ? 'district_id' : 'region_id'
    const parentSub = scope === 'site'
      ? `(SELECT district_id FROM dim_site WHERE site_id = ${numEntityId})`
      : `(SELECT region_id FROM dim_district WHERE district_id = ${numEntityId})`
    const pR = await conn.runAndReadAll(
      `SELECT e.name AS name, round(avg(w.prb_avg), 1) AS prb_avg, round(avg(w.dl_throughput_kbps_avg), 1) AS thr,
              round(avg(h.health_score), 1) AS health_score, sum(w.is_nc) AS nc
       FROM ${t} e
       JOIN dim_cell c ON c.${idC} = e.${idC}
       LEFT JOIN agg_cell_weekly w ON w.cell_id = c.cell_id
         AND w.week_start = (SELECT max(week_start) FROM agg_cell_weekly)
       LEFT JOIN cell_health_history h ON h.cell_id = c.cell_id
         AND h.date_id = (SELECT max(date_id) FROM cell_health_history)
       WHERE e.${parentC} = ${parentSub}
       GROUP BY e.${idC}, e.name
       ORDER BY health_score ASC NULLS LAST LIMIT 10`
    )
    peers = pR.getRowObjects().map((x) => ({
      name: String(x.name ?? ''),
      prbAvg: x.prb_avg == null ? null : Number(x.prb_avg),
      throughputKbps: x.thr == null ? null : Number(x.thr),
      healthScore: x.health_score == null ? null : Number(x.health_score),
      ncCells: Number(x.nc ?? 0)
    }))
  }

  return {
    scope,
    entityId,
    entityName,
    path,
    current,
    evidence,
    findings,
    hypotheses,
    events,
    status,
    beforeAfter,
    interventionWeek,
    weeks,
    peers
  }
}

export async function setInvestigationStatus(
  scope: InvestigationScope,
  entityId: number,
  patch: {
    status?: ActionStatus | null
    owner?: string | null
    externalTicket?: string | null
    targetReviewDate?: string | null
  }
): Promise<InvestigationStatus> {
  const conn = ws().connection
  const numEntityId = Number(entityId)
  const safeScope = scope.replace(/'/g, "''")
  const stR = await conn.runAndReadAll(
    `SELECT status, owner, external_ticket, CAST(target_review_date AS VARCHAR) AS trd
     FROM entity_action_status WHERE entity_type = '${safeScope}' AND entity_id = ${numEntityId}`
  )
  const before = stR.getRowObjects()[0]
  const beforeStatus = before?.status ? String(before.status) : null
  const status: ActionStatus | null =
    patch.status !== undefined ? patch.status : beforeStatus ? (beforeStatus as ActionStatus) : null
  const owner = patch.owner !== undefined ? patch.owner : before?.owner ? String(before.owner) : null
  const ticket =
    patch.externalTicket !== undefined ? patch.externalTicket : before?.external_ticket ? String(before.external_ticket) : null
  const trd =
    patch.targetReviewDate !== undefined
      ? patch.targetReviewDate
      : before?.trd
        ? String(before.trd)
        : null

  const sqlStatus = status ? `'${status.replace(/'/g, "''")}'` : 'NULL'
  const sqlOwner = owner ? `'${owner.replace(/'/g, "''")}'` : 'NULL'
  const sqlTicket = ticket ? `'${ticket.replace(/'/g, "''")}'` : 'NULL'
  const sqlTrd = trd ? `CAST('${trd.replace(/'/g, "''")}' AS DATE)` : 'NULL'

  await conn.run(
    `INSERT INTO entity_action_status (entity_type, entity_id, status, owner, external_ticket, target_review_date, updated_at)
     VALUES ('${safeScope}', ${numEntityId}, ${sqlStatus}, ${sqlOwner}, ${sqlTicket}, ${sqlTrd}, now())
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET
       status = excluded.status, owner = excluded.owner,
       external_ticket = excluded.external_ticket,
       target_review_date = excluded.target_review_date, updated_at = now()`
  )
  const parts: string[] = []
  if (patch.status !== undefined && patch.status !== beforeStatus) {
    parts.push(`status: ${beforeStatus ?? 'Unreviewed'} → ${patch.status}`)
  }
  if (patch.owner !== undefined && patch.owner !== (before?.owner ? String(before.owner) : null)) {
    parts.push(`owner: ${patch.owner ?? '—'}`)
  }
  if (parts.length > 0) {
    const safeParts = parts.join('; ').replace(/'/g, "''")
    await conn.run(
      `INSERT INTO notes_events (entity_type, entity_id, kind, note, author)
       VALUES ('${safeScope}', ${numEntityId}, 'status_change', '${safeParts}', 'user')`
    )
  }
  return { status, owner, externalTicket: ticket, targetReviewDate: trd, updatedAt: new Date().toISOString() }
}

export async function addInvestigationNote(
  scope: InvestigationScope,
  entityId: number,
  note: string
): Promise<InvestigationEvent> {
  const conn = ws().connection
  const numEntityId = Number(entityId)
  const safeScope = scope.replace(/'/g, "''")
  const safeNote = note.replace(/'/g, "''")
  await conn.run(
    `INSERT INTO notes_events (entity_type, entity_id, kind, note, author)
     VALUES ('${safeScope}', ${numEntityId}, 'user_note', '${safeNote}', 'user')`
  )
  const r = await conn.runAndReadAll(
    `SELECT CAST(event_id AS DOUBLE) AS event_id, CAST(occurred_at AS VARCHAR) AS occurred_at
     FROM notes_events WHERE entity_type = '${safeScope}' AND entity_id = ${numEntityId} ORDER BY event_id DESC LIMIT 1`
  )
  const row = r.getRowObjects()[0]
  return {
    id: Number(row?.event_id ?? 0),
    occurredAt: String(row?.occurred_at ?? ''),
    kind: 'user_note',
    note,
    author: 'user'
  }
}

/** Exportable investigation report (spec §47): markdown, saved to exports/. */
export function buildReportMarkdown(res: InvestigationResult): string {
  const L: string[] = []
  L.push(`# Investigation report — ${res.entityName}`)
  L.push('')
  L.push(`- Scope: ${res.scope}`)
  L.push(`- Hierarchy: ${res.path.join(' › ')}`)
  L.push(`- Generated: ${new Date().toISOString()}`)
  L.push(
    `- Action status: ${res.status.status ?? 'Unreviewed'}` +
      (res.status.owner ? ` · owner: ${res.status.owner}` : '') +
      (res.status.externalTicket ? ` · ticket: ${res.status.externalTicket}` : '') +
      (res.status.targetReviewDate ? ` · review by: ${res.status.targetReviewDate}` : '')
  )
  if (res.current) {
    L.push('')
    L.push('## Classification')
    L.push(
      `- Lifecycle: ${res.current.lifecycle ?? '—'} · Trend: ${res.current.trend ?? '—'} · ` +
        `Severity: ${res.current.severity ?? '—'} · NC: ${res.current.isNc ? 'yes' : 'no'}`
    )
    L.push(`- Priority: ${res.current.priorityScore ?? '—'} (${res.current.priorityBand ?? '—'}) · Week: ${res.current.weekStart}`)
  }
  L.push('')
  L.push('## KPI evidence (latest week vs previous)')
  L.push('')
  L.push('| Metric | Current | Previous | Δ | Δ% |')
  L.push('|---|---|---|---|---|')
  for (const e of res.evidence) {
    L.push(
      `| ${e.label} | ${fmt(e.current, e.unit)} | ${fmt(e.previous, e.unit)} | ` +
        `${e.delta == null ? '—' : (e.delta >= 0 ? '+' : '') + fmt(e.delta, e.unit)} | ` +
        `${e.deltaPct == null ? '—' : (e.deltaPct >= 0 ? '+' : '') + e.deltaPct.toFixed(1) + '%'} |`
    )
  }
  L.push('')
  L.push('## Findings (calibrated language)')
  L.push('')
  for (const f of res.findings) L.push(`- *[${f.level}] ${f.phrase}* — ${f.text}`)
  L.push('')
  L.push('## Alternative hypotheses (descriptive, not causal)')
  L.push('')
  for (const h of res.hypotheses) {
    L.push(`### ${h.title} — ${h.verdict} (support ${h.score}/100)`)
    for (const s of h.supporting) L.push(`- For: ${s}`)
    for (const c of h.contradicting) L.push(`- Against: ${c}`)
  }
  L.push('')
  L.push('## Before / after')
  L.push('')
  L.push(`Intervention window at week: ${res.interventionWeek ?? '—'}`)
  L.push('')
  L.push('| Metric | Before | After | Δ% | Improved |')
  L.push('|---|---|---|---|---|')
  for (const b of res.beforeAfter) {
    L.push(
      `| ${b.label} | ${fmt(b.before, b.unit)} | ${fmt(b.after, b.unit)} | ` +
        `${b.deltaPct == null ? '—' : (b.deltaPct >= 0 ? '+' : '') + b.deltaPct.toFixed(1) + '%'} | ` +
        `${b.improved == null ? '—' : b.improved ? 'yes' : 'no'} |`
    )
  }
  L.push('')
  L.push('## Events')
  L.push('')
  for (const ev of res.events.slice(0, 25)) {
    L.push(`- ${ev.occurredAt} — ${ev.kind}: ${ev.note ?? ''} (${ev.author ?? '—'})`)
  }
  L.push('')
  L.push('---')
  L.push('*Generated by 2G/3G/4G QoS Network Intelligence. Hypotheses are descriptive, not causal — ' +
    'root cause is never claimed beyond the imported data (spec §48).*')
  return L.join('\n')
}

export async function exportInvestigationReport(
  scope: InvestigationScope,
  entityId: number
): Promise<{ path: string; markdown: string } | null> {
  const res = await getInvestigation(scope, entityId)
  if (!res) return null
  const markdown = buildReportMarkdown(res)
  const safe = res.entityName.replace(/[^A-Za-z0-9_-]+/g, '_')
  const fname = `${res.scope}-${safe}-${new Date().toISOString().slice(0, 10)}.md`
  const path = join(exportsDir(), fname)
  writeFileSync(path, markdown, 'utf8')
  return { path, markdown }
}

