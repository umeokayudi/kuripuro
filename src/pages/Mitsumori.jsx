import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang, fill } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { APP_VERSION } from '../lib/appVersion'
import { lineTotal } from '../lib/invoice'
import {
  buildMitsumoriPrintHtml,
  defaultValidUntil,
  emptyLead,
  emptyQuoteItem,
  findLeadByCompany,
  leadFromRow,
  mergeLeadFromQuote,
  nextQuoteNumber,
  quoteTotals,
  yen,
  isSalesSchemaMissing,
} from '../lib/sales'
import SalesLeadFields from '../components/SalesLeadFields'
import SalesSetupCard from '../components/SalesSetupCard'

const QUOTE_FILTERS = ['all', 'draft', 'sent', 'accepted', 'declined']

export default function Mitsumori() {
  const { t } = useLang()
  const s = t.sales
  const inv = t.invoices
  const today = tokyoToday()
  const [params] = useSearchParams()
  const leadId = params.get('lead')
  const [quotes, setQuotes] = useState([])
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [schemaOk, setSchemaOk] = useState(true)
  const [tab, setTab] = useState(leadId ? 'new' : 'list')
  const [statusFilter, setStatusFilter] = useState('all')
  const [form, setForm] = useState(() => ({
    ...emptyLead(today, 'followup'),
    tax_rate: 10,
    valid_until: defaultValidUntil(today),
    frequency: '',
    hours_per_visit: '',
    site_visit_date: '',
  }))
  const [items, setItems] = useState([emptyQuoteItem()])
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    const [q, l] = await Promise.all([
      supabase.from('mitsumori').select('*').order('created_at', { ascending: false }),
      supabase.from('sales_leads').select('*').order('company_name'),
    ])
    if (q.error || l.error) {
      const err = q.error || l.error
      if (isSalesSchemaMissing(err)) setSchemaOk(false)
      else toast.error(err.message)
    } else {
      setSchemaOk(true)
      setQuotes(q.data || [])
      setLeads(l.data || [])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!leadId || loading) return
    const row = leads.find(x => x.id === leadId)
    if (!row) return
    setForm(f => ({
      ...f,
      ...leadFromRow(row, today),
      tax_rate: f.tax_rate,
      valid_until: f.valid_until || defaultValidUntil(today),
    }))
    setTab('new')
  }, [leadId, loading])

  const { subtotal, taxAmount: tax, total } = quoteTotals(items, form.tax_rate)

  const pickLead = (id) => {
    const row = leads.find(x => x.id === id)
    if (!row) return
    setForm(f => ({ ...f, ...leadFromRow(row, today), tax_rate: f.tax_rate, valid_until: f.valid_until }))
  }

  const updItem = (i, k, v) => setItems(its => its.map((it, idx) => {
    if (idx !== i) return it
    const updated = { ...it, [k]: v }
    if (k === 'quantity' || k === 'unit_price') updated.total = lineTotal(updated.quantity, updated.unit_price)
    return updated
  }))

  const handleCreate = async () => {
    if (!String(form.company_name || '').trim()) return toast.error(s.missingCompany)
    if (!String(form.contact_name || '').trim()) return toast.error(s.missingContact)
    if (!items.length || items.every(it => !it.description)) return toast.error(s.addItem)
    setSaving(true)
    const existing = findLeadByCompany(leads, form.company_name)
    const leadPayload = mergeLeadFromQuote(existing, form, today)
    let lead = existing
    if (existing) {
      const { data, error } = await supabase.from('sales_leads').update(leadPayload).eq('id', existing.id).select().single()
      if (error) { setSaving(false); return toast.error(error.message) }
      lead = data
    } else {
      const { data, error } = await supabase.from('sales_leads').insert(leadPayload).select().single()
      if (error) { setSaving(false); return toast.error(error.message) }
      lead = data
    }

    const quoteNumber = nextQuoteNumber(quotes, today)
    const quotePayload = {
      lead_id: lead.id,
      quote_number: quoteNumber,
      company_name: leadPayload.company_name,
      company_kana: leadPayload.company_kana,
      address: leadPayload.address,
      phone: leadPayload.phone,
      email: leadPayload.email,
      contact_name: leadPayload.contact_name,
      contact_title: leadPayload.contact_title,
      contact_phone: leadPayload.contact_phone,
      contact_email: leadPayload.contact_email,
      first_contact_date: leadPayload.first_contact_date,
      needs: leadPayload.needs,
      still_needed: leadPayload.still_needed,
      source: leadPayload.source,
      notes: leadPayload.notes,
      issue_date: today,
      valid_until: form.valid_until || defaultValidUntil(today),
      site_visit_date: form.site_visit_date || null,
      expected_start: leadPayload.expected_start,
      frequency: form.frequency || '',
      hours_per_visit: form.hours_per_visit === '' ? null : Number(form.hours_per_visit),
      tax_rate: parseInt(form.tax_rate, 10) || 10,
      subtotal,
      tax_amount: tax,
      total,
      status: 'draft',
    }
    const { data: quote, error: qErr } = await supabase.from('mitsumori').insert(quotePayload).select().single()
    if (qErr) {
      setSaving(false)
      if (isSalesSchemaMissing(qErr)) setSchemaOk(false)
      return toast.error(qErr.message)
    }
    for (const item of items.filter(it => it.description)) {
      const { error: iErr } = await supabase.from('mitsumori_items').insert({
        mitsumori_id: quote.id,
        description: item.description,
        quantity: parseFloat(item.quantity) || 1,
        unit_price: parseFloat(item.unit_price) || 0,
        total: parseFloat(item.total) || 0,
      })
      if (iErr) toast.error(iErr.message)
    }
    setSaving(false)
    toast.success(s.created)
    setForm({ ...emptyLead(today, 'followup'), tax_rate: 10, valid_until: defaultValidUntil(today), frequency: '', hours_per_visit: '', site_visit_date: '' })
    setItems([emptyQuoteItem()])
    setTab('list')
    load()
  }

  const handleStatus = async (row, status) => {
    const { error } = await supabase.from('mitsumori').update({ status }).eq('id', row.id)
    if (error) return toast.error(error.message)
    if (status === 'accepted' && row.lead_id) {
      await supabase.from('sales_leads').update({ stage: 'won', last_contact_date: today, updated_at: new Date().toISOString() }).eq('id', row.lead_id)
    }
    if (status === 'declined' && row.lead_id) {
      await supabase.from('sales_leads').update({ stage: 'lost', last_contact_date: today, updated_at: new Date().toISOString() }).eq('id', row.lead_id)
    }
    toast.success(fill(s.statusChanged, { status: s.quoteStatuses?.[status] || status }))
    load()
  }

  const handleDelete = async (id) => {
    if (!window.confirm(s.deleteQuoteConfirm)) return
    const { error } = await supabase.from('mitsumori').delete().eq('id', id)
    if (error) return toast.error(error.message)
    toast(s.deleted)
    load()
  }

  const openPrint = async (row, autoPrint) => {
    const { data, error } = await supabase.from('mitsumori_items').select('*').eq('mitsumori_id', row.id)
    if (error) return toast.error(error.message)
    const w = window.open('', '_blank')
    if (!w) return toast.error(s.popupBlocked)
    w.document.write(buildMitsumoriPrintHtml(row, data || [], {
      company: 'KuriPuro by JBM',
      address: t.ryoshu?.companyAddress || '',
      regNumber: t.ryoshu?.regNumber || '',
      version: APP_VERSION,
    }))
    w.document.close()
    if (autoPrint) { w.focus(); w.print() }
  }

  const visible = quotes.filter(q => statusFilter === 'all' || q.status === statusFilter)
  const badge = st => ({ draft: 'badge-amber', sent: 'badge-blue', accepted: 'badge-green', declined: 'badge-red', expired: 'badge-navy' }[st] || 'badge-navy')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 className="page-head" style={{ margin: 0, fontSize: 22 }}>{t.sidebar.mitsumori}</h2>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{fill(s.versionHint, { v: APP_VERSION })}</div>
        </div>
      </div>

      {!schemaOk && <SalesSetupCard onRecheck={load} />}

      <div className="tab-pills">
        <button type="button" className={`tab-pill${tab === 'list' ? ' active' : ''}`} onClick={() => setTab('list')}>{fill(s.quoteList, { n: quotes.length })}</button>
        <button type="button" className={`tab-pill${tab === 'new' ? ' active' : ''}`} onClick={() => setTab('new')}>{s.quoteNew}</button>
      </div>

      {tab === 'list' && (
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {QUOTE_FILTERS.map(st => (
              <button key={st} type="button" className={`tab-pill${statusFilter === st ? ' active' : ''}`} onClick={() => setStatusFilter(st)}>
                {st === 'all' ? s.filterAll : (s.quoteStatuses?.[st] || st)}
              </button>
            ))}
          </div>
          {loading && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{t.app.loading}</div>}
          {!loading && visible.length === 0 && <div className="card"><div style={{ color: 'var(--text3)', fontSize: 13 }}>{s.emptyQuotes}</div></div>}
          {visible.map(q => (
            <div key={q.id} className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{q.company_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>{q.quote_number} · {s.contact}: {q.contact_name || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>{s.firstContact}: {q.first_contact_date || '—'} · {s.validUntil}: {q.valid_until || '—'}</div>
                  {q.needs && <div style={{ fontSize: 12, marginTop: 4 }}>{s.needs}: {q.needs}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{yen(q.total)}</div>
                  <span className={`badge ${badge(q.status)}`}>{s.quoteStatuses?.[q.status] || q.status}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                <button type="button" className="btn btn-sm" onClick={() => openPrint(q, false)}>{s.view}</button>
                <button type="button" className="btn btn-sm" onClick={() => openPrint(q, true)}>{s.print}</button>
                {q.status === 'draft' && <button type="button" className="btn btn-sm btn-primary" onClick={() => handleStatus(q, 'sent')}>{s.markSent}</button>}
                {q.status === 'sent' && <button type="button" className="btn btn-sm" style={{ background: 'var(--green)', color: '#fff' }} onClick={() => handleStatus(q, 'accepted')}>{s.markAccepted}</button>}
                {q.status !== 'declined' && q.status !== 'accepted' && <button type="button" className="btn btn-sm btn-danger" onClick={() => handleStatus(q, 'declined')}>{s.markDeclined}</button>}
                <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDelete(q.id)}>{s.delete}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'new' && (
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">{s.quoteTitle}</div>
            {leads.length > 0 && (
              <div className="form-group">
                <label>{s.prefillLead}</label>
                <select value="" onChange={e => { if (e.target.value) pickLead(e.target.value) }}>
                  <option value="">{s.prefillLead}</option>
                  {leads.map(l => <option key={l.id} value={l.id}>{l.company_name} — {l.contact_name || ''} ({s.stages?.[l.stage] || l.stage})</option>)}
                </select>
              </div>
            )}
            <SalesLeadFields form={form} onChange={setForm} s={s} />
            <div className="grid-2" style={{ marginTop: 8 }}>
              <div className="form-group"><label>{s.validUntil}</label><input type="date" value={form.valid_until || ''} onChange={e => setForm({ ...form, valid_until: e.target.value })} /></div>
              <div className="form-group"><label>{inv.taxRate}</label>
                <select value={form.tax_rate} onChange={e => setForm({ ...form, tax_rate: e.target.value })}>
                  <option value={10}>10%</option><option value={8}>8%</option><option value={0}>0%</option>
                </select>
              </div>
              <div className="form-group"><label>{s.frequency}</label><input value={form.frequency || ''} onChange={e => setForm({ ...form, frequency: e.target.value })} /></div>
              <div className="form-group"><label>{s.hours}</label><input type="number" value={form.hours_per_visit || ''} onChange={e => setForm({ ...form, hours_per_visit: e.target.value })} /></div>
              <div className="form-group"><label>{s.siteVisit}</label><input type="date" value={form.site_visit_date || ''} onChange={e => setForm({ ...form, site_visit_date: e.target.value })} /></div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title" style={{ margin: 0 }}>{s.items}</div>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setItems(its => [...its, emptyQuoteItem()])}>{s.addLine}</button>
            </div>
            {items.map((it, i) => (
              <div key={i} className="invoice-line">
                <input value={it.description} onChange={e => updItem(i, 'description', e.target.value)} placeholder={s.description} />
                <input type="number" value={it.quantity} onChange={e => updItem(i, 'quantity', e.target.value)} />
                <input type="number" value={it.unit_price} onChange={e => updItem(i, 'unit_price', e.target.value)} />
                <div className="invoice-line-total">{yen(it.total)}</div>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => setItems(its => its.filter((_, idx) => idx !== i))}>✕</button>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: 13, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text3)' }}>{s.subtotal}: <strong>{yen(subtotal)}</strong></span>
              <span style={{ color: 'var(--text3)' }}>{s.tax} ({form.tax_rate}%): <strong>{yen(tax)}</strong></span>
              <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 15 }}>{s.total}: {yen(total)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleCreate}>{saving ? t.app.loading : s.createQuote}</button>
            <button type="button" className="btn" onClick={() => setTab('list')}>{s.cancel}</button>
          </div>
        </div>
      )}
    </div>
  )
}
