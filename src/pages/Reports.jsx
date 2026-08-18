import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { jobToServiceReport, fmtDuration, syncServiceReport } from '../lib/jobReport'
import { viewablePhotoUrl } from '../lib/photoUrl'
import StorageImage from '../components/StorageImage'
import { useLang, fill } from '../hooks/useLang'
import toast from 'react-hot-toast'

function typeBadge(type, tr) {
  return type === 'retroativo'
    ? <span className="badge badge-amber">{tr.typeRetro}</span>
    : <span className="badge badge-green">{tr.typeLive}</span>
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

  useEffect(() => { loadReports() }, [filterDays, lang])

  const loadReports = async () => {
    setLoading(true)
    const sinceIso = new Date(Date.now() - filterDays * 86400000).toISOString()
    const sinceDate = sinceIso.split('T')[0]

    const { data: srData, error: srErr } = await supabase
      .from('service_reports')
      .select('*')
      .gte('report_date', sinceDate)
      .order('created_at', { ascending: false })
      .limit(100)

    if (!srErr && srData?.length) {
      setReports(srData)
      setLoading(false)
      return
    }

    const { data: jobs, error: jobErr } = await supabase
      .from('jobs')
      .select('*')
      .eq('status', 'completed')
      .gte('completed_at', sinceIso)
      .order('completed_at', { ascending: false })
      .limit(100)

    if (jobErr) {
      toast.error(jobErr.message)
      setReports([])
      setLoading(false)
      return
    }

    const mapped = (jobs || []).map(j => jobToServiceReport(j, lang))
    setReports(mapped)
    setLoading(false)

    // Backfill service_reports in background
    for (const j of jobs || []) {
      syncServiceReport(supabase, j).catch(() => {})
    }
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

    const [{ error: srErr }, { error: jobErr }] = await Promise.all([
      supabase.from('service_reports').delete().eq('job_id', report.job_id),
      supabase.from('jobs').delete().eq('id', report.job_id),
    ])
    if (jobErr) { toast.error(jobErr.message); return }
    if (srErr) toast.error(srErr.message)

    setReports(prev => prev.filter(r => r.job_id !== report.job_id))
    if (selected?.job_id === report.job_id) setSelected(null)
    toast.success(tr.deleted)
  }

  const runAiAnalysis = async () => {
    setAiLoading(true)
    setAiAnalysis('')
    try {
      const resp = await fetch('/api/analyze-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: filterDays, employeeName: filterEmp || undefined, lang }),
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
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{tr.period}</div>
          <select value={filterDays} onChange={e => setFilterDays(Number(e.target.value))} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
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
        <div style={{ marginLeft: 'auto' }}>
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.job_id}>
                    <td style={{ fontWeight: 500 }}>{r.employee_name}</td>
                    <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.client_name || r.job_title}</td>
                    <td>{r.report_date}</td>
                    <td>{typeBadge(r.report_type, tr)}</td>
                    <td>{fmtDuration(r.duration_min, lang)}</td>
                    <td>{r.checklist_total ? `${r.checklist_done || 0}/${r.checklist_total}` : '—'}</td>
                    <td>{r.photo_ai_score != null ? `${r.photo_ai_score}/10` : (r.photo_after_url || r.photo_before_url) ? '📷' : '—'}</td>
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
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{selected.employee_name} · {selected.report_date}</div>
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
                <div className="grid-2" style={{ gap: 8 }}>
                  {selected.photo_before_url && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{tr.before}</div>
                      <StorageImage url={selected.photo_before_url} alt={tr.before} onClick={() => setLightbox(selected.photo_before_url)} />
                      <a href={viewablePhotoUrl(selected.photo_before_url)} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ marginTop: 6, width: '100%' }}>{tr.openFullscreen}</a>
                    </div>
                  )}
                  {selected.photo_after_url && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{tr.after}</div>
                      <StorageImage url={selected.photo_after_url} alt={tr.after} onClick={() => setLightbox(selected.photo_after_url)} />
                      <a href={viewablePhotoUrl(selected.photo_after_url)} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ marginTop: 6, width: '100%' }}>{tr.openFullscreen}</a>
                    </div>
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

      {lightbox && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setLightbox(null)}
        >
          <button onClick={() => setLightbox(null)} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>✕ {tr.close}</button>
          <img
            src={viewablePhotoUrl(lightbox)}
            alt=""
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 8, objectFit: 'contain' }}
          />
        </div>
      )}
    </div>
  )
}
