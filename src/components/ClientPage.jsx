import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { translations } from '../i18n/translations'
import toast from 'react-hot-toast'
import { salesGet, salesPost } from '../lib/salesApi'
import { ContactLogForm, followupCopy } from './SalesFollowupParts'
import { contractPdfBlob, downloadBlob } from '../lib/contractPdf'
import { toCsv, zipFiles } from '../lib/zipStore'
import { escapeHtml } from '../lib/escapeHtml'
import { pickLang } from '../hooks/useLang'
import { STEP_PHASES, day, funnelCopy, initials, mapUrlOf, phaseOf, serviceFromQuote, shortDay, timeOf, yen } from '../lib/salesPhases'

// One page per client: the funnel steps (each clickable, with date, who, notes,
// documents and the next action), then quote → contract → active client, the
// contacts, the files and the full history, plus "download everything".

const SERVICES = ['Basic Cleaning', 'Deep Cleaning', 'Range Hood', 'AC Cleaning', 'Grease Trap', 'Window Cleaning', 'Floor Wax', 'Spot Cleaning']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const baseMime = type => String(type || '').toLowerCase().split(';')[0].trim()
const html = v => escapeHtml(String(v ?? ''))

async function uploadPdf(file) {
  const slot = await salesPost('/api/sales-files', { purpose: 'contract', mime_type: 'application/pdf', size: file.size })
  const put = await fetch(slot.upload_url, { method: 'PUT', headers: { 'Content-Type': slot.mime_type, 'x-upsert': 'false' }, body: file })
  if (!put.ok) throw new Error('Upload failed')
  return slot.path
}

async function signedUrl(path, submissionId) {
  const response = await fetch(`/api/sales-files?path=${encodeURIComponent(path)}${submissionId ? `&submission_id=${encodeURIComponent(submissionId)}` : ''}`, { credentials: 'same-origin' })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'File')
  return result.url
}

function contractFromQuote(lead, quote, submission, rule) {
  if (submission) return { ...submission, days_of_week: submission.days_of_week || [], commission_value: submission.commission_value ?? '' }
  return {
    lead_id: lead.id, quote_id: quote?.id || null, site_name: lead.site_name || lead.company_name, address: lead.address || '', contact_name: lead.contact_name || '',
    service_type: serviceFromQuote(quote), billing_type: 'fixed_monthly', base_monthly_amount: Math.round(Number(quote?.subtotal || quote?.total || 0)),
    price_per_visit: '', visits_per_month: '', hours_per_visit: quote?.hours_per_visit || 2, days_of_week: [], billing_day: 10, tax_rate: quote?.tax_rate ?? 10,
    commission_type: rule?.commission_type || 'percent', commission_value: rule?.commission_value ?? '',
  }
}

function contractHtml(c, lead, seller, t, lang) {
  // The contract goes to Japanese clients: a Portuguese admin prints the English version.
  if (lang === 'pt') { lang = 'en'; t = translations.en }
  const base = c.billing_type === 'per_visit' ? Number(c.price_per_visit || 0) * Number(c.visits_per_month || 0) : Number(c.base_monthly_amount || 0)
  const extra = c.commission_type === 'percent' ? base * Number(c.commission_value || 0) / 100 : Number(c.commission_value || 0)
  const monthly = base + extra
  const tax = Math.round(monthly * Number(c.tax_rate || 0) / 100)
  const ja = lang === 'ja'
  const L = (en, jaText, pt) => pickLang(lang, en, jaText, pt)
  const row = (k, v) => `<tr><th>${html(k)}</th><td>${html(v)}</td></tr>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:"Hiragino Sans","Noto Sans JP",sans-serif;color:#111;padding:28px 34px;font-size:13px;line-height:1.6}
    h1{text-align:center;font-size:22px;letter-spacing:.2em;margin:0 0 4px} .sub{text-align:center;color:#555;margin-bottom:22px}
    table{width:100%;border-collapse:collapse;margin:14px 0} th,td{border:1px solid #bbb;padding:7px 10px;text-align:left;vertical-align:top} th{background:#f3f4f7;width:32%}
    .sign{display:flex;gap:24px;margin-top:34px} .sign div{flex:1;border:1px solid #bbb;padding:12px;min-height:110px} .sign b{display:block;margin-bottom:46px}
    p{margin:6px 0}
  </style></head><body>
    <h1>業務委託契約書</h1><div class="sub">Cleaning service agreement</div>
    <p>${html(lead.company_name)}（以下「甲」）とKURIPURO by JBM（以下「乙」）は、以下の条件で清掃業務の委託契約を締結する。</p>
    <table>
      ${row(L('Location', '店舗・場所', 'Local'), c.site_name || lead.site_name || lead.company_name)}
      ${row(L('Address', '住所', 'Endereço'), c.address || lead.address || '')}
      ${row(L('Contact', '担当者', 'Contato'), c.contact_name || lead.contact_name || '')}
      ${row(L('Service', '業務内容', 'Serviço'), c.service_type)}
      ${row(L('Billing', '請求方法', 'Cobrança'), c.billing_type === 'per_visit' ? `${t.perVisit} · ${yen(c.price_per_visit)} × ${c.visits_per_month || 0}` : t.monthlyFixed)}
      ${row(L('Days', '作業日', 'Dias'), (c.days_of_week || []).join(' / ') || '—')}
      ${row(L('Hours per visit', '1回の作業時間', 'Horas por visita'), `${c.hours_per_visit || 0} h`)}
      ${row(L('Monthly (before tax)', '月額（税抜）', 'Mensal (sem imposto)'), yen(monthly))}
      ${row(L('Tax', '消費税', 'Imposto'), `${c.tax_rate || 0}% · ${yen(tax)}`)}
      ${row(L('Monthly (with tax)', '月額（税込）', 'Mensal (com imposto)'), yen(monthly + tax))}
      ${row(L('Billing day', '請求日', 'Dia de cobrança'), `${L('Every month on day ', '毎月', 'Todo mês no dia ')}${c.billing_day || 10}${ja ? '日' : ''}`)}
      ${row(L('Sales representative', '営業担当', 'Vendedor responsável'), seller || '')}
    </table>
    <p>${L('This agreement is valid for one year from signing and renews automatically on the same terms unless either party gives notice.', '本契約の有効期間は締結日より1年間とし、双方から申し出がない場合は同条件で自動更新する。', 'Este contrato vale por um ano a partir da assinatura e é renovado automaticamente nas mesmas condições, salvo aviso de qualquer das partes.')}</p>
    <div class="sign"><div><b>甲 / Client</b>${html(lead.company_name)}<br>${L('Signature', '署名・捺印', 'Assinatura')}:</div><div><b>乙 / KURIPURO by JBM</b>${L('Signature', '署名・捺印', 'Assinatura')}:</div></div>
    <p style="margin-top:18px;color:#666">${L('Date', '締結日', 'Data')}: ______年____月____日</p>
  </body></html>`
}

export default function ClientPage({ deal, data, lang, today, isAdmin, onClose, onChanged, onEdit, onLogVisit, startWithContact = false }) {
  const t = funnelCopy(lang)
  const f = followupCopy(lang)
  const { lead } = deal
  const [tab, setTab] = useState('steps')
  const [detail, setDetail] = useState(null)
  const [cardUrl, setCardUrl] = useState('')
  const [contactOpen, setContactOpen] = useState(startWithContact)
  const [busy, setBusy] = useState('')
  const [dlOpen, setDlOpen] = useState(false)
  const [contract, setContract] = useState(null)
  const [quoteForm, setQuoteForm] = useState(null)
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    // If the details call fails, the page still works from the funnel data.
    try { setDetail(await salesGet(`/api/sales-data?action=deal&lead_id=${encodeURIComponent(lead.id)}`, lang)) }
    catch { setDetail(d => d || { services: [], jobs: [], invoices: [] }) }
  }, [lead.id, lang])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    setCardUrl('')
    if (!lead.business_card_object_path) return
    let gone = false
    signedUrl(lead.business_card_object_path).then(url => { if (!gone) setCardUrl(url) }).catch(() => {})
    return () => { gone = true }
  }, [lead.business_card_object_path])
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('fa-sheet-open')
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('fa-sheet-open') }
  }, [onClose])

  const quotes = detail?.quotes || deal.quotes
  const submissions = detail?.submissions || deal.submissions || []
  const jobs = detail?.jobs || []
  const invoices = detail?.invoices || []
  const services = detail?.services || []
  const accepted = quotes.find(q => q.status === 'accepted')
  const sub = submissions[0]
  const phase = phaseOf(lead, quotes, submissions, deal.visits, deal.touchpoints.length)
  const [selected, setSelected] = useState(phase)
  useEffect(() => { setSelected(phase) }, [phase])
  const rule = (data?.commissionRules || []).find(r => r.salesperson_id === lead.salesperson_id)

  const refresh = async () => { await Promise.all([load(), onChanged?.()]) }
  const run = async (key, fn, ok) => {
    setBusy(key)
    try { await fn(); if (ok) toast.success(ok); await refresh() }
    catch (e) { toast.error(e.message) }
    finally { setBusy('') }
  }

  // When each phase was reached, who did it and what is attached.
  const steps = useMemo(() => {
    const firstTouch = deal.touchpoints.slice().sort((a, b) => String(a.happened_at).localeCompare(String(b.happened_at)))[0]
    const visit = deal.visits.find(v => v.outcome === 'meeting_scheduled')
    const sent = quotes.filter(q => q.sent_at || q.status !== 'draft').sort((a, b) => String(a.sent_at || a.created_at).localeCompare(String(b.sent_at || b.created_at)))[0]
    const activeSub = submissions.find(s => ['active', 'approved'].includes(s.status))
    return {
      lead: { at: lead.first_contact_date || lead.created_at, who: deal.seller, note: lead.notes },
      contact: { at: firstTouch?.happened_at || (deal.visits.length ? deal.visits[deal.visits.length - 1].work_date : ''), who: firstTouch?.said_by || deal.seller, note: firstTouch?.body },
      visit: { at: visit?.followup_date || visit?.work_date, who: deal.seller, note: visit?.meeting_summary || visit?.notes },
      proposal: { at: sent?.sent_at || sent?.created_at, who: deal.seller, note: sent ? `${sent.quote_number || ''} · ${yen(sent.total)}` : '' },
      negotiation: { at: lead.stage === 'negotiation' ? lead.updated_at : '', who: deal.seller },
      approved: { at: accepted?.decided_at || (lead.stage === 'won' ? lead.closed_at || lead.updated_at : ''), who: deal.seller, note: accepted ? `${accepted.quote_number || ''} · ${yen(accepted.total)}${accepted.decision_reason ? ` · ${accepted.decision_reason}` : ''}` : '' },
      contract: { at: sub?.created_at, who: deal.seller, note: sub ? `${t.contractStatus[sub.status] || sub.status}${sub.admin_note ? ` · ${sub.admin_note}` : ''}` : '' },
      active: { at: activeSub?.reviewed_at, who: deal.seller, note: activeSub ? `${yen(activeSub.client_monthly_total)} ${t.perMonth}` : '' },
    }
  }, [deal, lead, quotes, submissions, accepted, sub, t])
  const reachedIndex = STEP_PHASES.indexOf(phase)

  const events = useMemo(() => {
    const rows = [{ at: lead.created_at || lead.first_contact_date, kind: 'created', icon: '★', title: t.ev.created, who: deal.seller, body: lead.notes }]
    for (const r of deal.touchpoints) rows.push({ at: r.created_at || r.happened_at, kind: 'contact', icon: { phone: '📞', line: '💬', email: '✉', visit: '🚶', meeting: '🤝' }[r.channel] || '•', title: `${t.ev.contact} · ${t.channels[r.channel] || r.channel || ''}`, who: r.said_by, body: [r.body, r.client_response && `“${r.client_response}”`].filter(Boolean).join('\n'), next: r.next_followup_date })
    for (const r of deal.visits) rows.push({ at: r.created_at || r.work_date, kind: 'visit', icon: '📍', title: `${t.ev.visit}${r.outcome ? ` · ${t.outcomes[r.outcome] || r.outcome}` : ''}`, who: deal.seller, body: r.meeting_summary || r.notes, next: r.followup_date, file: r.audio_object_path ? t.files.audio : '' })
    for (const r of quotes) {
      rows.push({ at: r.created_at, kind: 'quote', icon: '📄', title: `${t.ev.quoteDraft} · ${yen(r.total)}`, who: deal.seller, body: r.quote_number })
      if (r.sent_at) rows.push({ at: r.sent_at, kind: 'quote', icon: '📨', title: `${t.ev.quoteSent} · ${yen(r.total)}`, who: deal.seller })
      if (r.status === 'accepted') rows.push({ at: r.decided_at || r.created_at, kind: 'won', icon: '✓', title: `${t.ev.quoteAccepted} · ${yen(r.total)}`, body: r.decision_reason })
      if (r.status === 'declined') rows.push({ at: r.decided_at || r.created_at, kind: 'lost', icon: '×', title: t.ev.quoteDeclined, body: r.decision_reason })
    }
    for (const r of submissions) {
      rows.push({ at: r.created_at, kind: 'contract', icon: '✍', title: `${t.ev.contractDraft} · ${yen(r.client_monthly_total)}`, who: deal.seller })
      if (r.submitted_at) rows.push({ at: r.submitted_at, kind: 'contract', icon: '📎', title: t.ev.contractSent, who: deal.seller, file: r.signed_pdf_name })
      if (['approved', 'active'].includes(r.status)) rows.push({ at: r.reviewed_at, kind: 'won', icon: '🏁', title: t.ev.contractActive, body: r.admin_note })
      if (r.status === 'changes_requested') rows.push({ at: r.reviewed_at, kind: 'lost', icon: '↺', title: t.ev.contractBack, body: r.admin_note })
    }
    for (const j of jobs.filter(j => j.status === 'completed')) rows.push({ at: j.completed_at || j.scheduled_date, kind: 'job', icon: '🧽', title: `${t.ev.job} · ${j.title || ''}`, who: j.employee_name })
    for (const i of invoices.filter(i => i.paid_at)) rows.push({ at: i.paid_at, kind: 'won', icon: '¥', title: `${t.ev.invoicePaid} · ${yen(i.total)}`, body: i.payment_method })
    return rows.filter(r => r.at).sort((a, b) => String(b.at).localeCompare(String(a.at)))
  }, [deal, lead, quotes, submissions, jobs, invoices, t])

  const files = [
    lead.business_card_object_path && { key: 'card', icon: '📇', label: t.files.card, path: lead.business_card_object_path, name: 'cartao-de-visita.jpg', at: lead.first_contact_date },
    ...submissions.filter(r => r.signed_pdf_object_path).map(r => ({ key: r.id, icon: '📄', label: t.files.signed, path: r.signed_pdf_object_path, submission: r.id, name: r.signed_pdf_name || 'contrato-assinado.pdf', at: r.submitted_at || r.created_at })),
    ...deal.visits.filter(r => r.audio_object_path).map(r => ({ key: r.id, icon: '🎙', label: `${t.files.audio} · ${day(r.work_date)}`, path: r.audio_object_path, name: `reuniao-${day(r.work_date)}.${r.audio_object_path.split('.').pop()}`, at: r.work_date })),
  ].filter(Boolean)
  const others = [...new Map(deal.visits.filter(r => r.contact_name && r.contact_name !== lead.contact_name).map(r => [r.contact_name, r])).values()]
  const client = detail?.client
  const maps = mapUrlOf(lead)
  const name = lead.site_name || lead.company_name
  const slug = String(name).replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40)

  // ---- Contract actions ----
  const startContract = () => {
    if (!accepted && !isAdmin && phase !== 'approved') return toast.error(t.needApproved)
    setContract(contractFromQuote(lead, accepted, sub && ['draft', 'changes_requested'].includes(sub.status) ? sub : null, rule))
    setTab('contract')
  }
  const contractTotals = c => {
    const base = c.billing_type === 'per_visit' ? Number(c.price_per_visit || 0) * Number(c.visits_per_month || 0) : Number(c.base_monthly_amount || 0)
    const extra = c.commission_type === 'percent' ? base * Number(c.commission_value || 0) / 100 : Number(c.commission_value || 0)
    return { base, extra, total: base + extra }
  }
  const saveContract = (signedPath, signedName) => run('contract', async () => {
    const editable = sub && ['draft', 'changes_requested'].includes(sub.status)
    const body = { ...contract, lead_id: lead.id, id: contract.id || (editable ? sub.id : undefined) }
    if (signedPath) { body.signed_pdf_object_path = signedPath; body.signed_pdf_name = signedName }
    const { contract: saved } = await salesPost('/api/sales-data', { action: 'submit-contract', contract: body }, lang)
    setContract(saved && saved.status === 'draft' ? { ...saved, days_of_week: saved.days_of_week || [] } : null)
  }, signedPath ? t.sentForApproval : t.draftSaved)
  const attachSigned = async file => {
    if (!file) return
    if (baseMime(file.type) !== 'application/pdf') return toast.error(t.pdfOnly)
    setBusy('upload')
    try { const path = await uploadPdf(file); await saveContract(path, file.name) }
    catch (e) { toast.error(e.message) }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = '' }
  }
  const downloadContract = async () => {
    const c = contract || sub
    if (!c) return
    setBusy('pdf')
    try { downloadBlob(await contractPdfBlob(contractHtml(c, lead, deal.seller, t, lang), { footer: name }), `contrato-${slug}.pdf`) }
    catch (e) { toast.error(e.message) }
    finally { setBusy('') }
  }
  const review = status => run('review', () => salesPost('/api/sales-data', { action: 'review-contract', id: sub.id, status, admin_note: status === 'changes_requested' ? (window.prompt(t.adminNote) || '') : '' }, lang), status === 'approved' ? t.activated : '')

  // ---- Quote actions (seller) ----
  const saveQuote = () => run('quote', async () => {
    await salesPost('/api/sales-data', { action: 'save-quote', quote: { lead_id: lead.id, items: quoteForm.items, valid_until: quoteForm.valid_until, notes: quoteForm.notes, tax_rate: 10 } }, lang)
    setQuoteForm(null)
  }, '✓')
  const quoteStatus = (q, status) => run(`q-${q.id}`, () => salesPost('/api/sales-data', { action: 'set-quote-status', id: q.id, status }, lang), t.quoteStatus[status])

  // ---- Downloads ----
  const dlContacts = () => {
    const rows = [['name', 'role', 'phone', 'email', 'company', 'site']]
    if (lead.contact_name || lead.contact_phone) rows.push([lead.contact_name, lead.contact_title, lead.contact_phone, lead.contact_email, lead.company_name, lead.site_name])
    for (const r of others) rows.push([r.contact_name, r.contact_title, r.contact_phone, r.contact_email, lead.company_name, lead.site_name])
    if (client?.manager_name) rows.push([client.manager_name, t.clientManager, client.manager_phone, client.manager_email, lead.company_name, lead.site_name])
    downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv' }), `contatos-${slug}.csv`)
  }
  const dlHistory = () => {
    const rows = [['date', 'time', 'event', 'by', 'notes', 'next follow-up', 'file']]
    for (const e of events) rows.push([day(e.at), timeOf(e.at), e.title, e.who || '', e.body || '', e.next || '', e.file || ''])
    downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv' }), `historico-${slug}.csv`)
  }
  const dlDocs = async () => {
    setBusy('zip')
    try {
      const out = []
      for (const file of files) {
        const url = await signedUrl(file.path, file.submission)
        const res = await fetch(url)
        if (res.ok) out.push({ name: `${day(file.at) || 'sem-data'}-${file.name}`, data: new Uint8Array(await res.arrayBuffer()) })
      }
      const c = contract || sub
      if (c) out.push({ name: `contrato-para-assinatura-${slug}.pdf`, data: new Uint8Array(await (await contractPdfBlob(contractHtml(c, lead, deal.seller, t, lang), { footer: name })).arrayBuffer()) })
      out.push({ name: `historico-${slug}.csv`, data: toCsv([['date', 'time', 'event', 'by', 'notes'], ...events.map(e => [day(e.at), timeOf(e.at), e.title, e.who || '', e.body || ''])]) })
      downloadBlob(zipFiles(out), `documentos-${slug}.zip`)
    } catch (e) { toast.error(e.message) }
    finally { setBusy('') }
  }
  const dlSummary = async () => {
    setBusy('summary')
    try {
      const row = (k, v) => v ? `<tr><th>${html(k)}</th><td>${html(v)}</td></tr>` : ''
      const body = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:"Hiragino Sans","Noto Sans JP",sans-serif;color:#111;padding:26px 32px;font-size:12.5px;line-height:1.55}h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #3557f5;padding-bottom:3px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:5px 8px;text-align:left;vertical-align:top}th{background:#f3f5fa;width:30%}.muted{color:#666}</style></head><body>
        <h1>${html(name)}</h1><div class="muted">${html(lead.company_name)} · ${html(t.phases[phase])} · ${html(today)}</div>
        <h2>${html(t.mainContact)}</h2><table>${row(t.mainContact, [lead.contact_name, lead.contact_title].filter(Boolean).join(' · '))}${row(t.call, lead.contact_phone)}${row(t.email, lead.contact_email)}${row('Address', lead.address)}${row(t.seller, deal.seller)}${row(t.mapsLink, lead.maps_url)}</table>
        <h2>${html(t.tabs.steps)}</h2><table>${STEP_PHASES.map(p => row(t.phases[p], steps[p].at ? `${day(steps[p].at)}${steps[p].note ? ` · ${steps[p].note}` : ''}` : t.notDone)).join('')}</table>
        ${accepted ? `<h2>${html(t.quoteInfo)}</h2><table>${row(t.total, yen(accepted.total))}${row(t.approvedOn, day(accepted.decided_at))}${row(t.validUntil, accepted.valid_until)}${(accepted.items || []).map(i => row(i.description, `${i.quantity} × ${yen(i.unit_price)}`)).join('')}</table>` : ''}
        ${sub ? `<h2>${html(t.contractForm)}</h2><table>${row(t.status, t.contractStatus[sub.status])}${row(t.service, sub.service_type)}${row(t.clientTotal, `${yen(sub.client_monthly_total)} ${t.perMonth}`)}${row(t.billingDay, sub.billing_day)}</table>` : ''}
        <h2>${html(t.tabs.history)}</h2><table>${events.slice(0, 40).map(e => row(`${day(e.at)} ${timeOf(e.at)}`, `${e.title}${e.who ? ` (${e.who})` : ''}${e.body ? ` — ${e.body}` : ''}`)).join('')}</table>
      </body></html>`
      downloadBlob(await contractPdfBlob(body, { footer: name }), `resumo-${slug}.pdf`)
    } catch (e) { toast.error(e.message) }
    finally { setBusy('') }
  }

  const logContact = async contact => run('contact', async () => { await salesPost('/api/sales-data', { action: 'log-contact', contact }, lang); setContactOpen(false) }, f.saved)

  // ---- Pieces ----
  const primaryAction = {
    lead: [t.logContact, () => setContactOpen(true)], contact: [t.logContact, () => setContactOpen(true)], visit: onLogVisit ? [t.logVisit, () => onLogVisit(lead)] : [t.logContact, () => setContactOpen(true)],
    proposal: [t.openQuote, () => setTab('quote')], negotiation: [t.openQuote, () => setTab('quote')], approved: [`${t.advance} →`, startContract],
    contract: [t.contractForm, () => { if (sub && ['draft', 'changes_requested'].includes(sub.status)) setContract(contractFromQuote(lead, accepted, sub, rule)); setTab('contract') }], active: [t.tabs.active, () => setTab('active')], lost: [t.logContact, () => setContactOpen(true)],
  }[selected === phase ? phase : selected] || null

  const history = <ol className="fn-timeline">
    {events.map((e, i) => <li key={i} className={`is-${e.kind}`}>
      <time>{day(e.at).slice(8, 10)}/{day(e.at).slice(5, 7)}/{day(e.at).slice(0, 4)}{timeOf(e.at) && <small>{timeOf(e.at)}</small>}</time>
      <span className="fn-tl-icon" aria-hidden="true">{e.icon}</span>
      <div><strong>{e.title}</strong>{e.who && <small>{t.by(e.who)}</small>}{e.body && <p>{e.body}</p>}{e.file && <small>📎 {e.file}</small>}{e.next && <small>{t.nextFollowup}: {e.next}</small>}</div>
    </li>)}
    {events.length === 0 && <p className="fn-empty">{t.noHistory}</p>}
  </ol>

  const quoteCard = q => <div className={`cp-quote is-${q.status}`} key={q.id}>
    <div className="cp-quote-head"><strong>{q.quote_number || '—'}</strong><span className={`fn-badge is-q-${q.status}`}>{t.quoteStatus[q.status] || q.status}</span><b>{yen(q.total)}</b></div>
    <dl className="cp-dl">
      <div><dt>{t.created}</dt><dd>{day(q.created_at)}</dd></div>
      {q.sent_at && <div><dt>{t.sentOn}</dt><dd>{day(q.sent_at)}</dd></div>}
      {q.decided_at && <div><dt>{t.approvedOn}</dt><dd>{day(q.decided_at)}</dd></div>}
      {q.valid_until && <div><dt>{t.validUntil}</dt><dd>{q.valid_until}</dd></div>}
      {q.frequency && <div><dt>{t.frequency}</dt><dd>{q.frequency}</dd></div>}
      {q.hours_per_visit && <div><dt>{t.hours}</dt><dd>{q.hours_per_visit}h</dd></div>}
    </dl>
    {(q.items || []).length > 0 && <div className="cp-tags">{q.items.map((it, i) => <span key={i}>{it.description} · {yen(it.total || it.quantity * it.unit_price)}</span>)}</div>}
    <div className="cp-row-actions">
      {!isAdmin && ['draft', 'pending'].includes(q.status) && <button type="button" className="fa-btn fa-btn-sm" disabled={!!busy} onClick={() => quoteStatus(q, 'sent')}>{t.markSent}</button>}
      {q.status === 'sent' && <><button type="button" className="fa-btn fa-btn-sm fa-btn-primary" disabled={!!busy} onClick={() => quoteStatus(q, 'accepted')}>✓ {t.markAccepted}</button><button type="button" className="fa-btn fa-btn-sm" disabled={!!busy} onClick={() => quoteStatus(q, 'declined')}>{t.markDeclined}</button></>}
      {q.status === 'accepted' && !sub && <button type="button" className="fa-btn fa-btn-sm fa-btn-primary" onClick={startContract}>{t.advance} →</button>}
      {isAdmin && <a className="fa-btn fa-btn-sm" href={`/mitsumori?lead=${encodeURIComponent(lead.id)}`}>{t.openInQuotes} ›</a>}
    </div>
  </div>

  const contractChecklist = (() => {
    const s = sub?.status
    const done = { generate: Boolean(sub), review: Boolean(sub), send: Boolean(sub?.signed_pdf_object_path), signed: Boolean(sub?.signed_pdf_object_path), activate: ['approved', 'active'].includes(s) }
    return <ul className="cp-checklist">{Object.entries(t.contractSteps).map(([k, label]) => <li key={k} className={done[k] ? 'is-done' : ''}><span aria-hidden="true">{done[k] ? '✓' : ''}</span>{label}</li>)}</ul>
  })()

  const contractForm = contract && (() => {
    const totals = contractTotals(contract)
    const set = (k, v) => setContract(c => ({ ...c, [k]: v }))
    return <form className="cp-form" onSubmit={e => { e.preventDefault(); saveContract() }}>
      {accepted && <p className="cp-prefill">✓ {t.fromQuote(accepted.quote_number || yen(accepted.total))}</p>}
      <div className="sp-two"><label className="form-group"><span>{t.service}</span><select value={contract.service_type} onChange={e => set('service_type', e.target.value)}>{SERVICES.map(s => <option key={s}>{s}</option>)}</select></label>
        <label className="form-group"><span>{t.billing}</span><select value={contract.billing_type} onChange={e => set('billing_type', e.target.value)}><option value="fixed_monthly">{t.monthlyFixed}</option><option value="per_visit">{t.perVisit}</option></select></label></div>
      {contract.billing_type === 'per_visit' ? <div className="sp-two"><label className="form-group"><span>{t.priceVisit}</span><input type="number" min="0" value={contract.price_per_visit} onChange={e => set('price_per_visit', e.target.value)} /></label><label className="form-group"><span>{t.visits}</span><input type="number" min="0" value={contract.visits_per_month} onChange={e => set('visits_per_month', e.target.value)} /></label></div>
        : <label className="form-group"><span>{t.base}</span><input type="number" min="0" value={contract.base_monthly_amount} onChange={e => set('base_monthly_amount', e.target.value)} /></label>}
      <div className="form-group"><span>{t.days}</span><div className="sp-chip-row">{DAYS.map(d => <button type="button" key={d} className={`fa-chip${(contract.days_of_week || []).includes(d) ? ' is-active' : ''}`} onClick={() => set('days_of_week', (contract.days_of_week || []).includes(d) ? contract.days_of_week.filter(x => x !== d) : [...(contract.days_of_week || []), d])}>{d}</button>)}</div></div>
      <div className="cp-three"><label className="form-group"><span>{t.hours}</span><input type="number" min="0" step="0.5" value={contract.hours_per_visit} onChange={e => set('hours_per_visit', e.target.value)} /></label><label className="form-group"><span>{t.billingDay}</span><input type="number" min="1" max="28" value={contract.billing_day} onChange={e => set('billing_day', e.target.value)} /></label><label className="form-group"><span>{t.tax}</span><input type="number" min="0" max="20" value={contract.tax_rate} onChange={e => set('tax_rate', e.target.value)} /></label></div>
      <div className="sp-two"><label className="form-group"><span>{t.commission}</span><select value={contract.commission_type} onChange={e => set('commission_type', e.target.value)}><option value="percent">{t.percent}</option><option value="fixed">{t.fixed}</option></select></label><label className="form-group"><span>{t.commissionValue}</span><input type="number" min="0" step="0.1" value={contract.commission_value} onChange={e => set('commission_value', e.target.value)} /></label></div>
      <div className="sp-price"><span>{t.clientTotal}</span><strong>{yen(totals.total)} {t.perMonth}</strong><small>{yen(totals.base)} + {yen(totals.extra)}</small></div>
      <div className="cp-form-actions">
        <button type="submit" className="fa-btn fa-btn-primary" disabled={!!busy}>{busy === 'contract' ? '…' : t.saveDraft}</button>
        {(contract.id || sub) && <button type="button" className="fa-btn" disabled={!!busy} onClick={downloadContract}>⬇ {t.downloadForSign}</button>}
      </div>
    </form>
  })()

  const stepCard = sel => {
    const s = steps[sel] || {}
    const reached = STEP_PHASES.indexOf(sel) <= reachedIndex || sel === phase
    return <section className={`cp-current is-${sel}${reached ? '' : ' is-future'}`}>
      <div className="cp-current-main">
        <span className="cp-current-icon" aria-hidden="true">{reached ? '✓' : '○'}</span>
        <div>
          <strong>{t.phases[sel]}{sel === phase && <em className="cp-now">{t.currentStep}</em>}</strong>
          <small>{reached && s.at ? `${t.date}: ${day(s.at)}${timeOf(s.at) ? ` ${timeOf(s.at)}` : ''}` : t.notDone}{s.who ? ` · ${t.responsible}: ${s.who}` : ''}</small>
        </div>
        {primaryAction && sel === phase && <button type="button" className="fa-btn fa-btn-primary" onClick={primaryAction[1]}>{primaryAction[0]}</button>}
      </div>
      <p className="cp-current-note">ⓘ {s.note || t.stepHelp[sel]}</p>
    </section>
  }

  return <div className="fn-drawer-backdrop cp-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="cp-page" role="dialog" aria-modal="true" aria-label={name}>
      <main className="cp-main">
        <header className="cp-head">
          <div className="cp-photo">{cardUrl ? <a href={cardUrl} target="_blank" rel="noreferrer"><img src={cardUrl} alt={t.files.card} /></a> : <span>{initials(name)}</span>}</div>
          <div className="cp-head-info">
            <div className="cp-title"><h2>{name}</h2><span className={`fn-badge is-${phase}`}>{t.phases[phase]}</span></div>
            <div className="cp-tags">{[lead.company_name !== name && lead.company_name, lead.region, data?.marketing?.channels?.find(c => c.id === lead.marketing_channel_id)?.name].filter(Boolean).map(x => <span key={x}>{x}</span>)}</div>
            {lead.address && <a className="cp-address" href={maps || undefined} target="_blank" rel="noreferrer">📍 {lead.address}</a>}
          </div>
          <div className="cp-head-side">
            <div className="cp-who"><span className="fn-avatar is-sm">{initials(deal.seller || '?')}</span><div><strong>{deal.seller || '—'}</strong><small>{t.responsible}</small></div></div>
            {lead.contact_phone && <a href={`tel:${lead.contact_phone}`}>📞 {lead.contact_phone}</a>}
            {lead.contact_email && <a href={`mailto:${lead.contact_email}`}>✉ {lead.contact_email}</a>}
          </div>
          <div className="cp-head-actions">
            {onEdit && <button type="button" className="fa-btn fa-btn-sm" onClick={() => onEdit(lead)}>✎ {t.edit}</button>}
            <div className="cp-dl-wrap">
              <button type="button" className="fa-btn fa-btn-sm" aria-expanded={dlOpen} onClick={() => setDlOpen(v => !v)}>⬇ {busy && ['zip', 'summary'].includes(busy) ? t.preparing : t.download}</button>
              {dlOpen && <div className="cp-dl-menu" onMouseLeave={() => setDlOpen(false)}>
                <button type="button" onClick={() => { setDlOpen(false); dlContacts() }}>👥 {t.dl.contacts}</button>
                <button type="button" onClick={() => { setDlOpen(false); dlDocs() }}>🗂 {t.dl.docs}</button>
                <button type="button" onClick={() => { setDlOpen(false); dlHistory() }}>🕘 {t.dl.history}</button>
                <button type="button" onClick={() => { setDlOpen(false); dlSummary() }}>📄 {t.dl.summary}</button>
              </div>}
            </div>
            <button type="button" className="fn-close is-flat" aria-label="Close" onClick={onClose}>×</button>
          </div>
        </header>

        <div className="cp-quick">
          {lead.contact_phone && <a href={`tel:${lead.contact_phone}`}><span>📞</span>{t.call}</a>}
          {lead.contact_line_id && <a href={`https://line.me/R/ti/p/~${encodeURIComponent(lead.contact_line_id)}`} target="_blank" rel="noreferrer"><span>💬</span>{t.line}</a>}
          {lead.contact_email && <a href={`mailto:${lead.contact_email}`}><span>✉️</span>{t.email}</a>}
          {maps && <a href={maps} target="_blank" rel="noreferrer"><span>📍</span>{t.map}</a>}
          <button type="button" onClick={() => setContactOpen(v => !v)}><span>💬</span>{t.logContact}</button>
          {onLogVisit && <button type="button" onClick={() => onLogVisit(lead)}><span>📝</span>{t.logVisit}</button>}
        </div>
        {contactOpen && <div className="fn-contact-form"><ContactLogForm lead={lead} today={today} f={f} busy={busy === 'contact'} onSave={logContact} onCancel={() => setContactOpen(false)} /></div>}

        <nav className="cp-tabs">{Object.entries(t.tabs).map(([k, label]) => <button key={k} type="button" className={`${tab === k ? 'is-active' : ''}${k === 'history' ? ' cp-only-narrow' : ''}`} onClick={() => setTab(k)}>{label}{k === 'files' ? ` (${files.length})` : k === 'contacts' ? ` (${(lead.contact_name ? 1 : 0) + others.length})` : ''}</button>)}</nav>

        <div className="cp-body">
          {tab === 'steps' && <>
            <ol className="cp-stepper">{STEP_PHASES.map((p, i) => {
              const done = i < reachedIndex || (phase === 'active' && p === 'active'), current = p === phase
              return <li key={p} className={`${done ? 'is-done' : ''}${current ? ' is-current' : ''}${selected === p ? ' is-selected' : ''}`}>
                <button type="button" onClick={() => setSelected(p)}><span className="cp-dot">{done ? '✓' : current ? '●' : ''}</span><strong>{t.phases[p]}</strong><small>{steps[p]?.at && (done || current) ? shortDay(steps[p].at) : ''}</small></button>
              </li>
            })}</ol>
            <h3 className="cp-h3">{t.stepDetails}</h3>
            {stepCard(selected)}
            <div className="cp-grid">
              <section className="cp-box">
                <div className="cp-box-head"><h4>{t.quoteInfo}</h4>{(accepted || quotes[0]) && <button type="button" className="fa-btn fa-btn-sm" onClick={() => setTab('quote')}>{t.openQuote}</button>}</div>
                {(accepted || quotes[0]) ? (() => { const q = accepted || quotes[0]; return <dl className="cp-dl is-rows">
                  <div><dt>{t.total}</dt><dd><b>{yen(q.total)}</b></dd></div><div><dt>{t.created}</dt><dd>{day(q.created_at)}</dd></div>
                  {q.decided_at && <div><dt>{t.approvedOn}</dt><dd>{day(q.decided_at)}</dd></div>}{q.valid_until && <div><dt>{t.validUntil}</dt><dd>{q.valid_until}</dd></div>}
                  <div><dt>{t.status}</dt><dd><span className={`fn-badge is-q-${q.status}`}>{t.quoteStatus[q.status] || q.status}</span></dd></div>
                  {(q.items || []).length > 0 && <div><dt>{t.items}</dt><dd className="cp-tags">{q.items.slice(0, 6).map((it, i) => <span key={i}>{it.description}</span>)}</dd></div>}
                </dl> })() : <p className="fn-empty">{t.noQuote}</p>}
              </section>
              <section className="cp-box">
                <div className="cp-box-head"><h4>{t.nextStep}: {t.phases[STEP_PHASES[Math.min(reachedIndex + 1, STEP_PHASES.length - 1)]] || ''}</h4></div>
                {['approved', 'contract', 'active'].includes(phase) ? contractChecklist : <p className="fn-empty">{t.stepHelp[STEP_PHASES[Math.min(reachedIndex + 1, STEP_PHASES.length - 1)]]}</p>}
                {phase === 'approved' && <button type="button" className="fa-btn fa-btn-primary fa-btn-block" onClick={startContract}>📝 {t.advance}</button>}
              </section>
              <section className="cp-box">
                <div className="cp-box-head"><h4>{t.quickActions}</h4></div>
                <div className="cp-actions-list">
                  {lead.contact_email && <a className="fa-btn fa-btn-sm" href={`mailto:${lead.contact_email}`}>✉ {t.email}</a>}
                  {lead.contact_phone && <a className="fa-btn fa-btn-sm" href={`tel:${lead.contact_phone}`}>📞 {t.call}</a>}
                  <button type="button" className="fa-btn fa-btn-sm" onClick={() => setContactOpen(true)}>💬 {t.logContact}</button>
                  {onLogVisit && <button type="button" className="fa-btn fa-btn-sm" onClick={() => onLogVisit(lead)}>📝 {t.logVisit}</button>}
                  <button type="button" className="fa-btn fa-btn-sm" onClick={() => setContactOpen(true)}>＋ {t.followup}</button>
                </div>
              </section>
            </div>
          </>}

          {tab === 'quote' && <div className="cp-stack">
            {!isAdmin && !quoteForm && <button type="button" className="fa-btn fa-btn-primary" onClick={() => setQuoteForm({ items: [{ description: '', quantity: 1, unit_price: '' }], valid_until: '', notes: '' })}>＋ {t.newQuote}</button>}
            {isAdmin && <a className="fa-btn fa-btn-primary" href={`/mitsumori?lead=${encodeURIComponent(lead.id)}`}>＋ {t.newQuote}</a>}
            {quoteForm && <form className="cp-box cp-form" onSubmit={e => { e.preventDefault(); saveQuote() }}>
              {quoteForm.items.map((it, i) => <div className="cp-quote-line" key={i}>
                <input placeholder={t.items} value={it.description} onChange={e => setQuoteForm(q => ({ ...q, items: q.items.map((x, j) => j === i ? { ...x, description: e.target.value } : x) }))} />
                <input type="number" min="1" value={it.quantity} aria-label="qty" onChange={e => setQuoteForm(q => ({ ...q, items: q.items.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x) }))} />
                <input type="number" min="0" placeholder="¥" value={it.unit_price} onChange={e => setQuoteForm(q => ({ ...q, items: q.items.map((x, j) => j === i ? { ...x, unit_price: e.target.value } : x) }))} />
              </div>)}
              <button type="button" className="fa-link" onClick={() => setQuoteForm(q => ({ ...q, items: [...q.items, { description: '', quantity: 1, unit_price: '' }] }))}>＋ {t.items}</button>
              <label className="form-group"><span>{t.validUntil}</span><input type="date" value={quoteForm.valid_until} onChange={e => setQuoteForm(q => ({ ...q, valid_until: e.target.value }))} /></label>
              <div className="sp-price"><span>{t.total} (+10%)</span><strong>{yen(quoteForm.items.reduce((s, x) => s + Number(x.quantity || 0) * Number(x.unit_price || 0), 0) * 1.1)}</strong></div>
              <div className="cp-form-actions"><button className="fa-btn fa-btn-primary" disabled={!!busy}>{t.saveQuote}</button><button type="button" className="fa-btn" onClick={() => setQuoteForm(null)}>{f.cancel}</button></div>
            </form>}
            {quotes.map(quoteCard)}
            {quotes.length === 0 && !quoteForm && <p className="fn-empty">{t.noQuote}</p>}
          </div>}

          {tab === 'contract' && <div className="cp-stack">
            <section className="cp-box">{contractChecklist}</section>
            {sub && !contract && <section className="cp-box">
              <div className="cp-box-head"><h4>{t.contractForm}</h4><span className={`fn-badge is-c-${sub.status}`}>{t.contractStatus[sub.status]}</span></div>
              <dl className="cp-dl is-rows"><div><dt>{t.service}</dt><dd>{sub.service_type}</dd></div><div><dt>{t.clientTotal}</dt><dd><b>{yen(sub.client_monthly_total)}</b> {t.perMonth}</dd></div><div><dt>{t.billingDay}</dt><dd>{sub.billing_day}</dd></div><div><dt>{t.days}</dt><dd>{(sub.days_of_week || []).join(' / ') || '—'}</dd></div>{sub.admin_note && <div><dt>{t.adminNote}</dt><dd>{sub.admin_note}</dd></div>}</dl>
              <div className="cp-form-actions">
                {['draft', 'changes_requested'].includes(sub.status) && <button type="button" className="fa-btn" onClick={() => setContract(contractFromQuote(lead, accepted, sub, rule))}>✎ {t.edit}</button>}
                <button type="button" className="fa-btn" disabled={!!busy} onClick={downloadContract}>⬇ {busy === 'pdf' ? '…' : t.downloadForSign}</button>
                {sub.signed_pdf_object_path && <button type="button" className="fa-btn" onClick={() => signedUrl(sub.signed_pdf_object_path, sub.id).then(u => window.open(u, '_blank', 'noopener')).catch(e => toast.error(e.message))}>📄 {t.files.signed}</button>}
              </div>
              {['draft', 'changes_requested'].includes(sub.status) && <div className="cp-upload"><input ref={fileRef} hidden type="file" accept="application/pdf,.pdf" onChange={e => attachSigned(e.target.files?.[0])} /><button type="button" className="fa-btn fa-btn-primary fa-btn-block" disabled={!!busy} onClick={() => fileRef.current?.click()}>📎 {busy === 'upload' ? '…' : t.attachSigned}</button></div>}
              {isAdmin && ['pending_review', 'changes_requested'].includes(sub.status) && <div className="cp-form-actions"><button type="button" className="fa-btn fa-btn-primary" disabled={!!busy} onClick={() => review('approved')}>✓ {t.approveActivate}</button><button type="button" className="fa-btn" disabled={!!busy} onClick={() => review('changes_requested')}>{t.requestChanges}</button></div>}
            </section>}
            {contract && <section className="cp-box"><div className="cp-box-head"><h4>{t.contractForm}</h4></div>{contractForm}</section>}
            {!sub && !contract && <section className="cp-box cp-empty-cta"><p>{accepted || isAdmin ? t.stepHelp.approved : t.needApproved}</p>{(accepted || isAdmin) && <button type="button" className="fa-btn fa-btn-primary" onClick={startContract}>📝 {t.advance}</button>}</section>}
          </div>}

          {tab === 'active' && <div className="cp-stack">
            {!services.length && phase !== 'active' ? <p className="fn-empty">{t.notActive}</p> : <>
              <section className="cp-box"><div className="cp-box-head"><h4>{t.services}</h4></div>
                {services.map(s => <div className="cp-line" key={s.id}><div><strong>{s.service_type}</strong><small>{[s.location_name, (s.days_of_week || []).join('/'), s.hours_per_visit && `${s.hours_per_visit}h`].filter(Boolean).join(' · ')}</small></div><b>{yen(s.monthly_revenue)} {t.perMonth}</b></div>)}
              </section>
              <section className="cp-box"><div className="cp-box-head"><h4>{t.schedule}</h4></div>
                {jobs.slice(0, 20).map(j => <div className="cp-line" key={j.id}><span className="sp-date">{shortDay(j.scheduled_date)}</span><div><strong>{j.title}</strong><small>{[j.scheduled_time, j.employee_name].filter(Boolean).join(' · ')}</small></div><span className={`fn-badge is-j-${j.status}`}>{t.jobStatus[j.status] || j.status}</span></div>)}
                {jobs.length === 0 && <p className="fn-empty">{t.noJobs}</p>}
              </section>
              <section className="cp-box"><div className="cp-box-head"><h4>{t.invoices}</h4><span className="cp-sum">{t.paid}: {yen(invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.total || 0), 0))} · {t.open}: {yen(invoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled').reduce((s, i) => s + Number(i.total || 0), 0))}</span></div>
                {invoices.map(i => <div className="cp-line" key={i.id}><span className="sp-date">{shortDay(i.issue_date)}</span><div><strong>{yen(i.total)}</strong><small>{[i.period_start && `${i.period_start} – ${i.period_end}`, i.due_date && `→ ${i.due_date}`].filter(Boolean).join(' · ')}</small></div><span className={`fn-badge is-i-${i.status}`}>{t.invoiceStatus[i.status] || i.status}</span></div>)}
                {invoices.length === 0 && <p className="fn-empty">{t.noInvoices}</p>}
              </section>
            </>}
          </div>}

          {tab === 'contacts' && <div className="cp-stack">
            {lead.contact_name || lead.contact_phone ? <div className="fn-person is-main"><span className="fn-avatar">{initials(lead.contact_name)}</span><div><strong>{lead.contact_name || '—'}</strong><small>{[t.mainContact, lead.contact_title].filter(Boolean).join(' · ')}</small><small>{[lead.contact_phone, lead.contact_email].filter(Boolean).join(' · ')}</small></div>{lead.contact_phone && <a href={`tel:${lead.contact_phone}`} className="sp-round-btn">📞</a>}</div> : <p className="fn-empty">{t.noContacts}</p>}
            {client?.manager_name && <div className="fn-person"><span className="fn-avatar">{initials(client.manager_name)}</span><div><strong>{client.manager_name}</strong><small>{t.clientManager}</small><small>{[client.manager_phone, client.manager_email].filter(Boolean).join(' · ')}</small></div></div>}
            {others.length > 0 && <h3 className="cp-h3">{t.otherContacts}</h3>}
            {others.map(r => <div className="fn-person" key={r.contact_name}><span className="fn-avatar">{initials(r.contact_name)}</span><div><strong>{r.contact_name}</strong><small>{[r.contact_title, r.contact_phone].filter(Boolean).join(' · ')}</small></div>{r.contact_phone && <a href={`tel:${r.contact_phone}`} className="sp-round-btn">📞</a>}</div>)}
          </div>}

          {tab === 'files' && <div className="cp-stack">
            {cardUrl && <a href={cardUrl} target="_blank" rel="noreferrer" className="cp-card-photo"><img src={cardUrl} alt={t.files.card} /></a>}
            {files.map(file => <button type="button" key={file.key} className="cp-file" onClick={() => signedUrl(file.path, file.submission).then(u => window.open(u, '_blank', 'noopener')).catch(e => toast.error(e.message))}><span aria-hidden="true">{file.icon}</span><div><strong>{file.label}</strong><small>{file.name} · {day(file.at)}</small></div><b>{t.openFile} ›</b></button>)}
            {(contract || sub) && <button type="button" className="cp-file" onClick={downloadContract}><span aria-hidden="true">📝</span><div><strong>{t.downloadForSign}</strong><small>PDF</small></div><b>⬇</b></button>}
            {files.length === 0 && !sub && <p className="fn-empty">{t.noFiles}</p>}
          </div>}

          {tab === 'history' && <div className="cp-only-narrow">{history}</div>}
        </div>
      </main>
      <aside className="cp-side">
        <div className="cp-side-head"><h3>{t.tabs.history}</h3><span>{events.length}</span></div>
        {history}
      </aside>
    </div>
  </div>
}
