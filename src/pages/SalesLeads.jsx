import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang, fill } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { yen } from '../lib/invoice'
import {
  emptyLead,
  isSalesSchemaMissing,
  leadFromRow,
  leadIsOverdue,
  leadsForStage,
  leadWritePayload,
} from '../lib/sales'
import { SALES_SETUP_SQL, SUPABASE_SQL_URL } from '../lib/salesSetupSql'
import SalesLeadFields from '../components/SalesLeadFields'

export default function SalesLeads({ stage }) {
  const { t } = useLang()
  const s = t.sales
  const navigate = useNavigate()
  const today = tokyoToday()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [schemaOk, setSchemaOk] = useState(true)
  const [tab, setTab] = useState('list')
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(() => emptyLead(today, stage))
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase.from('sales_leads').select('*').order('updated_at', { ascending: false })
    if (error) {
      if (isSalesSchemaMissing(error)) setSchemaOk(false)
      else toast.error(error.message)
      setLeads([])
    } else {
      setSchemaOk(true)
      setLeads(data || [])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [stage])

  const rows = leadsForStage(leads, stage)

  const copySql = async () => {
    await navigator.clipboard.writeText(SALES_SETUP_SQL)
    toast.success(s.copied)
  }

  const startNew = () => {
    setEditingId(null)
    setForm(emptyLead(today, stage))
    setTab('form')
  }

  const startEdit = (row) => {
    setEditingId(row.id)
    setForm(leadFromRow(row, today))
    setTab('form')
  }

  const handleSave = async () => {
    if (!String(form.company_name || '').trim()) return toast.error(s.missingCompany)
    if (!String(form.contact_name || '').trim()) return toast.error(s.missingContact)
    setSaving(true)
    const payload = leadWritePayload(form, today, stage)
    const query = editingId
      ? supabase.from('sales_leads').update(payload).eq('id', editingId)
      : supabase.from('sales_leads').insert(payload)
    const { error } = await query
    setSaving(false)
    if (error) {
      if (isSalesSchemaMissing(error)) setSchemaOk(false)
      return toast.error(error.message)
    }
    toast.success(s.saved)
    setTab('list')
    load()
  }

  const handleDelete = async (id) => {
    if (!window.confirm(s.deleteConfirm)) return
    const { error } = await supabase.from('sales_leads').delete().eq('id', id)
    if (error) return toast.error(error.message)
    toast(s.deleted)
    load()
  }

  const setStage = async (row, next) => {
    const { error } = await supabase.from('sales_leads').update({
      stage: next,
      last_contact_date: today,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success(fill(s.stageChanged, { stage: s.stages?.[next] || next }))
    load()
  }

  const logContact = async (row) => {
    const { error } = await supabase.from('sales_leads').update({
      last_contact_date: today,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success(s.contactLogged)
    load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 className="page-head" style={{ margin: 0, fontSize: 22 }}>{stage === 'approach' ? t.sidebar.approaches : t.sidebar.followup}</h2>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{stage === 'approach' ? s.approachHint : s.followupHint}</div>
        </div>
      </div>

      {!schemaOk && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--amber)' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{s.setupNeeded}</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>{s.setupHint}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={copySql}>{s.copySql}</button>
            <a className="btn" href={SUPABASE_SQL_URL} target="_blank" rel="noreferrer">{s.openSql}</a>
          </div>
        </div>
      )}

      <div className="tab-pills">
        <button type="button" className={`tab-pill${tab === 'list' ? ' active' : ''}`} onClick={() => setTab('list')}>{fill(s.listCount, { n: rows.length })}</button>
        <button type="button" className={`tab-pill${tab === 'form' ? ' active' : ''}`} onClick={startNew}>{stage === 'approach' ? s.newApproach : s.newFollowup}</button>
      </div>

      {tab === 'list' && (
        <div>
          {loading && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{t.app.loading}</div>}
          {!loading && rows.length === 0 && (
            <div className="card"><div style={{ color: 'var(--text3)', fontSize: 13 }}>{stage === 'approach' ? s.emptyApproach : s.emptyFollowup}</div></div>
          )}
          {rows.map(row => {
            const overdue = leadIsOverdue(row, today)
            return (
              <div key={row.id} className="card" style={{ marginBottom: 12, borderColor: overdue ? 'var(--amber)' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{row.company_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                      {row.contact_title ? `${row.contact_title} ` : ''}{row.contact_name || '—'}
                      {row.contact_phone ? ` · ${row.contact_phone}` : ''}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{s.firstContact}: {row.first_contact_date || '—'} · {s.nextFollowup}: {row.next_followup_date || '—'}</div>
                    {row.needs && <div style={{ fontSize: 12, marginTop: 4 }}>{s.needs}: {row.needs}</div>}
                    {row.still_needed && <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 2 }}>{s.stillNeeded}: {row.still_needed}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {row.expected_monthly ? <div style={{ fontWeight: 700, color: 'var(--green)' }}>{yen(row.expected_monthly)}</div> : null}
                    {overdue && <span className="badge badge-amber">{s.overdue}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  <button type="button" className="btn btn-sm" onClick={() => startEdit(row)}>{s.edit}</button>
                  <button type="button" className="btn btn-sm" onClick={() => logContact(row)}>{s.logContact}</button>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate(`/mitsumori?lead=${row.id}`)}>{s.convertQuote}</button>
                  {stage === 'approach' && <button type="button" className="btn btn-sm" onClick={() => setStage(row, 'followup')}>{s.markFollowup}</button>}
                  {row.stage !== 'won' && <button type="button" className="btn btn-sm" onClick={() => setStage(row, 'won')}>{s.markWon}</button>}
                  {row.stage !== 'lost' && <button type="button" className="btn btn-sm btn-danger" onClick={() => setStage(row, 'lost')}>{s.markLost}</button>}
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDelete(row.id)}>{s.delete}</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'form' && (
        <div className="card">
          <SalesLeadFields form={form} onChange={setForm} s={s} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? t.app.loading : s.save}</button>
            <button type="button" className="btn" onClick={() => setTab('list')}>{s.cancel}</button>
          </div>
        </div>
      )}
    </div>
  )
}
