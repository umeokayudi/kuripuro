import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang, fill } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { APP_VERSION } from '../lib/appVersion'
import { lineTotal } from '../lib/invoice'
import { QUOTE_ISSUER } from '../lib/quoteIssuer'
import {
  buildMitsumoriPrintHtml,
  defaultValidUntil,
  emptyLead,
  emptyQuoteItem,
  findLeadByCompany,
  isQuoteEditable,
  isCrmSchemaMissing,
  leadFromRow,
  mergeLeadFromQuote,
  nextQuoteNumber,
  quoteTotals,
  quoteWritePayload,
  yen,
  isSalesSchemaMissing,
  dropSiteNameKeepNote,
  stripCrmExtras,
  restaurantFromNotes,
  notesForPrint,
} from '../lib/sales'
import SalesLeadFields from '../components/SalesLeadFields'
import SalesSetupCard, { SalesCrmSetupCard } from '../components/SalesSetupCard'
import SalesTouchpoints from '../components/SalesTouchpoints'

const QUOTE_FILTERS = ['all', 'draft', 'sent', 'accepted', 'declined']

function blankForm(today) {
  return {
    ...emptyLead(today, 'followup'),
    tax_rate: 10,
    valid_until: defaultValidUntil(today),
    frequency: '',
    hours_per_visit: '',
    site_visit_date: '',
  }
}

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
  const [crmOk, setCrmOk] = useState(true)
  const [tab, setTab] = useState(leadId ? 'form' : 'list')
  const [statusFilter, setStatusFilter] = useState('all')
  const [editingId, setEditingId] = useState(null)
  const [editingStatus, setEditingStatus] = useState('draft')
  const [editingLeadId, setEditingLeadId] = useState(null)
  const [form, setForm] = useState(() => blankForm(today))
  const [items, setItems] = useState([emptyQuoteItem()])
  const [saving, setSaving] = useState(false)

  const locked = editingId ? !isQuoteEditable(editingStatus) : false

  const load = async () => {
    setLoading(true)
    const [q, l, tp] = await Promise.all([
      supabase.from('mitsumori').select('*').order('created_at', { ascending: false }),
      supabase.from('sales_leads').select('*').order('company_name'),
      supabase.from('sales_touchpoints').select('id').limit(1),
    ])
    if (q.error || l.error) {
      const err = q.error || l.error
      if (isSalesSchemaMissing(err)) setSchemaOk(false)
      else toast.error(err.message)
    } else {
      setSchemaOk(true)
      setQuotes((q.data || []).map(row => ({
        ...row,
        site_name: row.site_name || restaurantFromNotes(row.notes) || '',
      })))
      setLeads((l.data || []).map(row => ({
        ...row,
        site_name: row.site_name || restaurantFromNotes(row.notes) || '',
      })))
    }
    if (tp.error) {
      if (isCrmSchemaMissing(tp.error) || isSalesSchemaMissing(tp.error)) setCrmOk(false)
    } else {
      setCrmOk(true)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!leadId || loading) return
    const row = leads.find(x => x.id === leadId)
    if (!row) return
    setEditingId(null)
    setEditingStatus('draft')
    setEditingLeadId(row.id)
    setForm(f => ({
      ...blankForm(today),
      ...leadFromRow(row, today),
      tax_rate: f.tax_rate,
      valid_until: f.valid_until || defaultValidUntil(today),
    }))
    setItems([emptyQuoteItem()])
    setTab('form')
  }, [leadId, loading])

  const totals = quoteTotals(items, form.tax_rate)
  const { subtotal, taxAmount: tax, total } = totals

  const pickLead = (id) => {
    if (locked) return
    const row = leads.find(x => x.id === id)
    if (!row) return
    setEditingLeadId(row.id)
    setForm(f => ({ ...f, ...leadFromRow(row, today), tax_rate: f.tax_rate, valid_until: f.valid_until }))
  }

  const startNew = () => {
    setEditingId(null)
    setEditingStatus('draft')
    setEditingLeadId(null)
    setForm(blankForm(today))
    setItems([emptyQuoteItem()])
    setTab('form')
  }

  const startEdit = async (row) => {
    setEditingId(row.id)
    setEditingStatus(row.status || 'draft')
    setEditingLeadId(row.lead_id || null)
    const lead = leads.find(x => x.id === row.lead_id)
    setForm({
      ...blankForm(today),
      ...(lead ? leadFromRow(lead, today) : {}),
      ...row,
      site_name: row.site_name || restaurantFromNotes(row.notes) || lead?.site_name || '',
      notes: notesForPrint(row.notes),
      tax_rate: row.tax_rate ?? 10,
      hours_per_visit: row.hours_per_visit ?? '',
    })
    const { data, error } = await supabase.from('mitsumori_items').select('*').eq('mitsumori_id', row.id)
    if (error) toast.error(error.message)
    setItems((data || []).length ? data.map(it => ({
      id: it.id,
      description: it.description || '',
      quantity: it.quantity ?? 1,
      unit_price: it.unit_price ?? 0,
      total: it.total ?? 0,
    })) : [emptyQuoteItem()])
    setTab('form')
  }

  const updItem = (i, k, v) => setItems(its => its.map((it, idx) => {
    if (idx !== i) return it
    const updated = { ...it, [k]: v }
    if (k === 'quantity' || k === 'unit_price') updated.total = lineTotal(updated.quantity, updated.unit_price)
    return updated
  }))

  const upsertLead = async () => {
    const existing = editingLeadId
      ? leads.find(x => x.id === editingLeadId)
      : findLeadByCompany(leads, form.company_name)
    const leadPayload = mergeLeadFromQuote(existing, form, today)
    const run = (body) => existing
      ? supabase.from('sales_leads').update(body).eq('id', existing.id).select().single()
      : supabase.from('sales_leads').insert(body).select().single()
    let { data, error } = await run(leadPayload)
    if (error && isCrmSchemaMissing(error)) {
      setCrmOk(false)
      ;({ data, error } = await run(dropSiteNameKeepNote(stripCrmExtras(leadPayload))))
    }
    if (error) throw error
    return data
  }

  const replaceItems = async (quoteId) => {
    await supabase.from('mitsumori_items').delete().eq('mitsumori_id', quoteId)
    for (const item of items.filter(it => it.description)) {
      const { error: iErr } = await supabase.from('mitsumori_items').insert({
        mitsumori_id: quoteId,
        description: item.description,
        quantity: parseFloat(item.quantity) || 1,
        unit_price: parseFloat(item.unit_price) || 0,
        total: parseFloat(item.total) || 0,
      })
      if (iErr) toast.error(iErr.message)
    }
  }

  const saveInterestOnly = async (lead) => {
    const patch = { interest: form.interest || '', updated_at: new Date().toISOString() }
    if (lead?.id) {
      const { error } = await supabase.from('sales_leads').update(patch).eq('id', lead.id)
      if (error && isCrmSchemaMissing(error)) setCrmOk(false)
      else if (error) throw error
    }
    if (editingId) {
      const { error } = await supabase.from('mitsumori').update({ interest: form.interest || '' }).eq('id', editingId)
      if (error && isCrmSchemaMissing(error)) setCrmOk(false)
      else if (error) throw error
    }
  }

  const handleSave = async () => {
    if (!String(form.company_name || '').trim()) return toast.error(s.missingCompany)
    if (!String(form.site_name || '').trim()) return toast.error(s.missingSite)
    if (!String(form.contact_name || '').trim()) return toast.error(s.missingContact)
    if (!locked && (!items.length || items.every(it => !it.description))) return toast.error(s.addItem)
    setSaving(true)
    try {
      if (locked) {
        const lead = editingLeadId ? leads.find(x => x.id === editingLeadId) : findLeadByCompany(leads, form.company_name)
        await saveInterestOnly(lead)
        toast.success(s.updated)
        load()
        return
      }
      const lead = await upsertLead()
      setEditingLeadId(lead.id)
      if (editingId) {
        const payload = quoteWritePayload(form, lead.id, totals)
        let { error } = await supabase.from('mitsumori').update(payload).eq('id', editingId)
        if (error && isCrmSchemaMissing(error)) {
          setCrmOk(false)
          ;({ error } = await supabase.from('mitsumori').update(dropSiteNameKeepNote(stripCrmExtras(payload))).eq('id', editingId))
        }
        if (error) {
          if (isSalesSchemaMissing(error)) setSchemaOk(false)
          throw error
        }
        await replaceItems(editingId)
        toast.success(s.updated)
      } else {
        const quoteNumber = nextQuoteNumber(quotes, today)
        const payload = quoteWritePayload(form, lead.id, totals, {
          quote_number: quoteNumber,
          issue_date: today,
          status: 'draft',
        })
        let { data: quote, error: qErr } = await supabase.from('mitsumori').insert(payload).select().single()
        if (qErr && isCrmSchemaMissing(qErr)) {
          setCrmOk(false)
          ;({ data: quote, error: qErr } = await supabase.from('mitsumori').insert(dropSiteNameKeepNote(stripCrmExtras(payload))).select().single())
        }
        if (qErr) {
          if (isSalesSchemaMissing(qErr)) setSchemaOk(false)
          throw qErr
        }
        await replaceItems(quote.id)
        toast.success(s.created)
        setEditingId(quote.id)
        setEditingStatus('draft')
      }
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
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
    if (editingId === row.id) setEditingStatus(status)
    load()
  }

  const handleDelete = async (id) => {
    if (!window.confirm(s.deleteQuoteConfirm)) return
    const { error } = await supabase.from('mitsumori').delete().eq('id', id)
    if (error) return toast.error(error.message)
    toast(s.deleted)
    if (editingId === id) startNew()
    load()
  }

  const openPrint = async (row, autoPrint) => {
    const { data, error } = await supabase.from('mitsumori_items').select('*').eq('mitsumori_id', row.id)
    if (error) return toast.error(error.message)
    const w = window.open('', '_blank')
    if (!w) return toast.error(s.popupBlocked)
    const lead = leads.find(x => x.id === row.lead_id)
    const printRow = {
      ...row,
      site_name: row.site_name || restaurantFromNotes(row.notes) || lead?.site_name || '',
    }
    w.document.write(buildMitsumoriPrintHtml(printRow, data || [], QUOTE_ISSUER))
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
      {schemaOk && !crmOk && <SalesCrmSetupCard onRecheck={load} />}

      <div className="tab-pills">
        <button type="button" className={`tab-pill${tab === 'list' ? ' active' : ''}`} onClick={() => setTab('list')}>{fill(s.quoteList, { n: quotes.length })}</button>
        <button type="button" className={`tab-pill${tab === 'form' ? ' active' : ''}`} onClick={startNew}>{s.quoteNew}</button>
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
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{q.site_name || q.company_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>{q.quote_number} · {q.site_name ? `${q.company_name} · ` : ''}{s.contact}: {q.contact_name || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>{s.firstContact}: {q.first_contact_date || '—'} · {s.validUntil}: {q.valid_until || '—'}</div>
                  {q.needs && <div style={{ fontSize: 12, marginTop: 4 }}>{s.needs}: {q.needs}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{yen(q.total)}</div>
                  <span className={`badge ${badge(q.status)}`}>{s.quoteStatuses?.[q.status] || q.status}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => startEdit(q)}>{s.edit}</button>
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

      {tab === 'form' && (
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">{editingId ? s.quoteTitleEdit : s.quoteTitle}</div>
            {locked && <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 10 }}>{s.lockedAfterSend}</div>}
            {leads.length > 0 && !editingId && (
              <div className="form-group">
                <label>{s.prefillLead}</label>
                <select value="" onChange={e => { if (e.target.value) pickLead(e.target.value) }}>
                  <option value="">{s.prefillLead}</option>
                  {leads.map(l => <option key={l.id} value={l.id}>{(l.site_name ? `${l.site_name} / ` : '') + l.company_name} — {l.contact_name || ''} ({s.stages?.[l.stage] || l.stage})</option>)}
                </select>
              </div>
            )}
            <SalesLeadFields form={form} onChange={setForm} s={s} locked={locked} requiredSite />
            <div className="grid-2" style={{ marginTop: 8 }}>
              <div className="form-group"><label>{s.validUntil}</label><input type="date" value={form.valid_until || ''} disabled={locked} onChange={e => setForm({ ...form, valid_until: e.target.value })} /></div>
              <div className="form-group"><label>{inv.taxRate}</label>
                <select value={form.tax_rate} disabled={locked} onChange={e => setForm({ ...form, tax_rate: e.target.value })}>
                  <option value={10}>10%</option><option value={8}>8%</option><option value={0}>0%</option>
                </select>
              </div>
              <div className="form-group"><label>{s.frequency}</label><input value={form.frequency || ''} disabled={locked} onChange={e => setForm({ ...form, frequency: e.target.value })} /></div>
              <div className="form-group"><label>{s.hours}</label><input type="number" value={form.hours_per_visit || ''} disabled={locked} onChange={e => setForm({ ...form, hours_per_visit: e.target.value })} /></div>
              <div className="form-group"><label>{s.siteVisit}</label><input type="date" value={form.site_visit_date || ''} disabled={locked} onChange={e => setForm({ ...form, site_visit_date: e.target.value })} /></div>
            </div>
            <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)', fontSize: 13, lineHeight: 1.65 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)', letterSpacing: '0.08em', marginBottom: 4 }}>{s.issuer}</div>
              <div style={{ fontWeight: 700 }}>{QUOTE_ISSUER.company}</div>
              <div>{s.issuerTitle}：{QUOTE_ISSUER.name}</div>
              <div>{s.issuerAddress}：{QUOTE_ISSUER.address}</div>
              <div>{s.issuerReg}：{QUOTE_ISSUER.regNumber}</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title" style={{ margin: 0 }}>{s.items}</div>
              <button type="button" className="btn btn-sm btn-primary" disabled={locked} onClick={() => setItems(its => [...its, emptyQuoteItem()])}>{s.addLine}</button>
            </div>
            {items.map((it, i) => (
              <div key={it.id || i} className="invoice-line">
                <input value={it.description} disabled={locked} onChange={e => updItem(i, 'description', e.target.value)} placeholder={s.description} />
                <input type="number" value={it.quantity} disabled={locked} onChange={e => updItem(i, 'quantity', e.target.value)} />
                <input type="number" value={it.unit_price} disabled={locked} onChange={e => updItem(i, 'unit_price', e.target.value)} />
                <div className="invoice-line-total">{yen(it.total)}</div>
                <button type="button" className="btn btn-sm btn-danger" disabled={locked} onClick={() => setItems(its => its.filter((_, idx) => idx !== i))}>✕</button>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: 13, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text3)' }}>{s.subtotal}: <strong>{yen(subtotal)}</strong></span>
              <span style={{ color: 'var(--text3)' }}>{s.tax} ({form.tax_rate}%): <strong>{yen(tax)}</strong></span>
              <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 15 }}>{s.total}: {yen(total)}</span>
            </div>
          </div>

          {(editingId || editingLeadId) && (
            <SalesTouchpoints
              leadId={editingLeadId}
              mitsumoriId={editingId}
              s={s}
              today={today}
              onCrmMissing={() => setCrmOk(false)}
            />
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? t.app.loading : (editingId ? s.saveQuote : s.createQuote)}</button>
            <button type="button" className="btn" onClick={() => setTab('list')}>{s.cancel}</button>
          </div>
        </div>
      )}
    </div>
  )
}
