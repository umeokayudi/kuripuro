#!/usr/bin/env node
import { calcEmployeeMonthlySalary, jobMinutes, countWorkedDays } from '../src/lib/salaryCalc.js'
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

async function main() {
  console.log('=== Salary calc unit tests ===\n')
  testJobMinutes()
  console.log('✅ jobMinutes')
  testWorkedDayKey()
  console.log('✅ workedDayKey')
  testFixedSalary()
  console.log('✅ calcEmployeeMonthlySalary (fixed)')
  console.log('\n✅ All salary calc tests passed')
}

main().catch(err => {
  console.error('\n❌', err.message)
  process.exit(1)
})
