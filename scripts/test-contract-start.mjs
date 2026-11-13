// v1.0.219 · contract start date (contract_details.start_date): Ao vivo "Hoje pelos contratos"
// and the Atribuir e gerar coverage never count a contract before it starts. Pure, no DB.
import assert from 'node:assert/strict'
import { contractTargets, contractStartDate, startedOn, coverage, contractCheck } from '../src/lib/schedulePlan.js'
import { dayCoverage } from '../src/lib/dayCoverage.js'
import { coverageCounts } from '../src/lib/assignFlow.js'

const clients = [{ id: 'a', company_name: 'Artis', is_active: true }, { id: 'o', company_name: 'OTP', is_active: true }]
const contracts = [
  { id: 1, client_id: 'a', location_name: 'Artis Ginza', service_type: 'Basic Cleaning', days_of_week: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], is_active: true, contract_details: { start_date: '2026-11-16' } },
  { id: 2, client_id: 'o', location_name: 'Kodama Oimachi', service_type: 'Basic Cleaning', days_of_week: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], is_active: true, contract_details: {} },
  { id: 3, client_id: 'o', location_name: 'Kodama Kinshicho', service_type: 'Basic Cleaning', days_of_week: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], is_active: true },
]
const targets = contractTargets(contracts, clients)
assert.equal(targets[0].startDate, '2026-11-16')
assert.equal(targets[1].startDate, null)
assert.equal(targets[2].startDate, null)
assert.equal(contractStartDate({ contract_details: { start_date: '2026/11/6' } }), '2026-11-06')
assert.equal(contractStartDate({ contract_details: { start_date: 'em breve' } }), null)
assert.equal(startedOn(targets[0], '2026-11-13'), false)
assert.equal(startedOn(targets[0], '2026-11-16'), true)
assert.equal(startedOn(targets[1], '2000-01-01'), true)

// Ao vivo — 13/11 (Fri): Artis out, OTP same as before; 16/11 (Mon): Artis back.
const places = d => dayCoverage(targets, d, [], { respectStart: true }).items.map(i => i.place).sort()
assert.deepEqual(places('2026-11-13'), ['Kodama Kinshicho', 'Kodama Oimachi'])
assert.deepEqual(places('2026-11-16'), ['Artis Ginza', 'Kodama Kinshicho', 'Kodama Oimachi'])
// Without the option (Mundo Kuripuro) nothing changes.
assert.equal(dayCoverage(targets, '2026-11-13', []).items.length, 3)
// Contracts without a start date: identical result with or without the rule.
const plain = contractTargets(contracts.slice(1), clients)
assert.deepEqual(dayCoverage(plain, '2026-11-13', [], { respectStart: true }), dayCoverage(plain, '2026-11-13', []))

// Atribuir e gerar — week 9–15/11: no Artis visit is due/suggested; week 16–20: 5 Artis visits.
const wk = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from + 'T12:00:00Z') + i * 864e5).toISOString().slice(0, 10))
const before = coverage(targets, wk('2026-11-09', 7), [])
assert.equal(before.missing.filter(m => m.target.base === 'Artis Ginza').length, 0)
assert.equal(before.missing.filter(m => m.target.base === 'Kodama Oimachi').length, 5)
const mid = coverage(targets, wk('2026-11-13', 4), [])
assert.deepEqual(mid.missing.filter(m => m.target.base === 'Artis Ginza').map(m => m.date), ['2026-11-16'])
const counts = coverageCounts(targets, wk('2026-11-09', 7), [])
assert.equal(counts.programmed.total, 10)
const chk = contractCheck(targets, wk('2026-11-09', 7), [], [])
assert.equal(chk.places.some(p => p.target.base === 'Artis Ginza'), false)
const chk2 = contractCheck(targets, wk('2026-11-16', 7), [], [])
assert.equal(chk2.places.find(p => p.target.base === 'Artis Ginza').total, 5)
// Contracts without start date: generator coverage identical to before.
const sig = c => JSON.stringify({ ...c, missing: c.missing.map(m => [m.date, m.target.base]) })
assert.equal(sig(coverage(plain, wk('2026-11-09', 7), [])), sig(coverage(plain.map(({ startDate, ...t }) => t), wk('2026-11-09', 7), [])))
console.log('contract start date: ok')
