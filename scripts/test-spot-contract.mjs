// v1.0.21: spot job → contract row, totals, printable 契約書, Google Calendar link and .ics feed.
import assert from 'node:assert/strict'
import { googleCalendarUrl, buildIcs, jobTimes } from '../src/lib/calendar.js'
import { buildSpotContractRow, spotContractTotals, spotContractHtml, DEFAULT_SPOT_TERMS } from '../src/lib/spotContract.js'

const job = { id: 'j1', title: 'Atomic Bar — Deep Clean', scheduled_date: '2026-10-12', scheduled_time: '00:30', address: '東京都港区新橋1-1-1', employee_name: 'Letícia', client_name: 'Atomic', job_category: 'spot', description: 'Kitchen; floor, hood' }

// 00:30 Tokyo on the 12th = 15:30 UTC on the 11th
const t = jobTimes(job)
assert.equal(t.start.toISOString(), '2026-10-11T15:30:00.000Z')
assert.equal(t.end.toISOString(), '2026-10-11T17:30:00.000Z')

const g = new URL(googleCalendarUrl(job))
assert.equal(g.hostname, 'calendar.google.com')
assert.equal(g.searchParams.get('action'), 'TEMPLATE')
assert.equal(g.searchParams.get('dates'), '20261011T153000Z/20261011T173000Z')
assert.equal(g.searchParams.get('text'), '⚡ Atomic Bar — Deep Clean')
assert.equal(g.searchParams.get('location'), job.address)
// No time → all-day event
assert.equal(new URL(googleCalendarUrl({ ...job, scheduled_time: '' })).searchParams.get('dates'), '20261012/20261013')

const ics = buildIcs([job, { ...job, id: 'j2', status: 'cancelled' }], { name: 'KuriPuro · Letícia', now: new Date('2026-10-11T00:00:00Z') })
assert.match(ics, /^BEGIN:VCALENDAR\r\n/)
assert.match(ics, /UID:job-j1@kuripuro/)
assert.match(ics, /DTSTART:20261011T153000Z/)
assert.ok(ics.includes('Kitchen\\; floor\\, hood'))
assert.match(ics, /UID:job-j2@kuripuro[\s\S]*STATUS:CANCELLED/)
for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line}`)

const form = { title: 'Atomic Bar', client_id: 'c1', employee_id: 'e1', scheduled_date: '2026-10-12', scheduled_time: '00:30', address: job.address, value: 0, spot_value: 8000, description: 'Kitchen', location_id: '' }
const row = buildSpotContractRow({ contract: { contact_name: ' 山田 ', price: '33000', tax_rate: 10, price_includes_tax: true, scope: '', terms: '' }, job, form, client: { company_name: 'Atomic' }, employee: { full_name: 'Letícia' } })
assert.equal(row.job_id, 'j1')
assert.equal(row.location_name, 'Atomic Bar')
assert.equal(row.contact_name, '山田')
assert.equal(row.price, 33000)
assert.equal(row.employee_pay, 8000)
assert.equal(row.employee_id, 'e1')
assert.equal(row.scope, 'Kitchen')
assert.equal(row.terms, DEFAULT_SPOT_TERMS.ja)
assert.equal(row.status, 'draft')

assert.deepEqual(spotContractTotals({ price: 33000, tax_rate: 10, price_includes_tax: true }), { subtotal: 30000, tax: 3000, total: 33000 })
assert.deepEqual(spotContractTotals({ price: 30000, tax_rate: 10, price_includes_tax: false }), { subtotal: 30000, tax: 3000, total: 33000 })

const html = spotContractHtml({ ...row, contract_number: 'SPOT-20261012-0001', location_name: '<b>x</b>' }, 'ja')
assert.match(html, /業務契約書/)
assert.match(html, /SPOT-20261012-0001/)
assert.match(html, /¥33,000/)
assert.ok(!html.includes('<b>x</b>'), 'location name must be escaped')
assert.match(spotContractHtml({ ...row, status: 'signed', signed_by: 'Yamada' }, 'en'), /SIGNED/)
console.log('✅ spot contract + Google Calendar helpers')
