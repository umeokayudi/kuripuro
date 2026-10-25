// Alert for a job whose time has come but that was not accepted / started yet.
// It pops up (with vibration, a beep and the voice when it is on) and repeats every
// DUE_ALERT_EVERY_MIN minutes until the worker accepts or starts it.
import { hoursPastScheduled, tokyoDateString, OVERDUE_SKIP_HOURS } from './jobOverdue'

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
 * - today's jobs not started yet once their time has come (only while no job is running),
 *   until they turn into the late registration (OVERDUE_SKIP_HOURS).
 */
export function dueAlertJobs(jobs, { activeJobId = null, hasActiveJob = false, now = new Date() } = {}) {
  const today = tokyoDateString(now)
  const out = []
  for (const job of jobs || []) {
    if (!job?.scheduled_date || job.id === activeJobId) continue
    if (job.status === 'in_progress' || job.started_at) continue
    const past = minutesPastScheduled(job, now)
    if (isPendingSpot(job)) {
      if (['completed', 'cancelled'].includes(job.status)) continue
      if (past >= -SPOT_ALERT_BEFORE_MIN && past < OVERDUE_SKIP_HOURS * 60) out.push({ job, past, kind: 'accept' })
    } else if (!hasActiveJob && job.status === 'assigned' && job.scheduled_date === today) {
      if (past >= 0 && past < OVERDUE_SKIP_HOURS * 60) out.push({ job, past, kind: 'start' })
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? b.past - a.past : a.kind === 'accept' ? -1 : 1))
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
