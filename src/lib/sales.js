import { escapeHtml } from './escapeHtml'
import { addDays, invoiceTotals, lineTotal, yen } from './invoice'
import { PRINT_DOC_CSS, localizePrintText, formatAddressForLang } from './printDoc'
import { printIssuer } from './quoteIssuer'

export const LEAD_SOURCES = ['visit', 'phone', 'referral', 'web', 'walkin', 'other']
export const LEAD_STAGES = ['approach', 'followup', 'won', 'lost']
export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired']

export function isSalesSchemaMissing(error) {
  const msg = String(error?.message || '')
  return error?.code === 'PGRST205' || msg.includes('sales_leads') || msg.includes('mitsumori') || msg.includes('sales_touchpoints')
}

export function isCrmSchemaMissing(error) {
  const msg = String(error?.message || '').toLowerCase()
  return msg.includes('sales_touchpoints')
    || msg.includes('site_name')
    || (msg.includes('interest') && (msg.includes('column') || msg.includes('schema cache')))
}

export function dropSiteNameKeepNote(payload) {
  if (!payload || typeof payload !== 'object') return payload
  const { site_name, ...rest } = payload
  return { ...rest, notes: embedRestaurantNote(rest.notes, site_name) }
}

export function stripCrmExtras(payload) {
  if (!payload || typeof payload !== 'object') return payload
  const rest = { ...payload }
  delete rest.interest
  return rest
}

const SITE_TAG_RE = /(?:【店舗】|【店名】|(?:店舗名|店名|店舗|現場名|現場|レストラン名|レストラン|Restaurant|Store name|Store)\s*[:：]?\s*)/i
const SITE_NOTE_RE = new RegExp(`(?:^|\\n)\\s*${SITE_TAG_RE.source}([^\\n]+)`, 'i')
const SITE_LINE_RE = new RegExp(`^(?:${SITE_TAG_RE.source})[^\\n]*\\n?`, 'i')

export function embedRestaurantNote(notes, siteName) {
  const site = String(siteName || '').replace(/\u3000/g, ' ').trim()
  const body = String(notes || '').replace(SITE_LINE_RE, '')
  if (!site) return body
  return `【店舗】${site}\n${body}`
}

export function restaurantFromNotes(notes) {
  const m = String(notes || '').match(SITE_NOTE_RE)
  return m ? String(m[1] || '').replace(/\u3000/g, ' ').trim() : ''
}

export function notesForPrint(notes) {
  return String(notes || '').replace(SITE_LINE_RE, '').trim()
}

export function quoteRestaurantName(quote) {
  const first = (...vals) => {
    for (const v of vals) {
      const s = String(v || '').replace(/\u3000/g, ' ').trim()
      if (s) return s
    }
    return ''
  }
  return first(
    quote?.site_name,
    restaurantFromNotes(quote?.notes),
    quote?.location_name,
    quote?.store_name,
    quote?.restaurant_name,
    quote?.restaurant,
    quote?.place,
  )
}

export function normalizeCompanyKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function findLeadByCompany(leads, companyName) {
  const key = normalizeCompanyKey(companyName)
  if (!key) return null
  return (leads || []).find(l => normalizeCompanyKey(l.company_name) === key) || null
}

export function emptyLead(today, stage = 'approach') {
  return {
    company_name: '',
    company_kana: '',
    site_name: '',
    address: '',
    phone: '',
    email: '',
    website: '',
    industry: '',
    locations_count: '',
    contact_name: '',
    contact_title: '',
    contact_phone: '',
    contact_email: '',
    contact_line_id: '',
    first_contact_date: today || '',
    last_contact_date: today || '',
    next_followup_date: '',
    source: 'visit',
    needs: '',
    still_needed: '',
    decision_maker: '',
    expected_monthly: '',
    expected_start: '',
    competitor: '',
    notes: '',
    interest: '',
    stage,
  }
}

export function leadFromRow(row, today) {
  const merged = { ...emptyLead(today, row.stage || 'approach'), ...row, locations_count: row.locations_count ?? '', expected_monthly: row.expected_monthly ?? '' }
  if (!String(merged.site_name || '').trim()) merged.site_name = restaurantFromNotes(row.notes)
  merged.notes = notesForPrint(row.notes)
  return merged
}

export function mergeLeadFromQuote(existing, form, today) {
  const first = existing?.first_contact_date || form.first_contact_date || today
  const keepWon = existing?.stage === 'won'
  return {
    company_name: String(form.company_name || '').trim(),
    company_kana: form.company_kana || '',
    site_name: form.site_name || '',
    address: form.address || '',
    phone: form.phone || '',
    email: form.email || '',
    website: form.website || existing?.website || '',
    industry: form.industry || existing?.industry || '',
    locations_count: form.locations_count === '' || form.locations_count == null ? (existing?.locations_count ?? null) : Number(form.locations_count),
    contact_name: form.contact_name || '',
    contact_title: form.contact_title || '',
    contact_phone: form.contact_phone || '',
    contact_email: form.contact_email || '',
    contact_line_id: form.contact_line_id || existing?.contact_line_id || '',
    first_contact_date: first,
    last_contact_date: today,
    next_followup_date: form.next_followup_date || existing?.next_followup_date || null,
    source: form.source || existing?.source || '',
    needs: form.needs || '',
    still_needed: form.still_needed || '',
    decision_maker: form.decision_maker || existing?.decision_maker || '',
    expected_monthly: form.expected_monthly === '' || form.expected_monthly == null ? (existing?.expected_monthly ?? null) : Number(form.expected_monthly),
    expected_start: form.expected_start || existing?.expected_start || null,
    competitor: form.competitor || existing?.competitor || '',
    notes: embedRestaurantNote(form.notes, form.site_name),
    interest: form.interest || existing?.interest || '',
    stage: keepWon ? 'won' : 'followup',
    updated_at: new Date().toISOString(),
  }
}

export function leadWritePayload(form, today, stage) {
  return {
    company_name: String(form.company_name || '').trim(),
    company_kana: form.company_kana || '',
    site_name: form.site_name || '',
    address: form.address || '',
    phone: form.phone || '',
    email: form.email || '',
    website: form.website || '',
    industry: form.industry || '',
    locations_count: form.locations_count === '' || form.locations_count == null ? null : Number(form.locations_count),
    contact_name: form.contact_name || '',
    contact_title: form.contact_title || '',
    contact_phone: form.contact_phone || '',
    contact_email: form.contact_email || '',
    contact_line_id: form.contact_line_id || '',
    first_contact_date: form.first_contact_date || today,
    last_contact_date: today,
    next_followup_date: form.next_followup_date || null,
    source: form.source || '',
    needs: form.needs || '',
    still_needed: form.still_needed || '',
    decision_maker: form.decision_maker || '',
    expected_monthly: form.expected_monthly === '' || form.expected_monthly == null ? null : Number(form.expected_monthly),
    expected_start: form.expected_start || null,
    competitor: form.competitor || '',
    notes: embedRestaurantNote(form.notes, form.site_name),
    interest: form.interest || '',
    stage: stage || form.stage || 'approach',
    updated_at: new Date().toISOString(),
  }
}

export function nextQuoteNumber(existing, issueDate) {
  const yyyymm = String(issueDate || '').slice(0, 7).replace('-', '')
  const prefix = `KPQ-${yyyymm}-`
  let max = 0
  for (const row of existing || []) {
    const n = String(row?.quote_number || '')
    if (!n.startsWith(prefix)) continue
    const seq = parseInt(n.slice(prefix.length), 10)
    if (Number.isFinite(seq) && seq > max) max = seq
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

export function quoteTotals(items, taxRate) {
  return invoiceTotals(items, taxRate)
}

export function quoteWritePayload(form, leadId, totals, extra = {}) {
  return {
    lead_id: leadId || null,
    company_name: String(form.company_name || '').trim(),
    company_kana: form.company_kana || '',
    site_name: form.site_name || '',
    address: form.address || '',
    phone: form.phone || '',
    email: form.email || '',
    contact_name: form.contact_name || '',
    contact_title: form.contact_title || '',
    contact_phone: form.contact_phone || '',
    contact_email: form.contact_email || '',
    first_contact_date: form.first_contact_date || null,
    needs: form.needs || '',
    still_needed: form.still_needed || '',
    source: form.source || '',
    notes: embedRestaurantNote(form.notes, form.site_name),
    interest: form.interest || '',
    valid_until: form.valid_until || null,
    site_visit_date: form.site_visit_date || null,
    expected_start: form.expected_start || null,
    frequency: form.frequency || '',
    hours_per_visit: form.hours_per_visit === '' || form.hours_per_visit == null ? null : Number(form.hours_per_visit),
    tax_rate: parseInt(form.tax_rate, 10) || 10,
    subtotal: totals.subtotal,
    tax_amount: totals.taxAmount,
    total: totals.total,
    ...extra,
  }
}

export function emptyQuoteItem() {
  return { description: '', quantity: 1, unit_price: 0, total: 0 }
}

export function leadIsOverdue(lead, today) {
  if (!lead?.next_followup_date) return false
  if (lead.stage === 'won' || lead.stage === 'lost') return false
  return lead.next_followup_date < today
}

export function leadsForStage(leads, stage) {
  return (leads || []).filter(l => l.stage === stage)
}

export function defaultValidUntil(issueDate) {
  return addDays(issueDate, 30)
}

export function isQuoteEditable(status) {
  return !status || status === 'draft' || status === 'pending'
}

export function emptyTouchpoint(today) {
  return { event_type: 'reply', happened_at: today || '', channel: 'phone', said_by: '', body: '' }
}

export const TOUCH_CHANNELS = ['phone', 'email', 'visit', 'line', 'other']
export const TOUCH_TYPES = ['reply', 'call', 'note', 'sent']

export const QUOTE_PRINT_COPY = {
  ja: {
    htmlLang: 'ja',
    docTitle: '見積書',
    honorific: '御中',
    store: '店舗',
    company: '会社',
    contact: 'ご担当',
    issueDate: '発行日',
    validUntil: '有効期限',
    rep: '代表',
    address: '住所',
    reg: '登録番号',
    desc: '内容',
    qty: '数量',
    unit: '単価',
    amount: '金額',
    subtotal: '小計',
    tax: '消費税',
    total: '合計（税込）',
    notes: '備考',
    issuer: '発行者',
    email: 'メール',
    phone: '電話',
    accepted: '成約',
    colon: '：',
    thanks: 'この度はお見積りをご依頼いただき、誠にありがとうございます。内容をご確認のうえ、ご返答をお待ちしております。',
    titleTracking: '0.45em',
  },
  en: {
    htmlLang: 'en',
    docTitle: 'QUOTATION',
    honorific: '',
    store: 'Store',
    company: 'Company',
    contact: 'Contact',
    issueDate: 'Issue date',
    validUntil: 'Valid until',
    rep: 'Rep.',
    address: 'Address',
    reg: 'Reg. No.',
    desc: 'Description',
    qty: 'Qty',
    unit: 'Unit price',
    amount: 'Amount',
    subtotal: 'Subtotal',
    tax: 'Consumption tax',
    total: 'Total (incl. tax)',
    notes: 'Notes',
    issuer: 'Issuer',
    email: 'Email',
    phone: 'Phone',
    accepted: 'Won',
    colon: ': ',
    thanks: 'Thank you for requesting this quotation. Please review the details — we look forward to your reply.',
    titleTracking: '0.12em',
  },
}

export function quotePrintCopy(lang) {
  return QUOTE_PRINT_COPY[lang === 'en' ? 'en' : 'ja']
}

export function buildMitsumoriPrintHtml(quote, items, issuer = {}, lang = 'ja') {
  const L = quotePrintCopy(lang)
  const loc = printIssuer(issuer, lang)
  const restaurant = localizePrintText(quoteRestaurantName(quote), lang)
  const companyRaw = localizePrintText(String(quote.company_name || '').trim(), lang)
  const company = escapeHtml(companyRaw)
  const siteName = escapeHtml(restaurant)
  const printTitle = siteName || company
  const contact = escapeHtml(localizePrintText([quote.contact_title, quote.contact_name].filter(Boolean).join(' '), lang))
  const number = escapeHtml(quote.quote_number || quote.id?.slice?.(0, 8) || '')
  const issuerCompany = escapeHtml(loc.company)
  const issuerTitle = escapeHtml(L.rep)
  const issuerPerson = escapeHtml(loc.name)
  const issuerAddress = escapeHtml(loc.address || '')
  const issuerReg = escapeHtml(loc.regNumber || '')
  const issuerEmail = escapeHtml(loc.email)
  const issuerPhone = escapeHtml(loc.phone)
  const printNotes = localizePrintText(notesForPrint(quote.notes), lang)
  const clientAddress = formatAddressForLang(quote.address || '', lang)
  const freqBits = [
    quote.frequency ? localizePrintText(quote.frequency, lang) : '',
    quote.hours_per_visit ? `${quote.hours_per_visit}${lang === 'en' ? ' h' : '時間'}` : '',
  ].filter(Boolean).join(lang === 'en' ? ' · ' : '　')
  const billCore = siteName || company
  const billName = L.honorific ? `${billCore} ${L.honorific}` : billCore
  const companyLine = company && company !== billCore
    ? `<div class="muted">${L.company}${L.colon}${company}</div>`
    : ''
  const billTo = `<div class="site-kicker">${L.store}</div><div class="bill-to">${billName}</div>${companyLine}`
  const rows = (items || []).map(it => `
      <tr>
        <td>${escapeHtml(localizePrintText(it.description || '', lang))}</td>
        <td class="num">${escapeHtml(String(it.quantity ?? ''))}</td>
        <td class="num">${yen(it.unit_price)}</td>
        <td class="num">${yen(it.total)}</td>
      </tr>`).join('')
  const accepted = quote.status === 'accepted'
  const brandTrack = lang === 'en' ? '0.08em' : '0.28em'

  return `<!DOCTYPE html>
<html lang="${L.htmlLang}"><head><meta charset="utf-8"><title>${L.docTitle} ${number} - ${printTitle}</title>
<style>${PRINT_DOC_CSS}
  .doc-title h1{letter-spacing:${L.titleTracking}}
  .brand-name{letter-spacing:${brandTrack}}
</style></head>
<body>
  <div class="wrap">
    ${accepted ? `<div class="stamp">${L.accepted}</div>` : ''}
    <div class="head">
      <div class="brand">
        <div class="brand-name">${issuerCompany}</div>
      </div>
      <div class="doc-title">
        <h1>${L.docTitle}</h1>
        <div class="no">${number}</div>
      </div>
    </div>
    <div class="gold"></div>
    <div class="meta">
      <div>
        ${billTo}
        ${contact ? `<div class="muted">${L.contact}${L.colon}${contact}</div>` : ''}
        ${clientAddress ? `<div class="muted">${escapeHtml(clientAddress)}</div>` : ''}
        ${freqBits ? `<div class="muted">${escapeHtml(freqBits)}</div>` : ''}
      </div>
      <div class="meta-side muted">
        <div>${L.issueDate}${L.colon}${escapeHtml(quote.issue_date || '')}</div>
        <div>${L.validUntil}${L.colon}${escapeHtml(quote.valid_until || '—')}</div>
        <div class="rep-block">
          <div class="rep-kicker">${issuerTitle}</div>
          <div class="rep-name">${issuerPerson}</div>
        </div>
        <div style="margin-top:6px;color:#152033;font-weight:800">${issuerCompany}</div>
        ${issuerAddress ? `<div>${issuerAddress}</div>` : ''}
        ${issuerReg ? `<div>${L.reg}${L.colon}${issuerReg}</div>` : ''}
      </div>
    </div>
    <table class="lines">
      <thead><tr><th>${L.desc}</th><th class="num">${L.qty}</th><th class="num">${L.unit}</th><th class="num">${L.amount}</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">—</td></tr>'}</tbody>
    </table>
    <table class="totals">
      <tr><td>${L.subtotal}</td><td class="num">${yen(quote.subtotal)}</td></tr>
      <tr><td>${L.tax} (${escapeHtml(String(quote.tax_rate ?? 10))}%)</td><td class="num">${yen(quote.tax_amount)}</td></tr>
      <tr class="total-row"><td>${L.total}</td><td class="num">${yen(quote.total)}</td></tr>
    </table>
    ${printNotes ? `<p class="muted" style="margin-top:18px">${L.notes}${L.colon}${escapeHtml(printNotes)}</p>` : ''}
    <p class="thanks">${L.thanks}</p>
    <div class="issuer">
      <div class="issuer-card">
        <div class="issuer-kicker">${L.issuer}</div>
        <strong>${issuerCompany}</strong>
        <div class="issuer-line"><span>${issuerTitle}</span><div>${issuerPerson}</div></div>
        ${issuerAddress ? `<div class="issuer-line"><span>${L.address}</span><div>${issuerAddress}</div></div>` : ''}
        ${issuerReg ? `<div class="issuer-line"><span>${L.reg}</span><div>${issuerReg}</div></div>` : ''}
        <div class="issuer-line"><span>${L.email}</span><div>${issuerEmail}</div></div>
        <div class="issuer-line"><span>${L.phone}</span><div>${issuerPhone}</div></div>
      </div>
    </div>
  </div>
</body></html>`
}

export { lineTotal, yen }
