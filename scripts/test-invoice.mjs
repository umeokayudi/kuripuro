#!/usr/bin/env node
import { readFileSync } from 'fs'
import {
  addDays,
  buildInvoicePrintHtml,
  cashflowDescription,
  invoiceTotals,
  jobsToInvoiceItems,
  lineTotal,
  nextInvoiceNumber,
  previousCalendarMonth,
  roundYen,
  yen,
} from '../src/lib/invoice.js'
import { APP_BUILD, APP_VERSION } from '../src/lib/appVersion.js'
import { kuripuroEn, kuripuroJa } from '../src/i18n/kuripuro.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function testTotals() {
  const { subtotal, taxAmount, total } = invoiceTotals([
    { quantity: 2, unit_price: 4000, total: 8000 },
    { quantity: 1, unit_price: 12000, total: 12000 },
  ], 10)
  assert(subtotal === 20000, `subtotal ${subtotal}`)
  assert(taxAmount === 2000, `tax ${taxAmount}`)
  assert(total === 22000, `total ${total}`)
  assert(lineTotal(3, 1100) === 3300, 'line total')
  assert(roundYen(10.4) === 10, 'round down')
  assert(roundYen(10.5) === 11, 'round up')
  assert(yen(22000) === '¥22,000', `yen format ${yen(22000)}`)
}

function testNumbers() {
  const existing = [
    { invoice_number: 'KP-202610-001' },
    { invoice_number: 'KP-202610-003' },
    { invoice_number: 'KP-202609-009' },
  ]
  assert(nextInvoiceNumber(existing, '2026-10-06') === 'KP-202610-004', 'next seq')
  assert(nextInvoiceNumber([], '2026-10-06') === 'KP-202610-001', 'first of month')
}

function testPeriod() {
  const oct = previousCalendarMonth('2026-10-06')
  assert(oct.start === '2026-09-01' && oct.end === '2026-09-30', JSON.stringify(oct))
  const jan = previousCalendarMonth('2026-01-15')
  assert(jan.start === '2025-12-01' && jan.end === '2025-12-31', JSON.stringify(jan))
  assert(addDays('2026-10-06', 30) === '2026-11-05', addDays('2026-10-06', 30))
}

function testJobs() {
  const items = jobsToInvoiceItems([
    { id: 'a', title: 'Daily', location_name: 'Kodama', value: 4000 },
    { id: 'b', title: 'Deep', spot_value: 15000 },
  ])
  assert(items.length === 2, 'two lines')
  assert(items[0].description.includes('Kodama'), items[0].description)
  assert(items[1].total === 15000, 'spot value')
}

function testPrint() {
  const html = buildInvoicePrintHtml(
    {
      client_name: '<script>x</script>',
      invoice_number: 'KP-202610-001',
      issue_date: '2026-10-06',
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      due_date: '2026-11-05',
      notes: 'a & b',
      tax_rate: 10,
      subtotal: 10000,
      tax_amount: 1000,
      total: 11000,
      status: 'paid',
    },
    [{ description: 'Daily <b>', quantity: 1, unit_price: 10000, total: 10000 }],
    { company: 'KuriPuro by JBM', version: APP_VERSION }
  )
  assert(html.includes('請求書'), 'title')
  assert(html.includes('KP-202610-001'), 'number')
  assert(html.includes('入金済'), 'paid stamp')
  assert(!html.includes('<script>x</script>'), 'escaped name')
  assert(html.includes('&lt;script&gt;'), 'escaped')
  assert(html.includes(APP_VERSION), 'version in print')
  assert(cashflowDescription('KP-202610-001', 'Kodama').includes('請求書 KP-202610-001'), 'cashflow desc')
}

function testVersionLock() {
  const api = readFileSync(new URL('../api/_gemini.js', import.meta.url), 'utf8')
  const match = api.match(/export const API_BUILD = '([^']+)'/)
  assert(match?.[1] === APP_BUILD, `API_BUILD ${match?.[1]} vs ${APP_BUILD}`)
  assert(APP_VERSION === 'v35', APP_VERSION)
  assert(APP_BUILD.endsWith('-v35'), APP_BUILD)
}

function testI18n() {
  const en = Object.keys(kuripuroEn.invoices).sort()
  const ja = Object.keys(kuripuroJa.invoices).sort()
  assert(en.join() === ja.join(), `invoice keys ${en.filter(k => !ja.includes(k))} / ${ja.filter(k => !en.includes(k))}`)
  const enSt = Object.keys(kuripuroEn.invoices.statuses).sort()
  const jaSt = Object.keys(kuripuroJa.invoices.statuses).sort()
  assert(enSt.join() === jaSt.join(), 'status keys')
}

function main() {
  testTotals()
  testNumbers()
  testPeriod()
  testJobs()
  testPrint()
  testVersionLock()
  testI18n()
  console.log('✅ invoice + version tests passed')
}

main()
