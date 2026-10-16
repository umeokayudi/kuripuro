#!/usr/bin/env node
import {
  hoursPastScheduled,
  isOverdueAssignedJob,
  isCriticallyOverdueJob,
  isMissedJob,
  canRegisterLate,
  isRetroJob,
  OVERDUE_SKIP_HOURS,
  OVERDUE_CRITICAL_HOURS,
} from '../src/lib/jobOverdue.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

console.log('=== Job overdue unit tests ===\n')

// Fixed instant: 2026-09-10 18:00 Tokyo
const now = new Date('2026-09-10T18:00:00+09:00')

assert(OVERDUE_SKIP_HOURS === 8, 'skip threshold is 8h')
assert(OVERDUE_CRITICAL_HOURS === 12, 'critical threshold is 12h')

const futureJob = { scheduled_date: '2026-09-10', scheduled_time: '20:00', status: 'assigned' }
assert(hoursPastScheduled(futureJob, now) < 0, 'future job is negative hours')

const onTimeJob = { scheduled_date: '2026-09-10', scheduled_time: '09:00', status: 'assigned' }
assert(hoursPastScheduled(onTimeJob, now) === 9, '9h past 09:00')

assert(isOverdueAssignedJob(onTimeJob, 8, now) === true, '9h assigned job is late at 8h threshold')
assert(!isOverdueAssignedJob({ ...onTimeJob, started_at: 'x' }, 8, now), 'started jobs are not late')

const barelyOk = { scheduled_date: '2026-09-10', scheduled_time: '10:30', status: 'assigned' }
assert(isOverdueAssignedJob(barelyOk, 8, now) === false, '7.5h is not late yet')

// Day turned: yesterday's job is incomplete, not "late", and can't be registered any more
const yesterday = { scheduled_date: '2026-09-09', scheduled_time: '22:00', status: 'assigned' }
assert(isOverdueAssignedJob(yesterday, 8, now) === false, "yesterday's job is not in the late (registrable) state")
assert(isMissedJob(yesterday, now) === true, "yesterday's job is incomplete")
assert(canRegisterLate(yesterday, now) === false, "yesterday's job can't be registered late")
assert(isMissedJob(onTimeJob, now) === false, "today's job is not incomplete yet")
assert(canRegisterLate(onTimeJob, now) === true, "today's late job can still be registered")

// 00:30 job: still registrable at 23:59 the same day, closed at 00:00 the next day
const nightJob = { scheduled_date: '2026-09-10', scheduled_time: '00:30', status: 'assigned' }
assert(canRegisterLate(nightJob, new Date('2026-09-10T23:59:00+09:00')) === true, '23:59 same day still open')
assert(canRegisterLate(nightJob, new Date('2026-09-11T00:00:00+09:00')) === false, 'midnight closes the day')
assert(isMissedJob(nightJob, new Date('2026-09-11T00:00:00+09:00')) === true, 'after midnight it is incomplete')

const completed = { scheduled_date: '2026-09-09', scheduled_time: '09:00', status: 'completed' }
assert(isOverdueAssignedJob(completed, 8, now) === false, 'completed jobs are not late')
assert(isMissedJob(completed, now) === false, 'completed jobs are not incomplete')
assert(isRetroJob({ retro_report: '' }) === true && isRetroJob({ retro_report: null }) === false, 'retro flag follows retro_report')

const criticalJob = { scheduled_date: '2026-09-10', scheduled_time: '05:00', status: 'assigned' }
assert(isCriticallyOverdueJob(criticalJob, now) === true, '13h is critically late')
assert(isCriticallyOverdueJob(barelyOk, now) === false, '7.5h is not critical')

console.log('✅ All job-overdue unit tests passed')
