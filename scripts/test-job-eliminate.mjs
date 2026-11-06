// v1.0.166 · rules of "Eliminar serviço" (pure part).
import assert from 'node:assert/strict'
import { canEliminate, jobMinutes, eliminateAudit } from '../src/lib/jobEliminate.js'

assert.equal(canEliminate({ status: 'completed' }), true)
assert.equal(canEliminate({ status: 'in_progress' }), true)
assert.equal(canEliminate({ status: 'assigned' }), true)
assert.equal(canEliminate({ status: 'cancelled' }), false)
assert.equal(canEliminate(null), false)
assert.equal(jobMinutes({ started_at: '2026-11-06T00:09:26Z', completed_at: '2026-11-06T00:09:53Z' }), 0)
assert.equal(jobMinutes({ started_at: '2026-11-05T15:30:00Z', completed_at: '2026-11-05T17:30:00Z' }), 120)
assert.equal(jobMinutes({ started_at: null }), null)
const job = { id: 'x', status: 'completed', started_at: 'a', completed_at: 'b', employee_name: 'Guilherme', title: 'Kodama Kinshicho — Deep Clean (AC Cleaning)', scheduled_date: '2026-11-06' }
const a = eliminateAudit(job, { reason: '  duplicado ', adminName: 'Alexandre', now: new Date('2026-11-06T12:00:00Z') })
assert.equal(a.reason, 'duplicado')
assert.equal(a.by, 'Alexandre')
assert.equal(a.old.status, 'completed')
assert.equal(a.new.status, 'cancelled')
assert.equal(a.at, '2026-11-06T12:00:00.000Z')
console.log('job-eliminate ok')
