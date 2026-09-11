#!/usr/bin/env node
import {
  enrichJobValues,
  employeeEarningsForJob,
  formatShiftElapsed,
  isStaleActiveJob,
  clientValueForJob,
} from '../src/lib/employeePay.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function testEnrichJobValues() {
  const jobs = [{ title: 'Kodama Oimachi — Basic', value: 0, status: 'completed' }]
  const contracts = [{ location_name: 'Kodama Oimachi', price_per_visit: 5000 }]
  const enriched = enrichJobValues(jobs, contracts)
  assert(enriched[0].value === 5000, `expected 5000, got ${enriched[0].value}`)
  assert(enrichJobValues([{ title: 'X', value: 3000 }], contracts)[0].value === 3000, 'keep existing value')
}

function testEmployeeEarnings() {
  const job = { status: 'completed', value: 10000, retro_value: null, started_at: '2026-09-10T01:00:00Z', completed_at: '2026-09-10T02:00:00Z' }
  assert(employeeEarningsForJob(job, { salary_type: 'per_job', job_bonus_rate: 50 }) === 5000, 'per_job 50%')
  assert(employeeEarningsForJob(job, { salary_type: 'hourly', hourly_rate: 1500 }) === 1500, 'hourly 1h')
  assert(employeeEarningsForJob(job, { salary_type: 'fixed', fixed_salary: 220000 }) === 0, 'fixed per-job display')
}

function testFormatShiftElapsed() {
  assert(formatShiftElapsed(45 * 60, 'en') === '45m', 'minutes')
  assert(formatShiftElapsed(2 * 3600 + 15 * 60, 'en') === '2h 15m', 'hours')
  assert(formatShiftElapsed(2 * 86400, 'en').includes('2 day'), 'days')
}

function testIsStaleActiveJob() {
  const job = { status: 'in_progress', scheduled_date: '2026-09-08' }
  assert(isStaleActiveJob(job, '2026-09-10', 100) === true, 'old date')
  assert(isStaleActiveJob({ status: 'in_progress', scheduled_date: '2026-09-10' }, '2026-09-10', 13 * 3600) === true, '12h+')
  assert(isStaleActiveJob({ status: 'assigned', scheduled_date: '2026-09-08' }, '2026-09-10', 100) === false, 'not in progress')
}

function testClientValue() {
  assert(clientValueForJob({ value: 100, retro_value: 200 }) === 200, 'retro wins')
}

async function main() {
  console.log('=== Employee pay unit tests ===\n')
  testEnrichJobValues()
  console.log('✅ enrichJobValues')
  testEmployeeEarnings()
  console.log('✅ employeeEarningsForJob')
  testFormatShiftElapsed()
  console.log('✅ formatShiftElapsed')
  testIsStaleActiveJob()
  console.log('✅ isStaleActiveJob')
  testClientValue()
  console.log('✅ clientValueForJob')
  console.log('\n✅ All employee pay tests passed')
}

main().catch(err => {
  console.error('\n❌', err.message)
  process.exit(1)
})
