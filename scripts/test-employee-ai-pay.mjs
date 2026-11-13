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

// v1.0.214 · per-job pay comes ONLY from employee_pay: never the client value, never the store contract.
const perJob = employeeJobRows([done, next], { salary_type: 'per_job', job_bonus_rate: 50 }, '*')
assert.ok(perJob.every(noMoney))
assert.equal(perJob[0].my_pay, 'a definir', 'no employee_pay → a definir, never 50% of ¥4000')
assert.equal(perJob[1].my_pay_expected, 'a definir', 'store contract price is not pay')
const noRate = employeeJobRows([done], { salary_type: 'per_job', job_bonus_rate: 0 }, '*')
assert.equal(noRate[0].my_pay, 'a definir', 'old `|| 100` would have paid ¥4000')
const withPay = employeeJobRows([{ ...done, employee_pay: 1000 }, { ...next, employee_pay: 1500 }], { salary_type: 'per_job', job_bonus_rate: 100 }, '*')
assert.equal(withPay[0].my_pay, 1000)
assert.equal(withPay[1].my_pay_expected, 1500)
assert.ok(!('employee_pay' in withPay[0]))
const mixed = employeeJobRows([done], { salary_type: 'mixed', job_bonus_rate: 30 }, '*')
assert.equal(mixed[0].my_pay, 'a definir')
for (const r of [...perJob, ...noRate, ...withPay, ...mixed]) assert.ok(!JSON.stringify(r).includes('4000') && !JSON.stringify(r).includes('6000'))

const hourly = employeeJobRows([done, next], { salary_type: 'hourly', hourly_rate: 1200 }, 'title,status')
assert.deepEqual(hourly[0], { title: done.title, status: 'completed', my_pay: 1200 })
assert.deepEqual(hourly[1], { title: next.title, status: 'assigned' })

assert.match(payRule({ salary_type: 'fixed' }), /FIXED MONTHLY SALARY/)
assert.match(explainColumnError('clients', 'column clients.name does not exist'), /company_name/)
console.log('✓ employee AI shows only own pay; fixed salary sees no job amounts; column errors list real columns')
