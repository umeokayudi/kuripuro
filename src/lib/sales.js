import { escapeHtml } from './escapeHtml'
import { addDays, invoiceTotals, lineTotal, yen } from './invoice'

export const LEAD_SOURCES = ['visit', 'phone', 'referral', 'web', 'walkin', 'other']
export const LEAD_STAGES = ['approach', 'followup', 'won', 'lost']
export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired']

export function isSalesSchemaMissing(error) {
  const msg = String(error?.message || '')
  return error?.code === 'PGRST205' || msg.includes('sales_leads') || msg.includes('mitsumori')
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

export function buildMitsumoriPrintHtml(quote, items, issuer = {}) {
  const company = escapeHtml(quote.company_name)
  const contact = escapeHtml([quote.contact_title, quote.contact_name].filter(Boolean).join(' '))
  const number = escapeHtml(quote.quote_number || quote.id?.slice?.(0, 8) || '')
  const issuerName = escapeHtml(issuer.company || 'KuriPuro by JBM')
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
  @page { size: A4; margin: 16mm; }
  body{font-family:'Hiragino Sans','Noto Sans JP',sans-serif;color:#152033;max-width:720px;margin:0 auto;padding:12px}
  h1{text-align:center;font-size:26px;letter-spacing:0.4em;margin:0 0 4px}
  .sub{text-align:center;color:#667;font-size:12px;margin-bottom:22px}
  .meta{display:flex;justify-content:space-between;gap:24px;margin-bottom:18px;font-size:13px}
  .bill-to{font-size:16px;font-weight:700}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  th{background:#0c1c30;color:#fff;padding:8px 10px;text-align:left;font-size:12px;font-weight:600}
  td{padding:8px 10px;border-bottom:1px solid #e6ebf2;font-size:13px}
  .num{text-align:right;white-space:nowrap}
  .totals{width:280px;margin-left:auto}
  .totals td{border:none;padding:5px 8px}
  .total-row td{border-top:2px solid #152033;font-weight:700;font-size:15px}
  .footer{margin-top:28px;font-size:12px;color:#556;line-height:1.6}
  .stamp{position:absolute;right:40px;top:48px;border:3px solid #0f6e56;color:#0f6e56;padding:6px 14px;font-weight:800;transform:rotate(-12deg);font-size:18px}
  .wrap{position:relative}
</style></head>
<body>
  <div class="wrap">
    ${accepted ? '<div class="stamp">成約</div>' : ''}
    <h1>見積書</h1>
    <div class="sub">${issuerName}</div>
    <div class="meta">
      <div>
        <div class="bill-to">${company} 御中</div>
        ${contact ? `<div>ご担当: ${contact}</div>` : ''}
        ${quote.address ? `<div>${escapeHtml(quote.address)}</div>` : ''}
        ${quote.needs ? `<div>ご要望: ${escapeHtml(quote.needs)}</div>` : ''}
      </div>
      <div style="text-align:right">
        <div>見積番号: ${number}</div>
        <div>発行日: ${escapeHtml(quote.issue_date || '')}</div>
        <div>有効期限: ${escapeHtml(quote.valid_until || '—')}</div>
        ${quote.first_contact_date ? `<div>初回接触: ${escapeHtml(quote.first_contact_date)}</div>` : ''}
      </div>
    </div>
    <table>
      <thead><tr><th>内容</th><th class="num">数量</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">—</td></tr>'}</tbody>
    </table>
    <table class="totals">
      <tr><td>小計</td><td class="num">${yen(quote.subtotal)}</td></tr>
      <tr><td>消費税 (${escapeHtml(String(quote.tax_rate ?? 10))}%)</td><td class="num">${yen(quote.tax_amount)}</td></tr>
      <tr class="total-row"><td>合計金額（税込）</td><td class="num">${yen(quote.total)}</td></tr>
    </table>
    ${quote.notes ? `<p style="margin-top:18px;font-size:13px;color:#556">備考: ${escapeHtml(quote.notes)}</p>` : ''}
    <div class="footer">
      ${issuer.address ? `<div>${escapeHtml(issuer.address)}</div>` : ''}
      ${issuer.regNumber ? `<div>${escapeHtml(issuer.regNumber)}</div>` : ''}
      <div style="margin-top:8px">本見積書は電子発行です。KuriPuro ${escapeHtml(issuer.version || '')}</div>
    </div>
  </div>
</body></html>`
}

export { lineTotal, yen }
