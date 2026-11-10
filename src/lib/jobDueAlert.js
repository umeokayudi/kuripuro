// Alert for a spot offer whose time has come but that was not accepted yet.
// It pops up (with vibration, a beep and the voice when it is on) and repeats every
// DUE_ALERT_EVERY_MIN minutes until the worker answers it.
import { hoursPastScheduled, OVERDUE_SKIP_HOURS } from './jobOverdue'

export const DUE_ALERT_EVERY_MIN = 5
// A spot offer is announced this many minutes before its time, so it can be accepted in advance.
export const SPOT_ALERT_BEFORE_MIN = 30

export const isPendingSpot = job => job?.job_category === 'spot' && job?.spot_status === 'pending'

/** Minutes past the scheduled time (negative = still ahead). */
export function minutesPastScheduled(job, now = new Date()) {
  return Math.round(hoursPastScheduled(job, now) * 60)
}

/**
 * Jobs that need the alert now, most urgent first.
 * - spot offers still waiting for an answer, from SPOT_ALERT_BEFORE_MIN before their time;
 * v1.0.198 · no more "time to start / X min late" pop-up for the worker's own scheduled jobs
 * (the owner found it got in the way on Meu dia). The job card on Meu dia still shows it is late.
 */
export function dueAlertJobs(jobs, { activeJobId = null, now = new Date() } = {}) {
  const out = []
  for (const job of jobs || []) {
    if (!job?.scheduled_date || job.id === activeJobId) continue
    if (job.status === 'in_progress' || job.started_at) continue
    const past = minutesPastScheduled(job, now)
    if (isPendingSpot(job)) {
      if (['completed', 'cancelled'].includes(job.status)) continue
      if (past >= -SPOT_ALERT_BEFORE_MIN && past < OVERDUE_SKIP_HOURS * 60) out.push({ job, past, kind: 'accept' })
    }
  }
  return out.sort((a, b) => b.past - a.past)
}

/**
 * Which 5-minute slot the alert for this job is in. The popup fires again each time it changes;
 * "remind me later" just closes it until the next slot.
 */
export function dueAlertSlot(past) {
  return Math.floor(past / DUE_ALERT_EVERY_MIN)
}

/** Fields to save when a spot is accepted: never touches a job that is already running. */
export function acceptSpotUpdate(job, nowIso = new Date().toISOString()) {
  const fields = { spot_status: 'accepted', spot_responded_at: nowIso }
  const running = job?.status === 'in_progress' || (job?.started_at && job?.status !== 'completed')
  if (!running && !['completed', 'cancelled'].includes(job?.status)) fields.status = 'assigned'
  return fields
}

/**
 * A job left with a start time but back on 'assigned' (what the old Accept button did to a
 * running spot job). It was really running, so it is reopened instead of being lost.
 */
export function isBrokenRunningJob(job, now = new Date()) {
  if (!job || job.status !== 'assigned' || !job.started_at || job.completed_at || job.retro_report != null) return false
  return now - new Date(job.started_at) < 24 * 3600 * 1000
}
