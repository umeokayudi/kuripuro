#!/usr/bin/env node
import { kuripuroEn, kuripuroJa } from '../src/i18n/kuripuro.js'
import { APP_VERSION } from '../src/lib/appVersion.js'
import {
  buildMitsumoriPrintHtml,
  findLeadByCompany,
  isSalesSchemaMissing,
  leadIsOverdue,
  leadsForStage,
  mergeLeadFromQuote,
  nextQuoteNumber,
  quoteTotals,
} from '../src/lib/sales.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function testFindAndMerge() {
  const existing = [{ id: '1', company_name: 'Kodama  Kinshicho', stage: 'approach', first_contact_date: '2026-09-01', notes: 'old' }]
  const found = findLeadByCompany(existing, 'kodama kinshicho')
  assert(found?.id === '1', 'fuzzy company match')
  const merged = mergeLeadFromQuote(found, {
    company_name: 'Kodama Kinshicho',
    contact_name: 'Sato',
    first_contact_date: '2026-10-06',
    needs: 'Daily cleaning',
    still_needed: 'HQ approval',
  }, '2026-10-06')
  assert(merged.stage === 'followup', merged.stage)
  assert(merged.first_contact_date === '2026-09-01', 'keep first contact')
  assert(merged.contact_name === 'Sato', 'contact saved')
  assert(merged.still_needed === 'HQ approval', 'still needed')
  const fresh = mergeLeadFromQuote(null, { company_name: 'New Co', contact_name: 'A', first_contact_date: '2026-10-01' }, '2026-10-06')
  assert(fresh.stage === 'followup', 'quote creates follow-up')
  assert(fresh.first_contact_date === '2026-10-01', 'new first contact')
}

function testStageFilter() {
  const rows = [
    { stage: 'approach', company_name: 'A' },
    { stage: 'followup', company_name: 'B' },
    { stage: 'followup', company_name: 'C' },
  ]
  assert(leadsForStage(rows, 'approach').length === 1, 'approach')
  assert(leadsForStage(rows, 'followup').length === 2, 'followup')
  assert(leadIsOverdue({ stage: 'followup', next_followup_date: '2026-10-01' }, '2026-10-06') === true, 'overdue')
  assert(leadIsOverdue({ stage: 'won', next_followup_date: '2026-10-01' }, '2026-10-06') === false, 'won not overdue')
}

function testQuoteNumberAndPrint() {
  assert(nextQuoteNumber([], '2026-10-06') === 'KPQ-202610-001', 'first quote')
  assert(nextQuoteNumber([{ quote_number: 'KPQ-202610-002' }], '2026-10-06') === 'KPQ-202610-003', 'seq')
  const totals = quoteTotals([{ quantity: 2, unit_price: 5000, total: 10000 }], 10)
  assert(totals.total === 11000, totals.total)
  const html = buildMitsumoriPrintHtml({
    company_name: '<x>',
    contact_name: 'Tanaka',
    quote_number: 'KPQ-202610-001',
    issue_date: '2026-10-06',
    valid_until: '2026-11-05',
    first_contact_date: '2026-09-01',
    needs: 'Daily & deep',
    tax_rate: 10,
    subtotal: 10000,
    tax_amount: 1000,
    total: 11000,
    status: 'accepted',
  }, [{ description: 'Daily', quantity: 1, unit_price: 10000, total: 10000 }], { version: APP_VERSION })
  assert(html.includes('見積書'), 'title')
  assert(html.includes('成約'), 'accepted stamp')
  assert(html.includes('KPQ-202610-001'), 'number')
  assert(!html.includes('<x>'), 'escaped')
  assert(html.includes(APP_VERSION), 'version')
}

function testSchemaDetect() {
  assert(isSalesSchemaMissing({ code: 'PGRST205' }), 'pgrst')
  assert(isSalesSchemaMissing({ message: "Could not find the table 'public.sales_leads'" }), 'name')
  assert(!isSalesSchemaMissing({ message: 'JWT' }), 'other')
}

function testI18n() {
  const en = Object.keys(kuripuroEn.sales).sort()
  const ja = Object.keys(kuripuroJa.sales).sort()
  assert(en.join() === ja.join(), `sales keys ${en.filter(k => !ja.includes(k))} ${ja.filter(k => !en.includes(k))}`)
}

function main() {
  testFindAndMerge()
  testStageFilter()
  testQuoteNumberAndPrint()
  testSchemaDetect()
  testI18n()
  console.log('✅ sales / 見積書 tests passed')
}

main()
