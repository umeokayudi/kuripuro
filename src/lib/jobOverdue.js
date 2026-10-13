// Employees can still check in to a job up to 24h after its scheduled time;
// only after that does it turn into "overdue" (cancel or register later).
export const OVERDUE_SKIP_HOURS = 24
export const OVERDUE_CRITICAL_HOURS = 48

function tokyoParts(date = new Date()) {
  const s = date.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' })
  const [datePart, timePart] = s.split(' ')
  const [y, mo, d] = datePart.split('-').map(Number)
  const [h, m] = (timePart || '00:00:00').split(':').map(n => parseInt(n, 10) || 0)
  return { y, mo, d, h, m }
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

/** Assigned job that was not started and is past the skip threshold. */
export function isOverdueAssignedJob(job, thresholdHours = OVERDUE_SKIP_HOURS, now = new Date()) {
  if (!job || job.status !== 'assigned' || job.started_at) return false
  return hoursPastScheduled(job, now) >= thresholdHours
}

/** Assigned job from an earlier day that can still be started (inside the 24h window). */
export function isCarryoverJob(job, today, now = new Date()) {
  if (!job || job.status !== 'assigned' || job.started_at) return false
  if (!job.scheduled_date || job.scheduled_date >= today) return false
  return !isOverdueAssignedJob(job, OVERDUE_SKIP_HOURS, now)
}

export function isCriticallyOverdueJob(job, now = new Date()) {
  return isOverdueAssignedJob(job, OVERDUE_CRITICAL_HOURS, now)
}
