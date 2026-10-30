#!/usr/bin/env node
// v1.0.102 · payroll close rules (pure, no database).
import { computeBase, payrollState, isPayrollActive } from '../src/lib/salaryClose.js'
import { payrollMonth, canCloseMonth } from '../src/lib/salaryCalc.js'

const assert = (c, m) => { if (!c) throw new Error(m) }

// Fixed salary never zeroes: no jobs, typed with separators, stale contract end.
assert(computeBase({ salary_type: 'fixed', fixed_salary: 212000 }, [], '2026-10') === 212000, 'fixed without jobs')
assert(computeBase({ salary_type: 'fixed', fixed_salary: '212,000' }, [], '2026-10') === 212000, 'fixed typed with comma')
assert(computeBase({ salary_type: 'fixed', fixed_salary: 212000, contract_end: '2026-03-31', is_active: true }, [], '2026-10') === 212000, 'stale contract end on active person')
assert(computeBase({ salary_type: 'fixed', fixed_salary: 212000, contract_end: '2026-03-31', is_active: false }, [], '2026-10') === 0, 'inactive person after contract end')
assert(computeBase({ salary_type: null, fixed_salary: 212000 }, [], '2026-10') === 212000, 'no salary type = fixed')
const job = { status: 'completed', started_at: '2026-10-05T01:00:00Z', completed_at: '2026-10-05T03:00:00Z', value: 10000 }
assert(computeBase({ salary_type: 'mixed', fixed_salary: 100000, hourly_rate: 1000, job_bonus_rate: 10 }, [job], '2026-10') === 100000 + 2000 + 1000, 'mixed = fixed + hours + bonus')

// Paid only with the payslip confirmed.
assert(payrollState(null, null) === 'none', 'none')
assert(payrollState({ status: 'awaiting_confirmation' }, { status: 'scheduled' }) === 'waiting', 'waiting')
assert(payrollState({ status: 'awaiting_confirmation' }, { status: 'paid' }) === 'paid_unconfirmed', 'paid without confirmation is flagged')
assert(payrollState({ status: 'finalized', employee_confirmed_at: 'x' }, { status: 'paid' }) === 'paid', 'paid')
assert(payrollState({ status: 'finalized', employee_confirmed_at: 'x' }, { status: 'scheduled' }) === 'finalized', 'finalized')

// Everyone not switched off is in the close.
assert(isPayrollActive({ is_active: null }) && isPayrollActive({}) && isPayrollActive({ is_active: true }) && !isPayrollActive({ is_active: false }), 'active rule')

// v1.0.108 · one calculation per person/month: base + jobs − deductions = net.
{
  const emp = { salary_type: 'fixed', fixed_salary: 212000 }
  const jobs = [
    { status: 'completed', scheduled_date: '2026-10-03', job_category: 'spot', spot_value: 5000 },
    { status: 'completed', scheduled_date: '2026-11-01', job_category: 'spot', spot_value: 9000 }, // other month
    { status: 'scheduled', scheduled_date: '2026-10-09', job_category: 'spot', spot_value: 7000 }, // not done
  ]
  const lines = [
    { is_deduction: true, status: 'scheduled', amount: 1091, period: '2026-10' },
    { is_deduction: true, status: 'cancelled', amount: 3000, period: '2026-10', description: '🤖 A revisar · x' }, // suggestion, not counted
    { is_deduction: true, status: 'scheduled', amount: 500, payment_date: '2026-10-20' }, // no period → month of the date
    { is_deduction: true, status: 'scheduled', amount: 800, period: '2026-09' }, // other month
    { payment_type: 'salary', status: 'scheduled', amount: 0, period: '2026-10' },
  ]
  const r = payrollMonth({ emp, jobs, lines, month: '2026-10' })
  assert(r.base === 212000, `fixed base never zeroes (${r.base})`)
  assert(r.jobsPay === 5000, `spot extras of the month (${r.jobsPay})`)
  assert(r.deductions === 1591, `deductions of the month, suggestions out (${r.deductions})`)
  assert(r.net === 212000 + 5000 - 1591, `net (${r.net})`)
  assert(r.salaryLine && r.jobs === 1, 'salary line + jobs count')
}
assert(!canCloseMonth('2026-10', '2026-10-31') && canCloseMonth('2026-10', '2026-11-01') && canCloseMonth('2026-09', '2026-10-30'), 'month closes only from the 1st of the next month')

console.log('payroll close: ok')
