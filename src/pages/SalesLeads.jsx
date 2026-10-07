import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang, fill } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { yen } from '../lib/invoice'
import { usePeriod } from '../hooks/usePeriod'
import { filterByPeriod } from '../lib/period'
import {
  emptyLead,
  isSalesSchemaMissing,
  leadFromRow,
  leadIsOverdue,
  leadsForStage,
  leadWritePayload,
  isCrmSchemaMissing,
  stripCrmExtras,
  dropSiteNameKeepNote,
  restaurantFromNotes,
} from '../lib/sales'
import SalesLeadFields from '../components/SalesLeadFields'
import SalesSetupCard, { SalesCrmSetupCard } from '../components/SalesSetupCard'
import SalesTouchpoints from '../components/SalesTouchpoints'

export default function SalesLeads({ stage }) {
  const { t } = useLang()
  const { start, end } = usePeriod()
  const s = t.sales
  const navigate = useNavigate()
  const today = tokyoToday()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [schemaOk, setSchemaOk] = useState(true)
  const [crmOk, setCrmOk] = useState(true)
  const [tab, setTab] = useState('list')
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(() => emptyLead(today, stage))
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase.from('sales_leads').select('*').order('updated_at', { ascending: false })
    const tp = await supabase.from('sales_touchpoints').select('id').limit(1)
    if (error) {
      if (isSalesSchemaMissing(error)) setSchemaOk(false)
      else toast.error(error.message)
      setLeads([])
    } else {
      setSchemaOk(true)
      setLeads((data || []).map(row => ({
        ...row,
        site_name: row.site_name || restaurantFromNotes(row.notes) || '',
      })))
    }
    if (tp.error && (String(tp.error.message || '').includes('sales_touchpoints') || tp.error.code === 'PGRST205')) setCrmOk(false)
    else if (!tp.error) setCrmOk(true)
    setLoading(false)
  }

  useEffect(() => { load() }, [stage])

  const stageRows = leadsForStage(leads, stage)
  const rows = (stage === 'won' || stage === 'lost')
    ? filterByPeriod(stageRows, start, end, ['last_contact_date', 'first_contact_date', 'created_at'])
    : stageRows

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
    const query = (body) => editingId
      ? supabase.from('sales_leads').update(body).eq('id', editingId)
      : supabase.from('sales_leads').insert(body)
    let { error } = await query(payload)
    if (error && isCrmSchemaMissing(error)) {
      setCrmOk(false)
      ;({ error } = await query(dropSiteNameKeepNote(stripCrmExtras(payload))))
    }
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

      {!schemaOk && <SalesSetupCard onRecheck={load} />}
      {schemaOk && !crmOk && <SalesCrmSetupCard onRecheck={load} />}

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
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{row.site_name || row.company_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                      {row.site_name && row.company_name ? `${row.company_name} · ` : ''}
                      {row.contact_title ? `${row.contact_title} ` : ''}{row.contact_name || '—'}
                      {row.contact_phone ? ` · ${row.contact_phone}` : ''}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{s.firstContact}: {row.first_contact_date || '—'} · {s.nextFollowup}: {row.next_followup_date || '—'}</div>
                    {row.needs && <div style={{ fontSize: 12, marginTop: 4 }}>{s.needs}: {row.needs}</div>}
                    {row.still_needed && <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 2 }}>{s.stillNeeded}: {row.still_needed}</div>}
                    {row.interest && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{s.interest}: {row.interest}</div>}
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
        <div>
          <div className="card">
            <SalesLeadFields form={form} onChange={setForm} s={s} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? t.app.loading : s.save}</button>
              <button type="button" className="btn" onClick={() => setTab('list')}>{s.cancel}</button>
            </div>
          </div>
          {editingId && (
            <div style={{ marginTop: 14 }}>
              <SalesTouchpoints
                leadId={editingId}
                s={s}
                today={today}
                onCrmMissing={() => setCrmOk(false)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
