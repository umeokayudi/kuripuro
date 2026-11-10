// v1.0.206 · Vendedor: "jogue tudo na IA" + "Visita agendada" — npx vite-node scripts/test-seller-visits.mjs
import assert from 'node:assert/strict'
import { applyLeadDump, cleanTime, findDuplicateLead, followupForVisit, isImagePath, missedVisits, normalizeVisit, upcomingVisits, upsertVisit, visitAsCalendarJob } from '../src/lib/sellerVisits.js'
import { buildIcs, googleCalendarUrl, jobTimes } from '../src/lib/calendar.js'

const today = '2026-11-10'
const LEAD = '11111111-1111-4111-8111-111111111111'
const V1 = '22222222-2222-4222-8222-222222222222'

// times the AI or the seller may type
assert.equal(cleanTime('15:00'), '15:00')
assert.equal(cleanTime('9:5'), '09:05')
assert.equal(cleanTime('14h30'), '14:30')
assert.equal(cleanTime('15時半'), '15:30')
assert.equal(cleanTime('25:00'), '')
assert.equal(cleanTime(''), '')

// visit validation
assert.ok(normalizeVisit({ date: '' }, { today }).error)
assert.ok(normalizeVisit({ date: '2026-02-30' }, { today }).error, 'impossible day')
assert.ok(normalizeVisit({ date: '2026-11-09' }, { today }).error, 'past day refused')
const ok = normalizeVisit({ date: '2026-11-14', time: '15h', duration_min: 2000, lead_id: LEAD, note: 'levar orçamento' }, { today }).visit
assert.equal(ok.time, '15:00')
assert.equal(ok.duration_min, 480, 'length capped at 8 h')
assert.equal(ok.status, 'scheduled')
assert.equal(ok.lead_id, LEAD)
assert.equal(normalizeVisit({ date: '2026-11-14', lead_id: 'x' }, { today }).visit.lead_id, '', 'bad lead id dropped')

// lists
const rows = [
  { id: 'a', lead_id: LEAD, date: '2026-11-12', time: '10:00', status: 'scheduled' },
  { id: 'b', lead_id: LEAD, date: '2026-11-11', time: '', status: 'scheduled' },
  { id: 'c', lead_id: LEAD, date: '2026-11-08', time: '10:00', status: 'scheduled' },
  { id: 'd', lead_id: LEAD, date: '2026-11-12', time: '09:00', status: 'cancelled' },
]
assert.deepEqual(upcomingVisits(rows, today).map(r => r.id), ['b', 'a'])
assert.deepEqual(missedVisits(rows, today).map(r => r.id), ['c'])
assert.equal(upsertVisit(rows, { ...rows[0], time: '11:00' }).filter(r => r.id === 'a').length, 1, 'upsert replaces')

// follow-up moves to the visit day only when sooner / empty, never hides an overdue one
assert.equal(followupForVisit('', '2026-11-14', today), '2026-11-14')
assert.equal(followupForVisit('2026-11-20', '2026-11-14', today), '2026-11-14')
assert.equal(followupForVisit('2026-11-12', '2026-11-14', today), null)
assert.equal(followupForVisit('2026-11-01', '2026-11-14', today), null)

// AI answer → lead form
const answer = {
  company_name: '寿司竜', site_name: '渋谷店', contact_name: '田中', phone: '03-1234-5678', email: 'not-an-email',
  maps_url: 'https://evil.example/maps', address: '東京都渋谷区1-2-3', needs: 'Limpeza de coifa', next_followup_date: '2026-11-01',
  notes: 'Quer orçamento de coifa.', expected_monthly: '¥40,000', visit: { date: '2026-11-14', time: '15:00', duration_min: 60, place: '' },
}
const fresh = applyLeadDump({ company_name: '', notes: 'minha nota', gps_lat: 35.6 }, answer, { today })
assert.equal(fresh.lead.company_name, '寿司竜')
assert.equal(fresh.lead.contact_phone, '03-1234-5678')
assert.equal(fresh.lead.contact_email, undefined, 'invalid e-mail ignored')
assert.equal(fresh.lead.maps_url, undefined, 'only real Google Maps links')
assert.equal(fresh.lead.next_followup_date, undefined, 'past follow-up ignored')
assert.equal(fresh.lead.expected_monthly, 40000)
assert.equal(fresh.lead.gps_lat, 35.6, 'GPS kept')
assert.equal(fresh.lead.notes, 'minha nota\nQuer orçamento de coifa.', 'AI note appended, seller note kept')
assert.equal(fresh.visit.date, '2026-11-14')
assert.equal(fresh.visit.place, '渋谷店')
assert.equal(fresh.visit.address, '東京都渋谷区1-2-3')
assert.ok(fresh.filled.includes('company_name') && fresh.filled.includes('notes'))
// editing an existing lead: only empty fields change
const edit = applyLeadDump({ company_name: 'Sushi Ryu', contact_phone: '' }, answer, { today, onlyEmpty: true })
assert.equal(edit.lead.company_name, 'Sushi Ryu')
assert.equal(edit.lead.contact_phone, '03-1234-5678')
// running twice does not duplicate the note
assert.equal(applyLeadDump(fresh.lead, answer, { today }).lead.notes, fresh.lead.notes)
assert.equal(applyLeadDump({}, null).filled.length, 0)
assert.equal(applyLeadDump({}, { visit: { date: '2026-11-01' } }, { today }).visit, null, 'past visit ignored')

// duplicates
const leads = [{ id: 'x1', company_name: '株式会社 寿司竜', site_name: '渋谷店', contact_phone: '+81 3-1234-5678' }, { id: 'x2', company_name: 'Bar Uno', contact_email: 'a@b.jp' }]
assert.equal(findDuplicateLead(leads, { contact_phone: '0312345678' })?.id, 'x1', 'same phone')
assert.equal(findDuplicateLead(leads, { company_name: '寿司竜', site_name: '渋谷店' })?.id, 'x1', 'same name without 株式会社')
assert.equal(findDuplicateLead(leads, { company_name: 'Novo', contact_email: 'A@B.jp' })?.id, 'x2', 'same e-mail')
assert.equal(findDuplicateLead(leads, { company_name: '寿司竜', site_name: '新宿店' }), null, 'other branch is not a duplicate')
assert.equal(findDuplicateLead(leads, { company_name: '寿司竜', site_name: '渋谷店' }, 'x1'), null, 'ignores itself')

assert.ok(isImagePath('cards/s/a.jpg') && !isImagePath('sales-dumps/s/dados-1.json'))

// calendar: own length + own UID; jobs unchanged
const lead = { id: LEAD, company_name: '寿司竜', site_name: '渋谷店', contact_name: '田中', contact_phone: '03-1234-5678', address: '東京都渋谷区1-2-3' }
const job = visitAsCalendarJob({ ...ok, id: V1 }, lead, { sellerName: 'Ana' })
const t = jobTimes(job)
assert.equal(t.start.toISOString(), '2026-11-14T06:00:00.000Z', '15:00 Tokyo')
assert.equal((t.end - t.start) / 60000, 480)
assert.equal(jobTimes({ scheduled_date: '2026-11-14', scheduled_time: '10:00' }).end.toISOString(), '2026-11-14T03:00:00.000Z', 'jobs keep 2 h')
const ics = buildIcs([job, { ...job, id: 'z', uid: 'visit-z@kuripuro', status: 'cancelled' }], { name: 'Visitas' })
assert.ok(ics.includes(`UID:visit-${V1}@kuripuro`))
assert.ok(ics.includes('STATUS:CANCELLED'))
assert.ok(ics.includes('SUMMARY:🤝 Visita · 渋谷店'))
assert.ok(buildIcs([{ id: 'j1', title: 'x', scheduled_date: '2026-11-14' }]).includes('UID:job-j1@kuripuro'), 'job UID unchanged')
const url = new URL(googleCalendarUrl(job))
assert.equal(url.searchParams.get('dates'), '20261114T060000Z/20261114T140000Z')
assert.ok(url.searchParams.get('details').includes('田中 · 03-1234-5678'))
assert.equal(url.searchParams.get('location'), '東京都渋谷区1-2-3')

console.log('seller visits + AI lead dump: ok')
