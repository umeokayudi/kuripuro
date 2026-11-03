// v1.0.131 · pure checks (no database): employee pay per job + payroll choice fixed / per job.
import assert from 'node:assert/strict'
import { parseEmployeePay, payFromDescription, perJobPay, employeeMonthPay } from '../src/lib/jobEmployeePay.js'
import { payrollMonth } from '../src/lib/salaryCalc.js'

assert.equal(parseEmployeePay(''), null)
assert.equal(parseEmployeePay('1000'), 1000)
assert.equal(parseEmployeePay('1.000'), 1000)
assert.equal(parseEmployeePay('¥3,125'), 3125)
assert.equal(parseEmployeePay(0), 0)
assert.throws(() => parseEmployeePay('-5'), /negative/)
assert.throws(() => parseEmployeePay('12.5'), /invalid/)
assert.equal(payFromDescription('x\nPagamento do funcionário (Gabriel): ¥3.125 — Deep OTP'), 3125)
assert.equal(payFromDescription('Pagamento do funcionário (Gabriel): ¥6.000 — polidora'), 6000)
assert.equal(payFromDescription('nada'), null)

// Gabriel's November plan: 24 × 1.000 + 4 × 6.000 + 8 × 3.125 = 73.000
const nov = [...Array(24).fill(1000), ...Array(4).fill(6000), ...Array(8).fill(3125)]
  .map((p, i) => ({ id: String(i), status: 'completed', scheduled_date: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}`, title: `Loja ${i} — Basic Cleaning`, value: 4231, employee_pay: p }))
assert.equal(perJobPay(nov).total, 73000)
// a completed job without pay is "a definir", not ¥0, and stays out of the sum
const withEmpty = [...nov, { id: 'x', status: 'completed', scheduled_date: '2026-11-02', title: 'Kodama — Basic', value: 4000, employee_pay: null }]
assert.equal(perJobPay(withEmpty).undefinedCount, 1)
assert.equal(perJobPay(withEmpty).total, 73000)
// only completed jobs count
assert.equal(perJobPay([{ status: 'assigned', employee_pay: 1000 }]).total, 0)

const gabriel = { salary_type: 'per_job', fixed_salary: 0, job_bonus_rate: 100 }
const noChoice = payrollMonth({ emp: gabriel, jobs: nov, month: '2026-11' })
// v1.0.133 · no fixed salary + jobs with pay → the sum per job counts without blocking the close
assert.equal(noChoice.needsBasis, false)
assert.equal(noChoice.base, 73000)
assert.equal(noChoice.autoBasis, 'per_job')
// fixed on the record wins by default, even for a per_job type and with priced jobs
const guiFixed = payrollMonth({ emp: { salary_type: 'per_job', fixed_salary: 212000, is_active: true }, jobs: nov, month: '2026-11' })
assert.equal(guiFixed.base, 212000)
assert.equal(guiFixed.bothOptions, true)
assert.equal(payrollMonth({ emp: { salary_type: 'per_job', fixed_salary: 212000, is_active: true }, jobs: [], month: '2026-10' }).base, 212000)
const perJob = payrollMonth({ emp: gabriel, jobs: nov, month: '2026-11', basis: { basis: 'per_job' } })
assert.equal(perJob.base, 73000)
assert.equal(perJob.needsBasis, false)

// fixed salary is never zeroed for lack of jobs and never added to the per-job sum
const fixedEmp = { salary_type: 'fixed', fixed_salary: 212000, is_active: true }
const f0 = payrollMonth({ emp: fixedEmp, jobs: [], month: '2026-11' })
assert.equal(f0.base, 212000)
const fChoice = payrollMonth({ emp: fixedEmp, jobs: nov, month: '2026-11', basis: 'fixed' })
assert.equal(fChoice.base, 212000)
assert.equal(fChoice.fixedTotal, 212000)
assert.equal(fChoice.perJob.total, 73000)
const pChoice = payrollMonth({ emp: fixedEmp, jobs: nov, month: '2026-11', basis: 'per_job' })
assert.equal(pChoice.base, 73000)
// the contract value is never used as employee pay
assert.ok(nov.every(j => j.value === 4231))

const m = employeeMonthPay([...nov, { status: 'assigned', scheduled_date: '2026-11-30', employee_pay: 6000 }, { status: 'assigned', scheduled_date: '2026-11-30', employee_pay: null }], '2026-11')
assert.equal(m.done, 73000)
assert.equal(m.planned, 79000)
assert.equal(m.undefinedCount, 1)
console.log('employee pay: all checks passed')
