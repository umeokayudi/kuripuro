// v1.0.104 · Deep & Spot coverage (pure, no database): npx vite-node scripts/test-deep-coverage.mjs
import assert from 'node:assert/strict'
import {
  deepTargets, expectedSlots, deepCoverage, deepStatusByPlace, jobCountsFor, isDeepWork, deepSpotType,
  parsePeriodicity, spotOrigin, spotOfferState, lineState, visitsInMonth,
} from '../src/lib/deepCoverage.js'

const OTP = { id: 'otp', company_name: 'On The Planet', is_active: true }
const contract = (o) => ({ id: o.location_name, client_id: 'otp', is_active: true, days_of_week: ['Mon'], visits_per_month: 0, price_per_visit: 5000, ...o })
const contracts = [
  contract({ location_name: 'Ibushio — Basic Cleaning', service_type: 'Basic Cleaning', days_of_week: ['Mon', 'Tue'] }),
  contract({ location_name: 'Ibushio', service_type: 'Deep Cleaning (Grease Trap 2x, AC)', days_of_week: ['Sun'], visits_per_month: 2 }),
  contract({ location_name: 'Ibushio - Deep Clean', service_type: 'Range Hood + AC + Grating + Grease Trap x2', visits_per_month: 4 }),
  contract({ location_name: 'Ibushio — Grease Trap', service_type: 'Grease Trap', days_of_week: ['Sun'], visits_per_month: 2 }),
  contract({ location_name: 'Ibushio — Stove', service_type: 'Stove', days_of_week: ['Sun'] }), // no visits → catalog? none → 1×
  contract({ location_name: 'Tooda — Floor Wax', service_type: 'Floor Wax', days_of_week: ['Sat'] }), // catalog 3×/year
  contract({ location_name: 'OTP — Grease Trap', service_type: 'Grease Trap', days_of_week: [] }), // price list row
]

assert.deepEqual(parsePeriodicity('2x por mês'), { perMonth: 2 })
assert.deepEqual(parsePeriodicity('3x por ano'), { perYear: 3 })
assert.equal(parsePeriodicity('quando necessário'), null)

const targets = deepTargets(contracts, [OTP])
const byKey = Object.fromEntries(targets.map(t => [t.key, t]))
assert.ok(!byKey['otp|grease trap'], 'price-list rows without days and visits are skipped')
assert.ok(!targets.some(t => t.service === 'Basic Cleaning'), 'basic cleaning is not a deep target')
assert.equal(byKey['ibushio|deep'].perMonth, 4, 'two deep contracts merge, the most frequent wins')
assert.deepEqual(byKey['ibushio|deep'].days, [1], 'with its weekdays')
assert.equal(byKey['ibushio|grease trap'].perMonth, 2)
assert.equal(byKey['ibushio|stove'].perMonth, 1)
assert.equal(byKey['tooda|floor wax'].perYear, 3)
assert.equal(visitsInMonth(byKey['tooda|floor wax'], '2026-01'), 1)
assert.equal(visitsInMonth(byKey['tooda|floor wax'], '2026-02'), 0)

// Expected days: Grease trap 2×/month on Sundays of Nov 2026 (1, 8, 15, 22, 29) → 1st and 3rd.
assert.deepEqual(expectedSlots(byKey['ibushio|grease trap'], '2026-11-01', '2026-11-30'), ['2026-11-01', '2026-11-15'])
// Deep 4×/month on Mondays (2, 9, 16, 23, 30) → four of the five.
assert.equal(expectedSlots(byKey['ibushio|deep'], '2026-11-01', '2026-11-30').length, 4)
// A week only holds the slots that fall in it.
assert.deepEqual(expectedSlots(byKey['ibushio|grease trap'], '2026-11-09', '2026-11-15'), ['2026-11-15'])

// Which job counts for what.
const J = (o) => ({ id: o.title + o.scheduled_date, status: 'assigned', job_category: 'regular', employee_id: 'a', ...o })
assert.ok(jobCountsFor(J({ title: 'Ibushio — Deep Clean (Grease Trap)', scheduled_date: '2026-11-02' }), byKey['ibushio|deep']))
assert.ok(jobCountsFor(J({ title: 'Ibushio — Deep Clean (Grease Trap)', scheduled_date: '2026-11-02' }), byKey['ibushio|grease trap']))
assert.ok(jobCountsFor(J({ title: 'Ibushio — Grease Trap', scheduled_date: '2026-11-01' }), byKey['ibushio|grease trap']))
assert.ok(!jobCountsFor(J({ title: 'Ibushio — Grease Trap', scheduled_date: '2026-11-01' }), byKey['ibushio|deep']), 'an item job is not a full deep clean')
assert.ok(!jobCountsFor(J({ title: 'Ibushio — Basic Cleaning', scheduled_date: '2026-11-02' }), byKey['ibushio|deep']))
assert.ok(jobCountsFor(J({ title: 'Ibushio — Fogão', scheduled_date: '2026-11-01' }), byKey['ibushio|stove']), 'PT name counts')
assert.ok(!jobCountsFor(J({ title: 'Ibushio — Deep Clean', job_category: 'spot', scheduled_date: '2026-11-02' }), byKey['ibushio|deep']), 'spots are separate')
assert.ok(isDeepWork(J({ title: 'Ibushio — Grill Cleaning' })))
assert.ok(!isDeepWork(J({ title: 'Ibushio — Basic Cleaning' })))
assert.equal(deepSpotType(J({ title: 'X — Deep Clean', job_category: 'spot' })), 'spot')
assert.equal(deepSpotType(J({ title: 'X — Basic Cleaning' })), null)

// Coverage for November with today = Nov 10.
const jobs = [
  J({ title: 'Ibushio — Deep Clean', scheduled_date: '2026-11-02', status: 'completed' }),
  J({ title: 'Ibushio — Deep Clean', scheduled_date: '2026-11-09', status: 'assigned' }), // past, not done
  J({ title: 'Ibushio — Deep Clean', scheduled_date: '2026-11-16', employee_id: null }),
  J({ title: 'Ibushio — Grease Trap', scheduled_date: '2026-11-01', status: 'completed' }),
  J({ title: 'Ibushio — Grease Trap', scheduled_date: '2026-11-15', status: 'cancelled' }),
]
const cov = deepCoverage(targets, jobs, { from: '2026-11-01', to: '2026-11-30', today: '2026-11-10' })
const ib = cov.places.find(p => p.base === 'Ibushio')
const deepRow = ib.items.find(i => i.target.item === 'deep')
assert.deepEqual([deepRow.expected, deepRow.scheduled, deepRow.done], [4, 3, 1])
const gtRow = ib.items.find(i => i.target.item === 'grease trap')
assert.deepEqual([gtRow.expected, gtRow.scheduled, gtRow.done], [2, 1, 1], 'cancelled jobs do not count')
assert.equal(ib.ok, false)
const reasons = cov.missing.filter(m => m.target.base === 'Ibushio').map(m => `${m.target.item}:${m.reason}:${m.date}`)
assert.ok(reasons.includes('deep:notDone:2026-11-09'), 'past job not done is missing')
assert.ok(reasons.some(r => r.startsWith('deep:notCreated:')), 'one deep not created yet')
assert.ok(reasons.includes('grease trap:notCreated:2026-11-15'), 'the cancelled one has to be scheduled again')
assert.ok(reasons.includes('stove:passed:2026-11-01'), 'stove day passed without a job')
assert.equal(cov.missing[0].reason, 'notDone', 'not-done jobs first')
assert.equal(cov.totals.missing, cov.missing.length)

// Last done / next expected per restaurant.
const st = deepStatusByPlace(targets, jobs, { today: '2026-11-10' })
assert.equal(st.ibushio.lastDone.scheduled_date, '2026-11-02')
assert.equal(st.ibushio.nextScheduled.scheduled_date, '2026-11-16')
assert.ok(st.ibushio.nextExpected >= '2026-11-10')

// Spot origin + offer state + line state.
assert.equal(spotOrigin({}, { contract_details: { quote_ref: 'req:123' } }), 'client')
assert.equal(spotOrigin({}, { contract_details: { quote_ref: 'mit:1' } }), 'internal')
assert.equal(spotOrigin({}, null), 'internal')
assert.equal(spotOfferState({ status: 'assigned', employee_id: null, spot_status: 'pending' }), 'open')
assert.equal(spotOfferState({ status: 'assigned', employee_id: 'a', spot_status: 'pending' }), 'waiting')
assert.equal(spotOfferState({ status: 'assigned', employee_id: 'a', spot_status: 'accepted' }), 'accepted')
assert.equal(spotOfferState({ status: 'cancelled', employee_id: 'a', spot_status: 'declined' }), 'declined')
assert.equal(spotOfferState({ status: 'completed', employee_id: 'a' }), 'done')
assert.equal(lineState({ status: 'assigned', employee_id: null, scheduled_date: '2026-11-20' }, '2026-11-10'), 'scheduled')
assert.equal(lineState({ status: 'assigned', employee_id: 'a', scheduled_date: '2026-11-20' }, '2026-11-10'), 'assigned')
assert.equal(lineState({ status: 'assigned', employee_id: 'a', scheduled_date: '2026-11-02' }, '2026-11-10'), 'missing')

console.log('✅ deep coverage: targets, expected days, missing list, last/next per restaurant, spot states')
