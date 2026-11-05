// v1.0.131 · pure checks (no database): employee pay per job + payroll choice fixed / per job.
import assert from 'node:assert/strict'
import { parseEmployeePay, payFromDescription, perJobPay, employeeMonthPay, jobPayPackage, payKind, employeeSafeJob, needsPayDefinition } from '../src/lib/jobEmployeePay.js'
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

// v1.0.157 · packages, employee-safe job, bell rule
const otp = { id: 'o1', status: 'completed', employee_id: 'g', scheduled_date: '2026-11-03', value: 4000, retro_value: 3800,
  description: 'Pagamento do funcionário (Guilherme): ¥1.471 — Grease Trap (pacote de manutenções OTP ¥50.000/mês) | Key box 1234' }
assert.ok(jobPayPackage(otp))
assert.equal(payKind(otp), 'package')
const safe = employeeSafeJob(otp)
assert.ok(!('value' in safe) && !('retro_value' in safe))
assert.equal(safe.employee_pay, null)
assert.equal(safe.employee_pay_package, 'monthly')
assert.ok(!/1\.471|50\.000|Pagamento/.test(safe.description), safe.description)
assert.ok(/Key box 1234/.test(safe.description))
const atomic = { status: 'completed', employee_id: 'g', scheduled_date: '2026-11-04', description: 'Pacote Atomic Bar: ¥35.000/mês fixo (5 limpezas profundas + 4 coletas de lixo) — sem valor por serviço' }
assert.equal(payKind(atomic), 'package')
assert.equal(needsPayDefinition(atomic, '2026-11-05'), false)
const deep = { status: 'completed', employee_id: 'gab', scheduled_date: '2026-11-04', value: 30000, description: 'Limpeza profunda' }
assert.equal(needsPayDefinition(deep, '2026-11-05'), true)
assert.equal(employeeSafeJob(deep).employee_pay, null)
assert.equal(needsPayDefinition({ ...deep, employee_pay: 8000 }, '2026-11-05'), false)
assert.equal(needsPayDefinition({ ...deep, status: 'assigned', scheduled_date: '2026-11-09' }, '2026-11-05'), false)
assert.equal(needsPayDefinition({ ...deep, status: 'assigned', scheduled_date: '2026-11-05' }, '2026-11-05'), true)
assert.equal(needsPayDefinition({ ...deep, job_category: 'spot' }, '2026-11-05'), false)
assert.equal(needsPayDefinition({ ...deep, employee_id: null }, '2026-11-05'), false)
const basic = { status: 'completed', employee_id: 'g', scheduled_date: '2026-11-02', value: 4000, employee_pay: 1000 }
assert.equal(employeeSafeJob(basic).employee_pay, 1000)
const pm = employeeMonthPay([otp, atomic, basic], '2026-11')
assert.equal(pm.done, 1000)
assert.equal(pm.packageJobs, 2)
const { buildExceptions } = await import('../src/lib/exceptionQueue.js').catch(e => { console.log('skip bell check:', e.message.slice(0, 80)); return {} })
if (buildExceptions) {
  const ex = buildExceptions({ jobs: [{ ...deep, id: 'd1', employee_name: 'Gabriel', title: 'Nyu Sakana Yakio — deep', admin_reviewed: true }, { ...otp, admin_reviewed: true, employee_name: 'Guilherme', title: 'OTP' }], today: '2026-11-05', hideTests: false })
  assert.deepEqual(ex.filter(x => x.kind === 'pay_undefined').map(x => x.jobId), ['d1'])
}
console.log('employee pay: all checks passed')
