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
  quoteRestaurantName,
  quoteTotals,
  quoteWritePayload,
  dropSiteNameKeepNote,
  stripCrmExtras,
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
  assert(html.includes('代表'), 'daihyo labeled')
  assert(html.includes('住所'), 'address labeled')
  assert(html.includes('〒204-0012'), 'kiyose postal')
  assert(html.includes('東京都清瀬市中清戸4-907-17'), 'kiyose street')
  assert(html.includes('登録番号'), 'touroku labeled')
  assert(html.includes('T1234567890123'), 'reg digits')
  assert(!html.includes('電子発行'), 'no e-issue line')
  assert(!html.includes('KuriPuro by JBM'), 'no old brand')
  assert(!html.includes('INTERNAL_INTEREST_SECRET'), 'interest stays off print')
  assert(!html.includes('SECRET_INTEREST_SHOULD_NOT_PRINT'), 'needs stay off print')
  assert(!html.includes('ご要望'), 'no needs label')
  assert(html.includes('issuer-card'), 'issuer card')
  assert(html.includes('issuer-brand'), 'issuer once at foot')
  assert((html.split('〒204-0012').length - 1) === 1, 'kiyose once')
  assert((html.split('梅岡アレサンドレユウジ').length - 1) === 1, 'daihyo once')
  assert((html.split('クリプロ').length - 1) === 1, 'company once')
  assert(!html.includes('brand-name'), 'no duplicate header brand')
  assert(quoteRestaurantName({ site_name: '  Kodama  ' }) === 'Kodama', 'trim restaurant')
  const shop = buildMitsumoriPrintHtml({
    company_name: 'Parent Co',
    site_name: 'Kodama Kinshicho',
    quote_number: 'KPQ-202610-002',
    tax_rate: 10,
    subtotal: 0,
    tax_amount: 0,
    total: 0,
  }, [])
  assert(shop.includes('Kodama Kinshicho 御中'), 'restaurant 御中')
  assert(shop.includes('Parent Co'), 'legal company under restaurant')
  assert(shop.includes('見積書 KPQ-202610-002 - Kodama Kinshicho'), 'title uses restaurant')
  const fromNotes = buildMitsumoriPrintHtml({
    company_name: 'Parent Co',
    notes: '【店舗】Kodama Kinshicho\n内部メモ',
    quote_number: 'KPQ-202610-003',
    tax_rate: 10,
    subtotal: 0,
    tax_amount: 0,
    total: 0,
  }, [])
  assert(fromNotes.includes('Kodama Kinshicho 御中'), 'restaurant from notes when column missing')
  assert(!fromNotes.includes('【店舗】'), 'store tag stripped from 備考')
  assert(fromNotes.includes('備考：内部メモ'), 'human notes remain')
  assert(html.includes('ご返答をお待ちしております'), 'thanks ja')
  assert(html.includes('誠にありがとうございます'), 'thanks ja gratitude')
  const en = buildMitsumoriPrintHtml({
    company_name: 'Parent Co',
    site_name: 'Kodama Kinshicho',
    quote_number: 'KPQ-202610-002',
    issue_date: '2026-10-06',
    tax_rate: 10,
    subtotal: 0,
    tax_amount: 0,
    total: 0,
  }, [], {}, 'en')
  assert(en.includes('QUOTATION'), 'en title')
  assert(en.includes('lang="en"'), 'html lang en')
  assert(en.includes('Thank you for requesting this quotation'), 'thanks en')
  assert(en.includes('we look forward to your reply'), 'await reply en')
  assert(en.includes('Kodama Kinshicho'), 'restaurant en')
  assert(!en.includes('御中'), 'no 御中 on english print')
  assert(en.includes('Rep.'), 'rep en')
  assert(en.includes('Issue date'), 'issue date en')
  assert(!en.includes('<h1>見積書</h1>'), 'no ja h1 on en')
  assert(en.includes('Alexandre Yuji Umeoka'), 'en legal name')
  assert(en.includes('Nakakiyoto'), 'en address')
  assert(en.includes('KuriPuro'), 'en company')
  assert(en.includes('rep-name'), 'name on own line')
  assert(!en.includes('梅岡アレサンドレユウジ'), 'no katakana name on en')
  assert(!en.includes('東京都清瀬市'), 'no ja street on en')
  assert(!en.includes('Representative: 梅'), 'label not concatenated into name')
  const jaLine = buildMitsumoriPrintHtml({
    company_name: 'Parent Co',
    site_name: 'Kodama Kinshicho',
    quote_number: 'KPQ-202610-004',
    tax_rate: 10,
    subtotal: 10000,
    tax_amount: 1000,
    total: 11000,
  }, [{ description: '日常清掃（月額）', quantity: 1, unit_price: 10000, total: 10000 }], {}, 'en')
  assert(jaLine.includes('Daily cleaning'), 'service line in english')
  assert(jaLine.includes('monthly'), 'monthly in english')
  assert(!jaLine.includes('日常清掃'), 'no japanese service line')
  assert(quoteRestaurantName({ notes: '店舗：魚豪商コダマ\nmemo' }) === '魚豪商コダマ', 'store colon in notes')
  assert(quoteRestaurantName({ notes: '店名：魚豪商コダマ' }) === '魚豪商コダマ', 'tenmei in notes')
  assert(html.includes('&lt;x&gt; 御中'), 'company as 御中 fallback')
}

function testEditableAndPayload() {
  assert(isQuoteEditable('draft') === true, 'draft editable')
  assert(isQuoteEditable('pending') === true, 'pending editable')
  assert(isQuoteEditable('sent') === false, 'sent locked')
  assert(isQuoteEditable('accepted') === false, 'accepted locked')
  const payload = quoteWritePayload({
    company_name: 'Cafe A',
    site_name: 'Kodama',
    contact_name: 'Ken',
    interest: 'warm',
    tax_rate: 10,
    notes: 'print me',
  }, 'lead-1', { subtotal: 100, taxAmount: 10, total: 110 })
  assert(payload.interest === 'warm', 'interest stored')
  assert(payload.notes === '【店舗】Kodama\nprint me', 'restaurant embedded in notes')
  assert(payload.lead_id === 'lead-1', 'lead id')
  const fallback = dropSiteNameKeepNote(stripCrmExtras(payload))
  assert(!('site_name' in fallback), 'column-missing retry drops site_name')
  assert(!('interest' in fallback), 'column-missing retry drops interest')
  assert(fallback.notes === '【店舗】Kodama\nprint me', 'restaurant survives retry')
  assert(quoteRestaurantName({ notes: fallback.notes }) === 'Kodama', 'print reads restaurant from notes')
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
  assert(SALES_CRM_SQL.includes('site_name'), 'restaurant column')
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
