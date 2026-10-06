import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { useLang, fill } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { APP_VERSION } from '../lib/appVersion'
import {
  addDays,
  buildInvoicePrintHtml,
  cashflowDescription,
  invoiceTotals,
  jobsToInvoiceItems,
  lineTotal,
  nextInvoiceNumber,
  previousCalendarMonth,
  yen,
} from '../lib/invoice'

const STATUSES = ['all', 'draft', 'sent', 'paid', 'cancelled']

function displayNumber(f) {
  if (f.invoice_number) return f.invoice_number
  const first = String(f.notes || '').split('\n')[0]
  if (first.startsWith('KP-')) return first
  return String(f.id || '').slice(0, 8)
}

function emptyForm(today) {
  const period = previousCalendarMonth(today)
  return {
    client_id: '',
    period_start: period.start,
    period_end: period.end,
    due_date: addDays(today, 30),
    tax_rate: 10,
    notes: '',
  }
}

export default function Faturas() {
  const { t } = useLang()
  const inv = t.invoices
  const today = tokyoToday()
  const [faturas, setFaturas] = useState([])
  const [clients, setClients] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('list')
  const [statusFilter, setStatusFilter] = useState('all')
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(() => emptyForm(today))

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [f, c] = await Promise.all([
      supabase.from('faturas').select('*').order('created_at', { ascending: false }),
      supabase.from('clients').select('*').eq('is_active', true).order('company_name'),
    ])
    if (f.error) toast.error(f.error.message)
    setFaturas(f.data || [])
    setClients(c.data || [])
    setLoading(false)
  }

  const loadJobs = async (clientId, start, end) => {
    if (!clientId || !start || !end) return
    const { data, error } = await supabase.from('jobs').select('*')
      .eq('client_id', clientId)
      .gte('scheduled_date', start)
      .lte('scheduled_date', end)
      .eq('status', 'completed')
    if (error) return toast.error(error.message)
    setJobs(data || [])
    setItems(jobsToInvoiceItems(data || []))
  }

  const upd = (k, v) => {
    setForm(f => {
      const next = { ...f, [k]: v }
      if (k === 'client_id' || k === 'period_start' || k === 'period_end') {
        if (next.client_id && next.period_start && next.period_end) {
          loadJobs(next.client_id, next.period_start, next.period_end)
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

  const addItem = () => setItems(its => [...its, { job_id: null, description: '', quantity: 1, unit_price: 0, total: 0 }])
  const removeItem = (i) => setItems(its => its.filter((_, idx) => idx !== i))

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

  const handleCreate = async () => {
    const client = clients.find(c => c.id === form.client_id)
    if (!client) return toast.error(inv.selectClient)
    if (items.length === 0) return toast.error(inv.addItem)
    setSaving(true)
    const issueDate = today
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
    for (const item of items) {
      const { error: itemErr } = await supabase.from('fatura_items').insert({
        fatura_id: fatura.id,
        job_id: item.job_id || null,
        description: item.description,
        quantity: parseInt(item.quantity, 10) || 1,
        unit_price: parseFloat(item.unit_price) || 0,
        total: parseFloat(item.total) || 0,
      })
      if (itemErr) toast.error(itemErr.message)
    }
    setSaving(false)
    toast.success(inv.created)
    setForm(emptyForm(today))
    setItems([])
    setJobs([])
    setTab('list')
    load()
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
    company: 'KuriPuro by JBM',
    address: t.ryoshu?.companyAddress || '',
    regNumber: t.ryoshu?.regNumber || '',
    bank: inv.bankNote,
    version: APP_VERSION,
  }

  const openPrint = async (f, autoPrint) => {
    const { data: printItems, error } = await supabase.from('fatura_items').select('*').eq('fatura_id', f.id)
    if (error) return toast.error(error.message)
    const w = window.open('', '_blank')
    if (!w) return toast.error(inv.popupBlocked)
    w.document.write(buildInvoicePrintHtml({ ...f, invoice_number: displayNumber(f) }, printItems || [], issuer))
    w.document.close()
    if (autoPrint) {
      w.focus()
      w.print()
    }
  }

  const visible = faturas.filter(f => statusFilter === 'all' || f.status === statusFilter)
  const month = today.slice(0, 7)
  const outstanding = faturas.filter(f => f.status === 'sent').reduce((s, f) => s + Number(f.total || 0), 0)
  const paidMonth = faturas.filter(f => f.status === 'paid' && String(f.issue_date || '').startsWith(month)).reduce((s, f) => s + Number(f.total || 0), 0)
  const drafts = faturas.filter(f => f.status === 'draft').length

  const statusBadge = s => ({ draft: 'badge-amber', sent: 'badge-blue', paid: 'badge-green', cancelled: 'badge-red' }[s] || 'badge-navy')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 className="page-head" style={{ margin: 0, fontSize: 22 }}>{t.sidebar.faturas}</h2>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{fill(inv.versionHint, { v: APP_VERSION })}</div>
        </div>
      </div>

      <div className="tab-pills">
        <button type="button" className={`tab-pill${tab === 'list' ? ' active' : ''}`} onClick={() => setTab('list')}>{fill(inv.list, { n: faturas.length })}</button>
        <button type="button" className={`tab-pill${tab === 'new' ? ' active' : ''}`} onClick={() => setTab('new')}>{inv.new}</button>
      </div>

      {tab === 'list' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10, marginBottom: 14 }}>
            {[[inv.outstanding, yen(outstanding), 'var(--amber)'], [inv.paidThisMonth, yen(paidMonth), 'var(--green)'], [inv.draftCount, String(drafts), 'var(--blue)']].map(([label, value, color]) => (
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
                <button type="button" className="btn btn-sm" onClick={() => openPrint(f, false)}>{inv.view}</button>
                <button type="button" className="btn btn-sm" onClick={() => openPrint(f, true)}>{inv.print}</button>
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

      {tab === 'new' && (
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">{inv.newTitle}</div>
            <div className="grid-2">
              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label>{inv.client} *</label>
                <select value={form.client_id} onChange={e => upd('client_id', e.target.value)}>
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
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
              <div className="card-title" style={{ margin: 0 }}>
                {inv.items}
                {jobs.length > 0 && <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}> ({fill(inv.jobsFound, { n: jobs.length })})</span>}
              </div>
              <button type="button" className="btn btn-sm btn-primary" onClick={addItem}>{inv.addLine}</button>
            </div>
            {items.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{inv.noItems}</div>}
            {items.map((it, i) => (
              <div key={i} className="invoice-line">
                <input value={it.description} onChange={e => updItem(i, 'description', e.target.value)} placeholder={inv.description} />
                <input type="number" value={it.quantity} onChange={e => updItem(i, 'quantity', e.target.value)} placeholder={inv.qty} />
                <input type="number" value={it.unit_price} onChange={e => updItem(i, 'unit_price', e.target.value)} placeholder={inv.price} />
                <div className="invoice-line-total">{yen(it.total)}</div>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => removeItem(i)}>✕</button>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: 13, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text3)' }}>{inv.subtotal}: <strong>{yen(subtotal)}</strong></span>
                <span style={{ color: 'var(--text3)' }}>{inv.tax} ({form.tax_rate}%): <strong>{yen(tax)}</strong></span>
                <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 15 }}>{inv.total}: {yen(total)}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleCreate}>{saving ? t.app.loading : inv.create}</button>
            <button type="button" className="btn" onClick={() => setTab('list')}>{inv.cancel}</button>
          </div>
        </div>
      )}
    </div>
  )
}
