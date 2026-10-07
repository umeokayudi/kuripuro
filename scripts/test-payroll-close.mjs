#!/usr/bin/env node
import { readFileSync } from 'fs'
import {
  monthLastDate,
  completedJobsInMonth,
  calcPeriodSalary,
  payslipAdvanceLines,
  payslipNetPay,
} from '../src/lib/salaryCalc.js'
import {
  buildCloseRow,
  buildSalaryPayment,
  periodsFromPayroll,
  previousPeriod,
  closePayrollMonth,
  payClosedPayroll,
} from '../src/lib/payrollClose.js'

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
  const built = buildCloseRow(emp, jobs, pays, '2026-09')
  assert(built.salaryPayment === undefined, 'close is not a payment')
  assert(built.payroll.status === 'pending', 'closed unpaid')
  assert(built.advances.lines.length === 1, 'one advance')
  assert(built.advances.lines[0].date === '2026-09-08', 'advance date on close')
  assert(built.payroll.deductions === 21000, `deds ${built.payroll.deductions}`)
  assert(built.payroll.net_total === Math.max(0, built.calc.total - 21000), 'net')
  const pay = buildSalaryPayment(built.payroll, { payDate: '2026-10-15', salaryDesc: 'Salary Sep 2026' })
  assert(pay.payment_type === 'salary', 'salary row is separate')
  assert(pay.amount === built.payroll.net_total, 'pay uses closed net')
  assert(pay.payment_date === '2026-10-15', pay.payment_date)
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
  assert(list[0].status === 'closed', `sep ${list[0].status}`)
  assert(list[1].status === 'paid', 'aug paid')
  assert(previousPeriod('2026-10') === '2026-09', 'prev oct')
}

function memorySb(store) {
  const writes = []
  const from = (table) => {
    const filters = {}
    let limitN = null
    const self = {
      select() { return self },
      eq(k, v) { filters[k] = v; return self },
      gte(k, v) { filters[k + '__gte'] = v; return self },
      lte(k, v) { filters[k + '__lte'] = v; return self },
      limit(n) { limitN = n; return self },
      then(resolve) {
        let rows = store[table] || []
        rows = rows.filter(row => {
          for (const [k, v] of Object.entries(filters)) {
            if (k.endsWith('__gte')) { if (String(row[k.slice(0, -5)]) < v) return false }
            else if (k.endsWith('__lte')) { if (String(row[k.slice(0, -5)]) > v) return false }
            else if (String(row[k]) !== String(v)) return false
          }
          return true
        })
        if (limitN) rows = rows.slice(0, limitN)
        return resolve({ data: rows, error: null })
      },
      async insert(row) {
        writes.push({ table, op: 'insert', row })
        const rec = { id: `${table}-${(store[table] || []).length + 1}`, ...row }
        store[table] = [...(store[table] || []), rec]
        return { data: rec, error: null }
      },
      update(row) {
        return {
          async eq(k, v) {
            writes.push({ table, op: 'update', row, k, v })
            store[table] = (store[table] || []).map(r => String(r[k]) === String(v) ? { ...r, ...row } : r)
            return { error: null }
          },
        }
      },
      async upsert(row) {
        writes.push({ table, op: 'upsert', row })
        return { error: null }
      },
    }
    return self
  }
  return { from, writes, store }
}

async function testCloseVsPayMemory() {
  const emp = { id: 'e1', full_name: 'Aoki', salary_type: 'per_job', job_bonus_rate: 100, is_active: true }
  const sb = memorySb({
    employees: [emp],
    jobs: [{ employee_id: 'e1', status: 'completed', scheduled_date: '2026-09-10', value: 50000, retro_value: 50000 }],
    salary_payments: [{ employee_id: 'e1', period: '2026-09', payment_type: 'advance', payment_date: '2026-09-08', amount: 10000 }],
    payroll: [],
  })
  const closed = await closePayrollMonth(sb, '2026-09')
  assert(closed.wrotePayments === false, 'close flag')
  assert(closed.closed.length === 1, 'one close')
  assert(closed.closed[0].payroll.net_total === 40000, `net ${closed.closed[0].payroll.net_total}`)
  assert(!sb.writes.some(w => w.table === 'salary_payments'), 'close did not write salary_payments')
  assert(sb.store.payroll.length === 1, 'payroll written')

  const paid = await payClosedPayroll(sb, '2026-09', { salaryDesc: 'Salary Sep 2026' })
  assert(paid.wroteClose === false, 'pay does not close')
  assert(paid.paid.length === 1, 'one salary payment')
  assert(sb.store.salary_payments.some(r => r.payment_type === 'salary' && r.amount === 40000), 'salary payment created')
  assert(sb.store.payroll[0].status === 'paid', 'payroll marked paid')
}

function testSourceGuards() {
  const close = readFileSync(new URL('../src/pages/SalaryPeriods.jsx', import.meta.url), 'utf8')
  assert(close.includes('closePayrollMonth'), 'uses close helper')
  assert(close.includes('payClosedPayroll'), 'pay is separate in UI')
  assert(!close.includes("period + '-31'"), 'no fake day 31 in close UI')
  const lib = readFileSync(new URL('../src/lib/payrollClose.js', import.meta.url), 'utf8')
  const closeFn = lib.split('export async function closePayrollMonth')[1].split('export async function refreshEmployeeClose')[0]
  assert(!closeFn.includes('salary_payments'), 'closePayrollMonth does not write salary_payments')
  assert(lib.includes('export async function payClosedPayroll'), 'pay helper exists')
  const pdf = readFileSync(new URL('../src/lib/generatePDF.js', import.meta.url), 'utf8')
  assert(pdf.includes('payslipAdvanceLines'), 'payslip lists advances')
  assert(!pdf.includes('Jun (\\d+)'), 'no jun/jul regex')
  const ai = readFileSync(new URL('../api/admin-ai.js', import.meta.url), 'utf8')
  assert(ai.includes('record_salary_advance'), 'AI advance tool')
  assert(ai.includes("name: 'close_payroll'"), 'AI close tool')
  assert(ai.includes("name: 'pay_salary'"), 'AI pay tool')
  assert(ai.includes("name: 'adjust_pay_record'"), 'AI adjust tool')
  const salary = readFileSync(new URL('../src/pages/Salary.jsx', import.meta.url), 'utf8')
  assert(salary.includes('payment_date'), 'salary UI stores date')
  assert(salary.includes('refreshEmployeeClose'), 'advance refreshes close')
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
  console.log('✅ close deducts advances, no payment')
  testPayslipNet()
  console.log('✅ payslip net')
  testPeriodsFromPayroll()
  console.log('✅ payroll periods')
  await testCloseVsPayMemory()
  console.log('✅ close vs pay memory')
  testSourceGuards()
  console.log('✅ source guards')
  console.log('\n✅ All payroll close tests passed')
}

main().catch(err => {
  console.error('\n❌', err.message)
  process.exit(1)
})
