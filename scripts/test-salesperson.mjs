#!/usr/bin/env node
import { readdirSync } from 'fs'
import { kuripuroEn, kuripuroJa } from '../src/i18n/kuripuro.js'
import { SALESPERSON_SQL } from '../src/lib/salesSetupSql.js'
import { QUOTE_ISSUER } from '../src/lib/quoteIssuer.js'
import { buildMitsumoriPrintHtml } from '../src/lib/sales.js'
import {
  approachIsValid,
  approachWritePayload,
  hashSalespersonSecret,
  hoursInMonth,
  isSalespersonSchemaMissing,
  openFollowups,
  ownRowsOnly,
  reportIsValid,
  reportWritePayload,
  salespersonSession,
} from '../src/lib/salesperson.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function testHash() {
  const a = await hashSalespersonSecret('Ken@Co.jp', 'secret')
  const b = await hashSalespersonSecret('ken@co.jp', 'secret')
  const c = await hashSalespersonSecret('ken@co.jp', 'other')
  assert(a === b, 'email normalized')
  assert(a.length === 64, 'sha256 hex')
  assert(a !== c, 'password changes hash')
  assert(!a.includes('secret'), 'hash is not plaintext')
}

function testScopeAndValidation() {
  const rows = [
    { salesperson_id: 'a', hours_worked: 4, work_date: '2026-10-01' },
    { salesperson_id: 'b', hours_worked: 8, work_date: '2026-10-01' },
  ]
  assert(ownRowsOnly(rows, 'a').length === 1, 'own only')
  assert(ownRowsOnly(rows, null).length === 0, 'no id empty')
  assert(reportIsValid({ work_date: '2026-10-06', hours_worked: 6, summary: 'Visited 3 shops near Kinshicho' }), 'report ok')
  assert(!reportIsValid({ work_date: '2026-10-06', hours_worked: 6, summary: 'short' }), 'report needs text')
  assert(!reportIsValid({ work_date: '2026-10-06', hours_worked: 0, summary: 'Visited 3 shops near Kinshicho' }), 'hours')
  assert(approachIsValid({ work_date: '2026-10-06', place: 'Kinshicho', meishi_photo_url: 'salespeople/x/meishi/1.jpg' }), 'approach ok')
  assert(!approachIsValid({ work_date: '2026-10-06', place: 'Kinshicho', meishi_photo_url: '' }), 'meishi required')
  const hours = hoursInMonth([{ work_date: '2026-10-01', hours_worked: 5 }, { work_date: '2026-09-30', hours_worked: 9 }], '2026-10')
  assert(hours === 5, hours)
  const fu = openFollowups([
    { followup_status: 'open', followup_date: '2026-10-01', followup_note: 'call' },
    { followup_status: 'done', followup_date: '2026-10-01', followup_note: 'x' },
  ], '2026-10-06')
  assert(fu.length === 1 && fu[0].overdue, 'overdue followup')
}

function testPayloads() {
  const r = reportWritePayload({ work_date: '2026-10-06', hours_worked: '7.5', summary: '  hello world long  ', areas: 'A' }, 'sp1')
  assert(r.salesperson_id === 'sp1', 'sid')
  assert(r.hours_worked === 7.5, 'hours num')
  const a = approachWritePayload({ work_date: '2026-10-06', place: ' X ', meishi_photo_url: 'p.jpg', site_name: 'Kodama' }, 'sp1', 'd1')
  assert(a.place === 'X' && a.meishi_photo_url === 'p.jpg' && a.site_name === 'Kodama', 'approach payload')
  const sess = salespersonSession({ id: '1', full_name: 'Ken', email: 'k@x', phone: '1' })
  assert(sess.role === 'salesperson' && !('password_hash' in sess), 'session scrub')
}

function testQuotePrint() {
  assert(QUOTE_ISSUER.title === '代表', 'daihyo')
  assert(QUOTE_ISSUER.address.includes('西新宿'), 'address')
  assert(QUOTE_ISSUER.regNumber.includes('T123'), 'touroku')
  const html = buildMitsumoriPrintHtml({
    company_name: 'Parent Co',
    site_name: 'Kodama Kinshicho',
    contact_name: 'Sato',
    quote_number: 'KPQ-202610-009',
    issue_date: '2026-10-06',
    tax_rate: 10,
    subtotal: 1000,
    tax_amount: 100,
    total: 1100,
  }, [])
  assert(html.includes('Kodama Kinshicho 御中'), 'restaurant 御中')
  assert(html.includes('Parent Co'), 'legal company under restaurant')
  assert(html.includes('代表'), 'rep title')
  assert(html.includes('〒160-0023'), 'commercial address')
  assert(html.includes('登録番号'), 'reg number')
}

function testSqlAndI18n() {
  assert(SALESPERSON_SQL.includes('password_hash'), 'hashed col')
  assert(SALESPERSON_SQL.includes('meishi_photo_url text not null'), 'meishi required')
  assert(SALESPERSON_SQL.includes('sales_day_reports'), 'reports table')
  assert(!SALESPERSON_SQL.includes('```'), 'no fences')
  const fns = readdirSync(new URL('../api', import.meta.url)).filter(f => f.endsWith('.js') && !f.startsWith('_'))
  assert(fns.length <= 12, `vercel hobby functions ${fns.length}: ${fns.join(',')}`)
  assert(isSalespersonSchemaMissing({ code: 'PGRST205' }), 'pgrst')
  const en = Object.keys(kuripuroEn.salesperson).sort()
  const ja = Object.keys(kuripuroJa.salesperson).sort()
  assert(en.join() === ja.join(), `salesperson keys ${en.filter(k => !ja.includes(k))} ${ja.filter(k => !en.includes(k))}`)
  const enAi = Object.keys(kuripuroEn.ai).sort()
  const jaAi = Object.keys(kuripuroJa.ai).sort()
  assert(enAi.join() === jaAi.join(), `ai keys ${enAi.filter(k => !jaAi.includes(k))} ${jaAi.filter(k => !enAi.includes(k))}`)
  assert(kuripuroEn.sales.siteName && kuripuroJa.sales.siteName, 'quote restaurant field')
  assert(kuripuroEn.sidebar.salesTeam && kuripuroJa.sidebar.salesTeam, 'nav')
}

async function main() {
  await testHash()
  testScopeAndValidation()
  testPayloads()
  testQuotePrint()
  testSqlAndI18n()
  console.log('✅ salesperson portal tests passed')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
