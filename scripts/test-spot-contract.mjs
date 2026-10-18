// v1.0.21: spot job → contract row, totals, printable 契約書, Google Calendar link and .ics feed.
import assert from 'node:assert/strict'
import { googleCalendarUrl, buildIcs, jobTimes } from '../src/lib/calendar.js'
import { buildSpotContractRow, spotContractTotals, spotContractHtml, contractPrefillFromClient } from '../src/lib/spotContract.js'

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
const row = buildSpotContractRow({ contract: { contact_name: ' 山田 ', price: '33000', tax_rate: 10, price_includes_tax: true, scope: '', terms: '' }, job, form, client: { company_name: 'Atomic', address: '港区新橋2-2-2' }, employee: { full_name: 'Letícia' } })
assert.equal(row.job_id, 'j1')
assert.equal(row.location_name, 'Atomic Bar')
assert.equal(row.contact_name, '山田')
assert.equal(row.price, 33000)
assert.equal(row.employee_pay, 8000)
assert.equal(row.employee_id, 'e1')
assert.equal(row.scope, 'Kitchen')
assert.equal(row.terms, null)
assert.equal(row.payment_day, 10)
assert.equal(row.client_address, '港区新橋2-2-2')
assert.equal(row.status, 'draft')

assert.deepEqual(spotContractTotals({ price: 33000, tax_rate: 10, price_includes_tax: true }), { subtotal: 30000, tax: 3000, total: 33000 })
assert.deepEqual(spotContractTotals({ price: 30000, tax_rate: 10, price_includes_tax: false }), { subtotal: 30000, tax: 3000, total: 33000 })

const html = spotContractHtml({ ...row, contract_number: 'SPOT-20261012-0001', location_name: '<b>x</b>' }, 'ja')
assert.match(html, /業務委託契約書/)
assert.match(html, /翌月10日までに/)
assert.match(html, /甲（委託者）/)
assert.match(html, /乙（受託者）/)
assert.match(html, /梅岡アレサンドレユウジ/)
assert.match(html, /第12条（協議）/)
assert.match(spotContractHtml({ ...row, payment_day: 25 }, 'ja'), /翌月25日までに/)
assert.deepEqual(contractPrefillFromClient({ address: 'A', contact_person: 'B', phone: 'C' }), { client_address: 'A', client_representative: 'B', contact_name: 'B', contact_phone: 'C' })
assert.match(html, /SPOT-20261012-0001/)
assert.match(html, /金33,000円/)
assert.ok(!html.includes('<b>x</b>'), 'location name must be escaped')
assert.match(spotContractHtml({ ...row, status: 'signed', signed_by: 'Yamada' }, 'en'), /APPROVED/)
console.log('✅ spot contract + Google Calendar helpers')

// Approval, invoice due date, recurring 業務委託契約書
const m = await import('../src/lib/spotContract.js')
assert.equal(m.contractStatus({ status: 'signed' }), 'approved')
assert.equal(m.contractStatus({}), 'draft')
assert.equal(m.dueDateAfter('2026-10-12', 10), '2026-11-10')
assert.equal(m.dueDateAfter('2026-12-05', 10), '2027-01-10')
assert.equal(m.dueDateAfter('2026-01-31', 31), '2026-02-28')
const inv = m.spotInvoiceRows({ ...row, id: 's1', contract_number: 'SPOT-1' })
assert.equal(inv.fatura.due_date, '2026-11-10')
assert.equal(inv.fatura.total, 33000)
assert.equal(inv.fatura.subtotal + inv.fatura.tax_amount, 33000)
assert.equal(inv.item.job_id, 'j1')
assert.match(m.spotContractHtml({ ...row, status: 'approved' }, 'ja'), /承認済/)
assert.match(m.spotContractHtml({ ...row, status: 'rejected' }, 'ja'), /不承認/)
const rc = m.recurringToContract({ id: 'abcd1234-0000', location_name: 'Atomic', days_of_week: ['Mon', 'Thu'], billing_type: 'fixed_monthly', fixed_monthly: 55000, billing_day: 10, tax_rate: 10 }, { company_name: 'A社', address: '港区' })
const rhtml = m.spotContractHtml(rc, 'ja')
assert.match(rhtml, /作業曜日：月・木/)
assert.match(rhtml, /月額金55,000円/)
assert.match(rhtml, /業務実施月の翌月10日までに/)
assert.match(rhtml, /1年間/)
console.log('✅ approval, invoice due date, recurring contract')

// Seller commission on contracts
const cc = await import('../src/lib/contractCommission.js')
const priced = { price: 33000, tax_rate: 10, price_includes_tax: true }
assert.deepEqual(cc.commissionFromRule({ commission_type: 'percent', commission_value: 10, percent_basis: 'base_monthly' }, priced), { commission_type: 'percent', commission_value: 10, commission_amount: 3000 })
assert.equal(cc.commissionFromRule({ commission_type: 'percent', commission_value: 10, percent_basis: 'contract_total' }, priced).commission_amount, 3300)
assert.equal(cc.commissionFromRule({ commission_type: 'fixed', commission_value: 5000 }, priced).commission_amount, 5000)
assert.equal(cc.commissionFromRule(null, priced).commission_amount, 0)
const sc = { salesperson_id: 'p1', commission_amount: 3000 }
assert.equal(cc.commissionState({ ...sc, status: 'draft' }), 'pending')
assert.equal(cc.commissionState({ ...sc, status: 'approved' }), 'earned')
assert.equal(cc.commissionState({ ...sc, status: 'signed' }), 'earned')
assert.equal(cc.commissionState({ ...sc, status: 'approved', commission_paid_at: '2026-10-11' }), 'paid')
assert.equal(cc.commissionState({ ...sc, status: 'cancelled' }), 'void')
assert.equal(cc.commissionState({ status: 'approved', commission_amount: 3000 }), 'none')
assert.deepEqual(cc.sellerCommissionSummary([{ ...sc, status: 'approved' }, { ...sc, status: 'draft', commission_amount: 1000 }, { ...sc, status: 'approved', commission_paid_at: 'x', commission_amount: 500 }], [{ commission_amount: 2000 }, { commission_amount: 9, is_active: false }]), { earned: 3000, paid: 500, pending: 1000, monthly: 2000 })
const withSeller = buildSpotContractRow({ contract: { price: '33000', tax_rate: 10, salesperson_id: 'p1', salesperson_name: 'Ken', commission_type: 'percent', commission_value: 10, commission_amount: '3000' }, job, form, client: {}, employee: {} })
assert.equal(withSeller.salesperson_id, 'p1')
assert.equal(withSeller.commission_amount, 3000)
assert.equal(row.salesperson_id, null)
assert.equal(row.commission_amount, 0)
console.log('✅ seller commission on contracts')

// v1.0.36 · written address, 責任者, no hours, Japanese service, monthly price, notes per item
{
  const sp = await import('../src/lib/spotContract.js')
  const maps = 'https://www.google.com/maps/search/?api=1&query=ATOMIC%20BAR%20%E5%85%AD%E6%9C%AC%E6%9C%A83-14-14%205F%20%E6%9D%B1%E4%BA%AC'
  assert.equal(sp.writtenAddress(maps), 'ATOMIC BAR 六本木3-14-14 5F 東京')
  assert.equal(sp.writtenAddress('https://maps.google.com/?q=35.6,139.7'), '')
  assert.equal(sp.writtenAddress('東京都港区1-2'), '東京都港区1-2')
  assert.equal(sp.serviceTypeJa('Deep Cleaning (Grease Trap 2x, AC, Range Hood, Fogão)'), 'ディープクリーニング（グリストラップ清掃×2・エアコン清掃・レンジフード清掃・コンロ清掃）')
  assert.equal(sp.serviceTypeJa('Atomic Bar — Deep Clean'), 'ディープクリーニング')
  assert.equal(sp.serviceTypeJa('Atomic Bar'), '')
  const rec = sp.recurringToContract({ id: 'dfff4a73-0', location_name: 'Atomic Bar', location_address: maps, service_type: 'Basic Cleaning', days_of_week: ['Mon'], hours_per_visit: 3, visits_per_month: 4, price_per_visit: 37500, billing_type: 'per_visit', tax_rate: 10, training_checklist: 'Retirar TODO o lixo', notes: 'Segunda-feira até 21:00', contract_details: { responsible: '山田 太郎', notes: { fee: '月4回の定期訪問のため' } } }, { company_name: 'Atomic 株式会社' })
  const html = sp.spotContractHtml(rec, 'ja')
  assert.ok(!html.includes('google.com/maps'), 'no Maps URL on the contract')
  assert.ok(html.includes('六本木3-14-14'))
  assert.ok(html.includes('責任者') && html.includes('山田 太郎'))
  assert.ok(!html.includes('時間'), 'no hours on the contract')
  assert.ok(!/Retirar|Segunda/.test(html), 'no Portuguese on the Japanese contract')
  assert.ok(html.includes('作業内容：定期清掃'))
  assert.ok(html.includes('月額金150,000円') && html.includes('1回あたり金37,500円 × 月4回'))
  assert.ok(html.includes('備考：月4回の定期訪問のため'))
  assert.ok(html.includes('ゴミの回収'), 'default Japanese scope')
  const spot = sp.spotContractHtml({ location_name: 'Bar', location_address: maps, service_type: 'Bar — Range Hood', service_date: '2026-10-20', service_time: '22:00', price: 33000, tax_rate: 10, contract_details: { notes: { payment: '翌月10日払い' } } }, 'ja')
  assert.ok(spot.includes('作業日：2026年10月20日') && !spot.includes('22:00'))
  assert.ok(spot.includes('レンジフード清掃') && spot.includes('本業務（1回）の委託料'))
  assert.deepEqual(sp.cleanContractDetails({ responsible: ' 山田 ', service_label: '', notes: { fee: '', place: '駅前' } }), { responsible: '山田', notes: { place: '駅前' } })
  console.log('✅ contract details (v1.0.36)')
}
