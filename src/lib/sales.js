import { escapeHtml } from './escapeHtml'
import { addDays, invoiceTotals, lineTotal, yen } from './invoice'
import { QUOTE_ISSUER } from './quoteIssuer'

export const LEAD_SOURCES = ['visit', 'phone', 'referral', 'web', 'walkin', 'other']
export const LEAD_STAGES = ['approach', 'followup', 'won', 'lost']
export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired']

export function isSalesSchemaMissing(error) {
  const msg = String(error?.message || '')
  return error?.code === 'PGRST205' || msg.includes('sales_leads') || msg.includes('mitsumori') || msg.includes('sales_touchpoints')
}

export function isCrmSchemaMissing(error) {
  const msg = String(error?.message || '').toLowerCase()
  return msg.includes('sales_touchpoints') || (msg.includes('interest') && (msg.includes('column') || msg.includes('schema cache')))
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
  return { ...emptyLead(today, row.stage || 'approach'), ...row, locations_count: row.locations_count ?? '', expected_monthly: row.expected_monthly ?? '' }
}

export function mergeLeadFromQuote(existing, form, today) {
  const first = existing?.first_contact_date || form.first_contact_date || today
  const keepWon = existing?.stage === 'won'
  return {
    company_name: String(form.company_name || '').trim(),
    company_kana: form.company_kana || '',
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
    notes: form.notes || existing?.notes || '',
    interest: form.interest || existing?.interest || '',
    stage: keepWon ? 'won' : 'followup',
    updated_at: new Date().toISOString(),
  }
}

export function leadWritePayload(form, today, stage) {
  return {
    company_name: String(form.company_name || '').trim(),
    company_kana: form.company_kana || '',
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
    notes: form.notes || '',
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
    notes: form.notes || '',
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

export function buildMitsumoriPrintHtml(quote, items, issuer = {}) {
  const company = escapeHtml(quote.company_name)
  const contact = escapeHtml([quote.contact_title, quote.contact_name].filter(Boolean).join(' '))
  const number = escapeHtml(quote.quote_number || quote.id?.slice?.(0, 8) || '')
  const issuerCompany = escapeHtml(issuer.company || QUOTE_ISSUER.company)
  const issuerPerson = escapeHtml(issuer.name || QUOTE_ISSUER.name)
  const issuerEmail = escapeHtml(issuer.email || QUOTE_ISSUER.email)
  const issuerPhone = escapeHtml(issuer.phone || QUOTE_ISSUER.phone)
  const rows = (items || []).map(it => `
      <tr>
        <td>${escapeHtml(it.description || '')}</td>
        <td class="num">${escapeHtml(String(it.quantity ?? ''))}</td>
        <td class="num">${yen(it.unit_price)}</td>
        <td class="num">${yen(it.total)}</td>
      </tr>`).join('')
  const accepted = quote.status === 'accepted'

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>見積書 ${number} - ${company}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body{font-family:'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif;color:#152033;max-width:740px;margin:0 auto;padding:8px 12px 24px;background:#fff}
  .head{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:3px solid #0c1c30;padding-bottom:14px;margin-bottom:10px}
  .brand-name{font-size:26px;font-weight:800;letter-spacing:0.28em;color:#0c1c30}
  .doc-title{text-align:right}
  .doc-title h1{font-size:28px;letter-spacing:0.45em;margin:0 0 4px;font-weight:800}
  .doc-title .no{font-size:12px;color:#667}
  .gold{height:4px;background:linear-gradient(90deg,#c4a35a,#ead9a8,#c4a35a);margin:0 0 20px}
  .meta{display:flex;justify-content:space-between;gap:24px;margin-bottom:18px;font-size:13px}
  .bill-to{font-size:18px;font-weight:800;margin-bottom:6px}
  .muted{color:#667;line-height:1.6}
  table.lines{width:100%;border-collapse:collapse;margin:8px 0 4px}
  table.lines th{background:#0c1c30;color:#f7efd8;padding:9px 10px;text-align:left;font-size:12px;font-weight:600}
  table.lines td{padding:9px 10px;border-bottom:1px solid #e6ebf2;font-size:13px}
  .num{text-align:right;white-space:nowrap}
  .totals{width:280px;margin:12px 0 0 auto}
  .totals td{border:none;padding:5px 8px;font-size:13px}
  .total-row td{border-top:2px solid #152033;font-weight:800;font-size:16px}
  .issuer{margin-top:32px;display:flex;justify-content:flex-end}
  .issuer-card{border:1px solid #e6d7b0;background:#fbf8f1;border-radius:12px;padding:14px 18px;min-width:240px;font-size:12px;line-height:1.7;color:#334}
  .issuer-card strong{display:block;font-size:14px;color:#0c1c30;margin-bottom:4px}
  .stamp{position:absolute;right:28px;top:86px;border:3px solid #0f6e56;color:#0f6e56;padding:6px 14px;font-weight:800;transform:rotate(-12deg);font-size:18px}
  .wrap{position:relative}
</style></head>
<body>
  <div class="wrap">
    ${accepted ? '<div class="stamp">成約</div>' : ''}
    <div class="head">
      <div class="brand">
        <div class="brand-name">${issuerCompany}</div>
      </div>
      <div class="doc-title">
        <h1>見積書</h1>
        <div class="no">${number}</div>
      </div>
    </div>
    <div class="gold"></div>
    <div class="meta">
      <div>
        <div class="bill-to">${company} 御中</div>
        ${contact ? `<div class="muted">ご担当: ${contact}</div>` : ''}
        ${quote.address ? `<div class="muted">${escapeHtml(quote.address)}</div>` : ''}
      </div>
      <div class="muted" style="text-align:right">
        <div>発行日: ${escapeHtml(quote.issue_date || '')}</div>
        <div>有効期限: ${escapeHtml(quote.valid_until || '—')}</div>
      </div>
    </div>
    <table class="lines">
      <thead><tr><th>内容</th><th class="num">数量</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">—</td></tr>'}</tbody>
    </table>
    <table class="totals">
      <tr><td>小計</td><td class="num">${yen(quote.subtotal)}</td></tr>
      <tr><td>消費税 (${escapeHtml(String(quote.tax_rate ?? 10))}%)</td><td class="num">${yen(quote.tax_amount)}</td></tr>
      <tr class="total-row"><td>合計（税込）</td><td class="num">${yen(quote.total)}</td></tr>
    </table>
    ${quote.notes ? `<p class="muted" style="margin-top:18px">備考: ${escapeHtml(quote.notes)}</p>` : ''}
    <div class="issuer">
      <div class="issuer-card">
        <strong>${issuerCompany}</strong>
        <div>${issuerPerson}</div>
        <div>${issuerEmail}</div>
        <div>${issuerPhone}</div>
      </div>
    </div>
  </div>
</body></html>`
}

export { lineTotal, yen }
