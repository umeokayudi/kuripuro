#!/usr/bin/env node
import { calcEmployeeMonthlySalary, jobMinutes, countWorkedDays, payrollJobLines } from '../src/lib/salaryCalc.js'
import { tokyoToday, workedDayKey } from '../src/lib/dates.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function testJobMinutes() {
  const live = {
    started_at: '2026-09-10T01:00:00Z',
    completed_at: '2026-09-10T02:30:00Z',
  }
  assert(jobMinutes(live) === 90, `live minutes: ${jobMinutes(live)}`)
  assert(jobMinutes({ retro_time_min: 45 }) === 45, 'retro minutes')
}

function testWorkedDayKey() {
  const night = { scheduled_date: '2026-09-10', scheduled_time: '02:00' }
  assert(workedDayKey(night) === '2026-09-09', `night shift key: ${workedDayKey(night)}`)
  const day = { scheduled_date: '2026-09-10', scheduled_time: '10:00' }
  assert(workedDayKey(day) === '2026-09-10', 'day shift key')
}

function testFixedSalary() {
  const month = tokyoToday().slice(0, 7)
  const jobs = [
    { status: 'completed', scheduled_date: `${month}-05`, scheduled_time: '10:00', value: 1000 },
    { status: 'completed', scheduled_date: `${month}-06`, scheduled_time: '10:00', value: 1000 },
  ]
  const emp = { salary_type: 'fixed', fixed_salary: 220000, monthly_work_days: 22 }
  const result = calcEmployeeMonthlySalary(emp, jobs, [])
  assert(result.workedDays === countWorkedDays(jobs), 'worked days')
  assert(result.base > 0 && result.base <= 220000, `base in range: ${result.base}`)
  assert(result.net === result.total - result.deductions, 'net calc')
}

// v1.0.145 · payroll detail pop-up rows
function testPayrollJobLines() {
  const jobs = [
    { id: 2, status: 'completed', scheduled_date: '2026-10-06', scheduled_time: '10:00', title: 'Shop B — Basic', value: 2000, retro_time_min: 60, address: 'Tokyo 2', client_name: 'Client B' },
    { id: 1, status: 'completed', scheduled_date: '2026-10-05', scheduled_time: '09:00', title: 'Shop A — Deep', value: 1000, retro_time_min: 30, employee_pay: 800 },
    { id: 3, status: 'scheduled', scheduled_date: '2026-10-07', title: 'Shop C', value: 5000 },
    { id: 4, status: 'completed', scheduled_date: '2026-11-01', title: 'Shop D', value: 5000 },
  ]
  const perJob = payrollJobLines({ emp: { salary_type: 'per_job', job_bonus_rate: 50 }, jobs, month: '2026-10' })
  assert(perJob.length === 2 && perJob[0].id === 1, 'rows: only completed in month, sorted by date')
  assert(perJob[0].place === 'Shop A' && perJob[1].address === 'Tokyo 2' && perJob[1].client === 'Client B', 'place / address / client')
  assert(perJob[0].amount === 500 && perJob[1].amount === 1000, `per_job amounts: ${perJob.map(r => r.amount)}`)
  const hourly = payrollJobLines({ emp: { salary_type: 'hourly', hourly_rate: 1200 }, jobs, month: '2026-10' })
  assert(hourly[0].amount === 600 && hourly[1].amount === 1200, `hourly amounts: ${hourly.map(r => r.amount)}`)
  const fixed = payrollJobLines({ emp: { salary_type: 'fixed', fixed_salary: 200000 }, jobs, month: '2026-10', used: 'fixed' })
  assert(fixed.every(r => r.amount === null), 'fixed: no per-job amount')
  const basis = payrollJobLines({ emp: { salary_type: 'fixed' }, jobs, month: '2026-10', used: 'per_job' })
  assert(basis[0].amount === 800 && basis[1].amount === null, 'per_job basis uses employee_pay')
}

async function main() {
  console.log('=== Salary calc unit tests ===\n')
  testJobMinutes()
  console.log('✅ jobMinutes')
  testWorkedDayKey()
  console.log('✅ workedDayKey')
  testPayrollJobLines()
  console.log('✅ payrollJobLines')
  testFixedSalary()
  console.log('✅ calcEmployeeMonthlySalary (fixed)')
  console.log('\n✅ All salary calc tests passed')
}

main().catch(err => {
  console.error('\n❌', err.message)
  process.exit(1)
})
