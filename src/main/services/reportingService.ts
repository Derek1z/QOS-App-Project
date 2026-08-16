import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import ExcelJS from 'exceljs'
import PptxGenJS from 'pptxgenjs'
import { dirs, exportsDir } from '../paths'
import { getCurrent } from '../workspace/manager'
import {
  getSummary, getHealth, getNcMovement, getPriorityQueue, getForecast,
  getCellIntelligence, getHealthMatrix, getNcLifecycle, getRulesCurrent
} from './queryService'
import type {
  DueReport, ReportChartConfig, ReportFormat, ReportHistoryRow, ReportOpts, ReportPack,
  ReportSectionId, ReportSnapshot, ReportType, CellIntelligenceRow, CellKpiValue
} from '../../../shared/api'
import { DEFAULT_CHARTS, REPORT_SECTIONS } from '../../../shared/api'

type JSZipLike = {
  loadAsync(data: Uint8Array | Buffer): Promise<{
    file(path: string): { async(type: 'string'): Promise<string> } | null
    file(path: string, content: string | Uint8Array): void
    generateAsync(opts: { type: 'nodebuffer' }): Promise<Buffer>
    files: Record<string, { async(type: 'string'): Promise<string> }>
  }>
}

/** Reporting Center (spec §51–56): build report packs from live analytics —
 *  markdown, CSV (Excel), styled HTML and PDF (via Electron printToPDF).
 *  Templates persist in report_definitions; generated packs are tracked in a
 *  history manifest under exports/. The snapshot freezes scope, thresholds,
 *  KPIs, classifications and the ruleset version (§55). */

interface SectionTable {
  title: string
  columns: string[]
  rows: Array<Array<string | number | null>>
  note?: string
}

interface SectionData {
  id: ReportSectionId
  table: SectionTable
}

type SectionBuilder = () => Promise<SectionTable>

const fmt = (v: number | null | undefined, unit = '', digits = 1): string =>
  v == null ? '—' : `${Number(v).toFixed(digits)}${unit}`

/** KPI columns present across the row set, in first-seen order (spec §54a). */
function kpiColumnDefs(rows: CellIntelligenceRow[]): CellKpiValue[] {
  const seen = new Map<string, CellKpiValue>()
  for (const r of rows) {
    for (const k of r.kpis) if (!seen.has(k.key)) seen.set(k.key, k)
  }
  return [...seen.values()]
}

function kpiCellValue(c: CellIntelligenceRow, key: string): string | null {
  const k = c.kpis.find((x) => x.key === key)
  if (!k || k.value == null) return null
  return `${Number(k.value).toFixed(1)}${k.breached ? ' ⚠' : ''}${k.unit ? ` ${k.unit}` : ''}`
}

const fmtK = (v: number | null | undefined): string =>
  v == null ? '—' : `${Math.round(v).toLocaleString()}`

function escCsv(v: string | number | null): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function escHtml(v: string | number | null): string {
  if (v == null) return '—'
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// --- section builders -------------------------------------------------------

const SECTION_BUILDERS: Partial<Record<ReportSectionId, SectionBuilder>> = {
  'executive-summary': async () => {
    const s = await getSummary()
    const h = await getHealth()
    const q = await getPriorityQueue('balanced', 10)
    const rows: Array<Array<string | number | null>> = [
      ['Observed rows', fmtK(s?.rowCount)],
      ['Cells / Sites / Districts / Regions', `${fmtK(s?.cells)} / ${fmtK(s?.sites)} / ${fmtK(s?.districts)} / ${fmtK(s?.regions)}`],
      ['Avg PRB utilization', fmt(s?.avgPrb, '%')],
      ['Data volume', s?.totalVolumeMb == null ? '—' : `${(s.totalVolumeMb / 1024).toFixed(1)} GB`],
      ['Connected users', fmtK(s?.totalUsers)],
      ['DL throughput', s?.avgThroughputKbps == null ? '—' : `${(s.avgThroughputKbps / 1024).toFixed(1)} Mbps`],
      ['Availability', fmt(s?.avgAvailability, '%')],
      ['Weekly NC cells', fmtK(s?.weeklyNcCells)],
      ['Ruleset version', s?.rulesetVersion ?? null]
    ]
    const latest = h.network[h.network.length - 1]
    if (latest) {
      rows.push(['Network health score', latest.score])
      rows.push(['Health components (cap/thr/avail/nc/growth)', `${latest.capacity} / ${latest.throughput} / ${latest.availability} / ${latest.ncRecurrence} / ${latest.growth}`])
    }
    const top = q.slice(0, 5).map((p) => `${p.cellName} (${p.band}, ${p.score})`).join('; ')
    rows.push(['Top priorities', top || '—'])
    return { title: 'Executive Summary', columns: ['KPI', 'Value'], rows, note: `NC rate and health as of the latest completed week (${latest?.asOf ?? '—'}).` }
  },

  'kpi-trend': async () => {
    const mv = await getNcMovement(8)
    const h = await getHealth()
    const healthByWeek = new Map(h.network.map((w) => [w.asOf, w.score]))
    const rows = mv.map((m) => [
      m.weekStart, m.newNc, m.recurring, m.persistent, m.recovering, m.ncCells,
      m.ncRate == null ? null : `${m.ncRate.toFixed(1)}%`,
      healthByWeek.get(m.weekStart) ?? null
    ])
    return {
      title: 'KPI Trend',
      columns: ['Week', 'New NC', 'Recurring', 'Persistent', 'Recovering', 'NC cells', 'NC rate', 'Health'],
      rows,
      note: `Network health (last ${Math.min(8, h.network.length)} weeks): the Health column is the network health score for the same week.`
    }
  },

  'region-analysis': async () => matrixSection('region', 'Region Analysis'),
  'district-analysis': async () => matrixSection('district', 'District Analysis'),
  'site-analysis': async () => matrixSection('site', 'Site Analysis'),

  'all-cells': async () => {
    const r = await getCellIntelligence({ limit: 200 })
    const kpiCols = kpiColumnDefs(r.rows)
    return {
      title: 'All Cells',
      columns: ['Cell', 'Region', 'District', 'Site', 'Lifecycle', 'Trend', 'Severity', 'PRB %', 'Priority', ...kpiCols.map((k) => k.label)],
      rows: r.rows.map((c) => [
        c.cellName, c.region ?? '', c.district ?? '', c.site ?? '', c.lifecycle, c.trend, c.severity,
        c.prbAvg == null ? null : c.prbAvg.toFixed(1), c.priorityScore ?? null,
        ...kpiCols.map((k) => kpiCellValue(c, k.key))
      ]),
      note: `Showing ${r.total} cells (first ${r.rows.length}).`
    }
  },

  'nc-register': async () => {
    const r = await getCellIntelligence({ limit: 400 })
    const nc = r.rows.filter((c) => c.isNc)
    const kpiCols = kpiColumnDefs(nc)
    return {
      title: 'NC Register',
      columns: ['Cell', 'Region', 'District', 'Site', 'Lifecycle', 'Trend', 'Severity', 'PRB %', 'Breach days', ...kpiCols.map((k) => k.label)],
      rows: nc.map((c) => [
        c.cellName, c.region ?? '', c.district ?? '', c.site ?? '', c.lifecycle, c.trend, c.severity,
        c.prbAvg == null ? null : c.prbAvg.toFixed(1), c.breachDays,
        ...kpiCols.map((k) => kpiCellValue(c, k.key))
      ]),
      note: `${nc.length} NC cells under the active ruleset.`
    }
  },

  'persistent-nc': async () => {
    const r = await getCellIntelligence({ lifecycle: 'Persistent NC', limit: 100 })
    const kpiCols = kpiColumnDefs(r.rows)
    return {
      title: 'Persistent NC',
      columns: ['Cell', 'Region', 'District', 'Site', 'Trend', 'Severity', 'PRB %', 'Breach days', 'Priority', ...kpiCols.map((k) => k.label)],
      rows: r.rows.map((c) => [
        c.cellName, c.region ?? '', c.district ?? '', c.site ?? '', c.trend, c.severity,
        c.prbAvg == null ? null : c.prbAvg.toFixed(1), c.breachDays, c.priorityScore ?? null,
        ...kpiCols.map((k) => kpiCellValue(c, k.key))
      ]),
      note: `${r.total} persistent NC cells — escalation candidates.`
    }
  },

  'priority-queue': async () => {
    const q = await getPriorityQueue('balanced', 50)
    return {
      title: 'Priority Queue',
      columns: ['Cell', 'Region', 'District', 'Site', 'Score', 'Band', 'PRB severity', 'Persistence', 'Trend'],
      rows: q.map((p) => [p.cellName, p.region ?? '', p.district ?? '', p.site ?? '', p.score, p.band, p.components.prbSeverity, p.components.persistence, p.components.worseningTrend]),
      note: 'Balanced mode, latest week. Higher score = more urgent.'
    }
  },

  'forecast-risk': async () => {
    const f = await getForecast({})
    return {
      title: 'Forecast Risk',
      columns: ['Cell', 'Path', 'Current', 'Forecast', 'Threshold', 'Risk'],
      rows: f.riskRows.slice(0, 25).map((r) => [r.name, r.path.join(' › '), r.current, r.forecast, r.threshold, r.risk]),
      note: `${f.totalEntities} entities; ${f.riskCounts['Already Breached'] ?? 0} already breached, ${f.riskCounts['Likely Breach'] ?? 0} likely to breach within the ${f.horizon} horizon.`
    }
  },

  'health-matrix': async () => {
    const m = await getHealthMatrix('cell', { weeks: 8, limit: 30 })
    return {
      title: 'Health Matrix',
      columns: ['Cell', ...m.weeks.map((w) => w.slice(5))],
      rows: m.rows.map((r) => [r.name, ...r.scores.map((s) => s == null ? null : s.toFixed(0))]),
      note: 'Green ≥ 80, amber 65–79, red < 65 (cell × week health scores).'
    }
  },

  'lifecycle-analysis': async () => {
    const l = await getNcLifecycle()
    return {
      title: 'Lifecycle Analysis',
      columns: ['Dimension', 'Bucket', 'Count'],
      rows: [
        ...Object.entries(l.byLifecycle).map(([k, v]) => ['Lifecycle', k, v]),
        ...Object.entries(l.byTrend).map(([k, v]) => ['Trend', k, v]),
        ...Object.entries(l.bySeverity).map(([k, v]) => ['Severity', k, v]),
        ['NC rate', '—', l.ncRate == null ? null : `${l.ncRate.toFixed(1)}%`]
      ],
      note: `Week ${l.weekStart ?? '—'}: ${l.ncCells} of ${l.totalCells} cells in NC.`
    }
  }
}

async function matrixSection(
  scope: 'region' | 'district' | 'site',
  title: string
): Promise<SectionTable> {
  const m = await getHealthMatrix(scope, { limit: 30 })
  const last = m.weeks[m.weeks.length - 1]?.slice(5)
  return {
    title,
    columns: ['Name', `Score (${last ?? 'latest'})`, 'Cells'],
    rows: m.rows.map((r) => [r.name, r.scores[r.scores.length - 1]?.toFixed(1) ?? null, '—']),
    note: 'Rolled up from cell health; worst first.'
  }
}

// --- renderers --------------------------------------------------------------

function csvLine(cells: Array<string | number | null>): string {
  return cells.map(escCsv).join(',')
}

function renderMarkdown(name: string, sections: SectionData[], snapshot: ReportSnapshot): string {
  const L: string[] = []
  L.push(`# ${name}`, '')
  L.push(`Generated ${new Date().toISOString()} · scope ${snapshot.scope} · as of ${snapshot.asOf} · ruleset v${snapshot.rulesetVersion ?? '—'}`)
  L.push('', `> ${snapshot.note}`, '')
  for (const s of sections) {
    L.push(`## ${s.table.title}`, '')
    L.push(`| ${s.table.columns.join(' | ')} |`, `| ${s.table.columns.map(() => '---').join(' | ')} |`)
    for (const row of s.table.rows) {
      L.push(`| ${row.map((c) => String(c ?? '—').replace(/\|/g, '\\|')).join(' | ')} |`)
    }
    if (s.table.note) L.push('', `*${s.table.note}*`)
    L.push('')
  }
  L.push('---', '*Generated by 2G/3G/4G QoS Network Intelligence — Reporting Center.*')
  return L.join('\n')
}

function renderCsv(name: string, sections: SectionData[]): string {
  const L: string[] = []
  L.push(csvLine(['#', name]))
  for (const s of sections) {
    L.push(csvLine(['##', s.table.title]))
    L.push(csvLine(s.table.columns))
    for (const row of s.table.rows) L.push(csvLine(row))
    L.push('')
  }
  return L.join('\n')
}

function renderHtml(name: string, sections: SectionData[], snapshot: ReportSnapshot): string {
  const esc = escHtml
  const table = (t: SectionTable): string => {
    const head = `<tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`
    const body = t.rows
      .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
      .join('')
    return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`
  }
  const sectionsHtml = sections
    .map(
      (s) => `<section>
        <h2>${esc(s.table.title)}</h2>
        ${table(s.table)}
        ${s.table.note ? `<p class="note">${esc(s.table.note)}</p>` : ''}
      </section>`
    )
    .join('')
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(name)}</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0e121a; color:#d7dde8; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; margin:0; padding:28px 36px; }
  h1 { font-size:22px; margin:0 0 4px; color:#fff; }
  h2 { font-size:15px; margin:22px 0 8px; color:#38bdf8; border-bottom:1px solid #263041; padding-bottom:4px; }
  .meta { color:#8b95a7; font-size:12px; margin-bottom:4px; }
  .note { color:#8b95a7; font-size:11px; margin:6px 0 0; }
  table { border-collapse:collapse; width:100%; margin:6px 0 10px; font-size:11px; }
  th { background:#1a2130; color:#d7dde8; text-align:left; padding:5px 8px; border:1px solid #263041; }
  td { padding:4px 8px; border:1px solid #232c3c; }
  tr:nth-child(even) td { background:#121720; }
  footer { color:#8b95a7; font-size:10px; margin-top:24px; border-top:1px solid #263041; padding-top:8px; }
</style></head><body>
  <h1>${esc(name)}</h1>
  <p class="meta">Generated ${new Date().toISOString()} · scope ${esc(snapshot.scope)} · as of ${esc(snapshot.asOf)} · ruleset v${esc(snapshot.rulesetVersion)} · ${esc(snapshot.ncCount)} NC cells</p>
  <p class="note">${esc(snapshot.note)}</p>
  ${sectionsHtml}
  <footer>2G/3G/4G QoS Network Intelligence — Reporting Center (spec §51–56). Hypotheses are descriptive, not causal (spec §48).</footer>
</body></html>`
}

// --- Excel 13-sheet pack (spec §53) ------------------------------------------

const XLSX_SHEETS: Array<[ReportSectionId, string]> = [
  ['executive-summary', 'Executive Summary'],
  ['kpi-trend', 'KPI Trend'],
  ['region-analysis', 'Region Analysis'],
  ['district-analysis', 'District Analysis'],
  ['site-analysis', 'Site Analysis'],
  ['all-cells', 'All Cells'],
  ['nc-register', 'NC Register'],
  ['persistent-nc', 'Persistent NC'],
  ['priority-queue', 'Priority Queue'],
  ['forecast-risk', 'Forecast Risk'],
  ['health-matrix', 'Health Matrix'],
  ['lifecycle-analysis', 'Lifecycle Analysis']
]

function xlsxWidth(rows: Array<Array<string | number | null>>, cols: string[], i: number): number {
  let w = cols[i]?.length ?? 10
  for (const r of rows.slice(0, 200)) {
    const c = r[i]
    if (c != null) w = Math.max(w, String(c).length)
  }
  return Math.min(44, Math.max(10, w + 2))
}

// --- native charts in the Excel pack (spec §53) -----------------------------
// ExcelJS cannot author chart objects, so charts are rendered as SVG, rasterized
// to PNG in a hidden window (the same infra as the PDF renderer) and embedded
// below the data rows — Excel-native pictures that Excel renders as charts.

function svgEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function svgLineChart(opts: {
  title: string
  labels: string[]
  series: Array<{ name: string; color: string; values: Array<number | null> }>
}): string {
  const W = 700, H = 340, L = 56, R = 22, T = 52, B = 42
  const values = opts.series.flatMap((s) => s.values).filter((v): v is number => v != null)
  let min = values.length ? Math.min(...values) : 0
  let max = values.length ? Math.max(...values) : 1
  if (min === max) { min -= 1; max += 1 }
  const pad = (max - min) * 0.08
  min = Math.max(0, min - pad)
  max = max + pad
  const iw = W - L - R, ih = H - T - B
  const x = (i: number): number => L + (opts.labels.length <= 1 ? iw / 2 : (i / (opts.labels.length - 1)) * iw)
  const y = (v: number): number => T + ih - ((v - min) / (max - min)) * ih
  const ticks = 5
  let g = ''
  for (let t = 0; t <= ticks; t++) {
    const yy = T + (ih / ticks) * t
    const val = max - ((max - min) / ticks) * t
    g += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${W - R}" y2="${yy.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`
    g += `<text x="${L - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#6b7280">${val.toFixed(1)}</text>`
  }
  const step = Math.max(1, Math.ceil(opts.labels.length / 8))
  opts.labels.forEach((lb, i) => {
    if (i % step === 0 || i === opts.labels.length - 1) {
      g += `<text x="${x(i).toFixed(1)}" y="${H - B + 16}" text-anchor="middle" font-size="10" fill="#6b7280">${svgEscape(String(lb))}</text>`
    }
  })
  let lx = L
  const legend = opts.series.map((s) => {
    const item = `<g transform="translate(${lx.toFixed(0)}, 20)"><rect width="11" height="11" rx="2" fill="${s.color}"/><text x="16" y="10" font-size="12" fill="#374151">${svgEscape(s.name)}</text></g>`
    lx += 18 + s.name.length * 7.4 + 22
    return item
  }).join('')
  const lines = opts.series.map((s) => {
    const pts = s.values.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter((p): p is string => p != null)
    if (!pts.length) return ''
    const dots = s.values.map((v, i) => (v == null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${s.color}"/>`)).join('')
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${L}" y="26" font-size="14" font-weight="700" fill="#111827">${svgEscape(opts.title)}</text>
  ${legend}
  ${g}
  ${lines}
  </svg>`
}

function svgHBarChart(opts: {
  title: string
  labels: string[]
  values: Array<number | null>
  suffix?: string
  digits?: number
  color?: string
  maxBars?: number
}): string {
  const W = 700, L = 32, R = 150, T = 48, B = 18
  const rows = opts.labels
    .map((lb, i) => ({ lb, v: opts.values[i] }))
    .filter((r): r is { lb: string; v: number } => r.v != null)
    .slice(0, opts.maxBars ?? 20)
  if (!rows.length) return ''
  const max = Math.max(...rows.map((r) => r.v), 1)
  const rh = 24
  const H = T + rows.length * rh + B
  const bw = W - L - R
  const bars = rows.map((r, i) => {
    const y = T + i * rh
    const w = Math.max(2, (r.v / max) * bw)
    return `<text x="${L - 8}" y="${(y + 15).toFixed(0)}" text-anchor="end" font-size="11" fill="#374151">${svgEscape(truncate(String(r.lb), 24))}</text>` +
      `<rect x="${L}" y="${(y + 3).toFixed(0)}" width="${w.toFixed(1)}" height="16" rx="3" fill="${opts.color ?? '#2563eb'}"/>` +
      `<text x="${(L + w + 6).toFixed(0)}" y="${(y + 16).toFixed(0)}" font-size="11" font-weight="600" fill="#111827">${fmt(r.v, opts.suffix ?? '', opts.digits ?? 1)}</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${L}" y="26" font-size="14" font-weight="700" fill="#111827">${svgEscape(opts.title)}</text>
  ${bars}
  </svg>`
}

function svgVBarChart(opts: {
  title: string
  labels: string[]
  values: Array<number | null>
  suffix?: string
  digits?: number
  colors?: string[]
}): string {
  const W = 700, H = 340, L = 56, R = 24, T = 48, B = 46
  const rows = opts.labels.map((lb, i) => ({ lb, v: opts.values[i] })).filter((r): r is { lb: string; v: number } => r.v != null)
  if (!rows.length) return ''
  const max = Math.max(...rows.map((r) => r.v), 1)
  const iw = W - L - R, ih = H - T - B
  const slot = iw / rows.length
  const bw = Math.min(64, slot * 0.62)
  const bars = rows.map((r, i) => {
    const cx = L + slot * i + slot / 2
    const h = Math.max(2, (r.v / max) * ih)
    const yy = T + ih - h
    return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${opts.colors?.[i] ?? '#2563eb'}"/>` +
      `<text x="${cx.toFixed(1)}" y="${(yy - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="#111827">${fmt(r.v, opts.suffix ?? '', opts.digits ?? 0)}</text>` +
      `<text x="${cx.toFixed(1)}" y="${H - B + 16}" text-anchor="middle" font-size="10" fill="#6b7280">${svgEscape(truncate(String(r.lb), 12))}</text>`
  }).join('')
  let grid = ''
  for (let t = 0; t <= 4; t++) {
    const yy = T + (ih / 4) * t
    const val = max - (max / 4) * t
    grid += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${W - R}" y2="${yy.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>` +
      `<text x="${L - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#6b7280">${val.toFixed(0)}</text>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${L}" y="26" font-size="14" font-weight="700" fill="#111827">${svgEscape(opts.title)}</text>
  ${grid}
  ${bars}
  </svg>`
}

/** Rasterize an SVG to PNG via a hidden window (reuses the PDF-window path). */
async function svgToPng(svg: string, w: number, h: number): Promise<Buffer> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}</style></head><body>${svg}</body></html>`
  const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, backgroundColor: '#ffffff' })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    // let the SVG lay out before capturing
    await new Promise((r) => setTimeout(r, 180))
    const img = await win.webContents.capturePage()
    const png = img.toPNG()
    if (!png || png.length < 8) throw new Error('chart capture returned no pixels')
    return png
  } finally {
    win.destroy()
  }
}

interface ExcelChart {
  sheetName: string
  png: Buffer
  width: number
  height: number
  caption: string
}

/** Rasterized (PNG) charts — the fallback for native chart injection and the
 *  only chart for Executive Summary, whose KPI/value table is not columnar.
 *  One chart per relevant sheet, only when the section is in the pack, enabled
 *  in the chart config, and has data. */
async function buildExcelCharts(sections: SectionData[], charts: ReportChartConfig): Promise<ExcelChart[]> {
  const out: ExcelChart[] = []
  const byId = new Set(sections.map((s) => s.id))
  try {
    if (byId.has('kpi-trend') && charts.kpiTrend.enabled) {
      const h = await getHealth()
      const mv = await getNcMovement(8)
      const health = h.network.slice(-8)
      const labels = health.map((x) => x.asOf)
      if (labels.length >= 2) {
        const svg = svgLineChart({
          title: 'Network health & NC cells — weekly',
          labels,
          series: [
            { name: 'Health score', color: '#2563eb', values: health.map((x) => x.score) },
            { name: 'NC cells', color: '#dc2626', values: mv.slice(-labels.length).map((m) => m.ncCells) }
          ]
        })
        out.push({ sheetName: 'KPI Trend', png: await svgToPng(svg, 700, 340), width: 700, height: 340, caption: 'Network health score and NC cell count by ISO week.' })
      }
    }
    const barScopes: Array<{ scope: 'region' | 'district' | 'site'; sheetName: string; enabled: boolean; maxBars: number }> = [
      { scope: 'region', sheetName: 'Region Analysis', enabled: charts.region.enabled, maxBars: 15 },
      { scope: 'district', sheetName: 'District Analysis', enabled: charts.district.enabled, maxBars: 15 },
      { scope: 'site', sheetName: 'Site Analysis', enabled: charts.site.enabled, maxBars: 12 }
    ]
    for (const b of barScopes) {
      if (!byId.has(b.sheetName === 'Region Analysis' ? 'region-analysis' : b.sheetName === 'District Analysis' ? 'district-analysis' : 'site-analysis') || !b.enabled) continue
      const m = await getHealthMatrix(b.scope, { limit: 30 })
      const labels = m.rows.map((r) => r.name)
      const values = m.rows.map((r) => r.scores[r.scores.length - 1])
      if (labels.length >= 2) {
        const svg = svgHBarChart({
          title: `${b.scope.charAt(0).toUpperCase() + b.scope.slice(1)} health scores — latest week, worst first`,
          labels,
          values,
          digits: 0,
          maxBars: b.maxBars
        })
        out.push({ sheetName: b.sheetName, png: await svgToPng(svg, 700, 48 + b.maxBars * 24 + 18), width: 700, height: 48 + b.maxBars * 24 + 18, caption: `Rolled-up ${b.scope} health (worst first).` })
      }
    }
    if (byId.has('executive-summary') && charts.executive.enabled) {
      const h = await getHealth()
      const latest = h.network[h.network.length - 1]
      if (latest) {
        const svg = svgVBarChart({
          title: `Network health components — ${latest.asOf}`,
          labels: ['Capacity', 'Throughput', 'Availability', 'NC recurrence', 'Growth'],
          values: [latest.capacity, latest.throughput, latest.availability, latest.ncRecurrence, latest.growth],
          colors: ['#2563eb', '#7c3aed', '#059669', '#dc2626', '#d97706']
        })
        out.push({ sheetName: 'Executive Summary', png: await svgToPng(svg, 700, 340), width: 700, height: 340, caption: 'Transparent weighted health components (0–100).' })
      }
    }
  } catch {
    // charts are decorative — a rasterization failure must never fail the pack
  }
  return out
}

// --- native Excel chart objects (spec §53) -----------------------------------
// ExcelJS cannot author chart objects, so the pack renders its tables first and
// then injects real OOXML chart parts (line/bar charts referencing the sheet's
// data cells) into the xlsx zip. On any injection failure the rasterized PNGs
// already embedded in the workbook are kept — the PNG is the fallback.

interface NativeChartTarget {
  sheetName: string
  sheetIndex: number
  type: 'line' | 'bar'
  title: string
  headerRow: number
  rows: Array<Array<string | number | null>>
  catCol: number
  series: Array<{ name: string; col: number; values: Array<number | null> }>
}

function numCell(v: string | number | null): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

/** Decide which sheets get native chart objects, from the section tables
 *  (the charts reference the sheet's own cells, so the tables are the source). */
function buildNativeChartTargets(sections: SectionData[], charts: ReportChartConfig): NativeChartTarget[] {
  const out: NativeChartTarget[] = []
  const byId = new Map(sections.map((s) => [s.id, s.table]))
  const kt = byId.get('kpi-trend')
  if (kt && charts.kpiTrend.enabled && kt.rows.length >= 2) {
    const series = charts.kpiTrend.metric === 'nc'
      ? [{ name: 'NC cells', col: 6, values: kt.rows.map((r) => numCell(r[5])) }]
      : [
          { name: 'Health', col: 8, values: kt.rows.map((r) => numCell(r[7])) },
          { name: 'NC cells', col: 6, values: kt.rows.map((r) => numCell(r[5])) }
        ]
    out.push({
      sheetName: 'KPI Trend', sheetIndex: 0, type: 'line', title: 'KPI Trend — weekly health & NC cells',
      headerRow: 3, rows: kt.rows, catCol: 1, series
    })
  }
  const barScopes: Array<{ id: ReportSectionId; sheetName: string; enabled: boolean; title: string }> = [
    { id: 'region-analysis', sheetName: 'Region Analysis', enabled: charts.region.enabled, title: 'Region health scores — latest week, worst first' },
    { id: 'district-analysis', sheetName: 'District Analysis', enabled: charts.district.enabled, title: 'District health scores — latest week, worst first' },
    { id: 'site-analysis', sheetName: 'Site Analysis', enabled: charts.site.enabled, title: 'Site health scores — latest week, worst first' }
  ]
  for (const b of barScopes) {
    const tb = byId.get(b.id)
    if (tb && b.enabled && tb.rows.length >= 2) {
      out.push({
        sheetName: b.sheetName, sheetIndex: 0, type: 'bar', title: b.title,
        headerRow: 3, rows: tb.rows, catCol: 1,
        series: [{ name: 'Score', col: 2, values: tb.rows.map((r) => numCell(r[1])) }]
      })
    }
  }
  return out
}

function colLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function chartRef(sheetName: string, col: number, firstRow: number, lastRow: number): string {
  const L = colLetter(col)
  return `'${sheetName.replace(/'/g, "''")}'!$${L}$${firstRow}:$${L}$${lastRow}`
}

/** OOXML chart part (DrawingML): a line or clustered-bar chart whose series
 *  reference the sheet's data cells, with caches so Excel renders immediately. */
function chartXml(t: NativeChartTarget): string {
  const first = t.headerRow + 1
  const last = t.headerRow + t.rows.length
  const catRef = chartRef(t.sheetName, t.catCol, first, last)
  const catPts = t.rows.map((r, i) => (r[t.catCol - 1] == null ? '' : `<c:pt idx="${i}"><c:v>${escXml(String(r[t.catCol - 1]))}</c:v></c:pt>`)).join('')
  const catCount = t.rows.filter((r) => r[t.catCol - 1] != null).length
  const seriesXml = t.series.map((s, si) => {
    const valRef = chartRef(t.sheetName, s.col, first, last)
    const nameRef = chartRef(t.sheetName, s.col, t.headerRow, t.headerRow)
    const valPts = s.values.map((v, i) => (v == null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')
    const valCount = s.values.filter((v) => v != null).length
    return `<c:ser>
      <c:idx val="${si}"/>
      <c:order val="${si}"/>
      <c:tx><c:strRef><c:f>${nameRef}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${escXml(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>
      <c:cat><c:strRef><c:f>${catRef}</c:f><c:strCache><c:ptCount val="${catCount}"/>${catPts}</c:strCache></c:strRef></c:cat>
      <c:val><c:numRef><c:f>${valRef}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${valCount}"/>${valPts}</c:numCache></c:numRef></c:val>
    </c:ser>`
  }).join('')
  const plot = t.type === 'bar'
    ? `<c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
        ${seriesXml}
        <c:gapWidth val="120"/>
        <c:axId val="111111111"/>
        <c:axId val="222222222"/>
      </c:barChart>`
    : `<c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
        ${seriesXml}
        <c:marker val="1"/>
        <c:axId val="111111111"/>
        <c:axId val="222222222"/>
      </c:lineChart>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>${escXml(t.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
    <c:plotArea>
      <c:layout/>
      ${plot}
      <c:catAx>
        <c:axId val="111111111"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="222222222"/><c:crosses val="autoZero"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="222222222"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="111111111"/><c:crosses val="autoZero"/>
      </c:valAx>
    </c:plotArea>
    <c:legend><c:legendPos val="t"/><c:overlay val="0"/></c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`
}

function chartAnchorXml(id: number, rid: string, fromRow: number, toRow: number): string {
  return `<xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>11</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="Chart ${id}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rid}"/>
      </a:graphicData></a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>`
}

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL_DRAWING = `${REL_NS}/drawing`
const REL_CHART = `${REL_NS}/chart`

function nextRid(xml: string): number {
  return (xml.match(/Id="rId\d+"/g) || []).map((x) => Number(x.match(/\d+/)?.[0] ?? 0)).reduce((a, b) => Math.max(a, b), 0) + 1
}

/** Post-process the xlsx zip: add real chart parts + drawing anchors for every
 *  target sheet, replacing that sheet's rasterized PNG picture. Throws on any
 *  failure so the caller keeps the PNG fallback buffer. */
async function injectNativeCharts(data: Uint8Array, targets: NativeChartTarget[]): Promise<Uint8Array> {
  const jszip = require('jszip') as JSZipLike
  const zip = await jszip.loadAsync(data)
  let contentTypes = (await zip.file('[Content_Types].xml')?.async('string')) ?? ''
  const existingCharts = Object.keys(zip.files).filter((p) => /^xl\/charts\/chart\d+\.xml$/.test(p))
  let chartSeq = existingCharts.reduce((m, p) => Math.max(m, Number(p.match(/chart(\d+)\.xml/)?.[1] ?? 0)), 0) + 1
  const existingDrawings = Object.keys(zip.files).filter((p) => /^xl\/drawings\/drawing\d+\.xml$/.test(p))
  let drawingSeq = existingDrawings.reduce((m, p) => Math.max(m, Number(p.match(/drawing(\d+)\.xml/)?.[1] ?? 0)), 0) + 1

  for (const t of targets) {
    const sheetPath = `xl/worksheets/sheet${t.sheetIndex}.xml`
    let sheetXml = (await zip.file(sheetPath)?.async('string')) ?? ''
    if (!sheetXml) throw new Error(`sheet ${sheetPath} missing`)
    const sheetRelsPath = `xl/worksheets/_rels/sheet${t.sheetIndex}.xml.rels`
    let sheetRels = zip.file(sheetRelsPath) ? await zip.file(sheetRelsPath)!.async('string') : null

    // find the sheet's existing drawing (created by exceljs for the PNG chart)
    const drawRef = sheetXml.match(/<drawing r:id="([^"]+)"/)
    let drawingPath: string | null = null
    if (drawRef && sheetRels) {
      const rm = sheetRels.match(new RegExp(`<Relationship[^>]*Id="${drawRef[1]}"[^>]*Type="[^"]*/drawing"[^>]*Target="([^"]+)"`))
      if (rm) drawingPath = rm[1].startsWith('../') ? rm[1].slice(3) : rm[1]
    }

    const chartFile = `xl/charts/chart${chartSeq}.xml`
    zip.file(chartFile, chartXml(t))
    zip.file(
      `xl/charts/_rels/chart${chartSeq}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}"/>`
    )
    contentTypes = contentTypes.replace('</Types>', `<Override PartName="/${chartFile}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`)

    let drawingXml: string
    let chartRid: string
    if (drawingPath) {
      drawingXml = (await zip.file(drawingPath)?.async('string')) ?? ''
      // native chart replaces the rasterized PNG: drop picture anchors
      drawingXml = drawingXml.replace(/<xdr:twoCellAnchor[\s\S]*?<\/xdr:twoCellAnchor>/g, (block) => (block.includes('<xdr:pic') ? '' : block))
      const drawRelsPath = `xl/drawings/_rels/${drawingPath.split('/').pop()}.rels`
      let drawRels = (await zip.file(drawRelsPath)?.async('string')) ?? `<Relationships xmlns="${REL_NS}"/>`
      chartRid = `rId${nextRid(drawRels)}`
      zip.file(drawRelsPath, drawRels.replace('</Relationships>', `<Relationship Id="${chartRid}" Type="${REL_CHART}" Target="../charts/chart${chartSeq}.xml"/></Relationships>`))
    } else {
      // no drawing yet — create one and wire it into the sheet
      drawingPath = `xl/drawings/drawing${drawingSeq}.xml`
      const drawRelsPath = `xl/drawings/_rels/drawing${drawingSeq}.xml.rels`
      chartRid = 'rId1'
      drawingXml = `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>`
      zip.file(drawingPath, drawingXml)
      zip.file(drawRelsPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}"><Relationship Id="${chartRid}" Type="${REL_CHART}" Target="../charts/chart${chartSeq}.xml"/></Relationships>`)
      const newRid = `rId${nextRid(sheetRels ?? '')}`
      const sheetRelsNew = (sheetRels ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">`).replace('</Relationships>', `<Relationship Id="${newRid}" Type="${REL_DRAWING}" Target="../drawings/drawing${drawingSeq}.xml"/></Relationships>`)
      zip.file(sheetRelsPath, sheetRelsNew)
      sheetXml = sheetXml.replace(/<\/worksheet>/, `<drawing r:id="${newRid}"/></worksheet>`)
      contentTypes = contentTypes.replace('</Types>', `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.spreadsheetDrawing+xml"/></Types>`)
      drawingSeq++
    }

    const fromRow = t.headerRow + t.rows.length + 1
    drawingXml = drawingXml.replace(/<\/xdr:wsDr>/, `${chartAnchorXml(2000 + chartSeq, chartRid, fromRow, fromRow + 17)}</xdr:wsDr>`)
    zip.file(drawingPath, drawingXml)
    zip.file(sheetPath, sheetXml)
    chartSeq++
  }

  zip.file('[Content_Types].xml', contentTypes)
  const out = await zip.generateAsync({ type: 'nodebuffer' })
  return new Uint8Array(out)
}

async function renderExcel(
  outPath: string,
  name: string,
  sections: SectionData[],
  snapshot: ReportSnapshot,
  charts: ReportChartConfig
): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = '2G/3G/4G QoS Network Intelligence'
  wb.created = new Date()
  const sectionById = new Map(sections.map((s) => [s.id, s.table]))

  // native chart targets reference the tables; PNG charts are the fallback
  const nativeTargets = buildNativeChartTargets(sections, charts)
  const nativeBySheet = new Map(nativeTargets.map((t) => [t.sheetName, t]))
  const pngCharts = await buildExcelCharts(sections, charts)
  const chartBySheet = new Map(pngCharts.map((c) => [c.sheetName, c]))

  for (const [id, sheetName] of XLSX_SHEETS) {
    const ws = wb.addWorksheet(sheetName)
    const native = nativeBySheet.get(sheetName)
    if (native) native.sheetIndex = wb.worksheets.length
    const t = sectionById.get(id)
    const cols = t?.columns ?? ['Note']
    ws.addRow([name])
    ws.addRow([`Generated ${new Date().toISOString()} · ruleset v${snapshot.rulesetVersion ?? '—'} · as of ${snapshot.asOf} · scope ${snapshot.scope}`])
    const hdr = ws.addRow(cols)
    hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6FEB' } }
    if (t) {
      for (const row of t.rows) ws.addRow(row.map((c) => (c == null ? '' : c)))
      if (t.note) ws.addRow([t.note])
    } else {
      ws.addRow(['Section not selected for this pack.'])
    }
    ws.views = [{ state: 'frozen', ySplit: 2 }]
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: Math.max(1, cols.length) } }
    ws.columns = cols.map((_, i) => ({ width: xlsxWidth(t?.rows ?? [], cols, i) }))

    // embed the rasterized chart below the table; the native injection removes
    // it from native-charted sheets on success (PNG stays as the fallback)
    const chart = chartBySheet.get(sheetName)
    if (chart) {
      const anchorRow = Math.max(ws.rowCount + 2, 4)
      const imageId = wb.addImage({ base64: chart.png.toString('base64'), extension: 'png' })
      ws.addImage(imageId, {
        tl: { col: 0, row: anchorRow },
        ext: { width: chart.width, height: chart.height }
      })
      const captionRow = anchorRow + Math.ceil(chart.height / 20) + 1
      const cap = ws.getCell(captionRow, 1)
      cap.value = chart.caption
      cap.font = { italic: true, color: { argb: 'FF6B7280' }, size: 10 }
    }
  }

  // sheet 13: Import Metadata (spec §16 / §53)
  const meta = wb.addWorksheet('Import Metadata')
  meta.addRow([name])
  meta.addRow([`Generated ${new Date().toISOString()} · ruleset v${snapshot.rulesetVersion ?? '—'}`])
  const hdr = meta.addRow(['#', 'When', 'File', 'Source rows', 'Inserted', 'Duplicates', 'Rejected', 'Ruleset'])
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6FEB' } }
  const w = getCurrent()
  if (w) {
    const r = await w.connection.runAndReadAll(`
      SELECT CAST(import_id AS DOUBLE) AS import_id, CAST(imported_at AS VARCHAR) AS imported_at,
        files, CAST(source_rows AS DOUBLE) AS source_rows, CAST(inserted_rows AS DOUBLE) AS inserted_rows,
        CAST(duplicates_ignored AS DOUBLE) AS duplicates_ignored, CAST(rejected_rows AS DOUBLE) AS rejected_rows,
        CAST(ruleset_version AS DOUBLE) AS ruleset_version
      FROM import_audit ORDER BY import_id DESC LIMIT 100
    `)
    for (const row of r.getRowObjects()) {
      meta.addRow([
        Number(row.import_id), String(row.imported_at ?? ''), String(row.files ?? ''),
        Number(row.source_rows ?? 0), Number(row.inserted_rows ?? 0),
        Number(row.duplicates_ignored ?? 0), Number(row.rejected_rows ?? 0),
        row.ruleset_version == null ? '' : Number(row.ruleset_version)
      ])
    }
  }
  meta.views = [{ state: 'frozen', ySplit: 2 }]
  meta.columns = Array.from({ length: 8 }, (_, i) => ({ width: xlsxWidth([], ['#', 'When', 'File', 'Source', 'Inserted', 'Dupes', 'Rejected', 'Ruleset'], i) }))

  const buf = await wb.xlsx.writeBuffer()
  let bytes: Uint8Array = new Uint8Array(buf)
  // native editable chart objects (§53); PNG rasterizations remain the fallback
  // if the OOXML injection fails for any reason
  if (nativeTargets.length > 0) {
    try {
      bytes = await injectNativeCharts(bytes, nativeTargets)
    } catch (e) {
      console.warn('native chart injection failed, keeping PNG fallback:', e instanceof Error ? e.message : String(e))
    }
  }
  writeFileSync(outPath, bytes)
}

// --- PowerPoint deck (spec §54) ----------------------------------------------

const PPTX_SLIDES: Array<[string, ReportSectionId]> = [
  ['KPI Trend', 'kpi-trend'],
  ['Region Analysis', 'region-analysis'],
  ['District Analysis', 'district-analysis'],
  ['Site Analysis', 'site-analysis'],
  ['Priority Queue', 'priority-queue'],
  ['Forecast Risk', 'forecast-risk'],
  ['Lifecycle Analysis', 'lifecycle-analysis']
]

const DARK = '0E121A'
const CARD = '131B2E'
const ACCENT = '38BDF8'
const TEXT = 'D7DDE8'
const MUTED = '8B95A7'

function pptxTable(t: SectionTable | undefined): Array<Array<{ text: string; options?: Record<string, unknown> }>> {
  if (!t) return [[{ text: 'Note' }], [{ text: 'Section not selected for this pack.' }]]
  const out: Array<Array<{ text: string; options?: Record<string, unknown> }>> = [
    t.columns.map((c) => ({ text: c, options: { bold: true } }))
  ]
  for (const r of t.rows.slice(0, 40)) {
    out.push(r.map((c) => ({ text: String(c ?? '—') })))
  }
  return out
}

async function renderPptx(
  outPath: string,
  name: string,
  sections: SectionData[],
  snapshot: ReportSnapshot
): Promise<void> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  pptx.author = '2G/3G/4G QoS Network Intelligence'
  pptx.title = name
  const sectionById = new Map(sections.map((s) => [s.id, s.table]))

  // 1. cover
  const cover = pptx.addSlide()
  cover.background = { color: DARK }
  cover.addText(name, { x: 0.6, y: 1.5, w: 9.2, h: 1.2, fontSize: 34, bold: true, color: 'FFFFFF' })
  cover.addText('2G/3G/4G QoS Network Intelligence — Reporting Center', { x: 0.6, y: 2.8, w: 9.2, h: 0.5, fontSize: 16, color: ACCENT })
  cover.addText(
    `Generated ${new Date().toISOString()} · scope ${snapshot.scope} · as of ${snapshot.asOf} · ruleset v${snapshot.rulesetVersion ?? '—'}`,
    { x: 0.6, y: 3.5, w: 9.2, h: 0.4, fontSize: 12, color: MUTED }
  )
  cover.addText(snapshot.note, { x: 0.6, y: 4.1, w: 9.2, h: 1.0, fontSize: 11, color: MUTED })

  // 2. executive summary
  const exec = pptx.addSlide()
  exec.background = { color: DARK }
  exec.addText('Executive Summary', { x: 0.4, y: 0.3, w: 9.2, h: 0.5, fontSize: 22, bold: true, color: 'FFFFFF' })
  const bullets = [
    `Network health score: ${snapshot.kpis.healthScore ?? '—'} / 100`,
    `Average PRB: ${snapshot.kpis.avgPrb ?? '—'}% · Availability: ${snapshot.kpis.avgAvailability ?? '—'}%`,
    `DL throughput: ${snapshot.kpis.avgThroughputKbps == null ? '—' : `${(snapshot.kpis.avgThroughputKbps / 1024).toFixed(1)} Mbps`}`,
    `NC cells: ${snapshot.ncCount}`,
    `Classified: ${Object.entries(snapshot.classifications).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
    ...Object.entries(snapshot.thresholds).map(([k, v]) => `Threshold ${k}: ${v == null ? '—' : v}`)
  ]
  exec.addText(bullets.map((b) => ({ text: b })), { x: 0.6, y: 1.0, w: 8.8, h: 5.4, fontSize: 14, color: TEXT, breakLine: true })

  // 3-9. section tables
  for (const [title, id] of PPTX_SLIDES) {
    const slide = pptx.addSlide()
    slide.background = { color: DARK }
    slide.addText(title, { x: 0.4, y: 0.3, w: 9.2, h: 0.5, fontSize: 22, bold: true, color: 'FFFFFF' })
    slide.addTable(pptxTable(sectionById.get(id)), {
      x: 0.4, y: 1.0, w: 9.2, h: 5.4,
      fontSize: 9, color: TEXT, fill: { color: CARD },
      border: { pt: 0.5, color: '263041' },
      rowH: 0.22
    })
  }

  // 10. recommended focus / meta
  const focus = pptx.addSlide()
  focus.background = { color: DARK }
  focus.addText('Recommended Focus', { x: 0.4, y: 0.3, w: 9.2, h: 0.5, fontSize: 22, bold: true, color: 'FFFFFF' })
  focus.addText(
    [
      `${snapshot.ncCount} NC cells under the active ruleset — escalate persistent NC first.`,
      `Network health ${snapshot.kpis.healthScore ?? '—'}/100; watch districts above the ${snapshot.thresholds.districtNc ?? 10}% NC threshold.`,
      `Generated by 2G/3G/4G QoS Network Intelligence — Reporting Center (spec §51–56).`
    ].map((b) => ({ text: b })),
    { x: 0.6, y: 1.2, w: 8.8, h: 4.0, fontSize: 14, color: TEXT, breakLine: true }
  )

  await pptx.writeFile({ fileName: outPath })
}

// --- pack generation ---------------------------------------------------------

async function buildSnapshot(): Promise<ReportSnapshot> {
  const s = await getSummary()
  const rules = await getRulesCurrent()
  const latestHealth = (await getHealth()).network.slice(-1)[0]
  const nc = await getNcLifecycle()
  return {
    scope: 'network',
    asOf: nc.weekStart ?? '—',
    rulesetVersion: rules?.version ?? null,
    thresholds: {
      prb: rules?.prbThresholdPct ?? 80,
      availability: 99.5,
      throughput: 10_000,
      districtNc: rules?.districtNcThresholdPct ?? 10
    },
    kpis: {
      avgPrb: s?.avgPrb ?? null,
      avgThroughputKbps: s?.avgThroughputKbps ?? null,
      totalUsers: s?.totalUsers ?? null,
      totalVolumeMb: s?.totalVolumeMb ?? null,
      avgAvailability: s?.avgAvailability ?? null,
      healthScore: latestHealth?.score ?? null
    },
    classifications: nc.byLifecycle,
    ncCount: nc.ncCells,
    note: `Snapshot frozen at generation time: thresholds, KPIs, classifications and ruleset v${rules?.version ?? '—'} are embedded in every format.`
  }
}

const SCHEDULE_DAYS: Record<string, number> = { weekly: 7, monthly: 30, quarterly: 91 }

/** Spec §56: schedules are app-local; on open the app detects definitions
 *  whose next run is due (never generated, or lastGenerated older than the
 *  schedule interval) and offers generation. */
export async function checkDueReports(): Promise<DueReport[]> {
  const defs = await listReportDefinitions()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due: DueReport[] = []
  for (const d of defs) {
    const days = SCHEDULE_DAYS[d.schedule ?? '']
    if (!days) continue
    let last: Date | null = null
    if (d.lastGenerated) {
      last = new Date(d.lastGenerated)
      last.setHours(0, 0, 0, 0)
    }
    if (last) {
      const next = new Date(last)
      next.setDate(next.getDate() + days)
      next.setHours(0, 0, 0, 0)
      if (next > today) continue // not due yet
      const overdueDays = Math.max(0, Math.round((today.getTime() - next.getTime()) / 86400000))
      due.push({ definitionId: d.id, name: d.name, type: d.type, schedule: d.schedule ?? '', lastGenerated: d.lastGenerated, nextDue: next.toISOString().slice(0, 10), overdueDays })
    } else {
      due.push({ definitionId: d.id, name: d.name, type: d.type, schedule: d.schedule ?? '', lastGenerated: null, nextDue: today.toISOString().slice(0, 10), overdueDays: 0 })
    }
  }
  return due.sort((a, b) => b.overdueDays - a.overdueDays || a.name.localeCompare(b.name))
}

export async function generateReportPack(opts: ReportOpts = {}): Promise<ReportPack> {
  const w = getCurrent()
  if (!w) throw new Error('Open a workspace before generating a report')
  let type: ReportType = opts.type ?? 'executive'
  let sections: ReportSectionId[] =
    opts.sections && opts.sections.length > 0
      ? opts.sections
      : REPORT_SECTIONS.filter((s) => s.defaultFor.includes(type)).map((s) => s.id)
  const formats: ReportFormat[] = opts.formats && opts.formats.length > 0 ? opts.formats : ['md', 'csv', 'html', 'pdf']
  let charts: ReportChartConfig = opts.charts ?? { ...DEFAULT_CHARTS }
  // a scheduled run inherits the definition's name, type, sections and charts (§56)
  let defName: string | null = null
  if (opts.definitionId != null) {
    const r = await w.connection.runAndReadAll(
      `SELECT name, template, config FROM report_definitions WHERE report_id = ?`,
      [opts.definitionId]
    )
    const row = r.getRowObjects()[0]
    if (row) {
      defName = String(row.name ?? null)
      if (!opts.type) type = (String(row.template ?? type) as ReportType) || type
      const cfg = parseDefConfig(row.config)
      if (!opts.sections?.length && Array.isArray(cfg.sections) && cfg.sections.length > 0) sections = cfg.sections
      if (!opts.charts && cfg.charts) charts = cfg.charts
    }
  }
  const name = opts.name?.trim() || defName || `Report ${type.charAt(0).toUpperCase() + type.slice(1)}`
  const slug = name.replace(/[^A-Za-z0-9_-]+/g, '_').toLowerCase() || 'report'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const id = `${slug}-${stamp}`

  const snapshot = await buildSnapshot()

  // gather section data (a failing section degrades to a note, never kills the pack)
  const sectionData: SectionData[] = []
  for (const id2 of sections) {
    const builder = SECTION_BUILDERS[id2]
    try {
      const def = REPORT_SECTIONS.find((s) => s.id === id2)
      const table = builder ? await builder() : { title: def?.label ?? id2, columns: ['Note'], rows: [['Section not implemented']] }
      sectionData.push({ id: id2, table })
    } catch (e) {
      sectionData.push({
        id: id2,
        table: {
          title: REPORT_SECTIONS.find((s) => s.id === id2)?.label ?? id2,
          columns: ['Note'],
          rows: [[`Section unavailable: ${e instanceof Error ? e.message : String(e)}`]]
        }
      })
    }
  }

  const md = renderMarkdown(name, sectionData, snapshot)
  const csv = renderCsv(name, sectionData)
  const html = renderHtml(name, sectionData, snapshot)

  const files: ReportPack['files'] = {}
  if (formats.includes('md')) {
    const path = join(exportsDir(), `${id}.md`)
    writeFileSync(path, md, 'utf8')
    files.md = { path, content: md }
  }
  if (formats.includes('csv')) {
    const path = join(exportsDir(), `${id}.csv`)
    writeFileSync(path, csv, 'utf8')
    files.csv = { path, content: csv }
  }
  if (formats.includes('html')) {
    const path = join(exportsDir(), `${id}.html`)
    writeFileSync(path, html, 'utf8')
    files.html = { path, content: html }
  }
  if (formats.includes('pdf')) {
    try {
      const path = join(exportsDir(), `${id}.pdf`)
      await renderPdf(html, path)
      files.pdf = { path, content: `PDF written to ${path}` }
    } catch (e) {
      files.pdf = { path: '', content: `PDF failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  if (formats.includes('xlsx')) {
    try {
      const path = join(exportsDir(), `${id}.xlsx`)
      await renderExcel(path, name, sectionData, snapshot, charts)
      files.xlsx = { path, content: `Excel written to ${path}` }
    } catch (e) {
      files.xlsx = { path: '', content: `Excel failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  if (formats.includes('pptx')) {
    try {
      const path = join(exportsDir(), `${id}.pptx`)
      await renderPptx(path, name, sectionData, snapshot)
      files.pptx = { path, content: `PowerPoint written to ${path}` }
    } catch (e) {
      files.pptx = { path: '', content: `PowerPoint failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  // track in the history manifest
  const historyRow: ReportHistoryRow = {
    id,
    name,
    type,
    sections,
    formats,
    rulesetVersion: snapshot.rulesetVersion,
    createdAt: new Date().toISOString(),
    path: join(exportsDir(), `${id}.md`)
  }
  const history = readHistory()
  history.unshift(historyRow)
  writeHistory(history.slice(0, 200))

  // a scheduled run marks the definition as generated (spec §56)
  if (opts.definitionId != null) {
    const r = await w.connection.runAndReadAll(
      `SELECT report_id, config FROM report_definitions WHERE report_id = ?`,
      [opts.definitionId]
    )
    const row = r.getRowObjects()[0]
    if (row) {
      const cfg = parseDefConfig(row.config)
      cfg.lastGenerated = new Date().toISOString()
      cfg.lastPackId = id
      await w.connection.run(
        `UPDATE report_definitions SET config = ? WHERE report_id = ?`,
        [JSON.stringify(cfg), opts.definitionId]
      )
    }
  }

  return { id, name, type, sections, formats, files, rulesetVersion: snapshot.rulesetVersion, asOf: snapshot.asOf, snapshot }
}

async function renderPdf(html: string, outPath: string): Promise<void> {
  const win = new BrowserWindow({ show: false, width: 1200, height: 900 })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const buf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', landscape: false })
    writeFileSync(outPath, buf)
  } finally {
    win.destroy()
  }
}

// --- templates + history -----------------------------------------------------

export interface ReportDefinitionLike {
  id: number
  name: string
  type: ReportType
  sections: ReportSectionId[]
  schedule: string | null
  charts: ReportChartConfig
  lastGenerated: string | null
  createdAt: string
}

interface DefConfig {
  sections?: ReportSectionId[]
  charts?: ReportChartConfig
  lastGenerated?: string
  lastPackId?: string
}

function parseDefConfig(raw: unknown): DefConfig {
  try {
    const c = JSON.parse(String(raw ?? '{}')) as DefConfig
    return c && typeof c === 'object' ? c : {}
  } catch {
    return {}
  }
}

export async function listReportDefinitions(): Promise<ReportDefinitionLike[]> {
  const w = getCurrent()
  if (!w) return []
  const r = await w.connection.runAndReadAll(
    `SELECT report_id, name, template, config, schedule, CAST(created_at AS VARCHAR) AS created_at
     FROM report_definitions ORDER BY report_id`
  )
  return r.getRowObjects().map((x) => {
    const config = parseDefConfig(x.config)
    return {
      id: Number(x.report_id),
      name: String(x.name ?? ''),
      type: (String(x.template ?? 'custom') as ReportType) || 'custom',
      sections: Array.isArray(config.sections) ? (config.sections as ReportSectionId[]) : [],
      schedule: x.schedule ? String(x.schedule) : null,
      charts: config.charts ?? { ...DEFAULT_CHARTS },
      lastGenerated: config.lastGenerated ?? null,
      createdAt: String(x.created_at ?? '')
    }
  })
}

export async function saveReportDefinition(
  name: string,
  type: ReportType,
  sections: ReportSectionId[],
  schedule: string | null = null,
  charts: ReportChartConfig = { ...DEFAULT_CHARTS }
): Promise<ReportDefinitionLike> {
  const w = getCurrent()
  if (!w) throw new Error('Open a workspace before saving a report template')
  await w.connection.run(
    `INSERT INTO report_definitions (name, template, config, schedule) VALUES (?, ?, ?, ?)`,
    [name, type, JSON.stringify({ sections, charts }), schedule]
  )
  const r = await w.connection.runAndReadAll(
    `SELECT report_id, name, template, config, schedule, CAST(created_at AS VARCHAR) AS created_at
     FROM report_definitions ORDER BY report_id DESC LIMIT 1`
  )
  const x = r.getRowObjects()[0]
  const config = parseDefConfig(x.config)
  return {
    id: Number(x.report_id),
    name: String(x.name ?? name),
    type: (String(x.template ?? type) as ReportType) || type,
    sections: [...sections],
    schedule,
    charts: config.charts ?? charts,
    lastGenerated: null,
    createdAt: String(x.created_at ?? '')
  }
}

function historyPath(): string {
  return join(exportsDir(), 'report-history.json')
}

export function readHistory(): ReportHistoryRow[] {
  try {
    if (!existsSync(historyPath())) return []
    return JSON.parse(readFileSync(historyPath(), 'utf8')) as ReportHistoryRow[]
  } catch {
    return []
  }
}

function writeHistory(rows: ReportHistoryRow[]): void {
  writeFileSync(historyPath(), JSON.stringify(rows, null, 2), 'utf8')
}

export async function listReportHistory(): Promise<ReportHistoryRow[]> {
  const rows = readHistory()
  return rows.map((r) => ({ ...r, formats: r.formats.filter((f) => f !== 'pdf' || existsSync(join(exportsDir(), `${r.id}.pdf`))) }))
}

export function revealReport(path: string): void {
  shell.showItemInFolder(path)
}
