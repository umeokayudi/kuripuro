import { escapeHtml } from './escapeHtml'

export function roundYen(n) {
  return Math.round(Number(n) || 0)
}

export function yen(n) {
  return `¥${roundYen(n).toLocaleString('ja-JP')}`
}

export function lineTotal(quantity, unitPrice) {
  return roundYen((Number(quantity) || 0) * (Number(unitPrice) || 0))
}

export function invoiceTotals(items, taxRate = 10) {
  const subtotal = roundYen(
    (items || []).reduce((sum, it) => {
      const line = it.total != null && it.total !== ''
        ? Number(it.total)
        : lineTotal(it.quantity, it.unit_price)
      return sum + (Number.isFinite(line) ? line : 0)
    }, 0)
  )
  const rate = Number(taxRate) || 0
  const taxAmount = subtotal <= 0 ? 0 : roundYen(subtotal * rate / 100)
  return { subtotal, taxAmount, total: subtotal + taxAmount, taxRate: rate }
}

/** KP-YYYYMM-001 from Tokyo issue date and existing rows. */
export function nextInvoiceNumber(existing, issueDate) {
  const yyyymm = String(issueDate || '').slice(0, 7).replace('-', '')
  const prefix = `KP-${yyyymm}-`
  let max = 0
  for (const row of existing || []) {
    const n = String(row?.invoice_number || '')
    if (!n.startsWith(prefix)) continue
    const seq = parseInt(n.slice(prefix.length), 10)
    if (Number.isFinite(seq) && seq > max) max = seq
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

export function lastDayOfMonth(iso) {
  const [y, m] = String(iso).split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

export function daysInIsoMonth(iso) {
  const [y, m] = String(iso).split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function calendarMonthPeriod(iso) {
  const start = `${String(iso).slice(0, 7)}-01`
  return { start, end: lastDayOfMonth(iso) }
}

export function previousCalendarMonth(today) {
  const [y, m] = String(today).split('-').map(Number)
  const startDate = new Date(Date.UTC(y, m - 2, 1))
  const endDate = new Date(Date.UTC(y, m - 1, 0))
  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
  }
}

/** Day 31, or the last calendar day when the month has no 31st. */
export function isMonthEndBillingDay(today) {
  const day = Number(String(today).slice(8, 10))
  return day === 31 || String(today) === lastDayOfMonth(today)
}

export function billingPeriodForDate(today) {
  if (isMonthEndBillingDay(today)) return calendarMonthPeriod(today)
  return previousCalendarMonth(today)
}

function fillTpl(tpl, vars) {
  if (!tpl) return ''
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''))
}

export function dailyRateFromMonthly(monthlyAmount, periodIso) {
  const days = daysInIsoMonth(periodIso || '2026-01-31')
  if (!days) return 0
  return roundYen((Number(monthlyAmount) || 0) / days)
}

export function contractMonthlyAmount(contract) {
  if (!contract) return 0
  if (contract.billing_type === 'fixed_monthly') {
    return roundYen(contract.fixed_monthly || contract.monthly_revenue || 0)
  }
  const fromVisits = (Number(contract.visits_per_month) || 0) * (Number(contract.price_per_visit) || 0)
  return roundYen(contract.monthly_revenue || fromVisits || 0)
}

export function buildMonthlyChargeItems(contracts, client, labels = {}) {
  const list = (contracts || []).filter(c => c && c.is_active !== false && contractMonthlyAmount(c) > 0)
  if (list.length) {
    return list.map(c => {
      const amount = contractMonthlyAmount(c)
      const place = c.location_name || ''
      const service = c.service_type || ''
      const description = labels.monthlyLine
        ? fillTpl(labels.monthlyLine, { place, service })
        : [place, service, 'monthly'].filter(Boolean).join(' — ')
      return {
        job_id: null,
        kind: 'monthly',
        description,
        quantity: 1,
        unit_price: amount,
        total: amount,
      }
    })
  }
  const fallback = roundYen(client?.monthly_revenue || 0)
  if (fallback <= 0) return []
  return [{
    job_id: null,
    kind: 'monthly',
    description: labels.monthlyFallback || 'Monthly contract',
    quantity: 1,
    unit_price: fallback,
    total: fallback,
  }]
}

export function makeDiscountLine({ reason = '', days = 0, dailyRate = 0, amount, labels = {} } = {}) {
  const daysN = Number(days) || 0
  const rate = roundYen(dailyRate)
  let total = amount != null && amount !== '' ? -Math.abs(roundYen(amount)) : 0
  if (!total && daysN && rate) total = -roundYen(daysN * rate)
  const qty = daysN || 1
  const unit = daysN && rate ? -rate : total
  const description = daysN
    ? (labels.discountDaysLine
      ? fillTpl(labels.discountDaysLine, { days: String(daysN), rate: yen(rate), reason })
      : `Discount — ${daysN} day(s) × ${yen(rate)}/day (${reason})`)
    : (labels.discountLine
      ? fillTpl(labels.discountLine, { reason })
      : `Discount — ${reason}`)
  return {
    job_id: null,
    kind: 'discount',
    description,
    quantity: qty,
    unit_price: unit,
    total,
  }
}

export function invoiceAlreadyExists(existing, clientId, period) {
  return (existing || []).some(f =>
    f.client_id === clientId
    && f.period_start === period.start
    && f.period_end === period.end
    && f.status !== 'cancelled'
  )
}

export function complaintInPeriod(row, period) {
  const d = String(row?.created_at || row?.complaint_date || '').slice(0, 10)
  if (!d || !period?.start || !period?.end) return false
  return d >= period.start && d <= period.end
}

export function planMonthlyInvoices({ clients, contracts, existing, period, labels = {} }) {
  const byClient = {}
  for (const c of contracts || []) {
    if (!c?.client_id || c.is_active === false) continue
    if (!byClient[c.client_id]) byClient[c.client_id] = []
    byClient[c.client_id].push(c)
  }
  const planned = []
  const skipped = []
  for (const client of clients || []) {
    if (!client?.id || client.is_active === false) continue
    const items = buildMonthlyChargeItems(byClient[client.id] || [], client, labels)
    if (!items.length) {
      skipped.push({ client, reason: 'noContract' })
      continue
    }
    if (invoiceAlreadyExists(existing, client.id, period)) {
      skipped.push({ client, reason: 'alreadyBilled' })
      continue
    }
    const monthlyAmount = items.reduce((s, it) => s + Number(it.total || 0), 0)
    planned.push({
      client_id: client.id,
      client_name: client.company_name,
      items,
      monthlyAmount,
      dailyRate: dailyRateFromMonthly(monthlyAmount, period.end || period.start),
    })
  }
  return { planned, skipped }
}

export function addDays(isoDate, days) {
  const [y, m, d] = String(isoDate).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + Number(days || 0))).toISOString().slice(0, 10)
}

export function jobsToInvoiceItems(jobs) {
  return (jobs || []).map(job => {
    const unit = roundYen(job.value ?? job.spot_value ?? 0)
    const place = job.location_name || job.address || ''
    const description = [job.title, place].filter(Boolean).join(' — ')
    return {
      job_id: job.id || null,
      description,
      quantity: 1,
      unit_price: unit,
      total: unit,
    }
  })
}

export function cashflowDescription(invoiceNumber, clientName) {
  const no = invoiceNumber || 'invoice'
  return `請求書 ${no} · ${clientName || ''}`.trim()
}

export function buildInvoicePrintHtml(invoice, items, issuer = {}) {
  const clientName = escapeHtml(invoice.client_name)
  const issueDate = escapeHtml(invoice.issue_date)
  const periodStart = escapeHtml(invoice.period_start || '—')
  const periodEnd = escapeHtml(invoice.period_end || '—')
  const dueDate = escapeHtml(invoice.due_date || '—')
  const notes = escapeHtml(invoice.notes || '')
  const number = escapeHtml(invoice.invoice_number || invoice.id?.slice?.(0, 8) || '')
  const company = escapeHtml(issuer.company || 'KuriPuro by JBM')
  const address = escapeHtml(issuer.address || '')
  const regNumber = escapeHtml(issuer.regNumber || '')
  const bank = escapeHtml(issuer.bank || '')
  const paid = invoice.status === 'paid'
  const rows = (items || []).map(it => `
      <tr>
        <td>${escapeHtml(it.description || '')}</td>
        <td class="num">${escapeHtml(String(it.quantity ?? ''))}</td>
        <td class="num">${yen(it.unit_price)}</td>
        <td class="num">${yen(it.total)}</td>
      </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>請求書 ${number} - ${clientName}</title>
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
    ${paid ? '<div class="stamp">入金済</div>' : ''}
    <h1>請求書</h1>
    <div class="sub">${company}</div>
    <div class="meta">
      <div>
        <div class="bill-to">${clientName} 御中</div>
        <div>対象期間: ${periodStart} 〜 ${periodEnd}</div>
      </div>
      <div style="text-align:right">
        <div>請求書番号: ${number}</div>
        <div>発行日: ${issueDate}</div>
        <div>支払期限: ${dueDate}</div>
      </div>
    </div>
    <table>
      <thead><tr><th>内容</th><th class="num">数量</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">—</td></tr>'}</tbody>
    </table>
    <table class="totals">
      <tr><td>小計</td><td class="num">${yen(invoice.subtotal)}</td></tr>
      <tr><td>消費税 (${escapeHtml(String(invoice.tax_rate ?? 10))}%)</td><td class="num">${yen(invoice.tax_amount)}</td></tr>
      <tr class="total-row"><td>合計金額（税込）</td><td class="num">${yen(invoice.total)}</td></tr>
    </table>
    ${notes ? `<p style="margin-top:18px;font-size:13px;color:#556">備考: ${notes}</p>` : ''}
    <div class="footer">
      ${address ? `<div>${address}</div>` : ''}
      ${regNumber ? `<div>${regNumber}</div>` : ''}
      ${bank ? `<div>${bank}</div>` : '<div>振込先等については別途ご連絡いたします</div>'}
      <div style="margin-top:8px">本請求書は電子発行です。KuriPuro ${escapeHtml(issuer.version || '')}</div>
    </div>
  </div>
</body></html>`
}
