import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { lineTotal, invoiceTotals } from '../src/lib/quoteMath.js'
import { defaultValidUntil, emptyQuoteItem, nextQuoteNumber, quoteWritePayload, quoteTotals, buildMitsumoriPrintHtml } from '../src/lib/sales.js'

const item = { ...emptyQuoteItem(), description: 'Daily cleaning', quantity: 3, unit_price: 1200 }
item.total = lineTotal(item.quantity, item.unit_price)
assert.equal(item.total, 3600)
assert.deepEqual(invoiceTotals([item], 10), { subtotal: 3600, taxAmount: 360, total: 3960, taxRate: 10 })
assert.equal(quoteTotals([{ quantity: 1, unit_price: 100, total: 100 }], 8).total, 108)
assert.equal(nextQuoteNumber([{ quote_number: 'KPQ-202610-004' }], '2026-10-08'), 'KPQ-202610-005')
assert.equal(nextQuoteNumber([], '2026-10-08'), 'KPQ-202610-001')
assert.equal(defaultValidUntil('2026-10-08'), '2026-11-07')
const payload = quoteWritePayload({ company_name:'Cafe', site_name:'Kiyose', valid_until:'2026-11-07', tax_rate:10 }, 'lead-id', quoteTotals([item], 10), { quote_number:'KPQ-202610-001', status:'draft' })
assert.equal(payload.lead_id, 'lead-id')
assert.equal(payload.total, 3960)
assert.equal(payload.valid_until, '2026-11-07')
assert.equal(payload.status, 'draft')
const translations = await readFile(new URL('../src/i18n/mitsumori.js', import.meta.url), 'utf8')
assert.match(translations, /quoteTitle:'New quote'/)
assert.match(translations, /quoteTitle:'新しい見積書'/)
const quote = { ...payload, contact_name:'Alex', issue_date:'2026-10-08', quote_number:'KPQ-202610-001' }
const jaHtml = buildMitsumoriPrintHtml(quote, [item], {}, 'ja')
const enHtml = buildMitsumoriPrintHtml(quote, [item], {}, 'en')
assert.match(jaHtml, /見積書/)
assert.match(enHtml, /quotation/i)
assert.match(jaHtml, /KPQ-202610-001/)
assert.match(enHtml, /3,600/)
console.log('Mitsumori checks passed: totals, tax, numbering, validity, payload, EN/JA print.')
