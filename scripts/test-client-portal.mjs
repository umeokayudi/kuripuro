#!/usr/bin/env node
/**
 * Client portal: visit filters match admin types, extra quotes match catalog.
 * No production writes.
 */
import {
  jobMatchesClientUser,
  filterClientVisits,
  monthCompletedCount,
  visibleInvoices,
  unpaidInvoices,
  filterInvoices,
  lastDeepVisit,
  itemsForInvoice,
  clientLocations,
  locationFromJob,
  clientMonthlyCost,
} from '../src/lib/clientPortal.js'
import {
  extrasForLocation,
  packExtraRequest,
  parseExtraRequest,
  packPaymentNotice,
  parsePaymentNotice,
  extraLabel,
  extraTimeLabel,
  extraInvoiceDraft,
  mergeExtraNotes,
} from '../src/lib/clientExtras.js'
import { DEFAULT_DEEP_CLEAN_PRICE } from '../src/lib/serviceCatalog.js'
import { kuripuroEn, kuripuroJa } from '../src/i18n/kuripuro.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const otp = { client_id: '7138f082-0d38-43e4-bd77-00c4598690b3', location_name: 'Kodama Shinbashi' }
const otpHq = { client_id: '7138f082-0d38-43e4-bd77-00c4598690b3' }
const atomicUser = { client_id: 'bf3f7ab5-24c4-4ec1-b25f-d91becb166de', location_name: 'Atomic Bar' }

const jobs = [
  { id: '1', status: 'completed', scheduled_date: '2026-09-18', title: 'Kodama Shinbashi — Basic Cleaning', client_id: otp.client_id },
  { id: '2', status: 'completed', scheduled_date: '2026-09-16', title: 'Ibushio — Deep Clean', client_id: otp.client_id },
  { id: '3', status: 'completed', scheduled_date: '2026-08-20', title: 'Kodama Shinbashi — Basic Cleaning', client_id: otp.client_id },
  { id: '4', status: 'assigned', scheduled_date: '2026-09-18', title: 'Kodama Shinbashi — Basic Cleaning', client_id: otp.client_id },
  { id: '5', status: 'completed', scheduled_date: '2026-09-15', title: 'Atomic Bar — Basic Cleaning', client_id: atomicUser.client_id },
]

console.log('=== Client portal data + extras (no DB) ===\n')

assert(jobMatchesClientUser(jobs[0], otp), 'store user sees own basic job')
assert(!jobMatchesClientUser(jobs[1], otp), 'Shinbashi user does not see Ibushio')
assert(jobMatchesClientUser(jobs[1], otpHq), 'OTP HQ sees Ibushio')
assert(!jobMatchesClientUser(jobs[0], atomicUser), 'Atomic does not see OTP job')
assert(locationFromJob(jobs[1]) === 'Ibushio', 'location from title')

const month = filterClientVisits(jobs, { from: '2026-09-01', to: '2026-09-18', type: 'all' })
assert(month.length === 3, `Sept completed across clients = 3, got ${month.length}`)
assert(filterClientVisits(jobs, { from: '2026-09-01', to: '2026-09-18', type: 'deep' }).every(j => /Deep/i.test(j.title)), 'deep filter')
assert(filterClientVisits(jobs, { from: '2026-09-01', to: '2026-09-18', store: 'Kodama Shinbashi' }).length === 1, 'store filter')
assert(filterClientVisits(jobs, { from: '2026-09-01', to: '2026-09-18', unratedOnly: true, ratedJobIds: new Set(['1']) }).every(j => j.id !== '1'), 'unrated filter')
assert(monthCompletedCount(jobs, '2026-09') === 3, 'month completed count')
console.log('  visit filters match admin types')

const shin = extrasForLocation('Kodama Shinbashi')
assert(shin.some(e => e.id === 'extra_basic' && e.price === 4000), 'Kodama extra basic ¥4000')
assert(shin.some(e => e.id === 'extra_deep' && e.price === DEFAULT_DEEP_CLEAN_PRICE), 'Kodama extra deep ¥5000')
const ibu = extrasForLocation('Ibushio')
assert(!ibu.some(e => e.id === 'extra_basic'), 'deep-only has no extra basic')
assert(ibu.some(e => e.id === 'extra_deep' && e.price === 5000), 'Ibushio extra deep')
assert(ibu.some(e => e.id === 'extra_grease' && e.price === 1000), 'component extras ¥1000')
assert(ibu.some(e => e.id === 'extra_grill' && e.price === 1000), 'grill extra matches hood/AC')
assert(extraLabel('extra_grill', 'ja').includes('グリル'), 'ja grill label')
const packed = packExtraRequest({ extraId: 'extra_deep', price: 5000, locationName: 'Ibushio', notes: mergeExtraNotes('After 21:00', 'after_close') })
const parsed = parseExtraRequest(packed)
assert(parsed.extraId === 'extra_deep' && parsed.price === 5000 && parsed.notes.includes('Preferred time: After close'), 'pack/parse extra with time')
assert(parsed.notes.includes('After 21:00'), 'user notes kept')
assert(extraLabel('extra_deep', 'ja').includes('深層'), 'ja extra label')
const pay = parsePaymentNotice(packPaymentNotice({ faturaId: 'abc', total: 12000, period: '2026-09' }))
assert(pay.faturaId === 'abc' && pay.total === 12000, 'pay notice')
console.log('  extra catalog quotes match HQ catalog')

const inv = visibleInvoices([
  { id: 'a', status: 'draft', total: 1 },
  { id: 'b', status: 'sent', total: 10 },
  { id: 'c', status: 'paid', total: 20 },
  { id: 'd', status: 'cancelled', total: 3 },
  { id: 'e', status: 'pending', total: 9 },
])
assert(inv.map(i => i.id).join() === 'b,c,e', 'hide only draft/cancelled — pending stays visible')
assert(unpaidInvoices([{ status: 'sent' }, { status: 'paid' }, { status: 'pending' }]).length === 2, 'unpaid = sent+pending')
assert(filterInvoices([{ status: 'sent' }, { status: 'paid' }, { status: 'draft' }, { status: 'pending' }], 'paid').length === 1, 'paid filter hides draft')
assert(filterInvoices([{ status: 'sent' }, { status: 'pending' }, { status: 'paid' }], 'unpaid').length === 2, 'unpaid filter includes pending')
assert(extraTimeLabel('after_close', 'pt').includes('fechamento'), 'pt extra time')
const draft = extraInvoiceDraft({
  extra: { extraId: 'extra_deep', price: 5000, locationName: 'Ibushio' },
  request: { client_id: otp.client_id, client_name: 'OTP', ticket_number: 'KP-1' },
  today: '2026-09-22',
  extraTitle: 'Extra deep clean',
})
assert(draft.fatura.status === 'sent' && draft.fatura.total === 5500, `extra invoice ${draft.fatura.total}`)
assert(draft.item.unit_price === 5000 && draft.item.description.includes('Ibushio'), 'extra line item')
assert(clientMonthlyCost({ monthly_cost: 0, monthly_cost_estimate: 12000 }) === 12000, 'cost falls back to estimate')
assert(lastDeepVisit(jobs)?.id === '2', 'last deep is Ibushio Sept 16')
assert(itemsForInvoice([{ fatura_id: 'b', total: 10 }, { fatura_id: 'c', total: 20 }], 'b').length === 1, 'invoice lines scoped')
assert(clientLocations(otp, [{ location_name: 'Ibushio' }, { location_name: 'Kodama Shinbashi' }], jobs).join() === 'Kodama Shinbashi', 'store user locked to own shop')
assert(clientLocations(otpHq, [{ location_name: 'Ibushio' }, { location_name: 'Kodama Shinbashi' }], []).join() === 'Ibushio,Kodama Shinbashi', 'HQ sees all OTP shops')
assert(kuripuroEn.client.bookExtra && kuripuroJa.client.invoicesDue && kuripuroEn.client.extraTime && kuripuroJa.client.repeatExtra, 'i18n keys')
console.log('  invoices visibility OK')

console.log('\n✅ Client portal tests passed')
