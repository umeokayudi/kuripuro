import { escapeHtml } from './escapeHtml'
import { invoicePrintCopy, localizePrintText, formatAddressForLang, printPartyHtml, printDatesHtml, printIssuerHtml, wrapPrintHtml } from './printDoc'
import { printIssuer } from './quoteIssuer'

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
        location_name: place || null,
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

export function placesFromInvoiceItems(items) {
  const seen = new Set()
  const out = []
  const add = (raw) => {
    const t = String(raw || '').replace(/\u3000/g, ' ').trim()
    if (!t) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(t)
  }
  for (const it of items || []) {
    if (it.kind === 'discount') continue
    const desc = String(it.description || '')
    if (/^(discount|値引|値引き)/i.test(desc)) continue
    add(it.location_name)
    const m = desc.match(/^(.+?)\s+[—–−-]\s+/)
    if (m && m[1].length < 80) add(m[1])
  }
  return out
}

export function invoiceRestaurantName(invoice, items = [], extras = {}) {
  const first = (...vals) => {
    for (const v of vals) {
      const s = String(v || '').replace(/\u3000/g, ' ').trim()
      if (s) return s
    }
    return ''
  }
  const fromItems = placesFromInvoiceItems(items)
  const fromContracts = [...new Set((extras.locations || []).map(s => String(s || '').trim()).filter(Boolean))]
  return first(
    invoice?.site_name,
    invoice?.location_name,
    invoice?.store_name,
    invoice?.restaurant,
    fromItems.length ? fromItems.join(' / ') : '',
    fromContracts.length === 1 ? fromContracts[0] : '',
  )
}

export function buildInvoicePrintHtml(invoice, items, issuer = {}, lang = 'ja', extras = {}) {
  const L = invoicePrintCopy(lang)
  const loc = printIssuer(issuer, lang)
  const company = localizePrintText(invoice.client_name, lang)
  const restaurant = localizePrintText(invoiceRestaurantName(invoice, items, extras), lang)
  const printTitle = escapeHtml(restaurant || company)
  const number = invoice.invoice_number || invoice.id?.slice?.(0, 8) || ''
  const notes = localizePrintText(invoice.notes || '', lang)
  const address = formatAddressForLang(extras.address || invoice.address || '', lang)
  const contact = localizePrintText(extras.contact || invoice.contact_name || '', lang)
  const bank = localizePrintText(loc.bank || '', lang)
  const rows = (items || []).map(it => `
      <tr>
        <td>${escapeHtml(localizePrintText(it.description || '', lang))}</td>
        <td class="num">${escapeHtml(String(it.quantity ?? ''))}</td>
        <td class="num">${yen(it.unit_price)}</td>
        <td class="num">${yen(it.total)}</td>
      </tr>`).join('')
  const totalsHtml = `<table class="totals">
      <tr><td>${L.subtotal}</td><td class="num">${yen(invoice.subtotal)}</td></tr>
      <tr><td>${L.tax} (${escapeHtml(String(invoice.tax_rate ?? 10))}%)</td><td class="num">${yen(invoice.tax_amount)}</td></tr>
      <tr class="total-row"><td>${L.total}</td><td class="num">${yen(invoice.total)}</td></tr>
    </table>`
  const notesHtml = notes
    ? `<p class="muted" style="margin-top:16px">${escapeHtml(L.notes)}${L.colon}${escapeHtml(notes)}</p>`
    : ''
  return wrapPrintHtml({
    L,
    number,
    printTitle,
    stamp: invoice.status === 'paid' ? L.paid : '',
    partyHtml: printPartyHtml(L, { restaurant, company, contact, address }),
    datesHtml: printDatesHtml([
      [L.issueDate, escapeHtml(invoice.issue_date || '')],
      [L.period, `${escapeHtml(invoice.period_start || '—')}${L.rangeSep}${escapeHtml(invoice.period_end || '—')}`],
      [L.due, escapeHtml(invoice.due_date || '—')],
    ]),
    columnHead: `<th>${L.desc}</th><th class="num">${L.qty}</th><th class="num">${L.unit}</th><th class="num">${L.amount}</th>`,
    rows,
    totalsHtml,
    notesHtml,
    thanks: L.thanks,
    issuerHtml: printIssuerHtml(L, loc, { bank }),
  })
}
