// v1.0.209 · Folha: October 2026 must never pay the client's price; the report edits drive the payslip.
import assert from 'node:assert/strict'
import { payrollMonth } from '../src/lib/salaryCalc.js'
import { reportRows, fillEmpty, previewMonth, jobKind } from '../src/lib/payrollReport.js'
import { summarizeRange } from '../src/lib/earnings.js'

const gabriel = { id: 'g', full_name: 'Gabriel', salary_type: 'per_job', fixed_salary: 0, hourly_rate: 0, job_bonus_rate: 0, is_active: true }
const job = (id, d, title, value, extra = {}) => ({ id, status: 'completed', scheduled_date: d, title, value, employee_pay: null, job_category: 'regular', ...extra })
const oct = [
  job('1', '2026-10-26', 'Atomic Bar — Basic Cleaning', 6000),
  job('2', '2026-10-27', 'Kodama Shinbashi — Basic Cleaning', 1000),
  job('3', '2026-10-28', 'Tooda — Basic Cleaning', 3846),
  job('4', '2026-10-29', 'Kodama Kinshicho — Deep Clean (Grease Trap)', 1000),
]

// before: 100% of the client price (¥11.846). Now: nothing defined → ¥0, never the client price.
assert.equal(payrollMonth({ emp: gabriel, jobs: oct, month: '2026-10' }).net, 0, 'no client price as salary')
// an explicit % on the record still works
assert.equal(payrollMonth({ emp: { ...gabriel, job_bonus_rate: 50 }, jobs: oct, month: '2026-10' }).net, Math.round(6000 / 2) + 500 + 1923 + 500)

// report: fill the empty ones (Basic ¥1.000 / Deep ¥1.500) and edit one line
let rows = reportRows(oct)
assert.equal(rows.length, 4)
assert.equal(jobKind(oct[3]), 'deep')
let edits = fillEmpty(rows, {}, { basic: '1000', deep: '1500' })
edits['1'] = '¥2.000'
rows = reportRows(oct, edits)
assert.deepEqual(rows.map(r => r.pay), [2000, 1000, 1000, 1500])
assert.ok(rows.every(r => r.dirty))

// extras and deductions added in Folha are inside the payslip
const lines = [
  { id: 'x', period: '2026-10', payment_type: 'extra', is_deduction: false, status: 'scheduled', amount: 500, description: 'Bônus' },
  { id: 'y', period: '2026-10', payment_type: 'extra', is_deduction: false, status: 'cancelled', amount: 9999 },
  { id: 'd', period: '2026-10', payment_type: 'deduction', is_deduction: true, status: 'scheduled', amount: 300 },
  { id: 's', period: '2026-10', payment_type: 'salary', is_deduction: false, status: 'scheduled', amount: 0 },
]
const p = previewMonth({ emp: gabriel, jobs: oct, lines, month: '2026-10', edits })
assert.equal(p.base, 5500)
assert.equal(p.extras, 500)
assert.equal(p.net, 5500 + 500 - 300)

// Meu salário (month) reads the same number once values are saved on the jobs
const saved = oct.map(j => ({ ...j, employee_pay: Number(String(edits[j.id]).replace(/[^0-9]/g, '')) }))
const s = summarizeRange({ emp: gabriel, jobs: saved, payroll: { jobs: saved, lines }, from: '2026-10-01', to: '2026-10-31', today: '2026-11-10' })
assert.equal(s.net, 5700)
assert.equal(s.deductionRows.length, 1, 'extras never shown as deductions')

// a "✕ não pagar" line (¥0) leaves the sum
edits = { ...edits, 3: '0' }
assert.equal(previewMonth({ emp: gabriel, jobs: oct, lines: [], month: '2026-10', edits }).net, 4500)

// invalid value is flagged, not saved as a number
assert.equal(reportRows(oct, { 1: 'abc' })[0].bad, true)

console.log('payroll report: ok')
