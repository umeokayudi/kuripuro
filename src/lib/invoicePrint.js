import { escapeHtml } from './escapeHtml.js'
import { invoicePrintCopy, printPartyHtml, printDatesHtml, printIssuerHtml, wrapPrintHtml } from './printDoc.js'
import { printIssuer, bankTransferFor } from './quoteIssuer.js'

// v1.0.122 · 請求書 printed in the same layout as the 見積書, with the bank account in the issuer card.
// An invoice born from an accepted 見積 shows the quote's lines exactly (description, qty, unit price,
// 小計, 消費税, 合計) — also for invoices saved before this version, which held one tax-included line.

const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString('ja-JP')}`
const sum = lines => lines.reduce((s, it) => s + Number(it.total || 0), 0)
const same = (a, b) => Math.abs(Math.round(Number(a || 0)) - Math.round(Number(b || 0))) <= 1

/**
 * What the invoice shows. `quote` = { items, subtotal, tax_amount, total } of the accepted 見積, or null.
 * Returns { lines, subtotal, tax, total, taxIncluded, fromQuote }.
 *  - quote with the same total → the quote's lines and totals
 *  - one tax-included line (old spot invoices) → that line shown tax-exclusive, so 小計 = line
 *  - several tax-included lines (contracts priced 税込) → lines kept, totals say 税込 / うち消費税
 */
export function invoiceDisplay(f, items = [], quote = null) {
  const subtotal = Math.round(Number(f?.subtotal || 0))
  const tax = Math.round(Number(f?.tax_amount || 0))
  const total = Math.round(Number(f?.total || 0))
  const base = { subtotal, tax, total, taxIncluded: false, fromQuote: false }
  const qItems = (quote?.items || []).filter(it => String(it.description || '').trim())
  if (qItems.length && same(quote.total, total)) {
    return {
      lines: qItems.map(it => ({ description: it.description, quantity: it.quantity ?? 1, unit_price: Number(it.unit_price || 0), total: Number(it.total ?? 0) })),
      subtotal: Math.round(Number(quote.subtotal)), tax: Math.round(Number(quote.tax_amount)), total: Math.round(Number(quote.total)),
      taxIncluded: false, fromQuote: true,
    }
  }
  const lines = (items || []).map(it => ({ ...it }))
  if (!lines.length || same(sum(lines), subtotal) || tax === 0) return { ...base, lines }
  if (lines.length === 1 && Number(lines[0].quantity || 1) === 1 && same(lines[0].total, total)) {
    return { ...base, lines: [{ ...lines[0], unit_price: subtotal, total: subtotal }] }
  }
  if (same(sum(lines), total)) return { ...base, lines, taxIncluded: true }
  return { ...base, lines }
}

const PLACEHOLDER_REG = /^T1234567890123$/

const INCLUDED = {
  ja: { sub: '小計（税込）', tax: 'うち消費税' },
  en: { sub: 'Subtotal (incl. tax)', tax: 'of which consumption tax' },
}

/** Full A4 請求書 HTML. client = { company_name, address } when known. */
export function buildInvoicePrintHtml(f, view, { client = null, lang = 'ja' } = {}) {
  if (lang === 'pt') lang = 'en'
  const L = invoicePrintCopy(lang)
  const issuer = printIssuer({}, lang)
  // The sample registration number must never print on a real 請求書.
  const loc = { ...issuer, regNumber: PLACEHOLDER_REG.test(issuer.regNumber || '') ? '' : issuer.regNumber }
  const name = String(f.client_name || client?.company_name || '').trim()
  const company = String(client?.company_name || '').trim()
  const number = `INV-${String(f.issue_date || '').replace(/-/g, '').slice(0, 8)}-${String(f.id || '').slice(0, 4).toUpperCase()}`
  const rows = view.lines.map(it => `
      <tr>
        <td>${escapeHtml(it.description || '')}</td>
        <td class="num">${escapeHtml(String(it.quantity ?? ''))}</td>
        <td class="num">${yen(it.unit_price)}</td>
        <td class="num">${yen(it.total)}</td>
      </tr>`).join('')
  const inc = INCLUDED[lang === 'en' ? 'en' : 'ja']
  const rate = escapeHtml(String(f.tax_rate ?? 10))
  const totalsHtml = view.taxIncluded
    ? `<table class="totals">
      <tr><td>${inc.sub}</td><td class="num">${yen(view.total)}</td></tr>
      <tr><td>${inc.tax} (${rate}%)</td><td class="num">${yen(view.tax)}</td></tr>
      <tr class="total-row"><td>${L.total}</td><td class="num">${yen(view.total)}</td></tr>
    </table>`
    : `<table class="totals">
      <tr><td>${L.subtotal}</td><td class="num">${yen(view.subtotal)}</td></tr>
      <tr><td>${L.tax} (${rate}%)</td><td class="num">${yen(view.tax)}</td></tr>
      <tr class="total-row"><td>${L.total}</td><td class="num">${yen(view.total)}</td></tr>
    </table>`
  const notes = String(f.notes || '').trim()
  return wrapPrintHtml({
    L,
    number,
    printTitle: escapeHtml(name),
    stamp: f.status === 'paid' ? L.paid : '',
    partyHtml: printPartyHtml(L, { restaurant: name, company: company !== name ? company : '', contact: '', address: client?.address || '' }),
    datesHtml: printDatesHtml([
      [L.issueDate, escapeHtml(f.issue_date || '')],
      [L.period, f.period_start ? `${escapeHtml(f.period_start)}${L.rangeSep}${escapeHtml(f.period_end || f.period_start)}` : ''],
      [L.due, escapeHtml(f.due_date || '—')],
    ]),
    columnHead: `<th>${L.desc}</th><th class="num">${L.qty}</th><th class="num">${L.unit}</th><th class="num">${L.amount}</th>`,
    rows,
    totalsHtml,
    notesHtml: notes ? `<p class="muted" style="margin-top:16px">${escapeHtml(L.notes)}${L.colon}${escapeHtml(notes)}</p>` : '',
    thanks: L.thanks,
    issuerHtml: printIssuerHtml(L, loc, { bank: bankTransferFor(lang) }),
  })
}
