// A job that was not checked in stays open until the end of its own day (Japan time).
// After OVERDUE_SKIP_HOURS it shows as late and the employee can only do the basic
// (retroactive) registration. When the day turns, it is incomplete and can no longer be registered.
export const OVERDUE_SKIP_HOURS = 8
export const OVERDUE_CRITICAL_HOURS = 12

function tokyoParts(date = new Date()) {
  const s = date.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' })
  const [datePart, timePart] = s.split(' ')
  const [y, mo, d] = datePart.split('-').map(Number)
  const [h, m] = (timePart || '00:00:00').split(':').map(n => parseInt(n, 10) || 0)
  return { y, mo, d, h, m }
}

export function tokyoDateString(date = new Date()) {
  const p = tokyoParts(date)
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

function tokyoDateTimeMs(dateStr, timeStr = '00:00') {
  const [h, m] = timeStr.split(':').map(n => parseInt(n, 10) || 0)
  return new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`).getTime()
}

/** Hours elapsed since scheduled date+time (Tokyo). Negative = still in the future. */
export function hoursPastScheduled(job, now = new Date()) {
  if (!job?.scheduled_date) return 0
  const scheduled = tokyoDateTimeMs(job.scheduled_date, job.scheduled_time || '00:00')
  const p = tokyoParts(now)
  const current = tokyoDateTimeMs(
    `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`,
    `${p.h}:${p.m}`,
  )
  return (current - scheduled) / 3600000
}

function notStarted(job) {
  return !!job && job.status === 'assigned' && !job.started_at
}

/** Not started and its day (Tokyo) is over: incomplete, no late registration any more. */
export function isMissedJob(job, now = new Date()) {
  return notStarted(job) && !!job.scheduled_date && job.scheduled_date < tokyoDateString(now)
}

/** Today's job not started and past the threshold: late, only the basic (retroactive) registration is offered. */
export function isOverdueAssignedJob(job, thresholdHours = OVERDUE_SKIP_HOURS, now = new Date()) {
  if (!notStarted(job)) return false
  if (job.scheduled_date !== tokyoDateString(now)) return false
  return hoursPastScheduled(job, now) >= thresholdHours
}

export function isCriticallyOverdueJob(job, now = new Date()) {
  return isOverdueAssignedJob(job, OVERDUE_CRITICAL_HOURS, now)
}

/** Late registration is only allowed on the job's own day (Tokyo). */
export function canRegisterLate(job, now = new Date()) {
  return !!job?.scheduled_date && job.scheduled_date === tokyoDateString(now)
}

/** Completed through the retroactive report instead of a live check-in. */
export function isRetroJob(job) {
  return job?.retro_report != null
}
