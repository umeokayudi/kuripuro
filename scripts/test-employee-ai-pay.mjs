#!/usr/bin/env node
// The employee AI never sees what the client pays for a job, only the employee's own pay.
import assert from 'node:assert/strict'
import { employeeJobRows, payRule } from '../api/_employee-ai-pay.js'
import { explainColumnError } from '../api/_ai-schema.js'

const done = { id: 1, title: 'Nyu Sakana Yakio — Basic Cleaning', status: 'completed', value: 4000, retro_value: null, spot_value: 0, started_at: '2026-10-18T00:00:00Z', completed_at: '2026-10-18T01:00:00Z' }
const next = { id: 2, title: 'Ibushio — Deep Clean', status: 'assigned', value: 0, spot_value: 0 }
const spot = { id: 3, title: 'Atomic Bar — Spot', status: 'assigned', value: 9000, job_category: 'spot', spot_value: 3000 }
const noMoney = row => ['value', 'retro_value', 'spot_value'].every(k => !(k in row))

const fixed = employeeJobRows([done, next, spot], { salary_type: 'fixed', fixed_salary: 200000 })
assert.ok(fixed.every(noMoney))
assert.equal(fixed[0].my_pay, undefined)
assert.equal(fixed[1].my_pay_expected, undefined)
assert.equal(fixed[2].my_pay_expected, 3000, 'spot extra is the employee\'s own pay')

const perJob = employeeJobRows([done, next], { salary_type: 'per_job', job_bonus_rate: 50 }, '*', [{ location_name: 'Ibushio', price_per_visit: 6000 }])
assert.ok(perJob.every(noMoney))
assert.equal(perJob[0].my_pay, 2000)
assert.equal(perJob[1].my_pay_expected, 3000, 'price comes from the store contract')

const hourly = employeeJobRows([done, next], { salary_type: 'hourly', hourly_rate: 1200 }, 'title,status')
assert.deepEqual(hourly[0], { title: done.title, status: 'completed', my_pay: 1200 })
assert.deepEqual(hourly[1], { title: next.title, status: 'assigned' })

assert.match(payRule({ salary_type: 'fixed' }), /FIXED MONTHLY SALARY/)
assert.match(explainColumnError('clients', 'column clients.name does not exist'), /company_name/)
console.log('✓ employee AI shows only own pay; fixed salary sees no job amounts; column errors list real columns')
