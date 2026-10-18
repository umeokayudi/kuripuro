// Quick round (Start + tick restaurants) must exist only for Alexandre's employee id.
import assert from 'node:assert/strict'
import { quickRoundEnabledFor, quickRoundRows, segmentStart, ALEXANDRE_EMPLOYEE_ID } from '../src/lib/quickRound.js'

assert.equal(quickRoundEnabledFor({ id: ALEXANDRE_EMPLOYEE_ID, role: 'employee' }), true)
assert.equal(quickRoundEnabledFor({ id: 'other', role: 'employee', name: 'Alexandre Umeoka' }), false)
assert.equal(quickRoundEnabledFor({ id: ALEXANDRE_EMPLOYEE_ID, role: 'admin' }), false)
assert.equal(quickRoundEnabledFor(null), false)

const rows = quickRoundRows([], ALEXANDRE_EMPLOYEE_ID)
assert.ok(rows.length > 5, 'lists the restaurant catalog')
assert.ok(rows.every(r => !r.scheduled && r.location))

const first = rows[0]
const job = { id: 'j1', title: first.name, employee_id: ALEXANDRE_EMPLOYEE_ID, status: 'assigned', scheduled_date: '2026-10-18' }
const withJob = quickRoundRows([job], ALEXANDRE_EMPLOYEE_ID)
assert.equal(withJob[0].key, 'job:j1')
assert.ok(!withJob.some(r => r.key === `loc:${first.name}`), 'own job replaces the catalog row')
assert.equal(withJob.length, rows.length)

assert.equal(segmentStart({ startedAt: 'A', done: [] }), 'A')
assert.equal(segmentStart({ startedAt: 'A', done: [{ at: 'B' }, { at: 'C' }] }), 'C')
console.log('✅ quick round only for Alexandre, rows and segments')
