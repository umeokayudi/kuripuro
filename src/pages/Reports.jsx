import { ReportsAnalytics } from '../components/AnalyticsCharts'
import { useState, useEffect, useMemo, useRef } from 'react'
import ProgressChart from '../components/ProgressChart'
import { confirmAndRun } from '../components/ConfirmDialog'
import { gradeJobPhoto } from '../lib/photoAi'
import { contractForAgendaJob, expectedMinutes } from '../lib/agenda'
import { aiScoreView, aiReasonShort } from '../lib/aiScore'
import { withDeadline } from '../lib/exceptionQueue'
import { exceptionDeadline } from '../lib/exceptionText'
import { supabase } from '../lib/supabase'
import { fmtDuration, syncServiceReport, mergeReportWithJob, reportNeedsPhotoSync, jobToReportView } from '../lib/jobReport'
import SignatureImage from '../components/SignatureImage'
import { tokyoToday } from '../lib/dates'
import JobPhotos from '../components/JobPhotos'
import { VideoMark } from '../components/JobVideos'
import ReportSheet from '../components/ReportSheet'
import { executionMode, jobNoteCount } from '../lib/reportSheet'
import PhotoLightbox from '../components/PhotoLightbox'
import { useLang, fill, pickLang } from '../hooks/useLang'
import { apiPost } from '../lib/apiFetch'
import { useAuth } from '../hooks/useAuth'
import JobCountStrip from '../components/JobCountStrip'
import toast from 'react-hot-toast'
import { useSearchParams } from 'react-router-dom'
import { peekVideoStatus } from '../lib/jobVideo'
import ReportFilterBar from '../components/ReportFilterBar'
import DayStoresReport from '../components/DayStoresReport'
import {
  periodRange, rangeDays, rangeIso, typeNeedsOpenJobs, rowKind, matchesType, rowProblems, matchesProblems,
  placeOf, matchesSearch, sortRows, isOpenRow, filtersFromParams, filtersToParams, activeFilterCount, PROBLEMS,
} from '../lib/reportFilters'

function typeBadge(type, tr, job, lang) {
  if (job && executionMode(job) === 'manual') return <span className="badge badge-amber">🔒 {pickLang(lang, 'Closed by admin', '管理者が完了', 'Fechamento manual')}</span>
  return type === 'retroativo'
    ? <span className="badge badge-amber">{tr.typeRetro}</span>
    : <span className="badge badge-green">{tr.typeLive}</span>
}


// Admin's own signature for the bottom of the day report PDF. Saved on admins.signature_url;
// until that column exists it is kept on this device only.
const adminSigKey = id => `kp_admin_signature_${id || 'admin'}`

async function loadAdminSignature(user) {
  if (!user?.id) return null
  const { data, error } = await supabase.from('admins').select('signature_url').eq('id', user.id).maybeSingle()
  if (!error && data?.signature_url) return data.signature_url
  try { return localStorage.getItem(adminSigKey(user.id)) } catch { return null }
}

async function saveAdminSignature(user, dataUrl) {
  try { localStorage.setItem(adminSigKey(user?.id), dataUrl) } catch {}
  if (!user?.id) return false
  const { error } = await supabase.from('admins').update({ signature_url: dataUrl }).eq('id', user.id)
  return !error
}

function AdminSignaturePad({ tr, current, onSave, onCancel }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)
  const paper = () => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height)
  }
  useEffect(() => { paper() }, [])
  const pos = e => {
    const c = canvasRef.current, r = c.getBoundingClientRect()
    const t = e.touches ? e.touches[0] : e
    return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) }
  }
  const start = e => {
    e.preventDefault()
    drawing.current = true
    const ctx = canvasRef.current.getContext('2d'), p = pos(e)
    ctx.strokeStyle = '#0f2747'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath(); ctx.moveTo(p.x, p.y)
  }
  const move = e => {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d'), p = pos(e)
    ctx.lineTo(p.x, p.y); ctx.stroke()
    setHasInk(true)
  }
  const end = () => { drawing.current = false }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onCancel}>
      <div style={{ background: '#fff', color: '#122033', borderRadius: 16, padding: 18, width: 'min(460px,100%)' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{tr.adminSigTitle}</div>
        <div style={{ fontSize: 12, color: '#5c6573', marginBottom: 10 }}>{tr.adminSigHint}</div>
        {current && !hasInk && (
          <div style={{ fontSize: 11, color: '#5c6573', marginBottom: 6 }}>{tr.adminSigCurrent} <img src={current} alt="" style={{ height: 32, verticalAlign: 'middle', border: '1px solid #e3e8f0', borderRadius: 4 }} /></div>
        )}
        <div style={{ border: '1px solid #cfd8e6', borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
          <canvas ref={canvasRef} width={420} height={170} style={{ width: '100%', height: 170, display: 'block', touchAction: 'none' }}
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
          {!hasInk && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9aa6b8', fontSize: 14, pointerEvents: 'none' }}>{tr.adminSigHere}</div>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: current ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: 8, marginTop: 12 }}>
          <button type="button" className="btn" onClick={() => { paper(); setHasInk(false) }}>{tr.adminSigClear}</button>
          <button type="button" className="btn" onClick={onCancel}>{tr.adminSigCancel}</button>
          {current && <button type="button" className="btn" onClick={() => onSave(null)}>{tr.adminSigKeep}</button>}
          <button type="button" className="btn btn-primary" disabled={!hasInk} onClick={() => onSave(canvasRef.current.toDataURL('image/png'))}>✓ {tr.adminSigSave}</button>
        </div>
      </div>
    </div>
  )
}

function typeLabel(type, tr) {
  return type === 'retroativo' ? tr.typeRetro : tr.typeLive
}

// Phone width: the list becomes cards (no sideways scrolling)
function useNarrow(max = 700) {
  const q = `(max-width: ${max}px)`
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(q).matches)
  useEffect(() => {
    const m = window.matchMedia?.(q)
    if (!m) return
    const on = () => setNarrow(m.matches)
    m.addEventListener?.('change', on)
    return () => m.removeEventListener?.('change', on)
  }, [q])
  return narrow
}

const noteCountOf = r => r._job ? jobNoteCount(r._job) : (r.notes_out ? 1 : 0)

export default function Reports() {
  const { lang, t } = useLang()
  const tr = t.reports
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  // v1.0.141 · every filter lives in the URL (?emp=…&p=7&pb=long,lowai) — survives reload and can be shared
  const [params, setParams] = useSearchParams()
  const f = useMemo(() => filtersFromParams(params), [params])
  const setF = patch => setParams(filtersToParams({ ...f, ...(typeof patch === 'function' ? patch(f) : patch) }), { replace: true })
  const today = tokyoToday()
  const range = useMemo(() => periodRange(f.period, today, f), [f.period, f.from, f.to, today]) // eslint-disable-line react-hooks/exhaustive-deps
  const filterEmp = f.emp
  const filterClient = f.client
  const includeOpen = typeNeedsOpenJobs(f.type) || f.problems.includes('open')
  const filterDay = range.from === range.to ? range.from : ''
  const filterDays = rangeDays(range)
  const [clientList, setClientList] = useState([])
  const [contractList, setContractList] = useState([])
  const [regrading, setRegrading] = useState(null)
  useEffect(() => {
    supabase.from('clients').select('id,company_name').eq('is_active', true).order('company_name').then(({ data }) => setClientList(data || []))
    supabase.from('service_contracts').select('*').then(({ data }) => setContractList(data || []))
  }, [])
  const [aiAnalysis, setAiAnalysis] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const { user } = useAuth()
  const narrow = useNarrow()
  const [adminSig, setAdminSig] = useState(null)
  const [sigPad, setSigPad] = useState(false)

  useEffect(() => { loadAdminSignature(user).then(setAdminSig) }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadReports() }, [range.from, range.to, includeOpen, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadReports = async () => {
    setLoading(true)
    const { fromIso, toIso } = rangeIso(range)

    // The list starts from the JOBS, so every job shows up even when service_reports
    // has no row for it yet (before v1.0.14 the list used service_reports only as soon
    // as it had any row, and the other completed jobs disappeared from the report).
    const jobsQuery = filterDay
      ? supabase.from('jobs').select('*').eq('scheduled_date', filterDay).neq('status', 'cancelled').order('scheduled_time', { ascending: true }).limit(500)
      : includeOpen
        ? supabase.from('jobs').select('*').gte('scheduled_date', range.from).lte('scheduled_date', range.to).neq('status', 'cancelled').order('scheduled_date', { ascending: false }).limit(1000)
        : supabase.from('jobs').select('*').eq('status', 'completed').gte('completed_at', fromIso).lt('completed_at', toIso).order('completed_at', { ascending: false }).limit(1000)
    const srQuery = filterDay
      ? supabase.from('service_reports').select('*').eq('report_date', filterDay).limit(500)
      : supabase.from('service_reports').select('*').gte('report_date', range.from).lte('report_date', range.to).order('created_at', { ascending: false }).limit(1000)

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

    setReports(rows)

    for (const j of jobs || []) {
      if (j.status !== 'completed') continue
      const r = srByJob[j.id]
      if (!r || reportNeedsPhotoSync(r, j)) syncServiceReport(supabase, j).catch(() => {})
    }

    setLoading(false)
  }

  // First PDF without a saved admin signature asks for one; the pad then continues the download.
  const onAdminSig = async (dataUrl) => {
    const fromDownload = sigPad === 'download'
    setSigPad(false)
    let sig = adminSig
    if (dataUrl) {
      await saveAdminSignature(user, dataUrl)
      setAdminSig(dataUrl)
      sig = dataUrl
      toast.success(tr.adminSigSaved)
    }
    if (fromDownload) downloadDayPdf(sig, true)
  }

  const downloadDayPdf = async (sigOverride, skipAsk) => {
    if (!filterDay) return toast.error(tr.dayPdfNeedsDay)
    const sig = typeof sigOverride === 'string' ? sigOverride : adminSig
    if (!sig && skipAsk !== true) return setSigPad('download')
    const ids = filtered.map(r => r.job_id).filter(Boolean)
    if (!ids.length) return toast.error(tr.empty)
    setPdfBusy(true)
    try {
      const { data: dayJobs, error } = await supabase.from('jobs').select('*').in('id', ids)
      if (error) throw error
      const order = new Map(ids.map((id, i) => [id, i]))
      const sorted = (dayJobs || []).sort((a, b) => order.get(a.id) - order.get(b.id))
      const { generateDailyReport } = await import('../lib/generatePDF')
      const doc = await generateDailyReport(filterDay, sorted, filterEmp || pickLang(lang, 'All staff', '全スタッフ', 'Todos os funcionários'), { showEmployee: !filterEmp, adminName: user?.name || '', adminSignature: sig || null })
      doc.save(`report_${filterDay}${filterEmp ? '_' + filterEmp.replace(/\s+/g, '_') : ''}.pdf`)
      toast.success(tr.dayPdfReady)
    } catch (e) {
      toast.error(e.message)
    }
    setPdfBusy(false)
  }

  const clientOfReport = r => r.client_id || contractForAgendaJob({ title: r.job_title || r.location_name || '' }, contractList)?.client_id || ''

  // v1.0.141 · video status of every row (small status file, 4 at a time, cached) so "no video" can be filtered
  const [videoMap, setVideoMap] = useState({})
  useEffect(() => {
    let alive = true
    const pending = {}
    let timer = null
    const flush = () => { timer = null; if (alive) setVideoMap(m => ({ ...m, ...pending })) }
    for (const r of reports) {
      if (!r.job_id || isOpenRow(r)) continue
      peekVideoStatus(r.job_id).then(st => {
        pending[r.job_id] = st || null
        if (!timer) timer = setTimeout(flush, 250)
      })
    }
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [reports])

  // v1.0.115 · same rule as the exception queue: > 2× the planned time, or never started → owner + deadline
  const rowException = r => {
    const job = r._job || { title: r.job_title, scheduled_date: r.report_date }
    const date = job.scheduled_date || r.report_date
    if (r.job_status && r.job_status !== 'completed') return { kind: 'incomplete', ...withDeadline('incomplete', date, tokyoToday()) }
    const planned = expectedMinutes(job, contractForAgendaJob(job, contractList))
    if (planned && r.duration_min != null && r.duration_min > 2 * planned) return { kind: 'long', planned, ...withDeadline('long', date, tokyoToday()) }
    return null
  }
  const L3 = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const noProblems = L3('no problems', '問題なし', 'sem problemas')

  // one pass per row: everything the filters need
  const enriched = useMemo(() => reports.map(r => {
    const exception = rowException(r)
    const kind = rowKind(r, r._job ? executionMode(r._job) : undefined)
    const problems = rowProblems(r, { exception, videoStatus: r.job_id ? videoMap[r.job_id] : null, notes: noteCountOf(r) })
    return { r, exception, kind, problems, place: placeOf(r), client: clientOfReport(r) }
  }), [reports, videoMap, contractList]) // eslint-disable-line react-hooks/exhaustive-deps

  const pass = (x, skip) =>
    (skip === 'emp' || !filterEmp || x.r.employee_name === filterEmp)
    && (skip === 'client' || !filterClient || x.client === filterClient)
    && (skip === 'place' || !f.place || x.place === f.place)
    && (skip === 'type' || matchesType(f.type, x.kind))
    && (skip === 'problems' || matchesProblems(f.problems, x.problems))
    && matchesSearch(f.q, x.r)

  const filtered = useMemo(() =>
    sortRows(enriched.filter(x => pass(x)).map(x => x.r), f.sort, { singleDay: !!filterDay }),
  [enriched, f, filterDay]) // eslint-disable-line react-hooks/exhaustive-deps

  // counts next to each option = what you would get by picking it (other filters kept)
  const facets = useMemo(() => {
    const emp = {}, place = {}, client = {}, type = {}, problem = Object.fromEntries(PROBLEMS.map(p => [p, 0]))
    let empAll = 0, problemAny = 0
    for (const x of enriched) {
      if (pass(x, 'emp')) { empAll++; const n = x.r.employee_name || ''; if (n) emp[n] = (emp[n] || 0) + 1 }
      if (pass(x, 'place') && x.place) place[x.place] = (place[x.place] || 0) + 1
      if (pass(x, 'client') && x.client) client[x.client] = (client[x.client] || 0) + 1
      if (pass(x, 'type')) type[x.kind] = (type[x.kind] || 0) + 1
      if (pass(x, 'problems')) {
        problemAny += x.problems.size ? 1 : 0
        for (const p of x.problems) problem[p] = (problem[p] || 0) + 1
      }
    }
    return { emp, empAll, place, client, type, problem, problemAny }
  }, [enriched, f]) // eslint-disable-line react-hooks/exhaustive-deps
  const videoPending = reports.some(r => r.job_id && !isOpenRow(r) && !(r.job_id in videoMap))

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
    const ok = await confirmAndRun({
      title: pickLang(lang, 'Delete report?', '報告書を削除しますか？', 'Excluir report?'),
      message: fill(tr.deleteConfirm, { label }),
      success: tr.deleted,
      run: () => supabase.from('service_reports').delete().eq('job_id', report.job_id),
    })
    if (!ok) return
    setReports(prev => prev.filter(r => r.job_id !== report.job_id))
    if (selected?.job_id === report.job_id) setSelected(null)
  }

  const runAiAnalysis = async () => {
    setAiLoading(true)
    setAiAnalysis('')
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 90000)
      const resp = await apiPost('/api/analyze-reports', {
        days: filterDays,
        employeeName: filterEmp || undefined,
        // v1.0.115 · exactly the jobs on screen (period / day / employee / client filters)
        jobIds: filtered.map(r => r.job_id).filter(Boolean).slice(0, 200),
        lang,
      }, { signal: ctrl.signal }).finally(() => clearTimeout(timer))
      const data = await resp.json()
      if (data.error) throw new Error(data.error)
      setAiAnalysis(data.analysis)
      toast.success(fill(tr.analysisReady, { count: data.count }))
    } catch (e) {
      toast.error(e?.name === 'AbortError' ? pickLang(lang, 'The AI took too long — try again.', 'AIの応答が遅すぎます。再試行してください。', 'A IA demorou demais — tente de novo.') : e.message)
    }
    setAiLoading(false)
  }

  // v1.0.133 · same job count as Dashboard / Serviços for the period of this screen (by scheduled day)
  const countFrom = range.from
  const countTo = range.to
  return (
    <div>
      <JobCountStrip from={countFrom} to={countTo} />
      {/* v1.0.151 · opens on TODAY grouped by store, same counter as the Painel do Dia; Não feitos always visible */}
      <DayStoresReport f={f} setF={setF} range={range} today={today} lang={lang} L={L3} />
      <ReportFilterBar
        f={f} setF={setF} reset={() => setParams({}, { replace: true })}
        today={today} range={range} lang={lang}
        facets={facets} clients={clientList} videoPending={videoPending}
        total={reports.length} shown={filtered.length} loading={loading}
        actions={<>
          <button className="btn btn-sm" onClick={() => setSigPad('edit')} title={tr.adminSigTitle}>✍️ {adminSig ? tr.adminSigChange : tr.adminSigAdd}</button>
          {filterDay && <button className="btn btn-sm" onClick={() => downloadDayPdf()} disabled={pdfBusy || !filtered.length}>{pdfBusy ? tr.loading : tr.dayPdf}</button>}
          <button className="btn btn-sm btn-primary" onClick={runAiAnalysis} disabled={aiLoading || !filtered.length}>
            {aiLoading ? tr.analyzing : tr.aiAnalyze}
          </button>
        </>}
      />

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
        <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #315cf5' }}>
          <div className="card-title">{tr.aiTitle}</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{aiAnalysis}</div>
        </div>
      )}

      <div className="card">
        <div className="card-title">{tr.serviceReports}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
          {tr.autoHint}
        </div>
        <div className="rp-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
          <span>⏱ {L3('time worked', '作業時間', 'tempo trabalhado')}</span>
          <span>⚠️ 2× {L3('took over double the planned time', '予定の2倍超', 'passou do dobro do previsto')}</span>
          <span>☑ {L3('checklist done / total', 'チェック済/全体', 'checklist feito / total')}</span>
          <span>🤖 {L3('AI photo grade (0–10) + reason', 'AI写真評価(0–10)+理由', 'nota da IA da foto (0–10) + motivo')}</span>
          <span>🎬 {L3('video attached', '動画あり', 'vídeo anexado')} · ⏳ {L3('sending', '送信中', 'enviando')}</span>
          <span>📝 {L3('notes from the office', '事務所メモ', 'notas do escritório')}</span>
          <span>🔒 {L3('closed by admin', '管理者が完了', 'fechado pelo admin')}</span>
          <span>— {L3('nothing recorded', '記録なし', 'nada registrado')}</span>
        </div>
        {loading && <div aria-busy="true" aria-label={tr.loading}>{[0,1,2,3].map(i => <div key={i} className="kp-skel kp-skel-row" />)}</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ color: 'var(--text3)', fontSize: 13, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {reports.length && activeFilterCount(f)
              ? <>{L3('No report matches these filters.', 'この条件に合うレポートはありません。', 'Nenhum report com esses filtros.')} <button className="btn btn-sm" onClick={() => setParams({}, { replace: true })}>{L3('Clear filters', '条件をクリア', 'Limpar filtros')}</button></>
              : tr.empty}
          </div>
        )}
        {filtered.length > 0 && narrow && (
          <div style={{ display: 'grid', gap: 10 }}>
            {filtered.map(r => {
              const n = noteCountOf(r)
              return (
                <button key={r.job_id || r.id} type="button" onClick={() => setSelected(r)}
                  style={{ textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', color: 'inherit', font: 'inherit' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(r.job_title || r.client_name || '').replace(/ — .*/, '')}</div>
                    <div style={{ flexShrink: 0 }}>{r.job_status && r.job_status !== 'completed' ? <span className="badge badge-red">{tr.pendingJob}</span> : typeBadge(r.report_type, tr, r._job, lang)}</div>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>👤 {r.employee_name || '—'} · 📅 {r.report_date}</div>
                  {rowException(r)?.due && <div style={{ fontSize: 12, marginTop: 4, color: rowException(r).overdue ? '#dc2626' : 'var(--text3)', fontWeight: rowException(r).overdue ? 700 : 400 }}>{exceptionDeadline(rowException(r), L3)}</div>}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 8, fontSize: 13 }}>
                    <span>⏱ {fmtDuration(r.duration_min, lang)}</span>
                    <span>☑ {r.checklist_total ? `${r.checklist_done || 0}/${r.checklist_total}` : '—'}</span>
                    {aiScoreView(r) && <span title={aiReasonShort(aiScoreView(r), noProblems)}>🤖 {r.photo_ai_score}/10 · {aiReasonShort(aiScoreView(r), noProblems)}</span>}
                    {rowException(r)?.kind === 'long' && <span className="badge badge-red">⚠️ 2×</span>}
                    {r.job_id && <VideoMark jobId={r.job_id} />}
                    {n > 0 && <span className="badge badge-navy">📝 {n}</span>}
                  </div>
                </button>
              )
            })}
          </div>
        )}
        {filtered.length > 0 && !narrow && (
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
                  <th>{pickLang(lang, 'Video', '動画', 'Vídeo')}</th>
                  <th>{pickLang(lang, 'Notes', 'メモ', 'Notas')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.job_id}>
                    <td style={{ fontWeight: 500 }}>
                      {r.employee_name
                        ? <button type="button" className="rf-link" title={L3('Show only this employee', 'このスタッフだけ表示', 'Ver só este funcionário')} onClick={() => setF({ emp: filterEmp === r.employee_name ? '' : r.employee_name })}>{r.employee_name}</button>
                        : '—'}
                    </td>
                    <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.client_name || r.job_title}</td>
                    <td>{r.report_date}</td>
                    <td>{r.job_status && r.job_status !== 'completed' ? <span className="badge badge-red">{tr.pendingJob}</span> : typeBadge(r.report_type, tr, r._job, lang)}</td>
                    <td>
                      {fmtDuration(r.duration_min, lang)}
                      {rowException(r)?.kind === 'long' && <div><span className="badge badge-red" title={L3(`Planned ${rowException(r).planned} min`, `予定${rowException(r).planned}分`, `Previsto ${rowException(r).planned} min`)}>⚠️ 2×</span></div>}
                      {rowException(r)?.due && <div style={{ fontSize: 11, whiteSpace: 'nowrap', color: rowException(r).overdue ? '#dc2626' : 'var(--text3)', fontWeight: rowException(r).overdue ? 700 : 400 }}>{exceptionDeadline(rowException(r), L3)}</div>}
                    </td>
                    <td>{r.checklist_total ? `${r.checklist_done || 0}/${r.checklist_total}` : '—'}</td>
                    <td>
                      {aiScoreView(r) && <div style={{ fontSize: 12, maxWidth: 170 }} title={aiReasonShort(aiScoreView(r), noProblems)}><b>{r.photo_ai_score}/10</b> <span style={{ color: 'var(--text3)' }}>{aiReasonShort(aiScoreView(r), noProblems)}</span></div>}
                      {(r.photo_after_url || r.photo_before_url) ? (
                        <JobPhotos
                          photoStartUrl={r.photo_before_url}
                          photoEndUrl={r.photo_after_url}
                          beforeLabel={tr.before}
                          afterLabel={tr.after}
                          size={44}
                          onPhotoClick={setLightbox}
                        />
                      ) : (aiScoreView(r) ? null : '—')}
                    </td>
                    <td><SignatureImage url={r.signature_url} height={34} emptyLabel={r.job_status && r.job_status !== 'completed' ? '—' : tr.noSignature} /></td>
                    <td>{r.job_id ? <VideoMark jobId={r.job_id} /> : '—'}</td>
                    <td>{noteCountOf(r) ? <span className="badge badge-navy">📝 {noteCountOf(r)}</span> : <span style={{ color: 'var(--text3)' }}>—</span>}</td>
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

      <ProgressChart anchorDate={range.to} defaultUnit={filterDays <= 7 ? 'day' : 'week'}
        filters={{ days: filterDays, clientId: filterClient, employeeName: filterEmp, label: [clientList.find(c => c.id === filterClient)?.company_name, filterEmp].filter(Boolean).join(' · ') }} />

      <ReportsAnalytics reports={filtered} selectedEmployee={filterEmp} onEmployeeClick={name => setF({ emp: filterEmp === name ? '' : name })} />

      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setSelected(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -8 }}>
              <button onClick={() => setSelected(null)} aria-label={tr.close} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', minWidth: 40, minHeight: 40 }}>✕</button>
            </div>
            <ReportSheet
              key={selected.job_id || selected.id}
              row={selected}
              tr={tr}
              lang={lang}
              contracts={contractList}
              user={user}
              onPhoto={setLightbox}
              regrading={regrading === selected.job_id}
              onRegrade={async () => {
                setRegrading(selected.job_id)
                try {
                  const { data: job } = await supabase.from('jobs').select('*').eq('id', selected.job_id).maybeSingle()
                  const graded = await gradeJobPhoto(job || { id: selected.job_id, photo_end_url: selected.photo_after_url, title: selected.job_title })
                  setSelected(s => ({ ...s, photo_ai_score: graded.photo_ai_score, photo_ai_approved: graded.photo_ai_approved, photo_ai_issues: graded.photo_ai_issues }))
                  loadReports()
                } catch (err) {
                  toast.error(err.message === 'timeout' ? pickLang(lang, 'The AI took too long — try again.', 'AIの応答が遅すぎます。再試行してください。', 'A IA demorou demais — tente de novo.') : err.message)
                }
                setRegrading(null)
              }}
              onJobSaved={job => {
                const merge = r => r.job_id === job.id ? { ...r, _job: job } : r
                setSelected(merge)
                setReports(prev => prev.map(merge))
              }}
              onDelete={() => handleDelete(selected)}
            />
          </div>
        </div>
      )}

      <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} closeLabel={tr.close} />
      {sigPad && <AdminSignaturePad tr={tr} current={adminSig} onSave={onAdminSig} onCancel={() => { const fromDownload = sigPad === 'download'; setSigPad(false); if (fromDownload) downloadDayPdf(null, true) }} />}
    </div>
  )
}
