#!/usr/bin/env node
import {
  hoursPastScheduled,
  isOverdueAssignedJob,
  isCriticallyOverdueJob,
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

assert(isOverdueAssignedJob(onTimeJob, 8, now) === true, '9h assigned job is overdue at 8h threshold')
assert(isOverdueAssignedJob(onTimeJob, 8, now) && !isOverdueAssignedJob({ ...onTimeJob, started_at: 'x' }, 8, now), 'started jobs are not overdue')

const barelyOk = { scheduled_date: '2026-09-10', scheduled_time: '10:30', status: 'assigned' }
assert(isOverdueAssignedJob(barelyOk, 8, now) === false, '7.5h is not overdue yet')

const yesterday = { scheduled_date: '2026-09-09', scheduled_time: '09:00', status: 'assigned' }
assert(isOverdueAssignedJob(yesterday, 8, now) === true, 'yesterday assigned job is overdue')

const completed = { scheduled_date: '2026-09-09', scheduled_time: '09:00', status: 'completed' }
assert(isOverdueAssignedJob(completed, 8, now) === false, 'completed jobs are not overdue')

const criticalJob = { scheduled_date: '2026-09-10', scheduled_time: '05:00', status: 'assigned' }
assert(isCriticallyOverdueJob(criticalJob, now) === true, '13h is critically overdue')
assert(isCriticallyOverdueJob(barelyOk, now) === false, '7.5h is not critical')

console.log('✅ All job-overdue unit tests passed')
