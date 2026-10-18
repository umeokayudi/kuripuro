import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { escapeHtml } from '../lib/escapeHtml'
import { fill } from '../hooks/useLang'
import {
  MAINTENANCE_ITEMS, QUOTE_CATEGORIES, LOCATION_FIELDS, maintenanceRows, invoiceState, billingSummary, receiptNumber,
} from '../lib/clientCare'

const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString('ja-JP')}`
const fmtDate = (iso, lang) => iso
  ? new Date(String(iso).slice(0, 10) + 'T12:00:00Z').toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  : '—'
export const itemLabel = (key, lang) => {
  const item = MAINTENANCE_ITEMS.find(i => i.key === key)
  return item ? (lang === 'ja' ? item.ja : item.en) : key
}

/* ───────── Account manager ───────── */
export function ManagerCard({ client, labels, compact = false }) {
  const [qr, setQr] = useState(null)
  const line = client?.manager_line_url
  useEffect(() => {
    let alive = true
    if (!line) { setQr(null); return undefined }
    QRCode.toDataURL(line, { margin: 1, width: 240, color: { dark: '#0c1c30', light: '#ffffff' } })
      .then(url => { if (alive) setQr(url) })
      .catch(() => { if (alive) setQr(null) })
    return () => { alive = false }
  }, [line])
  if (!client?.manager_name) return null
  const initials = client.manager_name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <section className={`cpx-manager${compact ? ' is-compact' : ''}`}>
      <div className="cpx-manager-main">
        {client.manager_photo_url
          ? <img className="cpx-manager-photo" src={client.manager_photo_url} alt="" />
          : <span className="cpx-manager-photo">{initials}</span>}
        <div>
          <small>{labels.yourManager}</small>
          <strong>{client.manager_name}</strong>
          <span>{labels.managerHint}</span>
        </div>
      </div>
      <div className="cpx-manager-actions">
        {client.manager_phone && <a href={`tel:${client.manager_phone.replace(/[^\d+]/g, '')}`}>📞 {client.manager_phone}</a>}
        {client.manager_email && <a href={`mailto:${client.manager_email}`}>✉️ {client.manager_email}</a>}
        {line && <a href={line} target="_blank" rel="noreferrer" className="is-line">LINE</a>}
      </div>
      {qr && !compact && (
        <div className="cpx-manager-qr">
          <img src={qr} alt="LINE QR" />
          <small>{labels.scanLine}</small>
        </div>
      )}
    </section>
  )
}

/* ───────── Billing ───────── */
function printDoc(title, body) {
  const w = window.open('', '_blank')
  if (!w) return toast.error('Pop-up blocked')
  w.document.write(`<html><head><title>${title}</title><style>
    body{font-family:'Hiragino Sans','Noto Sans JP',sans-serif;padding:40px;max-width:620px;margin:0 auto;color:#1b2a44}
    h1{text-align:center;font-size:24px;letter-spacing:.3em;margin:0 0 4px}
    .sub{text-align:center;color:#6b788c;font-size:12px;margin-bottom:28px}
    .to{font-size:18px;border-bottom:1px solid #1b2a44;padding-bottom:6px;margin-bottom:22px}
    .amount{font-size:30px;font-weight:800;text-align:center;border:2px solid #1b2a44;padding:14px;margin:18px 0}
    table{width:100%;border-collapse:collapse;font-size:13px}td{padding:7px 4px;border-bottom:1px solid #e5e9f0}
    .foot{margin-top:36px;text-align:right;font-size:12px;color:#6b788c}
  </style></head><body>${body}</body></html>`)
  w.document.close()
  w.print()
}

export function printReceipt(inv, clientName) {
  const no = receiptNumber(inv)
  const paid = (inv.paid_at || '').slice(0, 10) || inv.issue_date
  printDoc(`領収書 ${no}`, `
    <h1>領収書</h1><div class="sub">RECEIPT · ${escapeHtml(no)}</div>
    <div class="to">${escapeHtml(clientName || inv.client_name || '')} 様</div>
    <div class="amount">${yen(inv.total)}-</div>
    <p style="text-align:center;font-size:13px">但し、清掃サービス代として（${escapeHtml(inv.period_start || '')} 〜 ${escapeHtml(inv.period_end || '')}）<br>上記正に領収いたしました。</p>
    <table>
      <tr><td>領収日</td><td style="text-align:right">${escapeHtml(paid || '')}</td></tr>
      <tr><td>うち消費税 (${escapeHtml(String(inv.tax_rate ?? 10))}%)</td><td style="text-align:right">${yen(inv.tax_amount)}</td></tr>
      <tr><td>お支払方法</td><td style="text-align:right">${escapeHtml(inv.payment_method || '振込')}</td></tr>
    </table>
    <div class="foot">KuriPuro by JBM</div>`)
}

export async function printInvoice(inv, clientName) {
  const { data: items } = await supabase.from('fatura_items').select('*').eq('fatura_id', inv.id)
  const rows = (items || []).map(it => `<tr><td>${escapeHtml(it.description || '')}</td><td>${escapeHtml(String(it.quantity ?? ''))}</td><td style="text-align:right">${yen(it.unit_price)}</td><td style="text-align:right">${yen(it.total)}</td></tr>`).join('')
  printDoc(`請求書 ${escapeHtml(clientName || '')}`, `
    <h1>請求書</h1><div class="sub">INVOICE · ${escapeHtml(inv.issue_date || '')}</div>
    <div class="to">${escapeHtml(clientName || inv.client_name || '')} 御中</div>
    <table><tr><td>対象期間</td><td style="text-align:right">${escapeHtml(inv.period_start || '—')} 〜 ${escapeHtml(inv.period_end || '—')}</td></tr>
    <tr><td>支払期限</td><td style="text-align:right">${escapeHtml(inv.due_date || '—')}</td></tr></table>
    <div class="amount">${yen(inv.total)}</div>
    <table>${rows || '<tr><td>—</td></tr>'}
      <tr><td colspan="3">小計</td><td style="text-align:right">${yen(inv.subtotal)}</td></tr>
      <tr><td colspan="3">消費税 (${escapeHtml(String(inv.tax_rate ?? 10))}%)</td><td style="text-align:right">${yen(inv.tax_amount)}</td></tr></table>
    <div class="foot">KuriPuro by JBM</div>`)
}

function DueCalendar({ invoices, today, labels, lang }) {
  const [view, setView] = useState(today.slice(0, 7))
  const [y, m] = view.split('-').map(Number)
  const first = `${view}-01`
  const lead = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const byDay = {}
  for (const inv of invoices) {
    if (inv.due_date?.startsWith(view)) (byDay[Number(inv.due_date.slice(8))] ||= []).push(inv)
  }
  const move = d => setView(new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7))
  const weekdays = lang === 'ja' ? ['月', '火', '水', '木', '金', '土', '日'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return (
    <div className="cpx-cal">
      <div className="cpx-cal-head">
        <strong>{labels.paymentCalendar}</strong>
        <div className="cpx-month">
          <button type="button" onClick={() => move(-1)} aria-label={labels.prevMonth}>‹</button>
          <span>{new Date(first + 'T12:00:00Z').toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</span>
          <button type="button" onClick={() => move(1)} aria-label={labels.nextMonth}>›</button>
        </div>
      </div>
      <div className="cpx-cal-grid">
        {weekdays.map(w => <span key={w} className="cpx-cal-wd">{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = i + 1
          const iso = `${view}-${String(d).padStart(2, '0')}`
          const list = byDay[d] || []
          const states = list.map(inv => invoiceState(inv, today))
          const cls = states.includes('overdue') ? 'is-overdue' : states.includes('open') ? 'is-open' : states.length ? 'is-paid' : ''
          return (
            <span key={d} className={`cpx-cal-day ${cls}${iso === today ? ' is-today' : ''}`} title={list.map(inv => `${yen(inv.total)}`).join(' · ')}>
              {d}{list.length > 0 && <i />}
            </span>
          )
        })}
      </div>
      <div className="cpx-cal-key">
        <span><i className="is-open" />{labels.invOpen}</span>
        <span><i className="is-overdue" />{labels.invOverdue}</span>
        <span><i className="is-paid" />{labels.invPaid}</span>
      </div>
    </div>
  )
}

export function BillingAlerts({ invoices, today, labels, lang, onOpen }) {
  const sum = billingSummary(invoices, today)
  return (
    <>
      {sum.overdueCount > 0 && (
        <button type="button" className="cpx-alert is-bad" onClick={onOpen}>
          <b>!</b>
          <span><strong>{fill(labels.overdueAlert, { count: sum.overdueCount, amount: yen(sum.overdue) })}</strong><small>{labels.overdueAlertHint}</small></span>
        </button>
      )}
      {sum.recentlyPaid && (
        <div className="cpx-alert is-good">
          <b>✓</b>
          <span><strong>{labels.thanksTitle}</strong><small>{fill(labels.thanksBody, { amount: yen(sum.recentlyPaid.total), date: fmtDate(sum.recentlyPaid.paid_at, lang) })}</small></span>
        </div>
      )}
    </>
  )
}

export function BillingView({ invoices, today, labels, lang, clientName }) {
  const sum = billingSummary(invoices, today)
  const sorted = [...invoices].sort((a, b) => (b.issue_date || '').localeCompare(a.issue_date || ''))
  return (
    <div className="cpx-stack">
      <BillingAlerts invoices={invoices} today={today} labels={labels} lang={lang} />
      <div className="cpx-kpis is-inline">
        <div className="cpx-kpi" style={{ '--tone': sum.overdue ? '#dc2626' : '#3b62f0' }}><span>{labels.toPay}</span><strong>{yen(sum.open)}</strong></div>
        <div className="cpx-kpi" style={{ '--tone': '#f59e0b' }}><span>{labels.nextDueDate}</span><strong className="is-small">{sum.nextDue ? fmtDate(sum.nextDue.due_date, lang) : '—'}</strong></div>
        <div className="cpx-kpi" style={{ '--tone': '#16a34a' }}><span>{labels.paidThisYear}</span><strong>{yen(sum.paidThisYear)}</strong></div>
      </div>
      <DueCalendar invoices={invoices} today={today} labels={labels} lang={lang} />
      <div className="cp-section-title cpx-section">{labels.invoicesTitle}</div>
      {sorted.length === 0 && <div className="cpx-empty">{labels.noInvoices}</div>}
      {sorted.map(inv => {
        const state = invoiceState(inv, today)
        return (
          <article key={inv.id} className={`cpx-invoice is-${state}`}>
            <div className="cpx-invoice-top">
              <div>
                <strong>{yen(inv.total)}</strong>
                <small>{inv.period_start ? `${fmtDate(inv.period_start, lang)} – ${fmtDate(inv.period_end, lang)}` : fmtDate(inv.issue_date, lang)}</small>
              </div>
              <span className={`cpx-pill is-${state}`}>{state === 'paid' ? labels.invPaid : state === 'overdue' ? labels.invOverdue : labels.invOpen}</span>
            </div>
            <div className="cpx-invoice-meta">
              <span>{labels.issued}: {fmtDate(inv.issue_date, lang)}</span>
              <span>{state === 'paid' ? `${labels.paidOn}: ${fmtDate(inv.paid_at, lang)}` : `${labels.dueOn}: ${fmtDate(inv.due_date, lang)}`}</span>
            </div>
            <div className="cpx-invoice-actions">
              <button type="button" onClick={() => printInvoice(inv, clientName)}>{labels.viewInvoice}</button>
              {state === 'paid' && <button type="button" className="is-primary" onClick={() => printReceipt(inv, clientName)}>{labels.downloadReceipt}</button>}
            </div>
          </article>
        )
      })}
    </div>
  )
}

/* ───────── Stores: details + maintenance ───────── */
function LocationDetails({ profile, labels, onSave, saving }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(profile || {})
  useEffect(() => { setDraft(profile || {}) }, [profile])
  const filled = LOCATION_FIELDS.filter(f => profile?.[f.key] !== null && profile?.[f.key] !== undefined && profile?.[f.key] !== '')
  if (!editing) {
    return (
      <div className="cpx-details">
        {filled.length === 0
          ? <div className="cpx-empty">{labels.noDetails}</div>
          : (
            <div className="cpx-detail-grid">
              {filled.map(f => (
                <div key={f.key}><small>{labels[`f_${f.key}`]}</small><strong>{profile[f.key]}{f.unit ? ` ${f.unit}` : ''}</strong></div>
              ))}
            </div>
          )}
        <button type="button" className="cpx-link" onClick={() => setEditing(true)}>{filled.length ? labels.editDetails : labels.addDetails}</button>
      </div>
    )
  }
  return (
    <div className="cpx-details is-editing">
      <div className="cpx-form-grid">
        {LOCATION_FIELDS.map(f => (
          <label key={f.key} className={f.key === 'access_notes' ? 'is-wide' : ''}>
            <span>{labels[`f_${f.key}`]}{f.unit ? ` (${f.unit})` : ''}</span>
            <input className="cp-input" type={f.type} min={f.type === 'number' ? 0 : undefined} value={draft[f.key] ?? ''}
              onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))} />
          </label>
        ))}
      </div>
      <div className="cpx-row-btns">
        <button type="button" className="cp-btn" onClick={() => { setDraft(profile || {}); setEditing(false) }}>{labels.cancel}</button>
        <button type="button" className="cp-btn cp-btn-blue" disabled={saving} onClick={async () => { if (await onSave(draft)) setEditing(false) }}>{labels.save}</button>
      </div>
    </div>
  )
}

export function MaintenanceList({ rows, labels, lang, onQuote }) {
  return (
    <div className="cpx-maint">
      {rows.map(r => (
        <div key={r.key} className={`cpx-maint-row is-${r.state}`}>
          <i />
          <div className="cpx-maint-text">
            <strong>{lang === 'ja' ? r.ja : r.en}</strong>
            <small>
              {r.lastDone ? `${labels.lastDone}: ${fmtDate(r.lastDone, lang)}` : labels.neverRecorded}
              {' · '}{fill(labels.everyNDays, { n: r.interval })}
            </small>
          </div>
          <div className="cpx-maint-side">
            <span className={`cpx-pill is-${r.state}`}>
              {r.state === 'overdue' ? fill(labels.overdueDays, { n: -r.daysLeft })
                : r.state === 'soon' ? fill(labels.dueInDays, { n: r.daysLeft })
                  : r.state === 'ok' ? labels.upToDate : labels.noRecord}
            </span>
            {onQuote && (r.state === 'overdue' || r.state === 'soon' || r.state === 'unknown') && (
              <button type="button" onClick={() => onQuote(r.key)}>{labels.requestQuote}</button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function maintenanceAlertsFor({ locations, jobs, records, today }) {
  const out = []
  for (const loc of locations) {
    for (const r of maintenanceRows({ jobs, locationName: loc, records, today })) {
      if (r.state === 'overdue' || r.state === 'soon') out.push({ ...r, location: loc })
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft)
}

export function StoresView({ clientId, locations, jobs, profiles, records, today, labels, lang, onChanged, onQuote, userName }) {
  const [active, setActive] = useState(locations[0] || '')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!locations.includes(active)) setActive(locations[0] || '') }, [locations, active])
  const profile = profiles.find(p => p.location_name === active) || null
  const rows = useMemo(() => maintenanceRows({ jobs, locationName: active, records, today }), [jobs, active, records, today])

  const saveProfile = async draft => {
    setSaving(true)
    const body = { client_id: clientId, location_name: active, updated_by: userName || 'client', updated_at: new Date().toISOString() }
    for (const f of LOCATION_FIELDS) {
      const v = draft[f.key]
      body[f.key] = v === '' || v === undefined ? null : f.type === 'number' ? Number(v) : v
    }
    const { error } = await supabase.from('location_profiles').upsert(body, { onConflict: 'client_id,location_name' })
    setSaving(false)
    if (error) { toast.error(error.message); return false }
    toast.success(labels.saved)
    onChanged?.()
    return true
  }

  if (!locations.length) return <div className="cpx-empty">{labels.noStores}</div>
  return (
    <div className="cpx-stack">
      {locations.length > 1 && (
        <div className="cpx-store-tabs">
          {locations.map(loc => {
            const alerts = maintenanceRows({ jobs, locationName: loc, records, today }).filter(r => r.state === 'overdue').length
            return (
              <button key={loc} type="button" className={loc === active ? 'is-active' : ''} onClick={() => setActive(loc)}>
                {loc}{alerts > 0 && <b>{alerts}</b>}
              </button>
            )
          })}
        </div>
      )}
      <section className="cpx-panel">
        <header><h2>{active}</h2><small>{labels.storeDetails}</small></header>
        <LocationDetails profile={profile} labels={labels} onSave={saveProfile} saving={saving} />
      </section>
      <section className="cpx-panel">
        <header><h2>{labels.maintenanceTitle}</h2><small>{labels.maintenanceHint}</small></header>
        <MaintenanceList rows={rows} labels={labels} lang={lang} onQuote={key => onQuote(active, key)} />
      </section>
    </div>
  )
}

/* ───────── Quotes & requests ───────── */
export function QuoteForm({ locations, defaults, labels, lang, onSubmit, onCancel }) {
  const [form, setForm] = useState({ kind: 'quote', category: '', location_name: '', description: '', preferred_date: '', ...defaults })
  useEffect(() => { setForm(f => ({ ...f, ...defaults })) }, [defaults])
  const catLabel = key => (key === 'floor' ? labels.catFloor : key === 'windows' ? labels.catWindows : key === 'other' ? labels.catOther : itemLabel(key, lang))
  return (
    <section className="cpx-panel cpx-quote-form">
      <div className="cpx-seg">
        <button type="button" className={form.kind === 'quote' ? 'is-active' : ''} onClick={() => setForm(f => ({ ...f, kind: 'quote' }))}>{labels.askQuote}</button>
        <button type="button" className={form.kind === 'service' ? 'is-active' : ''} onClick={() => setForm(f => ({ ...f, kind: 'service' }))}>{labels.askService}</button>
      </div>
      {form.kind === 'quote' && (
        <div className="cpx-chips">
          {QUOTE_CATEGORIES.map(key => (
            <button key={key} type="button" className={form.category === key ? 'is-active' : ''} onClick={() => setForm(f => ({ ...f, category: key }))}>{catLabel(key)}</button>
          ))}
        </div>
      )}
      {locations.length > 1 && (
        <label className="cpx-field">
          <span>{labels.requestLocation}</span>
          <select className="cp-select" value={form.location_name} onChange={e => setForm(f => ({ ...f, location_name: e.target.value }))}>
            <option value="">{labels.allLocations}</option>
            {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
          </select>
        </label>
      )}
      <label className="cpx-field">
        <span>{form.kind === 'quote' ? labels.quoteDesc : labels.requestDesc}</span>
        <textarea className="cp-textarea" rows={4} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      </label>
      <label className="cpx-field">
        <span>{labels.requestDate}</span>
        <input type="date" className="cp-input" value={form.preferred_date} onChange={e => setForm(f => ({ ...f, preferred_date: e.target.value }))} />
      </label>
      <div className="cpx-row-btns">
        <button type="button" className="cp-btn" onClick={onCancel}>{labels.cancel}</button>
        <button type="button" className="cp-btn cp-btn-blue" onClick={() => onSubmit(form, catLabel(form.category))}>{form.kind === 'quote' ? labels.sendQuote : labels.submitRequest}</button>
      </div>
    </section>
  )
}

export function RequestCard({ rq, labels, lang, onDecide }) {
  const isQuote = rq.request_type === 'quote'
  const qs = rq.quote_status || (isQuote ? 'requested' : null)
  const pill = isQuote
    ? { requested: [labels.qRequested, 'open'], quoted: [labels.qQuoted, 'soon'], accepted: [labels.qAccepted, 'paid'], declined: [labels.qDeclined, 'muted'] }[qs] || [qs, 'open']
    : rq.status === 'completed' ? [labels.statusDone, 'paid'] : [labels.statusPending, 'open']
  return (
    <article className="cpx-request">
      <div className="cpx-invoice-top">
        <div>
          <strong>{isQuote ? `${labels.quoteWord}${rq.category ? ` · ${rq.category}` : ''}` : (rq.ticket_number || `#${rq.id.slice(0, 8)}`)}</strong>
          <small>{rq.location_name || labels.allLocations} · {fmtDate(rq.created_at, lang)}</small>
        </div>
        <span className={`cpx-pill is-${pill[1]}`}>{pill[0]}</span>
      </div>
      <p>{rq.description}</p>
      {isQuote && rq.quote_amount != null && (
        <div className="cpx-quote-answer">
          <div><small>{labels.quotedPrice}</small><strong>{yen(rq.quote_amount)}</strong></div>
          {rq.quote_note && <p>{rq.quote_note}</p>}
          {qs === 'quoted' && onDecide && (
            <div className="cpx-row-btns">
              <button type="button" className="cp-btn" onClick={() => onDecide(rq, 'declined')}>{labels.decline}</button>
              <button type="button" className="cp-btn cp-btn-blue" onClick={() => onDecide(rq, 'accepted')}>{labels.accept}</button>
            </div>
          )}
        </div>
      )}
      {!isQuote && rq.admin_notes && <p className="cpx-admin-note">{rq.admin_notes}</p>}
    </article>
  )
}
