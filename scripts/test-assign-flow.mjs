// v1.0.101 · Assignment flow (pure, no database): npx vite-node scripts/test-assign-flow.mjs
import assert from 'node:assert/strict'
import { asItem, pendingReason, conflictsFor, suggestPeople, planBatch, placeInDay, coverageCounts, requiredRole, travelWindow, splitPast, isOpenOffer } from '../src/lib/assignFlow.js'
import { assignText, conflictLabel } from '../src/components/assignText.js'
import { noticesForChange } from '../src/lib/assignNotices.js'
import { availabilityIndex } from '../src/lib/scheduleGenerator.js'
import { contractTargets } from '../src/lib/schedulePlan.js'

const ana = { id: 'a', full_name: 'Ana Carolina Nakamura', is_active: true, job_role: 'cleaner' }
const bia = { id: 'b', full_name: 'Beatriz Yamamoto Souza', is_active: true, job_role: 'leader' }
const tom = { id: 't', full_name: 'Tomoko Trainee', is_active: true, job_role: 'trainee' }
const mkt = { id: 'm', full_name: 'Marketing Person', is_active: true, job_role: 'MKT' }
const people = [ana, bia, tom, mkt]
const empById = Object.fromEntries(people.map(e => [e.id, e]))
const D = '2026-11-04' // Wednesday
const availability = availabilityIndex([{ employee_id: 'b', date: D, kind: 'off', status: 'pending' }])

// Pending reasons
const job = (o) => ({ id: o.id || 'j', title: 'Ibushio — Basic Cleaning', scheduled_date: D, scheduled_time: '00:30', status: 'assigned', employee_id: null, ...o })
assert.equal(pendingReason(job({}), { empById }), 'noPerson')
assert.equal(pendingReason(job({ job_category: 'spot', spot_status: 'pending' }), { empById }), 'offerOpen')
assert.equal(pendingReason(job({ job_category: 'spot', spot_status: 'declined', status: 'cancelled' }), { empById }), 'spotDeclined')
assert.equal(pendingReason(job({ status: 'cancelled' }), { empById }), null)
assert.equal(pendingReason(job({ employee_id: 'b' }), { empById, availability }), 'personOff')
assert.equal(pendingReason(job({ employee_id: 'zz' }), { empById }), 'personGone')
assert.equal(pendingReason(job({ employee_id: 'a' }), { empById, availability }), null)
assert.equal(pendingReason(job({ status: 'completed' }), { empById }), null)
// v1.0.120 · a routine (contract) visit offered to the team is an open offer but stays routine
assert.equal(pendingReason(job({ job_category: 'regular', spot_status: 'pending' }), { empById }), 'offerOpen')
assert.equal(isOpenOffer(job({ job_category: 'regular', spot_status: 'pending' })), true)
assert.equal(isOpenOffer(job({ job_category: 'regular', spot_status: 'pending', employee_id: 'a' })), false)
assert.equal(isOpenOffer(job({ job_category: 'regular', spot_status: null })), false)

// Role + conflicts
const deep = asItem(job({ id: 'd', title: 'Horumon — Deep Clean', scheduled_time: '01:00', expected_minutes: 240 }))
assert.equal(requiredRole(deep), 'deep')
assert.deepEqual(conflictsFor(deep, tom, []).map(c => c.kind), ['roleDeep'])
assert.deepEqual(conflictsFor(deep, mkt, []).map(c => c.kind), ['role'])
assert.deepEqual(conflictsFor(deep, bia, [], { availability }).map(c => c.kind), ['off'])
const other = asItem(job({ id: 'o', title: 'Nyu Ibushio — Basic Cleaning', scheduled_time: '02:00', employee_id: 'a', area: 'Shibuya' }))
assert.equal(conflictsFor(deep, ana, [other])[0].kind, 'overlap', 'deep 01:00 (4h) overlaps 02:00')
const late = asItem(job({ id: 'l', title: 'Atomic Bar — Basic Cleaning', scheduled_time: '05:10', employee_id: 'a', area: 'Shinbashi' }))
assert.equal(conflictsFor(deep, ana, [late])[0].kind, 'travel', 'ends 05:00, next 05:10 in another area')
const ok = asItem(job({ id: 'k', scheduled_time: '06:00', employee_id: 'a' }))
assert.deepEqual(conflictsFor(deep, ana, [ok]), [])
// Without planned minutes a 1h block is used: template visits 1h apart are not clashes
const t1 = asItem(job({ id: 's1', title: 'Sugita — Floor Wax', scheduled_time: '09:00' }))
const t2 = asItem(job({ id: 's2', title: 'Building 1 — Common Area', scheduled_time: '10:30', employee_id: 'a' }))
assert.deepEqual(conflictsFor(t1, ana, [t2]), [])
const sameStart = asItem(job({ id: 'r', title: 'Nyu Ibushio — Basic Cleaning', scheduled_time: '01:00', employee_id: 'a' }))
assert.deepEqual(conflictsFor(deep, ana, [sameStart]), [], 'same start time = one route in sequence')

// Suggestion: owner first, never someone off / wrong role
const basic = asItem(job({ id: 'n', title: 'Manmosu — Basic Cleaning', scheduled_time: '03:00', area: 'Shibuya' }))
let s = suggestPeople(basic, { employees: people, availability, jobs: [], owners: { manmosu: 'a' } })
assert.equal(s[0].emp.id, 'a'); assert.ok(s[0].why.includes('owner'))
assert.ok(!s.find(x => x.emp.id === 'b').ok, 'Bia is off')
assert.ok(!s.find(x => x.emp.id === 'm').ok, 'MKT has no cleaning role')
// Same area on the route of the day beats an empty day
s = suggestPeople(basic, { employees: [ana, tom], jobs: [{ ...asItem(job({ id: 'x', scheduled_time: '00:30', area: 'Shibuya' })), employeeId: 't' }] })
assert.equal(s[0].emp.id, 't'); assert.ok(s[0].why.includes('sameArea'))

// Batch: two overlapping jobs never go to the same person
const twin1 = asItem(job({ id: 'p1', title: 'A — Basic Cleaning', scheduled_time: '00:30' }))
const twin2 = asItem(job({ id: 'p2', title: 'B — Basic Cleaning', scheduled_time: '01:00', expected_minutes: 120 }))
const plan = planBatch([twin1, twin2], { employees: [ana, tom], availability, jobs: [] })
assert.notEqual(plan.get('p1')?.emp.id, plan.get('p2')?.emp.id)
const plan2 = planBatch([twin1, twin2], { employees: [ana], jobs: [] })
assert.equal(plan2.get('p2'), null, 'nobody left → stays pending')

// Position in the day: clock order or kept manual order
const dayClock = [{ id: 'x1', scheduled_time: '00:30', sequence_order: 1 }, { id: 'x2', scheduled_time: '03:00', sequence_order: 2 }]
assert.deepEqual(placeInDay(dayClock, { id: 'new', scheduled_time: '01:30' }), [{ id: 'new', sequence_order: 2 }, { id: 'x2', sequence_order: 3 }])
const dayManual = [{ id: 'm1', scheduled_time: '03:00', sequence_order: 1001 }, { id: 'm2', scheduled_time: '00:30', sequence_order: 1002 }]
assert.deepEqual(placeInDay(dayManual, { id: 'new', scheduled_time: '02:00' }), [{ id: 'new', sequence_order: 1001 }, { id: 'm1', sequence_order: 1002 }, { id: 'm2', sequence_order: 1003 }])

// Coverage counts: programmed vs assigned are separate
const clients = [{ id: 'c1', company_name: 'On The Planet', is_active: true }]
const targets = contractTargets([{ id: 's1', client_id: 'c1', location_name: 'Ibushio', service_type: 'Basic Cleaning', days_of_week: ['Mon', 'Wed'], is_active: true }], clients)
const week = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']
const cc = coverageCounts(targets, week, [job({ scheduled_date: '2026-11-02' }), job({ id: 'z', scheduled_date: '2026-11-04', employee_id: 'a' })], { empById })
assert.deepEqual(cc.programmed, { done: 2, total: 2 })
assert.deepEqual(cc.assigned, { done: 1, total: 2 })

// Notices
const before = { id: 'j1', title: 'Ibushio — Basic Cleaning', scheduled_date: '2099-01-01', scheduled_time: '00:30:00', employee_id: 'a', status: 'assigned' }
assert.deepEqual(noticesForChange(before, { employee_id: 'b' }).map(n => [n.employee_id, n.kind]), [['a', 'unassigned'], ['b', 'assigned']])
assert.deepEqual(noticesForChange(before, { scheduled_time: '01:00' }).map(n => n.kind), ['changed'])
assert.deepEqual(noticesForChange(before, { scheduled_time: '00:30' }), [])
assert.deepEqual(noticesForChange({ ...before, scheduled_date: '2000-01-01' }, { employee_id: 'b' }), [], 'past days never notify')
assert.deepEqual(noticesForChange(null, before).map(n => n.kind), ['assigned'])

// v1.0.111 · travel window of a substitute, past days apart, full warning text
{
  const it = { key: 'x', date: '2026-10-30', time: '10:00', span: 60, area: 'Ginza', place: 'Ginza' }
  const day = [
    { key: 'p', date: '2026-10-30', time: '08:30', span: 60, area: 'Shinjuku', place: 'Shinjuku', status: 'assigned' },
    { key: 'n', date: '2026-10-30', time: '11:20', span: 60, area: 'Ginza', place: 'Ginza 2', status: 'assigned' },
  ]
  const w = travelWindow(it, day)
  assert.equal(w.before.free, 30); assert.equal(w.before.need, 30)
  assert.equal(w.after.free, 20); assert.equal(w.after.need, 10)
  assert.equal(w.tight, false)
  assert.equal(travelWindow({ ...it, time: '09:45' }, day).tight, true)
  const lines = [{ item: { date: '2026-10-29' } }, { item: { date: '2026-10-30' } }, { item: { date: '2026-10-31' } }]
  const sp = splitPast(lines, '2026-10-30')
  assert.equal(sp.past.length, 1); assert.equal(sp.upcoming.length, 2)
  const T = assignText((en, ja, pt) => pt)
  assert.equal(conflictLabel({ kind: 'travel', with: 'Shinbashi', time: '10:00' }, T), 'sem tempo para se deslocar de/até Shinbashi (10:00)')
}

console.log('assign flow: ok')
