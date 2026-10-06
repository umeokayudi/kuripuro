import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { useLang, fill } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { usePeriod } from '../hooks/usePeriod'
import { filterByPeriodKeepOpen } from '../lib/period'
import { APP_VERSION } from '../lib/appVersion'
import { QUOTE_ISSUER } from '../lib/quoteIssuer'
import {
  addDays,
  billingPeriodForDate,
  buildInvoicePrintHtml,
  buildMonthlyChargeItems,
  calendarMonthPeriod,
  cashflowDescription,
  complaintInPeriod,
  contractMonthlyAmount,
  dailyRateFromMonthly,
  invoiceAlreadyExists,
  invoiceTotals,
  isMonthEndBillingDay,
  lineTotal,
  makeDiscountLine,
  nextInvoiceNumber,
  planMonthlyInvoices,
  yen,
} from '../lib/invoice'

const STATUSES = ['all', 'draft', 'sent', 'paid', 'cancelled']
const ALERT_KEY = 'kp_invoice_month_end_dismiss'

function displayNumber(f) {
  if (f.invoice_number) return f.invoice_number
  const first = String(f.notes || '').split('\n')[0]
  if (first.startsWith('KP-')) return first
  return String(f.id || '').slice(0, 8)
}

function emptyForm(today) {
  const period = billingPeriodForDate(today)
  return {
    id: null,
    client_id: '',
    period_start: period.start,
    period_end: period.end,
    due_date: addDays(today, 30),
    tax_rate: 10,
    notes: '',
  }
}

function lineLabels(inv) {
  return {
    monthlyLine: inv.monthlyLine,
    monthlyFallback: inv.monthlyFallback,
    discountLine: inv.discountLine,
    discountDaysLine: inv.discountDaysLine,
  }
}

export default function Faturas() {
  const { t } = useLang()
  const inv = t.invoices
  const labels = useMemo(
    () => lineLabels(inv),
    [inv.monthlyLine, inv.monthlyFallback, inv.discountLine, inv.discountDaysLine]
  )
  const today = tokyoToday()
  const { start, end } = usePeriod()
  const monthEnd = isMonthEndBillingDay(today)
  const defaultPeriod = billingPeriodForDate(today)
  const [searchParams, setSearchParams] = useSearchParams()
  const [faturas, setFaturas] = useState([])
  const [clients, setClients] = useState([])
  const [contracts, setContracts] = useState([])
  const [complaints, setComplaints] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState(() => searchParams.get('tab') === 'auto' ? 'auto' : 'list')
  const [statusFilter, setStatusFilter] = useState('all')
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(() => emptyForm(today))
  const [discount, setDiscount] = useState({ reason: '', days: '', amount: '' })
  const [planRows, setPlanRows] = useState([])
  const [planSkipped, setPlanSkipped] = useState([])
  const [planPeriod, setPlanPeriod] = useState(defaultPeriod)
  const [planTax, setPlanTax] = useState(10)
  const [extras, setExtras] = useState({})
  const [alertDismissed, setAlertDismissed] = useState(() => {
    try { return localStorage.getItem(ALERT_KEY) === defaultPeriod.start } catch { return false }
  })

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [f, c, sc, cp] = await Promise.all([
      supabase.from('faturas').select('*').order('created_at', { ascending: false }),
      supabase.from('clients').select('*').eq('is_active', true).order('company_name'),
      supabase.from('service_contracts').select('*').eq('is_active', true),
      supabase.from('client_complaints').select('*').order('created_at', { ascending: false }).limit(200),
    ])
    if (f.error) toast.error(f.error.message)
    setFaturas(f.data || [])
    setClients(c.data || [])
    setContracts(sc.error ? [] : (sc.data || []))
    setComplaints(cp.error ? [] : (cp.data || []))
    setLoading(false)
  }

  const contractsFor = (clientId) => contracts.filter(x => x.client_id === clientId)
  const clientMonthly = (client) => {
    const list = contractsFor(client.id)
    const fromContracts = list.reduce((s, c) => s + contractMonthlyAmount(c), 0)
    return fromContracts > 0 ? fromContracts : Number(client.monthly_revenue || 0)
  }

  const rebuildChargeItems = (clientId, start, end, extraDiscountItems = []) => {
    const client = clients.find(c => c.id === clientId)
    const charges = buildMonthlyChargeItems(contractsFor(clientId), client, labels)
    setItems([...charges, ...extraDiscountItems])
    if (clientId && start && end) {
      supabase.from('jobs').select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .gte('scheduled_date', start)
        .lte('scheduled_date', end)
        .eq('status', 'completed')
        .then(({ count, error }) => {
          if (!error) setJobs(Array.from({ length: count || 0 }, (_, i) => ({ id: i })))
        })
    } else {
      setJobs([])
    }
  }

  const upd = (k, v) => {
    setForm(f => {
      const next = { ...f, [k]: v }
      if (k === 'client_id' || k === 'period_start' || k === 'period_end') {
        if (next.client_id && next.period_start && next.period_end) {
          rebuildChargeItems(next.client_id, next.period_start, next.period_end)
        }
      }
      return next
    })
  }

  const updItem = (i, k, v) => setItems(its => its.map((it, idx) => {
    if (idx !== i) return it
    const updated = { ...it, [k]: v }
    if (k === 'quantity' || k === 'unit_price') updated.total = lineTotal(updated.quantity, updated.unit_price)
    return updated
  }))

  const addItem = () => setItems(its => [...its, { job_id: null, kind: 'extra', description: '', quantity: 1, unit_price: 0, total: 0 }])
  const removeItem = (i) => setItems(its => its.filter((_, idx) => idx !== i))

  const dailyRate = (() => {
    const monthly = items.filter(it => it.kind !== 'discount').reduce((s, it) => s + Number(it.total || 0), 0)
    return dailyRateFromMonthly(monthly, form.period_end || form.period_start)
  })()

  const addDiscountLine = (partial = {}) => {
    const reason = partial.reason ?? discount.reason
    const days = partial.days ?? discount.days
    const amount = partial.amount ?? discount.amount
    const line = makeDiscountLine({
      reason: reason || inv.reasonOther,
      days,
      dailyRate,
      amount: amount === '' ? undefined : amount,
      labels,
    })
    if (!line.total) return toast.error(inv.addItem)
    setItems(its => [...its, line])
    setDiscount({ reason: '', days: '', amount: '' })
  }

  const { subtotal, taxAmount: tax, total } = invoiceTotals(items, form.tax_rate)

  const insertInvoice = async (payload) => {
    const first = await supabase.from('faturas').insert(payload).select().single()
    if (!first.error) return first
    if (!payload.invoice_number) return first
    const { invoice_number, ...rest } = payload
    const retry = await supabase.from('faturas').insert({
      ...rest,
      notes: [invoice_number, rest.notes].filter(Boolean).join('\n'),
    }).select().single()
    if (!retry.error) retry.data = { ...retry.data, invoice_number }
    return retry
  }

  const saveItems = async (faturaId, lineItems) => {
    await supabase.from('fatura_items').delete().eq('fatura_id', faturaId)
    for (const item of lineItems) {
      const { error: itemErr } = await supabase.from('fatura_items').insert({
        fatura_id: faturaId,
        job_id: item.job_id || null,
        description: item.description,
        quantity: Number(item.quantity) || 1,
        unit_price: parseFloat(item.unit_price) || 0,
        total: parseFloat(item.total) || 0,
      })
      if (itemErr) toast.error(itemErr.message)
    }
  }

  const handleCreate = async () => {
    const client = clients.find(c => c.id === form.client_id)
    if (!client) return toast.error(inv.selectClient)
    if (items.length === 0) return toast.error(inv.addItem)
    setSaving(true)
    const issueDate = today
    if (form.id) {
      const { error } = await supabase.from('faturas').update({
        period_start: form.period_start || null,
        period_end: form.period_end || null,
        due_date: form.due_date || null,
        subtotal,
        tax_amount: tax,
        total,
        tax_rate: parseInt(form.tax_rate, 10) || 10,
        notes: form.notes,
      }).eq('id', form.id)
      if (error) {
        setSaving(false)
        return toast.error(error.message)
      }
      await saveItems(form.id, items)
      setSaving(false)
      toast.success(inv.updated)
      setForm(emptyForm(today))
      setItems([])
      setJobs([])
      setTab('list')
      load()
      return
    }
    const invoiceNumber = nextInvoiceNumber(faturas, issueDate)
    const payload = {
      client_id: form.client_id,
      client_name: client.company_name,
      invoice_number: invoiceNumber,
      period_start: form.period_start || null,
      period_end: form.period_end || null,
      issue_date: issueDate,
      due_date: form.due_date || null,
      subtotal,
      tax_amount: tax,
      total,
      tax_rate: parseInt(form.tax_rate, 10) || 10,
      status: 'draft',
      notes: form.notes,
    }
    const { data: fatura, error } = await insertInvoice(payload)
    if (error) {
      setSaving(false)
      return toast.error(error.message)
    }
    await saveItems(fatura.id, items)
    setSaving(false)
    toast.success(inv.created)
    setForm(emptyForm(today))
    setItems([])
    setJobs([])
    setTab('list')
    setStatusFilter('draft')
    load()
  }

  const handleEditDraft = async (row) => {
    const { data, error } = await supabase.from('fatura_items').select('*').eq('fatura_id', row.id)
    if (error) return toast.error(error.message)
    setForm({
      id: row.id,
      client_id: row.client_id || '',
      period_start: row.period_start || '',
      period_end: row.period_end || '',
      due_date: row.due_date || addDays(today, 30),
      tax_rate: row.tax_rate || 10,
      notes: row.notes || '',
    })
    setItems((data || []).map(it => ({
      job_id: it.job_id,
      kind: Number(it.total) < 0 ? 'discount' : 'monthly',
      description: it.description,
      quantity: it.quantity,
      unit_price: it.unit_price,
      total: it.total,
    })))
    setTab('new')
  }

  const handleDelete = async (id) => {
    if (!window.confirm(inv.deleteConfirm)) return
    const { error } = await supabase.from('faturas').delete().eq('id', id)
    if (error) return toast.error(error.message)
    toast(inv.deleted)
    load()
  }

  const handleStatusChange = async (row, status) => {
    const { error } = await supabase.from('faturas').update({ status }).eq('id', row.id)
    if (error) return toast.error(error.message)
    if (status === 'paid') {
      const desc = cashflowDescription(displayNumber(row), row.client_name)
      const { data: existing } = await supabase.from('cashflow').select('id').eq('description', desc).limit(1)
      if (!existing?.length) {
        const cf = await supabase.from('cashflow').insert({
          entry_type: 'income',
          category: 'Client Payment',
          amount: Number(row.total || 0),
          description: desc,
          entry_date: today,
        })
        if (cf.error) toast.error(cf.error.message)
        else toast.success(inv.cashflowAdded)
      }
    }
    toast.success(fill(inv.statusChanged, { status: inv.statuses?.[status] || status }))
    load()
  }

  const issuer = {
    ...QUOTE_ISSUER,
    bank: inv.bankNote,
  }

  const openPrint = async (f, autoPrint, lang = 'ja') => {
    const { data: printItems, error } = await supabase.from('fatura_items').select('*').eq('fatura_id', f.id)
    if (error) return toast.error(error.message)
    const w = window.open('', '_blank')
    if (!w) return toast.error(inv.popupBlocked)
    w.document.write(buildInvoicePrintHtml({ ...f, invoice_number: displayNumber(f) }, printItems || [], issuer, lang))
    w.document.close()
    if (autoPrint) {
      w.focus()
      w.print()
    }
  }

  const openAuto = () => {
    const period = monthEnd ? calendarMonthPeriod(today) : defaultPeriod
    setPlanPeriod(period)
    setExtras({})
    setTab('auto')
    setSearchParams({ tab: 'auto' })
  }

  useEffect(() => {
    if (tab !== 'auto' || !clients.length) return
    const { planned, skipped } = planMonthlyInvoices({
      clients,
      contracts,
      existing: faturas,
      period: planPeriod,
      labels,
    })
    setPlanRows(planned)
    setPlanSkipped(skipped)
  }, [tab, clients, contracts, faturas, planPeriod, labels])

  const extraItemsFor = (clientId, monthlyAmount, periodEnd) => {
    const rate = dailyRateFromMonthly(monthlyAmount, periodEnd)
    return (extras[clientId] || []).map(d => makeDiscountLine({
      reason: d.reason,
      days: d.days,
      dailyRate: rate,
      amount: d.amount === '' ? undefined : d.amount,
      labels,
    })).filter(l => l.total)
  }

  const handleGenerateAll = async () => {
    if (!planRows.length) return toast.error(inv.autoNone)
    setSaving(true)
    let created = 0
    let skipped = 0
    let existingRows = [...faturas]
    for (const row of planRows) {
      if (invoiceAlreadyExists(existingRows, row.client_id, planPeriod)) {
        skipped += 1
        continue
      }
      const extra = extraItemsFor(row.client_id, row.monthlyAmount, planPeriod.end)
      const lineItems = [...row.items, ...extra]
      const totals = invoiceTotals(lineItems, planTax)
      const invoiceNumber = nextInvoiceNumber(existingRows, today)
      const payload = {
        client_id: row.client_id,
        client_name: row.client_name,
        invoice_number: invoiceNumber,
        period_start: planPeriod.start,
        period_end: planPeriod.end,
        issue_date: today,
        due_date: addDays(today, 30),
        subtotal: totals.subtotal,
        tax_amount: totals.taxAmount,
        total: totals.total,
        tax_rate: parseInt(planTax, 10) || 10,
        status: 'draft',
        notes: '',
      }
      const { data: fatura, error } = await insertInvoice(payload)
      if (error) {
        toast.error(error.message)
        continue
      }
      await saveItems(fatura.id, lineItems)
      existingRows = [...existingRows, { ...payload, id: fatura.id }]
      created += 1
    }
    setSaving(false)
    if (created) toast.success(fill(inv.autoCreated, { n: created }))
    if (skipped) toast(fill(inv.autoSkipped, { n: skipped }))
    setTab('list')
    setStatusFilter('draft')
    setSearchParams({})
    load()
  }

  const periodRows = filterByPeriodKeepOpen(faturas, start, end, ['issue_date', 'period_start', 'created_at'], f => f.status === 'draft')
  const visible = periodRows.filter(f => statusFilter === 'all' || f.status === statusFilter)
  const outstanding = periodRows.filter(f => f.status === 'sent').reduce((s, f) => s + Number(f.total || 0), 0)
  const paidMonth = periodRows.filter(f => f.status === 'paid').reduce((s, f) => s + Number(f.total || 0), 0)
  const drafts = faturas.filter(f => f.status === 'draft')
  const periodDrafts = drafts.filter(f => f.period_start === defaultPeriod.start)
  const billedIds = new Set(
    faturas.filter(f => f.period_start === defaultPeriod.start && f.status !== 'cancelled').map(f => f.client_id)
  )
  const missingCount = clients.filter(c => clientMonthly(c) > 0 && !billedIds.has(c.id)).length
  const showMonthEnd = monthEnd && !alertDismissed && (missingCount > 0 || periodDrafts.length > 0)

  const statusBadge = s => ({ draft: 'badge-amber', sent: 'badge-blue', paid: 'badge-green', cancelled: 'badge-red' }[s] || 'badge-navy')

  const periodComplaints = (clientId) => complaints.filter(c =>
    c.client_id === clientId && complaintInPeriod(c, { start: form.period_start, end: form.period_end })
  )

  const dismissAlert = () => {
    try { localStorage.setItem(ALERT_KEY, defaultPeriod.start) } catch { /* ignore */ }
    setAlertDismissed(true)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 className="page-head" style={{ margin: 0, fontSize: 22 }}>{t.sidebar.faturas}</h2>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{fill(inv.versionHint, { v: APP_VERSION })}</div>
        </div>
      </div>

      {showMonthEnd && (
        <div style={{ background: 'rgba(239,159,39,0.08)', border: '1px solid rgba(239,159,39,0.25)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text2)' }}>⚠️ {missingCount > 0 ? inv.monthEndAlert : inv.monthEndReview}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={openAuto}>{inv.monthEndAction}</button>
            <button type="button" className="btn btn-sm" onClick={dismissAlert}>{inv.dismiss}</button>
          </div>
        </div>
      )}

      <div className="tab-pills">
        <button type="button" className={`tab-pill${tab === 'list' ? ' active' : ''}`} onClick={() => { setTab('list'); setSearchParams({}) }}>{fill(inv.list, { n: periodRows.length })}</button>
        <button type="button" className={`tab-pill${tab === 'auto' ? ' active' : ''}`} onClick={openAuto}>{inv.auto}</button>
        <button type="button" className={`tab-pill${tab === 'new' ? ' active' : ''}`} onClick={() => setTab('new')}>{inv.new}</button>
      </div>

      {tab === 'list' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10, marginBottom: 14 }}>
            {[[inv.outstanding, yen(outstanding), 'var(--amber)'], [inv.paidThisMonth, yen(paidMonth), 'var(--green)'], [inv.draftCount, String(drafts.length), 'var(--blue)']].map(([label, value, color]) => (
              <div key={label} className="card" style={{ textAlign: 'center', padding: 14 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color, marginBottom: 4 }}>{value}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {STATUSES.map(s => (
              <button
                key={s}
                type="button"
                className={`tab-pill${statusFilter === s ? ' active' : ''}`}
                onClick={() => setStatusFilter(s)}
              >
                {s === 'all' ? inv.filterAll : (inv.statuses?.[s] || s)}
              </button>
            ))}
          </div>

          {loading && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{t.app.loading}</div>}
          {visible.length === 0 && !loading && <div className="card"><div style={{ color: 'var(--text3)', fontSize: 13 }}>{inv.empty}</div></div>}
          {visible.map(f => (
            <div key={f.id} className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{f.client_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{displayNumber(f)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{f.period_start} 〜 {f.period_end}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>{inv.issued}: {f.issue_date} · {inv.due}: {f.due_date || '—'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{yen(f.total)}</div>
                  <span className={`badge ${statusBadge(f.status)}`}>{inv.statuses?.[f.status] || f.status}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(f.status === 'draft' || f.status === 'pending') && (
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => handleEditDraft(f)}>{inv.editDraft}</button>
                )}
                <button type="button" className="btn btn-sm" onClick={() => openPrint(f, false, 'ja')}>{inv.printJa}</button>
                <button type="button" className="btn btn-sm" onClick={() => openPrint(f, false, 'en')}>{inv.printEn}</button>
                {(f.status === 'draft' || f.status === 'pending') && (
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => handleStatusChange(f, 'sent')}>{inv.markSent}</button>
                )}
                {f.status === 'sent' && (
                  <button type="button" className="btn btn-sm" style={{ background: 'var(--green)', color: '#fff' }} onClick={() => handleStatusChange(f, 'paid')}>{inv.markPaid}</button>
                )}
                {f.status !== 'cancelled' && f.status !== 'paid' && (
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => handleStatusChange(f, 'cancelled')}>{inv.cancel}</button>
                )}
                <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDelete(f.id)}>{inv.delete}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'auto' && (
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">{inv.autoTitle}</div>
            <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 14px' }}>{inv.autoHint}</p>
            <div className="grid-2">
              <div className="form-group"><label>{inv.periodStart}</label><input type="date" value={planPeriod.start} onChange={e => { setPlanPeriod(p => ({ ...p, start: e.target.value })); setExtras({}) }} /></div>
              <div className="form-group"><label>{inv.periodEnd}</label><input type="date" value={planPeriod.end} onChange={e => { setPlanPeriod(p => ({ ...p, end: e.target.value })); setExtras({}) }} /></div>
              <div className="form-group"><label>{inv.taxRate}</label>
                <select value={planTax} onChange={e => setPlanTax(e.target.value)}>
                  <option value={10}>10%</option><option value={8}>8%</option><option value={0}>0%</option>
                </select>
              </div>
            </div>
          </div>

          {planRows.length === 0 && <div className="card"><div style={{ color: 'var(--text3)', fontSize: 13 }}>{inv.autoNone}</div></div>}
          {planRows.map(row => {
            const extra = extras[row.client_id] || []
            const extraLines = extraItemsFor(row.client_id, row.monthlyAmount, planPeriod.end)
            const totals = invoiceTotals([...row.items, ...extraLines], planTax)
            const cps = complaints.filter(c => c.client_id === row.client_id && complaintInPeriod(c, planPeriod))
            return (
              <div key={row.client_id} className="card" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{row.client_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{inv.dailyRate}: {yen(row.dailyRate)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{inv.previewMonthly}: {yen(row.monthlyAmount)}</div>
                    <div style={{ fontWeight: 700, color: 'var(--green)' }}>{inv.total}: {yen(totals.total)}</div>
                  </div>
                </div>
                <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--text2)' }}>
                  {row.items.map((it, i) => <li key={`m${i}`}>{it.description} · {yen(it.total)}</li>)}
                  {extraLines.map((it, i) => <li key={`d${i}`} style={{ color: 'var(--red)' }}>{it.description} · {yen(it.total)}</li>)}
                </ul>
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text3)' }}>{inv.discountSection}</div>
                {cps.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    <div style={{ color: 'var(--amber)', marginBottom: 4 }}>{inv.complaintSuggest}</div>
                    {cps.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        className="btn btn-sm"
                        style={{ margin: '0 6px 6px 0' }}
                        onClick={() => setExtras(ex => ({
                          ...ex,
                          [row.client_id]: [...(ex[row.client_id] || []), { reason: `${inv.reasonComplaint}: ${String(c.description || '').slice(0, 80)}`, days: '1', amount: '' }],
                        }))}
                      >
                        {inv.applyComplaint}
                      </button>
                    ))}
                  </div>
                )}
                {extra.map((d, i) => (
                  <div key={i} className="invoice-line discount" style={{ marginTop: 8 }}>
                    <input value={d.reason} onChange={e => setExtras(ex => ({
                      ...ex,
                      [row.client_id]: ex[row.client_id].map((x, idx) => idx === i ? { ...x, reason: e.target.value } : x),
                    }))} placeholder={inv.discountReason} />
                    <input type="number" value={d.days} onChange={e => setExtras(ex => ({
                      ...ex,
                      [row.client_id]: ex[row.client_id].map((x, idx) => idx === i ? { ...x, days: e.target.value } : x),
                    }))} placeholder={inv.discountDays} />
                    <input type="number" value={d.amount} onChange={e => setExtras(ex => ({
                      ...ex,
                      [row.client_id]: ex[row.client_id].map((x, idx) => idx === i ? { ...x, amount: e.target.value } : x),
                    }))} placeholder={inv.amount} />
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => setExtras(ex => ({
                      ...ex,
                      [row.client_id]: (ex[row.client_id] || []).filter((_, idx) => idx !== i),
                    }))}>✕</button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ marginTop: 8 }}
                  onClick={() => setExtras(ex => ({
                    ...ex,
                    [row.client_id]: [...(ex[row.client_id] || []), { reason: inv.reasonDays, days: '1', amount: '' }],
                  }))}
                >
                  {inv.addDiscount}
                </button>
              </div>
            )
          })}

          {planSkipped.length > 0 && (
            <div className="card" style={{ marginBottom: 14, fontSize: 12, color: 'var(--text3)' }}>
              {fill(inv.autoSkipped, { n: planSkipped.length })}
              {': '}
              {planSkipped.map(s => `${s.client.company_name} (${inv[s.reason] || s.reason})`).join(' · ')}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={saving || !planRows.length} onClick={handleGenerateAll}>
              {saving ? t.app.loading : inv.saveDrafts}
            </button>
            <button type="button" className="btn" onClick={() => { setTab('list'); setSearchParams({}) }}>{inv.cancel}</button>
          </div>
        </div>
      )}

      {tab === 'new' && (
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">{form.id ? inv.editDraft : inv.newTitle}</div>
            <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 12px' }}>{inv.discountHint}</p>
            <div className="grid-2">
              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label>{inv.client} *</label>
                <select value={form.client_id} onChange={e => upd('client_id', e.target.value)} disabled={!!form.id}>
                  <option value="">{inv.selectClient}</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </div>
              <div className="form-group"><label>{inv.periodStart}</label><input type="date" value={form.period_start} onChange={e => upd('period_start', e.target.value)} /></div>
              <div className="form-group"><label>{inv.periodEnd}</label><input type="date" value={form.period_end} onChange={e => upd('period_end', e.target.value)} /></div>
              <div className="form-group"><label>{inv.dueDate}</label><input type="date" value={form.due_date} onChange={e => upd('due_date', e.target.value)} /></div>
              <div className="form-group"><label>{inv.taxRate}</label>
                <select value={form.tax_rate} onChange={e => upd('tax_rate', e.target.value)}>
                  <option value={10}>10%</option><option value={8}>8%</option><option value={0}>0%</option>
                </select>
              </div>
              <div className="form-group" style={{ gridColumn: '1/-1' }}><label>{inv.notes}</label><input value={form.notes} onChange={e => upd('notes', e.target.value)} /></div>
            </div>
            <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)', fontSize: 13, lineHeight: 1.65 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)', letterSpacing: '0.08em', marginBottom: 4 }}>{t.sales.issuer}</div>
              <div style={{ fontWeight: 700 }}>{QUOTE_ISSUER.company}</div>
              <div>{t.sales.issuerTitle}：{QUOTE_ISSUER.name}</div>
              <div>{t.sales.issuerAddress}：{QUOTE_ISSUER.address}</div>
              <div>{t.sales.issuerReg}：{QUOTE_ISSUER.regNumber}</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
              <div className="card-title" style={{ margin: 0 }}>
                {inv.items}
                {jobs.length > 0 && <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}> ({fill(inv.jobsNotBilled, { n: jobs.length })})</span>}
              </div>
              <button type="button" className="btn btn-sm" onClick={addItem}>{inv.addLine}</button>
            </div>
            {items.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{inv.noItems}</div>}
            {items.map((it, i) => (
              <div key={i} className={`invoice-line${it.kind === 'discount' ? ' discount' : ''}`}>
                <input value={it.description} onChange={e => updItem(i, 'description', e.target.value)} placeholder={inv.description} />
                <input type="number" value={it.quantity} onChange={e => updItem(i, 'quantity', e.target.value)} placeholder={inv.qty} />
                <input type="number" value={it.unit_price} onChange={e => updItem(i, 'unit_price', e.target.value)} placeholder={inv.price} />
                <div className="invoice-line-total">{yen(it.total)}</div>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => removeItem(i)}>✕</button>
              </div>
            ))}
            {form.client_id && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <div className="card-title" style={{ marginBottom: 6 }}>{inv.discountSection}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>{inv.dailyRate}: {yen(dailyRate)}</div>
                {periodComplaints(form.client_id).map(c => (
                  <button
                    key={c.id}
                    type="button"
                    className="btn btn-sm"
                    style={{ margin: '0 6px 8px 0' }}
                    onClick={() => addDiscountLine({ reason: `${inv.reasonComplaint}: ${String(c.description || '').slice(0, 80)}`, days: '1', amount: '' })}
                  >
                    {inv.applyComplaint}: {String(c.description || '').slice(0, 40)}
                  </button>
                ))}
                <div className="invoice-line discount">
                  <input value={discount.reason} onChange={e => setDiscount(d => ({ ...d, reason: e.target.value }))} placeholder={inv.discountReason} />
                  <input type="number" value={discount.days} onChange={e => setDiscount(d => ({ ...d, days: e.target.value }))} placeholder={inv.discountDays} />
                  <input type="number" value={discount.amount} onChange={e => setDiscount(d => ({ ...d, amount: e.target.value }))} placeholder={inv.amount} />
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => addDiscountLine()}>{inv.addDiscount}</button>
                </div>
              </div>
            )}
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: 13, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text3)' }}>{inv.subtotal}: <strong>{yen(subtotal)}</strong></span>
                <span style={{ color: 'var(--text3)' }}>{inv.tax} ({form.tax_rate}%): <strong>{yen(tax)}</strong></span>
                <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 15 }}>{inv.total}: {yen(total)}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleCreate}>{saving ? t.app.loading : (form.id ? inv.editDraft : inv.create)}</button>
            {form.id && (
              <>
                <button type="button" className="btn" onClick={() => openPrint(faturas.find(x => x.id === form.id) || { ...form, invoice_number: displayNumber(form) }, false, 'ja')}>{inv.printJa}</button>
                <button type="button" className="btn" onClick={() => openPrint(faturas.find(x => x.id === form.id) || { ...form, invoice_number: displayNumber(form) }, false, 'en')}>{inv.printEn}</button>
              </>
            )}
            <button type="button" className="btn" onClick={() => { setTab('list'); setForm(emptyForm(today)); setItems([]) }}>{inv.cancel}</button>
          </div>
        </div>
      )}
    </div>
  )
}
