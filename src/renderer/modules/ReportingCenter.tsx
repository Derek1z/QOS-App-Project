import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store'
import type {
  ReportChartConfig, ReportDefinition, ReportFormat, ReportHistoryRow, ReportPack,
  ReportSectionId, ReportType
} from '../../../shared/api'
import { DEFAULT_CHARTS, REPORT_SECTIONS, REPORT_TYPES } from '../../../shared/api'

const FORMATS: Array<{ id: ReportFormat; label: string; hint: string }> = [
  { id: 'md', label: 'Markdown', hint: '.md' },
  { id: 'csv', label: 'CSV (Excel)', hint: '.csv' },
  { id: 'html', label: 'HTML', hint: '.html' },
  { id: 'pdf', label: 'PDF', hint: '.pdf' },
  { id: 'xlsx', label: 'Excel 13-sheet', hint: '.xlsx' },
  { id: 'pptx', label: 'PowerPoint', hint: '.pptx' }
]

const SCHEDULES = ['', 'weekly', 'monthly', 'quarterly'] as const

function defaultSections(type: ReportType): ReportSectionId[] {
  return REPORT_SECTIONS.filter((s) => s.defaultFor.includes(type)).map((s) => s.id)
}

function Chip({ text, tone }: { text: string; tone: string }): React.JSX.Element {
  return <span className={`chip chip-${tone}`}>{text}</span>
}

function fmtVal(v: number | null | undefined, digits = 1): string {
  return v == null ? '—' : Number(v).toFixed(digits)
}

export default function ReportingCenter(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  // window.api is assigned by boot() after static imports, so read it lazily
  const isDemo = useMemo(() => !!(window.api as { demo?: boolean }).demo, [])
  const [type, setType] = useState<ReportType>('executive')
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('')
  const [formats, setFormats] = useState<ReportFormat[]>(['md', 'csv', 'html', 'pdf'])
  const [charts, setCharts] = useState<ReportChartConfig>({ ...DEFAULT_CHARTS })
  const [sections, setSections] = useState<ReportSectionId[]>(() => defaultSections('executive'))
  const [defs, setDefs] = useState<ReportDefinition[]>([])
  const [history, setHistory] = useState<ReportHistoryRow[]>([])
  const [pack, setPack] = useState<ReportPack | null>(null)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState('')
  const [previewOpen, setPreviewOpen] = useState(true)

  useEffect(() => {
    setSections(defaultSections(type))
  }, [type])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [d, h] = await Promise.all([window.api.reports.definitions(), window.api.reports.history()])
        if (!alive) return
        setDefs(d)
        setHistory(h)
      } catch {
        /* demo/desktop both fine */
      }
    })()
    return () => {
      alive = false
    }
  }, [workspace?.path])

  const typeLabel = useMemo(() => REPORT_TYPES.find((t) => t.id === type)?.label ?? type, [type])

  function toggleSection(id: ReportSectionId): void {
    setSections((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  function moveSection(id: ReportSectionId, dir: -1 | 1): void {
    setSections((prev) => {
      const i = prev.indexOf(id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function applyDefinition(d: ReportDefinition): void {
    setType(d.type)
    setSections([...d.sections])
    setName(d.name)
    setSchedule(d.schedule ?? '')
    setCharts(d.charts ? { ...d.charts } : { ...DEFAULT_CHARTS })
    setSavedMsg(`Template “${d.name}” applied.`)
  }

  async function generate(): Promise<void> {
    setGenerating(true)
    setError(null)
    try {
      const p = await window.api.reports.generate({
        type,
        sections,
        name: name || undefined,
        formats,
        charts
      })
      setPack(p)
      setPreviewOpen(true)
      setHistory(await window.api.reports.history())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }

  async function saveTemplate(): Promise<void> {
    if (!name.trim()) {
      setSavedMsg('Give the template a name first.')
      return
    }
    setSaving(true)
    try {
      const d = await window.api.reports.saveDefinition(name.trim(), type, sections, schedule || null, charts)
      setDefs(await window.api.reports.definitions())
      setSavedMsg(`Template “${d.name}” saved.`)
    } finally {
      setSaving(false)
    }
  }

  const snapshot = pack?.snapshot
  const previewHtml = pack?.files.html?.content ?? null
  const previewMd = pack?.files.md?.content ?? null

  return (
    <div className="module">
      <div className="module-head">
        <h2>Reporting Center</h2>
        <span className="module-workspace">{workspace?.name}</span>
        {pack && (
          <span className="module-workspace">
            {pack.name} · {pack.sections.length} sections · as of {pack.asOf}
          </span>
        )}
      </div>

      {error && <div className="status-error">{error}</div>}

      <div className="row-actions filter-row">
        <div className="seg">
          {REPORT_TYPES.map((t) => (
            <button
              key={t.id}
              className={`seg-btn${type === t.id ? ' active' : ''}`}
              onClick={() => setType(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          className="input rc-name"
          placeholder={`Report name (default: Report ${typeLabel})`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select className="input" value={schedule} onChange={(e) => setSchedule(e.target.value)}>
          <option value="">No schedule</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
        </select>
        <button className="btn" disabled={generating} onClick={() => void generate()}>
          {generating ? 'Generating…' : '⚡ Generate pack'}
        </button>
      </div>

      {/* formats */}
      <div className="rc-formats">
        <span className="rc-label">Formats:</span>
        {FORMATS.map((f) => {
          const on = formats.includes(f.id)
          return (
            <button
              key={f.id}
              className={`rc-format${on ? ' on' : ''}`}
              title={f.id === 'pdf' && isDemo ? '.pdf · desktop only' : f.hint}
              onClick={() => setFormats((prev) => (on ? prev.filter((x) => x !== f.id) : [...prev, f.id]))}
            >
              {on ? '☑' : '☐'} {f.label}
            </button>
          )
        })}
      </div>

      {/* charts (spec §53): which Excel sheets get a native chart + the KPI
          Trend metric. Persisted with templates, honored at generation. */}
      <div className="rc-formats">
        <span className="rc-label">Excel charts:</span>
        <button
          className={`rc-format${charts.kpiTrend.enabled ? ' on' : ''}`}
          title="Native editable line chart on the KPI Trend sheet"
          onClick={() => setCharts((c) => ({ ...c, kpiTrend: { ...c.kpiTrend, enabled: !c.kpiTrend.enabled } }))}
        >
          {charts.kpiTrend.enabled ? '☑' : '☐'} KPI Trend
        </button>
        <select
          className="sched-select"
          title="KPI Trend chart metric"
          value={charts.kpiTrend.metric}
          onChange={(e) => setCharts((c) => ({ ...c, kpiTrend: { ...c.kpiTrend, metric: e.target.value as 'health' | 'nc' } }))}
        >
          <option value="health">Health + NC cells</option>
          <option value="nc">NC cells</option>
        </select>
        <button
          className={`rc-format${charts.executive.enabled ? ' on' : ''}`}
          title="Component bar chart on the Executive Summary sheet"
          onClick={() => setCharts((c) => ({ ...c, executive: { enabled: !c.executive.enabled } }))}
        >
          {charts.executive.enabled ? '☑' : '☐'} Executive
        </button>
        <button
          className={`rc-format${charts.region.enabled ? ' on' : ''}`}
          title="Native bar chart on the Region Analysis sheet"
          onClick={() => setCharts((c) => ({ ...c, region: { enabled: !c.region.enabled } }))}
        >
          {charts.region.enabled ? '☑' : '☐'} Region
        </button>
        <button
          className={`rc-format${charts.district.enabled ? ' on' : ''}`}
          title="Native bar chart on the District Analysis sheet"
          onClick={() => setCharts((c) => ({ ...c, district: { enabled: !c.district.enabled } }))}
        >
          {charts.district.enabled ? '☑' : '☐'} District
        </button>
        <button
          className={`rc-format${charts.site.enabled ? ' on' : ''}`}
          title="Native bar chart on the Site Analysis sheet"
          onClick={() => setCharts((c) => ({ ...c, site: { enabled: !c.site.enabled } }))}
        >
          {charts.site.enabled ? '☑' : '☐'} Site
        </button>
      </div>

      <div className="rc-grid">
        {/* builder: sections + templates */}
        <div className="card rc-builder">
          <div className="card-head-row">
            <h3>Report builder — sections</h3>
            <button className="btn btn-sm" onClick={() => setSections(defaultSections(type))}>
              Reset to {typeLabel} defaults
            </button>
          </div>
          <div className="rc-sections">
            {REPORT_SECTIONS.map((s) => {
              const on = sections.includes(s.id)
              const idx = sections.indexOf(s.id)
              return (
                <div key={s.id} className={`rc-section${on ? ' on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleSection(s.id)}
                  />
                  <div className="rc-section-body">
                    <div className="rc-section-label">{s.label}</div>
                    <div className="rc-section-blurb">{s.blurb}</div>
                  </div>
                  <div className="rc-section-order">
                    <button className="btn btn-sm" disabled={idx <= 0} onClick={() => moveSection(s.id, -1)} title="Move up">↑</button>
                    <button className="btn btn-sm" disabled={idx < 0 || idx >= sections.length - 1} onClick={() => moveSection(s.id, 1)} title="Move down">↓</button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="rc-save-row">
            <input
              className="input"
              placeholder="Template name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn btn-sm" disabled={saving || !name.trim()} onClick={() => void saveTemplate()}>
              {saving ? 'Saving…' : 'Save template'}
            </button>
            {defs.length > 0 && (
              <select
                className="input"
                value=""
                onChange={(e) => {
                  const d = defs.find((x) => x.id === Number(e.target.value))
                  if (d) applyDefinition(d)
                }}
              >
                <option value="">Apply saved template…</option>
                {defs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.type}{d.schedule ? ` · ${d.schedule}` : ''})
                  </option>
                ))}
              </select>
            )}
            {savedMsg && <span className="rc-saved">{savedMsg}</span>}
          </div>
        </div>

        {/* result: snapshot + files + preview */}
        <div className="rc-result">
          {!pack ? (
            <div className="card rc-empty">
              <h3>No report generated yet</h3>
              <p className="card-note">
                Choose a report type, tweak the sections, and hit Generate. Packs freeze a
                snapshot — scope, thresholds, KPIs, classifications and ruleset version (§55)
                — and render Markdown, CSV (Excel), styled HTML, PDF, a 13-sheet Excel pack
                (§53) and an editable PowerPoint deck (§54).
              </p>
            </div>
          ) : (
            <>
              <div className="card">
                <div className="card-head-row">
                  <h3>Snapshot (§55)</h3>
                  <span className="card-note">{pack.id}</span>
                </div>
                {snapshot && (
                  <>
                    <div className="rc-snap-strip">
                      <span>As of <b>{snapshot.asOf}</b></span>
                      <span>Ruleset <b>v{snapshot.rulesetVersion ?? '—'}</b></span>
                      <span>Scope <b>{snapshot.scope}</b></span>
                      <span>NC cells <b>{snapshot.ncCount}</b></span>
                      <span>Health <b>{fmtVal(snapshot.kpis.healthScore)}</b></span>
                      <span>PRB <b>{fmtVal(snapshot.kpis.avgPrb)}%</b></span>
                      <span>Availability <b>{fmtVal(snapshot.kpis.avgAvailability)}%</b></span>
                    </div>
                    <div className="rc-snap-note">{snapshot.note}</div>
                    <div className="rc-snap-table">
                      <table className="data-table">
                        <thead><tr><th>Threshold</th><th>Value</th></tr></thead>
                        <tbody>
                          {Object.entries(snapshot.thresholds).map(([k, v]) => (
                            <tr key={k}><td>{k}</td><td>{v == null ? '—' : String(v)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                      <table className="data-table">
                        <thead><tr><th>Classification</th><th>Cells</th></tr></thead>
                        <tbody>
                          {Object.entries(snapshot.classifications).map(([k, v]) => (
                            <tr key={k}><td>{k}</td><td>{String(v)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                <div className="rc-files">
                  {FORMATS.filter((f) => formats.includes(f.id)).map((f) => {
                    const file = pack.files[f.id]
                    const ok = !!file?.path
                    return (
                      <div key={f.id} className={`rc-file${ok ? ' ok' : ''}`}>
                        <span className="rc-file-fmt">{f.label}</span>
                        <span className="rc-file-path">{file?.path || file?.content || 'not generated'}</span>
                        {ok && !isDemo && (
                          <button className="btn btn-sm" onClick={() => void window.api.reports.reveal(file.path)}>
                            Reveal
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="card">
                <div className="card-head-row">
                  <h3>Preview</h3>
                  <button className="btn btn-sm" onClick={() => setPreviewOpen(!previewOpen)}>
                    {previewOpen ? 'Hide' : 'Show'}
                  </button>
                </div>
                {previewOpen && previewHtml && (
                  <iframe
                    className="rc-preview"
                    title={`${pack.name} preview`}
                    srcDoc={previewHtml}
                    sandbox=""
                  />
                )}
                {previewOpen && !previewHtml && previewMd && (
                  <pre className="rc-preview rc-preview-md">{previewMd}</pre>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* history */}
      <div className="card">
        <div className="card-head-row">
          <h3>Report history (§56)</h3>
          <span className="card-note">{history.length} packs</span>
        </div>
        {history.length === 0 ? (
          <div className="pc-empty">No reports generated yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Generated</th>
                  <th>Ruleset</th>
                  <th>Sections</th>
                  <th>Formats</th>
                  <th>Path</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 12).map((r) => (
                  <tr key={r.id}>
                    <td className="rc-hist-name">{r.name}</td>
                    <td><Chip text={r.type} tone={r.type === 'executive' ? 'ok' : 'dim'} /></td>
                    <td className="rc-hist-date">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="num">v{r.rulesetVersion ?? '—'}</td>
                    <td className="num">{r.sections.length}</td>
                    <td>{r.formats.map((f) => <Chip key={f} text={f.toUpperCase()} tone="dim" />)}</td>
                    <td className="rc-hist-path">{r.path}</td>
                    <td>
                      <button
                        className="btn btn-sm"
                        title="Regenerate this pack"
                        onClick={() => {
                          setType(r.type)
                          setSections([...r.sections])
                          setName(r.name)
                          setFormats(r.formats.includes('pdf') ? [...FORMATS.map((f) => f.id)] : r.formats.filter((f) => f !== 'pdf'))
                          void generate()
                        }}
                      >
                        ⟳
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
