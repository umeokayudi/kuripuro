#!/usr/bin/env node
import {
  hoursPastScheduled,
  isOverdueAssignedJob,
  isCriticallyOverdueJob,
  OVERDUE_SKIP_HOURS,
  OVERDUE_CRITICAL_HOURS,
  isCarryoverJob,
} from '../src/lib/jobOverdue.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

console.log('=== Job overdue unit tests ===\n')

// Fixed instant: 2026-09-10 18:00 Tokyo
const now = new Date('2026-09-10T18:00:00+09:00')

assert(OVERDUE_SKIP_HOURS === 24, 'skip threshold is 24h')
assert(OVERDUE_CRITICAL_HOURS === 48, 'critical threshold is 48h')

const futureJob = { scheduled_date: '2026-09-10', scheduled_time: '20:00', status: 'assigned' }
assert(hoursPastScheduled(futureJob, now) < 0, 'future job is negative hours')

const onTimeJob = { scheduled_date: '2026-09-10', scheduled_time: '09:00', status: 'assigned' }
assert(hoursPastScheduled(onTimeJob, now) === 9, '9h past 09:00')

assert(isOverdueAssignedJob(onTimeJob, 8, now) === true, '9h assigned job is overdue at 8h threshold')
assert(isOverdueAssignedJob(onTimeJob, 8, now) && !isOverdueAssignedJob({ ...onTimeJob, started_at: 'x' }, 8, now), 'started jobs are not overdue')

const barelyOk = { scheduled_date: '2026-09-10', scheduled_time: '10:30', status: 'assigned' }
assert(isOverdueAssignedJob(barelyOk, 8, now) === false, '7.5h is not overdue yet')

const yesterday = { scheduled_date: '2026-09-09', scheduled_time: '09:00', status: 'assigned' }
assert(isOverdueAssignedJob(yesterday, 8, now) === true, 'yesterday assigned job is overdue at 8h threshold')
// Default 24h window: 9h late is still startable, 33h late is overdue
assert(isOverdueAssignedJob(onTimeJob, undefined, now) === false, '9h late is NOT overdue with the 24h window')
assert(isOverdueAssignedJob(yesterday, undefined, now) === true, '33h late is overdue')
const lastNight = { scheduled_date: '2026-09-09', scheduled_time: '22:00', status: 'assigned' }
assert(isOverdueAssignedJob(lastNight, undefined, now) === false, '20h late (yesterday 22:00) is still inside 24h')
assert(isCarryoverJob(lastNight, '2026-09-10', now) === true, 'yesterday 22:00 job carries over to today')
assert(isCarryoverJob(yesterday, '2026-09-10', now) === false, '33h late does not carry over')
assert(isCarryoverJob(onTimeJob, '2026-09-10', now) === false, "today's job is not a carryover")

const completed = { scheduled_date: '2026-09-09', scheduled_time: '09:00', status: 'completed' }
assert(isOverdueAssignedJob(completed, 8, now) === false, 'completed jobs are not overdue')

const criticalJob = { scheduled_date: '2026-09-10', scheduled_time: '05:00', status: 'assigned' }
assert(isCriticallyOverdueJob(criticalJob, now) === false, '13h is not critical any more')
assert(isCriticallyOverdueJob({ scheduled_date: '2026-09-08', scheduled_time: '09:00', status: 'assigned' }, now) === true, '57h is critically overdue')
assert(isCriticallyOverdueJob(barelyOk, now) === false, '7.5h is not critical')

console.log('✅ All job-overdue unit tests passed')
