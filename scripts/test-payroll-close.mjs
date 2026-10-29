#!/usr/bin/env node
// v1.0.102 · payroll close rules (pure, no database).
import { computeBase, payrollState, isPayrollActive } from '../src/lib/salaryClose.js'

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

console.log('payroll close: ok')
