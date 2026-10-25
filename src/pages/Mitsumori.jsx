import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePendingCounts } from '../components/Sidebar'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { lineTotal, yen } from '../lib/quoteMath'
import { useLang, fill, pickLang } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { QUOTE_ISSUER } from '../lib/quoteIssuer'
import { openPrintHtml } from '../lib/openPrintHtml'
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
  dropSiteNameKeepNote,
  stripCrmExtras,
  restaurantFromNotes,
  notesForPrint,
} from '../lib/sales'
import SalesLeadFields from '../components/SalesLeadFields'
import StoreDossier from '../components/facility/StoreDossier'
import ClientQuoteBox from '../components/ClientQuoteBox'
import QuoteTracker from '../components/QuoteTracker'
import QuoteProgress from '../components/QuoteProgress'
import { quoteFromMitsumori, quoteFromRequest, fetchQuoteSessions, quoteStage, quoteRef, QUOTE_FLOW_CHANGED } from '../lib/quoteFlow'
import { QUOTE_REQUESTS_CHANGED } from '../lib/quoteRequests'
import { fetchContractSellers } from '../lib/contractSellers'
import { quoteSellerFor } from '../lib/quoteSeller'
import { ClientLink } from '../components/ClientSheetHost'

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
  const { t, lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const s = t.sales
  const inv = t.invoices
  const today = tokyoToday()
  const [params] = useSearchParams()
  const pending = usePendingCounts()
  const leadId = params.get('lead')
  const [quotes, setQuotes] = useState([])
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState(leadId ? 'form' : params.get('tab') === 'requests' ? 'requests' : 'list')
  // v1.0.70 · client quote requests live here too (they were only in Client feedback → Requests)
  const [requests, setRequests] = useState([])
  const [reqClients, setReqClients] = useState([])
  const [reqContracts, setReqContracts] = useState([])
  const [sellers, setSellers] = useState([])
  const [reqFilter, setReqFilter] = useState('open')
  const [reqDossier, setReqDossier] = useState(null)
  const [tracking, setTracking] = useState(null)
  const [flow, setFlow] = useState({})
  const [statusFilter, setStatusFilter] = useState('all')
  const [editingId, setEditingId] = useState(null)
  const [editingStatus, setEditingStatus] = useState('draft')
  const [editingLeadId, setEditingLeadId] = useState(null)
  const [form, setForm] = useState(() => blankForm(today))
  // ficha da loja (3D, fotos, local, medidas): espera parar de digitar o nome antes de buscar
  const [dossierKey, setDossierKey] = useState({ company: '', site: '' })
  useEffect(() => {
    const id = setTimeout(() => setDossierKey({ company: form.company_name || '', site: form.site_name || '' }), 600)
    return () => clearTimeout(id)
  }, [form.company_name, form.site_name])
  const [items, setItems] = useState([emptyQuoteItem()])
  const [saving, setSaving] = useState(false)

  const locked = editingId ? !isQuoteEditable(editingStatus) : false

  const load = async () => {
    setLoading(true)
    const [q, l] = await Promise.all([
      supabase.from('mitsumori').select('*').order('created_at', { ascending: false }),
      supabase.from('sales_leads').select('*').order('company_name'),
    ])
    if (q.error || l.error) {
      const err = q.error || l.error
      toast.error(err.message)
    } else {
      setQuotes((q.data || []).map(row => ({
        ...row,
        site_name: row.site_name || restaurantFromNotes(row.notes) || '',
      })))
      setLeads((l.data || []).map(row => ({
        ...row,
        site_name: row.site_name || restaurantFromNotes(row.notes) || '',
      })))
    }
    setLoading(false)
  }

  const loadRequests = async () => {
    const [rq, cl, sc] = await Promise.all([
      supabase.from('client_requests').select('*').eq('request_type', 'quote').order('created_at', { ascending: false }).limit(200),
      supabase.from('clients').select('id,company_name,salesperson_id,address'),
      supabase.from('service_contracts').select('client_id,location_name,salesperson_id').not('salesperson_id', 'is', null),
    ])
    setRequests(rq.data || [])
    setReqClients(cl.data || [])
    setReqContracts(sc.data || [])
  }

  useEffect(() => {
    load(); loadRequests()
    fetchContractSellers().then(r => setSellers(r.salespeople || [])).catch(() => {})
    const reload = () => { load(); loadRequests() }
    window.addEventListener(QUOTE_FLOW_CHANGED, reload)
    window.addEventListener(QUOTE_REQUESTS_CHANGED, loadRequests)
    return () => { window.removeEventListener(QUOTE_FLOW_CHANGED, reload); window.removeEventListener(QUOTE_REQUESTS_CHANGED, loadRequests) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // sessions of each accepted quote, for its button and its follow-up strip
  useEffect(() => {
    const accepted = quotes.filter(q => q.status === 'accepted')
    if (!accepted.length) return
    Promise.all(accepted.map(q => fetchQuoteSessions(quoteRef('mitsumori', q.id)).then(rows => [q.id, rows]).catch(() => [q.id, []])))
      .then(pairs => setFlow(Object.fromEntries(pairs)))
  }, [quotes])

  // ?track=req:<id> | mit:<id> (from the bell) opens the follow-up of that accepted quote
  const trackParam = params.get('track')
  useEffect(() => {
    if (!trackParam || tracking) return
    const [kind, id] = trackParam.split(':')
    if (kind === 'mit') {
      const q = quotes.find(x => x.id === id)
      if (q) { setTab('list'); setTracking(quoteFromMitsumori(q)) }
    } else {
      const rq = requests.find(x => x.id === id)
      if (rq) { setTab('requests'); setTracking(quoteFromRequest({ ...rq, account_seller_id: quoteSellerFor(rq, reqClients.find(c => c.id === rq.client_id), reqContracts) }, reqClients.find(c => c.id === rq.client_id))) }
    }
  }, [trackParam, quotes, requests]) // eslint-disable-line react-hooks/exhaustive-deps

  const reqOpen = r => !['declined'].includes(r.quote_status) && r.status !== 'completed'
  const reqVisible = requests.filter(r => reqFilter === 'all' ? true : reqFilter === 'accepted' ? r.quote_status === 'accepted' : reqOpen(r))
  const reqWaiting = requests.filter(r => !r.quote_status || r.quote_status === 'requested').length

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
      if (error && !isCrmSchemaMissing(error)) throw error
    }
    if (editingId) {
      const { error } = await supabase.from('mitsumori').update({ interest: form.interest || '' }).eq('id', editingId)
      if (error && !isCrmSchemaMissing(error)) throw error
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
          ;({ error } = await supabase.from('mitsumori').update(dropSiteNameKeepNote(stripCrmExtras(payload))).eq('id', editingId))
        }
        if (error) {
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
          ;({ data: quote, error: qErr } = await supabase.from('mitsumori').insert(dropSiteNameKeepNote(stripCrmExtras(payload))).select().single())
        }
        if (qErr) {
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
    const patch = { status }
    if (status === 'accepted' || status === 'declined') {
      const reason = window.prompt(status === 'declined' ? s.declineReasonPrompt : s.acceptReasonPrompt, '')
      if (reason === null) return
      if (reason.trim()) patch.decision_reason = reason.trim().slice(0, 1000)
    }
    let { error } = await supabase.from('mitsumori').update(patch).eq('id', row.id)
    // Older databases without the decision_reason column still get the status change.
    if (error && patch.decision_reason && /decision_reason/.test(error.message || '')) ({ error } = await supabase.from('mitsumori').update({ status }).eq('id', row.id))
    if (error) return toast.error(error.message)
    if (status === 'accepted' && row.lead_id) {
      await supabase.from('sales_leads').update({ stage: 'won', last_contact_date: today, updated_at: new Date().toISOString() }).eq('id', row.lead_id)
    }
    if (status === 'declined' && row.lead_id) {
      await supabase.from('sales_leads').update({ stage: 'lost', ...(patch.decision_reason ? { lost_reason: patch.decision_reason } : {}), last_contact_date: today, updated_at: new Date().toISOString() }).eq('id', row.lead_id)
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

  const openPrint = async (row, autoPrint, lang = 'ja') => {
    const { data, error } = await supabase.from('mitsumori_items').select('*').eq('mitsumori_id', row.id)
    if (error) return toast.error(error.message)
    const lead = leads.find(x => x.id === row.lead_id)
    const fromForm = editingId && row.id === editingId ? form : {}
    const printRow = {
      ...row,
      ...fromForm,
      company_name: fromForm.company_name || row.company_name,
      address: fromForm.address || row.address,
      contact_name: fromForm.contact_name || row.contact_name,
      contact_title: fromForm.contact_title || row.contact_title,
      notes: fromForm.notes || row.notes,
      frequency: fromForm.frequency || row.frequency,
      hours_per_visit: fromForm.hours_per_visit || row.hours_per_visit,
      site_name: fromForm.site_name
        || row.site_name
        || restaurantFromNotes(fromForm.notes || row.notes)
        || lead?.site_name
        || restaurantFromNotes(lead?.notes)
        || '',
    }
    const opened = openPrintHtml(buildMitsumoriPrintHtml(printRow, data || [], {}, lang), { autoPrint })
    if (!opened.ok) toast.error(s.popupBlocked)
  }

  const visible = quotes.filter(q => statusFilter === 'all' || q.status === statusFilter)
  const editingQuote = editingId ? quotes.find(q => q.id === editingId) : null
  const badge = st => ({ draft: 'badge-amber', sent: 'badge-blue', accepted: 'badge-green', declined: 'badge-red', expired: 'badge-navy' }[st] || 'badge-navy')

  return (
    <div className="mitsumori-page">
      <style>{`.mitsumori-page .invoice-line{display:grid;grid-template-columns:minmax(140px,1fr) 90px 120px auto 36px;gap:8px;align-items:center;margin:8px 0}.mitsumori-page .invoice-line input{min-width:0;width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)}.mitsumori-page .invoice-line-total{min-width:72px;text-align:right;font-weight:600}@media(max-width:640px){.mitsumori-page .invoice-line{grid-template-columns:minmax(0,1fr) 1fr 1fr 36px;gap:6px}.mitsumori-page .invoice-line input:first-child{grid-column:1/-1}.mitsumori-page .invoice-line-total{grid-column:1/4;text-align:left;padding:4px 2px}}`}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 className="page-head" style={{ margin: 0, fontSize: 22 }}>{t.sidebar.mitsumori}</h2>
        </div>
      </div>


      <div className="tab-pills">
        <button type="button" className={`tab-pill${tab === 'list' ? ' active' : ''}`} onClick={() => setTab('list')}>{fill(s.quoteList, { n: quotes.length })}</button>
        <button type="button" className={`tab-pill${tab === 'form' ? ' active' : ''}`} onClick={startNew}>{s.quoteNew}</button>
        <button type="button" className={`tab-pill${tab === 'requests' ? ' active' : ''}`} onClick={() => setTab('requests')}>
          {L('Client requests', 'お客様からの依頼', 'Pedidos de clientes')} ({requests.length})
          {(reqWaiting || pending.mitsumori) > 0 && <span className="nav-count" style={{ marginLeft: 6 }}>{reqWaiting || pending.mitsumori}</span>}
        </button>
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
                  <div style={{ fontWeight: 700, fontSize: 15 }}><ClientLink name={q.company_name}>{q.site_name || q.company_name}</ClientLink></div>
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
                <button type="button" className="btn btn-sm" onClick={() => openPrint(q, false, 'ja')}>{s.printJa}</button>
                <button type="button" className="btn btn-sm" onClick={() => openPrint(q, false, 'en')}>{s.printEn}</button>
                {q.status === 'draft' && <button type="button" className="btn btn-sm btn-primary" onClick={() => handleStatus(q, 'sent')}>{s.markSent}</button>}
                {q.status === 'sent' && <button type="button" className="btn btn-sm" style={{ background: 'var(--green)', color: '#fff' }} onClick={() => handleStatus(q, 'accepted')}>{s.markAccepted}</button>}
                {q.status === 'accepted' && (() => {
                  const stage = flow[q.id] ? quoteStage(flow[q.id]) : 'approved'
                  return (
                    <button type="button" className={`btn btn-sm${stage !== 'approved' ? '' : ' btn-primary'}`} onClick={() => setTracking(quoteFromMitsumori(q))}>
                      📅 {stage === 'done' ? L('Done · see invoice', '完了・請求書を見る', 'Feito · ver nota') : stage === 'scheduled' ? L('Scheduled · follow up', '予約済み・進捗を見る', 'Agendado · acompanhar') : L('Book the date and follow up', '日程を決めて進める', 'Marcar a data e acompanhar')}
                    </button>
                  )
                })()}
                {q.status !== 'declined' && q.status !== 'accepted' && <button type="button" className="btn btn-sm btn-danger" onClick={() => handleStatus(q, 'declined')}>{s.markDeclined}</button>}
                <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDelete(q.id)}>{s.delete}</button>
              </div>
              {q.status === 'accepted' && flow[q.id] && <QuoteProgress sessions={flow[q.id]} onOpen={() => setTracking(quoteFromMitsumori(q))} />}
            </div>
          ))}
        </div>
      )}

      {tab === 'requests' && (
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {[['open', L('Open', '対応中', 'Em aberto')], ['accepted', L('Accepted', '承認済み', 'Aceitos')], ['all', s.filterAll]].map(([k, label]) => (
              <button key={k} type="button" className={`tab-pill${reqFilter === k ? ' active' : ''}`} onClick={() => setReqFilter(k)}>{label}</button>
            ))}
          </div>
          {!reqVisible.length && <div className="card"><div style={{ color: 'var(--text3)', fontSize: 13 }}>{L('No client requests here.', '依頼はありません。', 'Nenhum pedido de cliente aqui.')}</div></div>}
          {reqVisible.map(row => (
            <div key={row.id} className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}><ClientLink id={row.client_id} name={reqClients.find(c => c.id === row.client_id)?.company_name} /></div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                    {row.location_name || '—'} · {String(row.created_at || '').slice(0, 10)}
                    {row.preferred_date ? ` · ${L('wanted', '希望日', 'quer em')} ${row.preferred_date}` : ''}
                  </div>
                </div>
                {row.quote_amount != null && <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{yen(row.quote_amount)}</div>}
              </div>
              {row.description && <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>{row.description}</div>}
              <button type="button" className="btn btn-sm" style={{ marginBottom: 8 }} onClick={() => setReqDossier(v => (v === row.id ? null : row.id))}>
                📷 {L('Store: photos, cleanings, size', '店舗：写真・清掃・広さ', 'Loja: fotos, limpezas e tamanho')} {reqDossier === row.id ? '▲' : '▼'}
              </button>
              {reqDossier === row.id && <StoreDossier clientId={row.client_id} locationName={row.location_name} />}
              <ClientQuoteBox row={row} clients={reqClients} contracts={reqContracts} sellers={sellers} onChanged={loadRequests}
                onTrack={(rq, client) => setTracking(quoteFromRequest(rq, client))} />
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
            <SalesLeadFields form={form} onChange={setForm} s={s} locked={locked} />
            {dossierKey.company.trim().length >= 2 && (
              <StoreDossier companyName={dossierKey.company} locationName={dossierKey.site || null}
                onUseSummary={locked ? undefined : text => setForm(f => ({ ...f, notes: f.notes ? `${f.notes}\n\n${text}` : text }))} />
            )}
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


          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? t.app.loading : (editingId ? s.saveQuote : s.createQuote)}</button>
            {editingQuote && (
              <>
                <button type="button" className="btn" onClick={() => openPrint(editingQuote, false, 'ja')}>{s.printJa}</button>
                <button type="button" className="btn" onClick={() => openPrint(editingQuote, false, 'en')}>{s.printEn}</button>
              </>
            )}
            <button type="button" className="btn" onClick={() => setTab('list')}>{s.cancel}</button>
          </div>
        </div>
      )}
      {tracking && <QuoteTracker quote={tracking} onClose={() => { setTracking(null); load(); loadRequests() }} />}
    </div>
  )
}
