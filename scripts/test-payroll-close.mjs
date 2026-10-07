#!/usr/bin/env node
import { readFileSync } from 'fs'
import {
  monthLastDate,
  completedJobsInMonth,
  calcPeriodSalary,
  payslipAdvanceLines,
  payslipNetPay,
} from '../src/lib/salaryCalc.js'
import { buildCloseRow, periodsFromPayroll } from '../src/lib/payrollClose.js'
import { getPeriodDates } from '../src/lib/salaryPeriod.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function testMonthLastDate() {
  assert(monthLastDate('2026-09') === '2026-09-30', monthLastDate('2026-09'))
  assert(monthLastDate('2026-02') === '2026-02-28', 'feb 2026')
  assert(monthLastDate('2024-02') === '2024-02-29', 'leap')
  assert(monthLastDate('2026-10') === '2026-10-31', 'oct')
  assert(monthLastDate('2026-09') !== '2026-09-31', 'never day 31 in september')
}

function testSeptemberCloseFromOctober() {
  const jobs = [
    { status: 'completed', scheduled_date: '2026-09-30', scheduled_time: '10:00', value: 5000, retro_value: 5000 },
    { status: 'completed', scheduled_date: '2026-10-01', scheduled_time: '10:00', value: 9000, retro_value: 9000 },
    { status: 'assigned', scheduled_date: '2026-09-15', scheduled_time: '10:00', value: 1000 },
  ]
  const inSep = completedJobsInMonth(jobs, '2026-09', '2026-10-07')
  assert(inSep.length === 1 && inSep[0].scheduled_date === '2026-09-30', `sep jobs ${inSep.length}`)
  const emp = { id: 'e1', full_name: 'Aoki', salary_type: 'per_job', job_bonus_rate: 100 }
  const calc = calcPeriodSalary(emp, jobs, [], '2026-09', monthLastDate('2026-09'))
  assert(calc.jobs === 1, 'one september job')
  assert(calc.base === 5000, `base ${calc.base}`)
}

function testAdvanceLines() {
  const rows = [
    { id: 1, payment_type: 'advance', period: '2026-09', payment_date: '2026-09-05', amount: 10000, description: 'Week 1' },
    { id: 2, payment_type: 'advance', period: '2026-09', payment_date: '2026-09-12', amount: 8000, description: 'Week 2' },
    { id: 1, payment_type: 'advance', period: '2026-09', payment_date: '2026-09-05', amount: 10000, description: 'Week 1' },
    { id: 3, payment_type: 'salary', period: '2026-09', payment_date: '2026-10-15', amount: 200000 },
    { id: 4, payment_type: 'advance', period: '2026-10', payment_date: '2026-10-03', amount: 5000 },
  ]
  const slip = payslipAdvanceLines(rows, '2026-09')
  assert(slip.lines.length === 2, `lines ${slip.lines.length}`)
  assert(slip.lines[0].date === '2026-09-05' && slip.lines[0].amount === 10000, 'first date')
  assert(slip.lines[1].date === '2026-09-12' && slip.lines[1].amount === 8000, 'second date')
  assert(slip.total === 18000, `total ${slip.total}`)
}

function testCloseDeductsAdvances() {
  const emp = { id: 'e1', full_name: 'Aoki', salary_type: 'fixed', fixed_salary: 220000, monthly_work_days: 22 }
  const jobs = [
    { status: 'completed', scheduled_date: '2026-09-01', scheduled_time: '10:00' },
    { status: 'completed', scheduled_date: '2026-09-02', scheduled_time: '10:00' },
  ]
  const pays = [
    { payment_type: 'advance', period: '2026-09', payment_date: '2026-09-08', amount: 20000 },
    { is_deduction: true, payment_type: 'deduction', period: '2026-09', amount: 1000, description: 'uniform' },
  ]
  const dates = getPeriodDates('2026-09')
  const built = buildCloseRow(emp, jobs, pays, '2026-09', { payDate: dates.payDate, salaryDesc: 'Salary Sep 2026' })
  assert(built.advances.lines.length === 1, 'one advance')
  assert(built.advances.lines[0].date === '2026-09-08', 'advance date on close')
  assert(built.payroll.deductions === 21000, `deds ${built.payroll.deductions}`)
  assert(built.payroll.net_total === Math.max(0, built.calc.total - 21000), 'net')
  assert(built.salaryPayment.payment_type === 'salary', 'salary row')
  assert(built.salaryPayment.payment_date === '2026-10-15', built.salaryPayment.payment_date)
}

function testPayslipNet() {
  const salaryData = { total: 200000 }
  const payments = [{ payment_type: 'salary', amount: 182000, is_deduction: false }]
  assert(payslipNetPay(salaryData, payments, 18000) === 182000, 'prefer scheduled salary')
  assert(payslipNetPay(salaryData, [], 18000) === 182000, 'fallback earnings minus advances')
}

function testPeriodsFromPayroll() {
  const list = periodsFromPayroll([
    { period: '2026-09', status: 'pending' },
    { period: '2026-08', status: 'paid' },
  ])
  assert(list[0].period === '2026-09', 'newest first')
}

function testSourceGuards() {
  const close = readFileSync(new URL('../src/pages/SalaryPeriods.jsx', import.meta.url), 'utf8')
  assert(close.includes('closePayrollMonth'), 'uses close helper')
  assert(!close.includes("period + '-31'"), 'no fake day 31 in close UI')
  const lib = readFileSync(new URL('../src/lib/payrollClose.js', import.meta.url), 'utf8')
  assert(lib.includes('monthLastDate'), 'close uses last real day')
  assert(lib.includes("'payroll'"), 'writes payroll')
  const pdf = readFileSync(new URL('../src/lib/generatePDF.js', import.meta.url), 'utf8')
  assert(pdf.includes('payslipAdvanceLines'), 'payslip lists advances')
  assert(!pdf.includes('Jun (\\d+)'), 'no jun/jul regex')
  const ai = readFileSync(new URL('../api/admin-ai.js', import.meta.url), 'utf8')
  assert(ai.includes('record_salary_advance'), 'AI advance tool')
  assert(ai.includes('needs_confirmation'), 'AI confirms first')
  const salary = readFileSync(new URL('../src/pages/Salary.jsx', import.meta.url), 'utf8')
  assert(salary.includes('payment_date'), 'salary UI stores date')
  assert(salary.includes('monthLastDate'), 'salary jobs use real month end')
}

async function main() {
  console.log('=== Payroll close / payslip advances ===\n')
  testMonthLastDate()
  console.log('✅ monthLastDate')
  testSeptemberCloseFromOctober()
  console.log('✅ september close from october')
  testAdvanceLines()
  console.log('✅ payslip advance dates')
  testCloseDeductsAdvances()
  console.log('✅ close deducts advances')
  testPayslipNet()
  console.log('✅ payslip net')
  testPeriodsFromPayroll()
  console.log('✅ payroll periods')
  testSourceGuards()
  console.log('✅ source guards')
  console.log('\n✅ All payroll close tests passed')
}

main().catch(err => {
  console.error('\n❌', err.message)
  process.exit(1)
})
