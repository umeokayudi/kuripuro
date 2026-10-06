import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { useLang, fill } from '../hooks/useLang'
import { APP_VERSION } from '../lib/appVersion'
import { supabase } from '../lib/supabase'
import { tokyoToday } from '../lib/dates'
import { uploadJobPhoto } from '../lib/uploadPhoto'
import { viewablePhotoUrl } from '../lib/photoUrl'
import LanguageToggle from '../components/LanguageToggle'
import AIChatPanel from '../components/AIChatPanel'
import {
  approachIsValid,
  approachWritePayload,
  emptyApproach,
  emptyDayReport,
  hoursInMonth,
  isSalespersonSchemaMissing,
  openFollowups,
  reportIsValid,
  reportWritePayload,
} from '../lib/salesperson'

export default function SalespersonPortal() {
  const { user, logout } = useAuth()
  const { t } = useLang()
  const sp = t.salesperson
  const today = tokyoToday()
  const month = today.slice(0, 7)
  const [tab, setTab] = useState('today')
  const [schemaOk, setSchemaOk] = useState(true)
  const [reports, setReports] = useState([])
  const [approaches, setApproaches] = useState([])
  const [report, setReport] = useState(() => emptyDayReport(today))
  const [approach, setApproach] = useState(() => emptyApproach(today))
  const [saving, setSaving] = useState(false)
  const [meishiBusy, setMeishiBusy] = useState(false)
  const meishiRef = useRef()

  const load = async () => {
    const [r, a] = await Promise.all([
      supabase.from('sales_day_reports').select('*').eq('salesperson_id', user.id).order('work_date', { ascending: false }),
      supabase.from('sales_field_approaches').select('*').eq('salesperson_id', user.id).order('created_at', { ascending: false }),
    ])
    if (r.error || a.error) {
      const err = r.error || a.error
      if (isSalespersonSchemaMissing(err)) setSchemaOk(false)
      else toast.error(err.message)
      return
    }
    setSchemaOk(true)
    setReports(r.data || [])
    setApproaches(a.data || [])
    const todayRow = (r.data || []).find(x => x.work_date === today)
    if (todayRow) setReport({
      work_date: todayRow.work_date,
      hours_worked: todayRow.hours_worked ?? '',
      started_at: todayRow.started_at || '',
      ended_at: todayRow.ended_at || '',
      areas: todayRow.areas || '',
      summary: todayRow.summary || '',
      id: todayRow.id,
    })
  }

  useEffect(() => { load() }, [user.id])

  const followups = openFollowups(approaches, today)
  const monthHours = hoursInMonth(reports, month)
  const todayApproaches = approaches.filter(x => x.work_date === today)

  const saveReport = async () => {
    if (!reportIsValid(report)) return toast.error(sp.needReport)
    setSaving(true)
    const body = reportWritePayload(report, user.id)
    const run = report.id
      ? supabase.from('sales_day_reports').update(body).eq('id', report.id).eq('salesperson_id', user.id)
      : supabase.from('sales_day_reports').upsert(body, { onConflict: 'salesperson_id,work_date' })
    const { error } = await run
    setSaving(false)
    if (error) {
      if (isSalespersonSchemaMissing(error)) setSchemaOk(false)
      return toast.error(error.message)
    }
    toast.success(sp.saved)
    load()
  }

  const onMeishi = async (file) => {
    if (!file) return
    setMeishiBusy(true)
    try {
      const path = `salespeople/${user.id}/meishi/${today}_${Date.now()}.jpg`
      const stored = await uploadJobPhoto(path, file)
      setApproach(a => ({ ...a, meishi_photo_url: stored }))
      toast.success(sp.meishiOk)
    } catch (e) {
      toast.error(e.message)
    }
    setMeishiBusy(false)
  }

  const saveApproach = async () => {
    if (!approachIsValid(approach)) return toast.error(sp.needMeishi)
    setSaving(true)
    const body = approachWritePayload(approach, user.id, report.id || null)
    const { error } = await supabase.from('sales_field_approaches').insert(body)
    setSaving(false)
    if (error) {
      if (isSalespersonSchemaMissing(error)) setSchemaOk(false)
      return toast.error(error.message)
    }
    toast.success(sp.saved)
    setApproach(emptyApproach(today))
    load()
  }

  const setFollowup = async (row, status) => {
    const { error } = await supabase.from('sales_field_approaches').update({ followup_status: status }).eq('id', row.id).eq('salesperson_id', user.id)
    if (error) toast.error(error.message)
    else load()
  }

  return (
    <div className="emp-shell" style={{ background: '#07111c' }}>
      <header className="emp-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="emp-brand">KuriPuro · {sp.tag} · {APP_VERSION}</div>
            <div className="emp-name" style={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>{user.name}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <LanguageToggle variant="dark" />
            <button type="button" className="btn btn-sm" onClick={logout}>{t.sidebar.logout}</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 10, color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>
          <span>{fill(sp.monthHours, { n: monthHours.toFixed(1) })}</span>
          <span>{fill(sp.todayCount, { n: todayApproaches.length })}</span>
        </div>
      </header>

      <div style={{ padding: '12px 14px 24px', flex: 1 }}>
        {!schemaOk && (
          <div className="card" style={{ marginBottom: 12, borderColor: 'var(--amber)' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{sp.setupNeeded}</div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>{sp.setupHint}</div>
          </div>
        )}

        {tab === 'today' && (
          <>
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-title">{sp.todayTitle}</div>
              <div className="grid-2">
                <div className="form-group"><label>{sp.hours}</label><input type="number" step="0.5" min="0" value={report.hours_worked} onChange={e => setReport({ ...report, hours_worked: e.target.value })} /></div>
                <div className="form-group"><label>{sp.date}</label><input type="date" value={report.work_date} onChange={e => setReport({ ...report, work_date: e.target.value })} /></div>
                <div className="form-group"><label>{sp.started}</label><input type="time" value={report.started_at} onChange={e => setReport({ ...report, started_at: e.target.value })} /></div>
                <div className="form-group"><label>{sp.ended}</label><input type="time" value={report.ended_at} onChange={e => setReport({ ...report, ended_at: e.target.value })} /></div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}><label>{sp.areas}</label><input value={report.areas} onChange={e => setReport({ ...report, areas: e.target.value })} placeholder={sp.areasHint} /></div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label>{sp.summary} *</label>
                  <textarea rows={4} value={report.summary} onChange={e => setReport({ ...report, summary: e.target.value })} placeholder={sp.summaryHint} style={{ width: '100%', minHeight: 90 }} />
                </div>
              </div>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={saveReport}>{sp.saveReport}</button>
            </div>

            <div className="card">
              <div className="card-title">{sp.newApproach}</div>
              <div className="form-group"><label>{sp.place} *</label><input value={approach.place} onChange={e => setApproach({ ...approach, place: e.target.value })} placeholder={sp.placeHint} /></div>
              <div className="form-group"><label>{sp.siteName}</label><input value={approach.site_name} onChange={e => setApproach({ ...approach, site_name: e.target.value })} placeholder={sp.siteHint} /></div>
              <div className="form-group"><label>{sp.company}</label><input value={approach.company_name} onChange={e => setApproach({ ...approach, company_name: e.target.value })} /></div>
              <div className="grid-2">
                <div className="form-group"><label>{sp.contact}</label><input value={approach.contact_name} onChange={e => setApproach({ ...approach, contact_name: e.target.value })} /></div>
                <div className="form-group"><label>{sp.title}</label><input value={approach.contact_title} onChange={e => setApproach({ ...approach, contact_title: e.target.value })} /></div>
                <div className="form-group"><label>{sp.phone}</label><input value={approach.contact_phone} onChange={e => setApproach({ ...approach, contact_phone: e.target.value })} /></div>
                <div className="form-group"><label>{sp.email}</label><input value={approach.contact_email} onChange={e => setApproach({ ...approach, contact_email: e.target.value })} /></div>
              </div>
              <div className="form-group">
                <label>{sp.meishi} *</label>
                <input ref={meishiRef} type="file" accept="image/*" capture="environment" hidden onChange={e => onMeishi(e.target.files?.[0])} />
                <button type="button" className="btn" disabled={meishiBusy} onClick={() => meishiRef.current?.click()}>{meishiBusy ? sp.uploading : sp.takeMeishi}</button>
                {approach.meishi_photo_url && (
                  <img src={viewablePhotoUrl(approach.meishi_photo_url)} alt="meishi" style={{ display: 'block', marginTop: 8, width: 180, borderRadius: 8 }} />
                )}
              </div>
              <div className="form-group"><label>{sp.notes}</label><textarea rows={2} value={approach.notes} onChange={e => setApproach({ ...approach, notes: e.target.value })} style={{ width: '100%' }} /></div>
              <div className="grid-2">
                <div className="form-group"><label>{sp.followupDate}</label><input type="date" value={approach.followup_date} onChange={e => setApproach({ ...approach, followup_date: e.target.value })} /></div>
                <div className="form-group"><label>{sp.followupNote}</label><input value={approach.followup_note} onChange={e => setApproach({ ...approach, followup_note: e.target.value })} /></div>
              </div>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={saveApproach}>{sp.saveApproach}</button>
            </div>
          </>
        )}

        {tab === 'followup' && (
          <div>
            {followups.length === 0 && <div className="card" style={{ color: 'var(--text3)' }}>{sp.emptyFollowup}</div>}
            {followups.map(row => (
              <div key={row.id} className="card" style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 700 }}>{row.site_name || row.company_name || row.place}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{row.place} · {row.contact_name || '—'} · {row.followup_date || '—'}</div>
                {row.overdue && <div style={{ color: 'var(--amber)', fontSize: 12, marginTop: 4 }}>{sp.overdue}</div>}
                {row.followup_note && <div style={{ fontSize: 13, marginTop: 6 }}>{row.followup_note}</div>}
                {row.meishi_photo_url && <img src={viewablePhotoUrl(row.meishi_photo_url)} alt="" style={{ width: 120, marginTop: 8, borderRadius: 8 }} />}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button type="button" className="btn btn-sm" onClick={() => setFollowup(row, 'done')}>{sp.markDone}</button>
                  <button type="button" className="btn btn-sm" onClick={() => setFollowup(row, 'lost')}>{sp.markLost}</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'log' && (
          <div>
            {reports.map(r => (
              <div key={r.id} className="card" style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 700 }}>{r.work_date} · {r.hours_worked}h</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{r.areas}</div>
                <div style={{ fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap' }}>{r.summary}</div>
                {approaches.filter(a => a.work_date === r.work_date).map(a => (
                  <div key={a.id} style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    {a.meishi_photo_url && <img src={viewablePhotoUrl(a.meishi_photo_url)} alt="" style={{ width: 56, height: 36, objectFit: 'cover', borderRadius: 6 }} />}
                    <div style={{ fontSize: 12 }}>{a.place} — {a.site_name || a.company_name || a.contact_name}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {tab === 'ai' && (
          <div className="ai-workspace" style={{ minHeight: '70dvh', padding: 0, background: 'transparent' }}>
            <p className="ai-workspace-hint" style={{ color: 'rgba(255,255,255,0.55)' }}>{sp.aiHint}</p>
            <AIChatPanel
              mode="salesperson"
              employeeId={user.id}
              employeeName={user.name}
              dark
              workspace
              suggestions={[sp.suggestDay, sp.suggestMeishi, sp.suggestFollow]}
            />
          </div>
        )}
      </div>

      <nav className="emp-bottom-nav">
        {[
          ['today', sp.tabToday],
          ['followup', sp.tabFollow],
          ['log', sp.tabLog],
          ['ai', sp.tabAi],
        ].map(([k, label]) => (
          <button key={k} type="button" className={`admin-bottom-item${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
