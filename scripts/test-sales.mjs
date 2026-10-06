#!/usr/bin/env node
import { kuripuroEn, kuripuroJa } from '../src/i18n/kuripuro.js'
import { SALES_CRM_SQL, SALES_SETUP_SQL, SALES_SETUP_STEPS } from '../src/lib/salesSetupSql.js'
import {
  buildMitsumoriPrintHtml,
  findLeadByCompany,
  isQuoteEditable,
  isSalesSchemaMissing,
  leadIsOverdue,
  leadsForStage,
  mergeLeadFromQuote,
  nextQuoteNumber,
  quoteTotals,
  quoteWritePayload,
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
    interest: 'Hot — wants April start',
  }, '2026-10-06')
  assert(merged.stage === 'followup', merged.stage)
  assert(merged.first_contact_date === '2026-09-01', 'keep first contact')
  assert(merged.contact_name === 'Sato', 'contact saved')
  assert(merged.still_needed === 'HQ approval', 'still needed')
  assert(merged.interest === 'Hot — wants April start', 'interest kept internal')
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
    needs: 'Daily & deep SECRET_INTEREST_SHOULD_NOT_PRINT',
    interest: 'INTERNAL_INTEREST_SECRET',
    tax_rate: 10,
    subtotal: 10000,
    tax_amount: 1000,
    total: 11000,
    status: 'accepted',
  }, [{ description: 'Daily', quantity: 1, unit_price: 10000, total: 10000 }])
  assert(html.includes('見積書'), 'title')
  assert(html.includes('成約'), 'accepted stamp')
  assert(html.includes('KPQ-202610-001'), 'number')
  assert(!html.includes('<x>'), 'escaped')
  assert(html.includes('クリプロ'), 'issuer company')
  assert(html.includes('梅岡アレサンドレユウジ'), 'issuer name')
  assert(html.includes('umeokagroup@gmail.com'), 'email')
  assert(html.includes('070-9073-2909'), 'phone')
  assert(!html.includes('電子発行'), 'no e-issue line')
  assert(!html.includes('KuriPuro by JBM'), 'no old brand')
  assert(!html.includes('INTERNAL_INTEREST_SECRET'), 'interest stays off print')
  assert(!html.includes('SECRET_INTEREST_SHOULD_NOT_PRINT'), 'needs stay off print')
  assert(!html.includes('ご要望'), 'no needs label')
  assert(html.includes('brand-name'), 'styled header')
  assert(html.includes('issuer-card'), 'issuer card')
}

function testEditableAndPayload() {
  assert(isQuoteEditable('draft') === true, 'draft editable')
  assert(isQuoteEditable('pending') === true, 'pending editable')
  assert(isQuoteEditable('sent') === false, 'sent locked')
  assert(isQuoteEditable('accepted') === false, 'accepted locked')
  const payload = quoteWritePayload({
    company_name: 'Cafe A',
    contact_name: 'Ken',
    interest: 'warm',
    tax_rate: 10,
    notes: 'print me',
  }, 'lead-1', { subtotal: 100, taxAmount: 10, total: 110 })
  assert(payload.interest === 'warm', 'interest stored')
  assert(payload.notes === 'print me', 'notes stored')
  assert(payload.lead_id === 'lead-1', 'lead id')
}

function testSchemaDetect() {
  assert(isSalesSchemaMissing({ code: 'PGRST205' }), 'pgrst')
  assert(isSalesSchemaMissing({ message: "Could not find the table 'public.sales_leads'" }), 'name')
  assert(!isSalesSchemaMissing({ message: 'JWT' }), 'other')
}

function testSqlFile() {
  assert(SALES_SETUP_SQL.includes('public.sales_leads'), 'leads sql')
  assert(SALES_SETUP_SQL.includes('public.mitsumori_items'), 'items sql')
  assert(!SALES_SETUP_SQL.includes('```'), 'no fences')
  assert(SALES_SETUP_STEPS.length === 3, 'three steps')
  assert(SALES_CRM_SQL.includes('sales_touchpoints'), 'crm table')
  assert(SALES_CRM_SQL.includes('interest'), 'interest column')
}

function testI18n() {
  const en = Object.keys(kuripuroEn.sales).sort()
  const ja = Object.keys(kuripuroJa.sales).sort()
  assert(en.join() === ja.join(), `sales keys ${en.filter(k => !ja.includes(k))} ${ja.filter(k => !en.includes(k))}`)
  const enCh = Object.keys(kuripuroEn.sales.channels).sort()
  const jaCh = Object.keys(kuripuroJa.sales.channels).sort()
  assert(enCh.join() === jaCh.join(), 'channels')
  const enTp = Object.keys(kuripuroEn.sales.touchTypes).sort()
  const jaTp = Object.keys(kuripuroJa.sales.touchTypes).sort()
  assert(enTp.join() === jaTp.join(), 'touchTypes')
  assert(kuripuroJa.invoices.notes === '備考', 'invoice notes restored')
}

function main() {
  testFindAndMerge()
  testStageFilter()
  testQuoteNumberAndPrint()
  testEditableAndPayload()
  testSchemaDetect()
  testSqlFile()
  testI18n()
  console.log('✅ sales / 見積書 tests passed')
}

main()
