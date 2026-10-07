import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang, fill } from '../hooks/useLang'
import { APP_VERSION } from '../lib/appVersion'
import { tokyoToday } from '../lib/dates'
import { viewablePhotoUrl } from '../lib/photoUrl'
import { hashSalespersonSecret, hoursInMonth, isSalespersonSchemaMissing, openFollowups } from '../lib/salesperson'
import { SalespersonSetupCard } from '../components/SalesSetupCard'

export default function SalesTeam() {
  const { t } = useLang()
  const s = t.salesperson
  const today = tokyoToday()
  const [people, setPeople] = useState([])
  const [selected, setSelected] = useState(null)
  const [reports, setReports] = useState([])
  const [approaches, setApproaches] = useState([])
  const [schemaOk, setSchemaOk] = useState(true)
  const [form, setForm] = useState({ full_name: '', email: '', password: '', phone: '' })
  const [saving, setSaving] = useState(false)

  const loadPeople = async () => {
    const { data, error } = await supabase.from('salespeople').select('id, full_name, email, phone, is_active, created_at').order('full_name')
    if (error) {
      if (isSalespersonSchemaMissing(error)) setSchemaOk(false)
      else toast.error(error.message)
      return
    }
    setSchemaOk(true)
    setPeople(data || [])
  }

  const loadOne = async (id) => {
    const [r, a] = await Promise.all([
      supabase.from('sales_day_reports').select('*').eq('salesperson_id', id).order('work_date', { ascending: false }),
      supabase.from('sales_field_approaches').select('*').eq('salesperson_id', id).order('created_at', { ascending: false }),
    ])
    if (r.error || a.error) return toast.error((r.error || a.error).message)
    setReports(r.data || [])
    setApproaches(a.data || [])
  }

  useEffect(() => { loadPeople() }, [])
  useEffect(() => { if (selected?.id) loadOne(selected.id) }, [selected?.id])

  const createPerson = async () => {
    if (!form.full_name.trim() || !form.email.trim() || !form.password) return toast.error(s.needAccount)
    setSaving(true)
    const password_hash = await hashSalespersonSecret(form.email, form.password)
    const { error } = await supabase.from('salespeople').insert({
      full_name: form.full_name.trim(),
      email: form.email.trim().toLowerCase(),
      password_hash,
      phone: form.phone.trim(),
      is_active: true,
    })
    setSaving(false)
    if (error) {
      if (isSalespersonSchemaMissing(error)) setSchemaOk(false)
      return toast.error(error.message)
    }
    toast.success(s.accountCreated)
    setForm({ full_name: '', email: '', password: '', phone: '' })
    loadPeople()
  }

  const toggleActive = async (row) => {
    const { error } = await supabase.from('salespeople').update({ is_active: !row.is_active }).eq('id', row.id)
    if (error) toast.error(error.message)
    else loadPeople()
  }

  const followups = openFollowups(approaches, today)
  const monthHours = hoursInMonth(reports, today.slice(0, 7))

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h2 className="page-head" style={{ margin: 0, fontSize: 22 }}>{t.sidebar.salesTeam}</h2>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{fill(s.adminHint, { v: APP_VERSION })}</div>
      </div>
      {!schemaOk && <SalespersonSetupCard onRecheck={loadPeople} />}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">{s.newAccount}</div>
        <div className="grid-2">
          <div className="form-group"><label>{s.name}</label><input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
          <div className="form-group"><label>{s.email}</label><input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div className="form-group"><label>{s.password}</label><input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
          <div className="form-group"><label>{s.phone}</label><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
        </div>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={createPerson}>{s.createAccount}</button>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        {(people || []).map(p => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <button type="button" onClick={() => setSelected(p)} style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}>
              <div style={{ fontWeight: 700, color: selected?.id === p.id ? 'var(--gold, #c19c56)' : 'inherit' }}>{p.full_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{p.email} · {p.is_active ? s.active : s.inactive}</div>
            </button>
            <button type="button" className="btn btn-sm" onClick={() => toggleActive(p)}>{p.is_active ? s.disable : s.enable}</button>
          </div>
        ))}
        {people.length === 0 && schemaOk && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{s.emptyTeam}</div>}
      </div>

      {selected && (
        <div>
          <h3 style={{ fontSize: 16 }}>{selected.full_name}</h3>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>{fill(s.monthHours, { n: monthHours.toFixed(1) })} · {fill(s.openFu, { n: followups.length })}</div>
          {reports.map(r => (
            <div key={r.id} className="card" style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 700 }}>{r.work_date} · {r.hours_worked}h · {r.started_at || '—'}–{r.ended_at || '—'}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{r.areas}</div>
              <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 13 }}>{r.summary}</div>
              {approaches.filter(a => a.work_date === r.work_date).map(a => (
                <div key={a.id} style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'flex-start' }}>
                  {a.meishi_photo_url && <img src={viewablePhotoUrl(a.meishi_photo_url)} alt="meishi" style={{ width: 88, borderRadius: 8 }} />}
                  <div>
                    <div style={{ fontWeight: 600 }}>{a.place} — {a.site_name || a.company_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{a.contact_name} {a.contact_title} · {a.followup_date || ''} {a.followup_status}</div>
                    {a.notes && <div style={{ fontSize: 12 }}>{a.notes}</div>}
                    {a.followup_note && <div style={{ fontSize: 12 }}>{a.followup_note}</div>}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
