import { tokyoNow, tokyoToday } from './dates'

export const OVERDUE_SKIP_HOURS = 8
export const OVERDUE_CRITICAL_HOURS = 12

/** Hours elapsed since scheduled date+time (Tokyo). Negative = still in the future. */
export function hoursPastScheduled(job, now = tokyoNow()) {
  if (!job?.scheduled_date) return 0
  const [h, m] = (job.scheduled_time || '00:00').split(':').map(n => parseInt(n, 10) || 0)
  const [y, mo, d] = job.scheduled_date.split('-').map(Number)
  const scheduled = new Date(y, mo - 1, d, h, m, 0, 0).getTime()
  const current = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    0,
    0,
  ).getTime()
  return (current - scheduled) / 3600000
}

/** Assigned job that was not started and is past the skip threshold. */
export function isOverdueAssignedJob(job, thresholdHours = OVERDUE_SKIP_HOURS, now = tokyoNow()) {
  if (!job || job.status !== 'assigned' || job.started_at) return false
  const today = tokyoToday()
  if (job.scheduled_date > today) return false
  if (job.scheduled_date < today) return true
  return hoursPastScheduled(job, now) >= thresholdHours
}

export function isCriticallyOverdueJob(job, now = tokyoNow()) {
  return isOverdueAssignedJob(job, OVERDUE_CRITICAL_HOURS, now)
}
