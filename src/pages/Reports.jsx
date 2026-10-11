import { ReportsAnalytics } from '../components/AnalyticsCharts'
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDuration, fmtTime, syncServiceReport, mergeReportWithJob, reportNeedsPhotoSync, jobToReportView } from '../lib/jobReport'
import SignatureImage from '../components/SignatureImage'
import { tokyoToday } from '../lib/dates'
import { viewablePhotoUrl } from '../lib/photoUrl'
import JobPhotos from '../components/JobPhotos'
import PhotoLightbox from '../components/PhotoLightbox'
import { useLang, fill } from '../hooks/useLang'
import { apiPost } from '../lib/apiFetch'
import toast from 'react-hot-toast'

function typeBadge(type, tr) {
  return type === 'retroativo'
    ? <span className="badge badge-amber">{tr.typeRetro}</span>
    : <span className="badge badge-green">{tr.typeLive}</span>
}

const mapUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`

function GpsBlock({ r, tr, lang }) {
  const rows = [
    [tr.gpsIn, r.started_at, r.gps_lat_in, r.gps_lng_in, r.gps_acc_in, r.gps_dist_in],
    [tr.gpsOut, r.completed_at, r.gps_lat_out, r.gps_lng_out, r.gps_acc_out, r.gps_dist_out],
  ]
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>{tr.gpsTitle}</div>
      <div className="grid-2" style={{ gap: 8 }}>
        {rows.map(([label, at, lat, lng, acc, dist]) => (
          <div key={label} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 600 }}>{label} · {at ? fmtTime(at, lang) : '—'}</div>
            {lat != null && lng != null ? (
              <>
                <div style={{ color: 'var(--text3)' }}>{Number(lat).toFixed(5)}, {Number(lng).toFixed(5)}{acc != null ? ` (±${Math.round(acc)} m)` : ''}</div>
                {dist != null && <div style={{ color: Number(dist) > 150 ? 'var(--red)' : 'var(--text3)' }}>{fill(tr.gpsFromSite, { m: Math.round(dist) })}</div>}
                <a href={mapUrl(lat, lng)} target="_blank" rel="noreferrer">{tr.openMap} ↗</a>
              </>
            ) : <div style={{ color: 'var(--text3)' }}>{tr.gpsNone}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function typeLabel(type, tr) {
  return type === 'retroativo' ? tr.typeRetro : tr.typeLive
}

export default function Reports() {
  const { lang, t } = useLang()
  const tr = t.reports
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [filterEmp, setFilterEmp] = useState('')
  const [filterDays, setFilterDays] = useState(30)
  const [aiAnalysis, setAiAnalysis] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [filterDay, setFilterDay] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)

  useEffect(() => { loadReports() }, [filterDays, filterDay, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadReports = async () => {
    setLoading(true)
    const sinceIso = new Date(Date.now() - filterDays * 86400000).toISOString()
    const sinceDate = sinceIso.split('T')[0]

    // The list starts from the JOBS, so every job shows up even when service_reports
    // has no row for it yet (before v1.0.14 the list used service_reports only as soon
    // as it had any row, and the other completed jobs disappeared from the report).
    const jobsQuery = filterDay
      ? supabase.from('jobs').select('*').eq('scheduled_date', filterDay).neq('status', 'cancelled').order('scheduled_time', { ascending: true }).limit(500)
      : supabase.from('jobs').select('*').eq('status', 'completed').gte('completed_at', sinceIso).order('completed_at', { ascending: false }).limit(500)
    const srQuery = filterDay
      ? supabase.from('service_reports').select('*').eq('report_date', filterDay).limit(500)
      : supabase.from('service_reports').select('*').gte('report_date', sinceDate).order('created_at', { ascending: false }).limit(500)

    const [{ data: srData, error: srErr }, { data: jobs, error: jobErr }] = await Promise.all([srQuery, jobsQuery])

    if (srErr && jobErr) {
      toast.error(jobErr.message || srErr.message)
      setReports([])
      setLoading(false)
      return
    }

    const srByJob = Object.fromEntries((srData || []).filter(r => r.job_id).map(r => [r.job_id, r]))
    const rows = (jobs || []).map(j => srByJob[j.id] ? mergeReportWithJob(srByJob[j.id], j, lang) : jobToReportView(j, lang))

    // service_reports whose job is outside this query (e.g. completed late) still count
    const seen = new Set((jobs || []).map(j => j.id))
    const orphans = (srData || []).filter(r => !r.job_id || !seen.has(r.job_id))
    if (orphans.length) {
      const ids = orphans.map(r => r.job_id).filter(Boolean)
      const { data: extraJobs } = ids.length ? await supabase.from('jobs').select('*').in('id', ids) : { data: [] }
      const extraById = Object.fromEntries((extraJobs || []).map(j => [j.id, j]))
      for (const r of orphans) rows.push(extraById[r.job_id] ? mergeReportWithJob(r, extraById[r.job_id], lang) : r)
    }

    rows.sort((x, y) => filterDay
      ? String(x.started_at || x.time_in || '').localeCompare(String(y.started_at || y.time_in || ''))
      : String(y.completed_at || y.created_at || '').localeCompare(String(x.completed_at || x.created_at || '')))
    setReports(rows)

    for (const j of jobs || []) {
      if (j.status !== 'completed') continue
      const r = srByJob[j.id]
      if (!r || reportNeedsPhotoSync(r, j)) syncServiceReport(supabase, j).catch(() => {})
    }

    setLoading(false)
  }

  const downloadDayPdf = async () => {
    if (!filterDay) return toast.error(tr.dayPdfNeedsDay)
    const ids = filtered.map(r => r.job_id).filter(Boolean)
    if (!ids.length) return toast.error(tr.empty)
    setPdfBusy(true)
    try {
      const { data: dayJobs, error } = await supabase.from('jobs').select('*').in('id', ids)
      if (error) throw error
      const order = new Map(ids.map((id, i) => [id, i]))
      const sorted = (dayJobs || []).sort((a, b) => order.get(a.id) - order.get(b.id))
      const { generateDailyReport } = await import('../lib/generatePDF')
      const doc = await generateDailyReport(filterDay, sorted, filterEmp || (lang === 'ja' ? '全スタッフ' : 'All staff'), { showEmployee: !filterEmp })
      doc.save(`report_${filterDay}${filterEmp ? '_' + filterEmp.replace(/\s+/g, '_') : ''}.pdf`)
      toast.success(tr.dayPdfReady)
    } catch (e) {
      toast.error(e.message)
    }
    setPdfBusy(false)
  }

  const employees = useMemo(() =>
    [...new Set(reports.map(r => r.employee_name).filter(Boolean))].sort(),
  [reports])

  const filtered = useMemo(() =>
    filterEmp ? reports.filter(r => r.employee_name === filterEmp) : reports,
  [reports, filterEmp])

  const stats = useMemo(() => {
    const withDur = filtered.filter(r => r.duration_min != null)
    const avg = withDur.length
      ? Math.round(withDur.reduce((s, r) => s + r.duration_min, 0) / withDur.length)
      : null
    const byEmp = {}
    withDur.forEach(r => {
      if (!byEmp[r.employee_name]) byEmp[r.employee_name] = []
      byEmp[r.employee_name].push(r.duration_min)
    })
    return { total: filtered.length, avg, byEmp }
  }, [filtered])

  const handleDelete = async (report) => {
    const label = `${report.employee_name} · ${report.client_name || report.job_title} · ${report.report_date}`
    if (!confirm(fill(tr.deleteConfirm, { label }))) return

    const { error: srErr } = await supabase.from('service_reports').delete().eq('job_id', report.job_id)
    if (srErr) { toast.error(srErr.message); return }

    setReports(prev => prev.filter(r => r.job_id !== report.job_id))
    if (selected?.job_id === report.job_id) setSelected(null)
    toast.success(tr.deleted)
  }

  const runAiAnalysis = async () => {
    setAiLoading(true)
    setAiAnalysis('')
    try {
      const resp = await apiPost('/api/analyze-reports', {
        days: filterDays,
        employeeName: filterEmp || undefined,
        lang,
      })
      const data = await resp.json()
      if (data.error) throw new Error(data.error)
      setAiAnalysis(data.analysis)
      toast.success(fill(tr.analysisReady, { count: data.count }))
    } catch (e) {
      toast.error(e.message)
    }
    setAiLoading(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ opacity: filterDay ? 0.45 : 1 }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{tr.period}</div>
          <select disabled={!!filterDay} value={filterDays} onChange={e => setFilterDays(Number(e.target.value))} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
            <option value={7}>{tr.days7}</option>
            <option value={30}>{tr.days30}</option>
            <option value={90}>{tr.days90}</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{tr.employee}</div>
          <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', minWidth: 160 }}>
            <option value="">{tr.all}</option>
            {employees.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{tr.day}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="date" value={filterDay} onChange={e => setFilterDay(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)' }} />
            {filterDay
              ? <button className="btn btn-sm" onClick={() => setFilterDay('')}>{tr.anyDay}</button>
              : <button className="btn btn-sm" onClick={() => setFilterDay(tokyoToday())}>{lang === 'ja' ? '今日' : 'Today'}</button>}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {filterDay && <button className="btn" onClick={downloadDayPdf} disabled={pdfBusy || !filtered.length}>{pdfBusy ? tr.loading : tr.dayPdf}</button>}
          <button className="btn btn-primary" onClick={runAiAnalysis} disabled={aiLoading || !filtered.length}>
            {aiLoading ? tr.analyzing : tr.aiAnalyze}
          </button>
        </div>
      </div>

      <div className="grid-3" style={{ gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ margin: 0, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{tr.reports}</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.total}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{tr.avgTime}</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtDuration(stats.avg, lang)}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{tr.employees}</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{Object.keys(stats.byEmp).length}</div>
        </div>
      </div>

      <ReportsAnalytics reports={filtered} />

      {aiAnalysis && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #c19c56' }}>
          <div className="card-title">{tr.aiTitle}</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{aiAnalysis}</div>
        </div>
      )}

      <div className="card">
        <div className="card-title">{tr.serviceReports}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
          {tr.autoHint}
        </div>
        {loading && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{tr.loading}</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>{tr.empty}</div>
        )}
        {filtered.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tr.colEmployee}</th>
                  <th>{tr.colLocation}</th>
                  <th>{tr.colDate}</th>
                  <th>{tr.colType}</th>
                  <th>{tr.colDuration}</th>
                  <th>{tr.colChecklist}</th>
                  <th>{tr.colAiPhoto}</th>
                  <th>{tr.colSignature}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.job_id}>
                    <td style={{ fontWeight: 500 }}>{r.employee_name}</td>
                    <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.client_name || r.job_title}</td>
                    <td>{r.report_date}</td>
                    <td>{r.job_status && r.job_status !== 'completed' ? <span className="badge badge-red">{tr.pendingJob}</span> : typeBadge(r.report_type, tr)}</td>
                    <td>{fmtDuration(r.duration_min, lang)}</td>
                    <td>{r.checklist_total ? `${r.checklist_done || 0}/${r.checklist_total}` : '—'}</td>
                    <td>
                      {r.photo_ai_score != null && <span style={{ marginRight: 6 }}>{r.photo_ai_score}/10</span>}
                      {(r.photo_after_url || r.photo_before_url) ? (
                        <JobPhotos
                          photoStartUrl={r.photo_before_url}
                          photoEndUrl={r.photo_after_url}
                          beforeLabel={tr.before}
                          afterLabel={tr.after}
                          size={44}
                          onPhotoClick={setLightbox}
                        />
                      ) : (r.photo_ai_score == null ? '—' : null)}
                    </td>
                    <td><SignatureImage url={r.signature_url} height={34} emptyLabel={r.job_status && r.job_status !== 'completed' ? '—' : tr.noSignature} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm" onClick={() => setSelected(r)}>{tr.read}</button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(r)}>{tr.delete}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setSelected(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.job_title || selected.client_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{selected.employee_name} · {selected.report_date}{selected.area ? ` · ${tr.area}: ${selected.area}` : ''}</div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>

            <div className="grid-2" style={{ gap: 8, marginBottom: 14 }}>
              {[
                [tr.start, selected.time_in],
                [tr.end, selected.time_out],
                [tr.duration, fmtDuration(selected.duration_min, lang)],
                [tr.type, typeLabel(selected.report_type, tr)],
                [tr.checklist, selected.checklist_total ? `${selected.checklist_done}/${selected.checklist_total}` : '—'],
                [tr.value, selected.job_value ? `¥${Number(selected.job_value).toLocaleString()}` : '—'],
              ].map(([l, v]) => (
                <div key={l} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{l}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{v || '—'}</div>
                </div>
              ))}
            </div>

            <GpsBlock r={selected} tr={tr} lang={lang} />

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>{tr.signature}</div>
              <SignatureImage url={selected.signature_url} height={90} emptyLabel={tr.noSignature} />
            </div>

            {selected.notes_out && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{tr.employeeReport}</div>
                <div style={{ fontSize: 13, background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px', lineHeight: 1.5 }}>{selected.notes_out}</div>
              </div>
            )}

            {selected.retro_ai_summary && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{tr.aiRetro}</div>
                <div style={{ fontSize: 13, background: 'rgba(193,156,86,0.1)', borderRadius: 8, padding: '10px 12px' }}>{selected.retro_ai_summary}</div>
              </div>
            )}

            {selected.checklist_missed_items && (
              <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--red)' }}>{tr.missedItems}: {selected.checklist_missed_items}</div>
            )}

            {selected.photo_ai_issues && (
              <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text3)' }}>{tr.photoIssues}: {selected.photo_ai_issues}</div>
            )}

            {(selected.photo_before_url || selected.photo_after_url) && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>{tr.servicePhotos}</div>
                <JobPhotos
                  photoStartUrl={selected.photo_before_url}
                  photoEndUrl={selected.photo_after_url}
                  beforeLabel={tr.before}
                  afterLabel={tr.after}
                  variant="full"
                  onPhotoClick={setLightbox}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {selected.photo_before_url && (
                    <a href={viewablePhotoUrl(selected.photo_before_url)} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ flex: 1 }}>{tr.openFullscreen} ({tr.before})</a>
                  )}
                  {selected.photo_after_url && (
                    <a href={viewablePhotoUrl(selected.photo_after_url)} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ flex: 1 }}>{tr.openFullscreen} ({tr.after})</a>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-danger" onClick={() => handleDelete(selected)}>🗑 {tr.deleteReport}</button>
            </div>
          </div>
        </div>
      )}

      <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} closeLabel={tr.close} />
    </div>
  )
}
