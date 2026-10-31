// v1.0.122: 請求書 repeats the accepted 見積 line by line; tax-exclusive lines; bank account in the footer.
import assert from 'node:assert/strict'
import { spotInvoiceRows, spotLineTitle } from '../src/lib/spotContract.js'
import { invoiceDisplay, buildInvoicePrintHtml } from '../src/lib/invoicePrint.js'

// K.K. Bacana, SPOT-20261101-0001 / KPQ-202610-001
const quote = { subtotal: '140000.00', tax_amount: '14000.00', total: '154000.00', items: [
  { description: 'エアコン分解洗浄', quantity: 7, unit_price: 25000, total: 175000 },
  { description: 'エアコン室外機清掃', quantity: 2, unit_price: 12500, total: 25000 },
  { description: '値引額', quantity: 1, unit_price: -60000, total: -60000 },
] }
const c = { contract_number: 'SPOT-20261101-0001', price: 154000, price_includes_tax: true, tax_rate: 10, service_date: '2026-11-01', location_name: 'K.K. Bacana — エアコン分解洗浄', service_type: 'K.K. Bacana — エアコン分解洗浄', client_name: 'K.K. Bacana', job_id: 'j1', payment_day: 10 }

assert.equal(spotLineTitle(c), 'K.K. Bacana — エアコン分解洗浄')
assert.equal(spotLineTitle({ location_name: 'Atomic', service_type: 'Deep Clean' }), 'Atomic — Deep Clean')

const q = spotInvoiceRows(c, quote)
assert.deepEqual(q.items.map(i => [i.description, i.quantity, i.unit_price, i.total]), [['エアコン分解洗浄', 7, 25000, 175000], ['エアコン室外機清掃', 2, 12500, 25000], ['値引額', 1, -60000, -60000]])
assert.equal(q.fatura.subtotal, 140000); assert.equal(q.fatura.tax_amount, 14000); assert.equal(q.fatura.total, 154000)
assert.equal(q.items.reduce((s, i) => s + i.total, 0), q.fatura.subtotal)
assert.ok(q.items.every(i => i.job_id === 'j1'))

// Session priced differently from the quote → one tax-exclusive line, no doubled name
const one = spotInvoiceRows({ ...c, price: 77000 }, quote)
assert.equal(one.items.length, 1)
assert.equal(one.items[0].unit_price, 70000); assert.equal(one.items[0].total, one.fatura.subtotal)
assert.equal(one.items[0].description, 'K.K. Bacana — エアコン分解洗浄 (2026-11-01)')
assert.equal(spotInvoiceRows(c).items[0].total, 140000)

// Invoice saved before v1.0.122: one ¥154,000 line → shows the quote; without quote → tax-exclusive line
const f = { id: '488bb045-x', client_name: 'K.K. Bacana', issue_date: '2026-11-01', period_start: '2026-11-01', period_end: '2026-11-01', due_date: '2026-12-10', subtotal: 140000, tax_amount: 14000, total: 154000, tax_rate: 10, status: 'draft', notes: 'Spot SPOT-20261101-0001' }
const old = [{ description: 'K.K. Bacana — エアコン分解洗浄 — K.K. Bacana — エアコン分解洗浄 (2026-11-01)', quantity: 1, unit_price: 154000, total: 154000 }]
const v = invoiceDisplay(f, old, quote)
assert.ok(v.fromQuote); assert.equal(v.lines.length, 3); assert.equal(v.subtotal, 140000)
const v2 = invoiceDisplay(f, old, null)
assert.equal(v2.lines[0].unit_price, 140000); assert.equal(v2.lines[0].total, 140000); assert.ok(!v2.taxIncluded)
// Monthly contract priced 税込: several lines that add to the total → 小計（税込）/ うち消費税
const v3 = invoiceDisplay({ ...f, subtotal: 100000, tax_amount: 10000, total: 110000 }, [{ total: 55000, quantity: 1, unit_price: 55000 }, { total: 55000, quantity: 1, unit_price: 55000 }])
assert.ok(v3.taxIncluded)
// Tax-exclusive lines stay as they are
assert.ok(!invoiceDisplay({ ...f, subtotal: 100000, tax_amount: 10000, total: 110000 }, [{ total: 100000 }]).taxIncluded)

const html = buildInvoicePrintHtml(f, v, { client: { company_name: 'K.K. Bacana', address: '東京都' } })
assert.match(html, /請求書/)
assert.match(html, /エアコン室外機清掃/)
assert.match(html, /¥-60,000|-¥60,000|¥−60,000/)
assert.match(html, /三菱UFJ銀行 西尾支店（449） 普通 0181001 ウメオカアレサンドレユウジ/)
assert.match(html, /振込先/)
assert.doesNotMatch(html, /別途ご連絡/)
assert.doesNotMatch(html, /T1234567890123/)
assert.equal(html.split('K.K. Bacana — エアコン分解洗浄 — K.K. Bacana').length, 1)
console.log('invoice = quote OK')
