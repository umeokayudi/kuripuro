#!/usr/bin/env node
import {
  calcEmployeeMonthlySalary,
  calcPeriodSalary,
  jobMinutes,
  countWorkedDays,
  isAdvanceReceived,
  isTransportRow,
  plannedWeeklyAdvances,
  fridaysInMonth,
} from '../src/lib/salaryCalc.js'
import { tokyoToday, workedDayKey } from '../src/lib/dates.js'
import { fmtPeriod, shiftYearMonth, getPeriodDates } from '../src/lib/salaryPeriod.js'

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

function testToPayAfterAdvances() {
  const emp = { salary_type: 'fixed', fixed_salary: 220000, monthly_work_days: 22 }
  const jobs = [
    { status: 'completed', scheduled_date: '2026-08-04', scheduled_time: '10:00', value: 1000 },
    { status: 'completed', scheduled_date: '2026-08-05', scheduled_time: '10:00', value: 1000 },
    { status: 'completed', scheduled_date: '2026-08-11', scheduled_time: '10:00', value: 1000 },
  ]
  const payments = [
    { payment_type: 'advance', amount: 20000, payment_date: '2026-08-07', status: 'paid' },
    { payment_type: 'deduction', amount: 5000, payment_date: '2026-08-10', is_deduction: true },
  ]
  const calc = calcPeriodSalary(emp, jobs, payments, { period: '2026-08', today: '2026-08-20' })
  assert(calc.workedDays === 3, `worked ${calc.workedDays}`)
  assert(calc.base === Math.round(220000 / 22 * 3), `base ${calc.base}`)
  assert(calc.deductions === 5000, `deductions ${calc.deductions}`)
  assert(calc.advancesReceived === 20000, `adv ${calc.advancesReceived}`)
  assert(calc.toPay === Math.max(0, calc.net - 20000), `toPay ${calc.toPay}`)
  assert(calc.toPay === calc.base - 5000 - 20000, '15th = earned - deductions - advances')
}

function testTransportAndBonuses() {
  const emp = { salary_type: 'fixed', fixed_salary: 220000, monthly_work_days: 22, attendance_bonus: 10000 }
  const jobs = Array.from({ length: 22 }, (_, i) => ({
    status: 'completed',
    scheduled_date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    scheduled_time: '10:00',
  }))
  const payments = [
    { payment_type: 'bonus', amount: 3000, payment_date: '2026-08-20' },
    { payment_type: 'extra', amount: 280, payment_date: '2026-08-12', description: 'Transport reimbursement' },
    { payment_type: 'advance', amount: 10000, payment_date: '2026-08-07', status: 'paid' },
  ]
  const calc = calcPeriodSalary(emp, jobs, payments, { period: '2026-08', today: '2026-08-31' })
  assert(calc.attendanceBonus === 10000, `attendance ${calc.attendanceBonus}`)
  assert(calc.bonuses === 3000, `bonuses ${calc.bonuses}`)
  assert(calc.transport === 280, `transport ${calc.transport}`)
  assert(calc.gross === calc.base + 3000 + 10000, `gross ${calc.gross}`)
  assert(calc.toPay === calc.net - 10000 + 280, `toPay ${calc.toPay}`)
  assert(isTransportRow({ payment_type: 'extra', description: 'Transport reimbursement' }), 'extra transport')
  assert(!isTransportRow({ payment_type: 'extra', description: 'Spot extra' }), 'extra without transport')
}

function testAttendanceBonusNeedsFullMonth() {
  const emp = { salary_type: 'fixed', fixed_salary: 220000, monthly_work_days: 22, attendance_bonus: 10000 }
  const jobs = [{ status: 'completed', scheduled_date: '2026-08-04', scheduled_time: '10:00' }]
  const calc = calcPeriodSalary(emp, jobs, [], { period: '2026-08', today: '2026-08-20' })
  assert(calc.attendanceBonus === 0, 'bonus only after full work days')
}

function testAdvanceReceived() {
  assert(isAdvanceReceived({ status: 'paid', payment_date: '2026-09-20' }, '2026-09-16') === true, 'paid is received')
  assert(isAdvanceReceived({ status: 'scheduled', payment_date: '2026-09-10' }, '2026-09-16') === true, 'past date received')
  assert(isAdvanceReceived({ status: 'scheduled', payment_date: '2026-09-20' }, '2026-09-16') === false, 'future still pending')
  assert(isAdvanceReceived({ description: 'Jun 13 advance', payment_date: '2026-06-13' }, '2026-09-16') === true, 'uses payment_date not Jun regex')
}

function testWeeklyPlan() {
  const fridays = fridaysInMonth('2026-09')
  assert(fridays[0] === '2026-09-04', `first friday ${fridays[0]}`)
  assert(fridays.includes('2026-09-25'), 'late friday')
  const emp = { advance_per_week: 15000 }
  const planned = plannedWeeklyAdvances(emp, '2026-09', [{ payment_date: '2026-09-04' }])
  assert(!planned.some(p => p.payment_date === '2026-09-04'), 'skips existing')
  assert(planned.length === fridays.length - 1, `drafts ${planned.length}`)
  assert(plannedWeeklyAdvances({ advance_per_week: 0 }, '2026-09').length === 0, 'no weekly amount')
}

function testPeriodHelpers() {
  assert(shiftYearMonth('2026-01', -1) === '2025-12', 'wrap year')
  const dates = getPeriodDates('2026-09')
  assert(dates.closeDate === '2026-09-30', dates.closeDate)
  assert(dates.payDate === '2026-10-15', dates.payDate)
  assert(fmtPeriod('2026-09', 'ja') === '2026年9月', fmtPeriod('2026-09', 'ja'))
  assert(fmtPeriod('2026-09', 'en') === 'Sep 2026', fmtPeriod('2026-09', 'en'))
}

async function main() {
  console.log('=== Salary calc unit tests ===\n')
  testJobMinutes()
  console.log('✅ jobMinutes')
  testWorkedDayKey()
  console.log('✅ workedDayKey')
  testFixedSalary()
  console.log('✅ calcEmployeeMonthlySalary (fixed)')
  testToPayAfterAdvances()
  console.log('✅ toPay after advances + deductions')
  testTransportAndBonuses()
  console.log('✅ transport, bonuses and completion bonus on 15th')
  testAttendanceBonusNeedsFullMonth()
  console.log('✅ completion bonus waits for full month')
  testAdvanceReceived()
  console.log('✅ isAdvanceReceived uses payment_date')
  testWeeklyPlan()
  console.log('✅ weekly advance plan')
  testPeriodHelpers()
  console.log('✅ period helpers')
  console.log('\n✅ All salary calc tests passed')
}

main().catch(err => {
  console.error('\n❌', err.message)
  process.exit(1)
})
