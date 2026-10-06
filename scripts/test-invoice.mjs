#!/usr/bin/env node
import { readFileSync } from 'fs'
import {
  addDays,
  billingPeriodForDate,
  buildInvoicePrintHtml,
  buildMonthlyChargeItems,
  cashflowDescription,
  complaintInPeriod,
  contractMonthlyAmount,
  dailyRateFromMonthly,
  invoiceAlreadyExists,
  invoiceTotals,
  isMonthEndBillingDay,
  jobsToInvoiceItems,
  lastDayOfMonth,
  lineTotal,
  makeDiscountLine,
  nextInvoiceNumber,
  planMonthlyInvoices,
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
  const discounted = invoiceTotals([
    { total: 310000 },
    { total: -20000 },
  ], 10)
  assert(discounted.subtotal === 290000, `disc sub ${discounted.subtotal}`)
  assert(discounted.taxAmount === 29000, `disc tax ${discounted.taxAmount}`)
  const zeroed = invoiceTotals([{ total: -100 }], 10)
  assert(zeroed.taxAmount === 0, 'no tax on negative')
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
  assert(lastDayOfMonth('2026-10-06') === '2026-10-31', 'oct last')
  assert(isMonthEndBillingDay('2026-10-31'), 'oct 31')
  assert(isMonthEndBillingDay('2026-02-28'), 'feb last')
  assert(!isMonthEndBillingDay('2026-10-06'), 'mid month')
  const on31 = billingPeriodForDate('2026-10-31')
  assert(on31.start === '2026-10-01' && on31.end === '2026-10-31', JSON.stringify(on31))
  const mid = billingPeriodForDate('2026-10-06')
  assert(mid.start === '2026-09-01' && mid.end === '2026-09-30', JSON.stringify(mid))
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
  assert(APP_VERSION === 'v46', APP_VERSION)
  assert(APP_BUILD.endsWith('-v46'), APP_BUILD)
}

function testMonthlyAndDiscounts() {
  assert(contractMonthlyAmount({ billing_type: 'fixed_monthly', fixed_monthly: 120000 }) === 120000, 'fixed')
  assert(contractMonthlyAmount({ billing_type: 'per_visit', visits_per_month: 10, price_per_visit: 4000 }) === 40000, 'visits')
  assert(dailyRateFromMonthly(310000, '2026-10-31') === 10000, 'daily oct')
  const items = buildMonthlyChargeItems([
    { client_id: 'c1', location_name: 'Kodama', service_type: 'Daily', billing_type: 'fixed_monthly', fixed_monthly: 200000, is_active: true },
  ], { monthly_revenue: 1 }, { monthlyLine: '{place} — {service} (monthly)' })
  assert(items.length === 1 && items[0].total === 200000, 'one monthly line')
  assert(items[0].description.includes('Kodama'), items[0].description)
  const fallback = buildMonthlyChargeItems([], { monthly_revenue: 88000 }, { monthlyFallback: 'Monthly contract' })
  assert(fallback[0].total === 88000, 'client fallback')
  const disc = makeDiscountLine({ reason: 'complaint', days: 2, dailyRate: 10000 })
  assert(disc.total === -20000, `disc ${disc.total}`)
  assert(disc.kind === 'discount', 'kind')
  assert(complaintInPeriod({ created_at: '2026-10-12T10:00:00Z' }, { start: '2026-10-01', end: '2026-10-31' }), 'in period')
  assert(!complaintInPeriod({ created_at: '2026-09-30' }, { start: '2026-10-01', end: '2026-10-31' }), 'out')
  const plan = planMonthlyInvoices({
    clients: [
      { id: 'a', company_name: 'A Co', monthly_revenue: 100000, is_active: true },
      { id: 'b', company_name: 'B Co', monthly_revenue: 50000, is_active: true },
      { id: 'c', company_name: 'C Co', monthly_revenue: 0, is_active: true },
    ],
    contracts: [
      { client_id: 'a', billing_type: 'fixed_monthly', fixed_monthly: 100000, location_name: 'Shop', service_type: 'Clean', is_active: true },
    ],
    existing: [{ client_id: 'b', period_start: '2026-10-01', period_end: '2026-10-31', status: 'draft' }],
    period: { start: '2026-10-01', end: '2026-10-31' },
  })
  assert(plan.planned.length === 1 && plan.planned[0].client_id === 'a', 'plan a')
  assert(plan.skipped.some(s => s.reason === 'alreadyBilled'), 'skip billed')
  assert(plan.skipped.some(s => s.reason === 'noContract'), 'skip empty')
  assert(invoiceAlreadyExists(plan.skipped.length ? [{ client_id: 'b', period_start: '2026-10-01', period_end: '2026-10-31', status: 'sent' }] : [], 'b', { start: '2026-10-01', end: '2026-10-31' }))
}

function testI18n() {
  const en = Object.keys(kuripuroEn.invoices).sort()
  const ja = Object.keys(kuripuroJa.invoices).sort()
  assert(en.join() === ja.join(), `invoice keys ${en.filter(k => !ja.includes(k))} / ${ja.filter(k => !en.includes(k))}`)
  const enSt = Object.keys(kuripuroEn.invoices.statuses).sort()
  const jaSt = Object.keys(kuripuroJa.invoices.statuses).sort()
  assert(enSt.join() === jaSt.join(), 'status keys')
  const enD = Object.keys(kuripuroEn.dashboard).sort()
  const jaD = Object.keys(kuripuroJa.dashboard).sort()
  assert(enD.join() === jaD.join(), `dashboard keys ${enD.filter(k => !jaD.includes(k))} / ${jaD.filter(k => !enD.includes(k))}`)
}

function main() {
  testTotals()
  testNumbers()
  testPeriod()
  testJobs()
  testMonthlyAndDiscounts()
  testPrint()
  testVersionLock()
  testI18n()
  console.log('✅ invoice + version tests passed')
}

main()
