import { tokyoNow } from './dates'

export const OVERDUE_SKIP_HOURS = 8
export const OVERDUE_CRITICAL_HOURS = 12

function tokyoParts(date = new Date()) {
  const s = date.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' })
  const [datePart, timePart] = s.split(' ')
  const [y, mo, d] = datePart.split('-').map(Number)
  const [h, m] = (timePart || '00:00:00').split(':').map(n => parseInt(n, 10) || 0)
  return { y, mo, d, h, m }
}

function tokyoDateString(date = new Date()) {
  const p = tokyoParts(date)
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

function tokyoDateTimeMs(dateStr, timeStr = '00:00') {
  const [h, m] = timeStr.split(':').map(n => parseInt(n, 10) || 0)
  return new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`).getTime()
}

/** Hours elapsed since scheduled date+time (Tokyo). Negative = still in the future. */
export function hoursPastScheduled(job, now = tokyoNow()) {
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
export function isOverdueAssignedJob(job, thresholdHours = OVERDUE_SKIP_HOURS, now = tokyoNow()) {
  if (!job || job.status !== 'assigned' || job.started_at) return false
  const today = tokyoDateString(now)
  if (job.scheduled_date > today) return false
  if (job.scheduled_date < today) return true
  return hoursPastScheduled(job, now) >= thresholdHours
}

export function isCriticallyOverdueJob(job, now = tokyoNow()) {
  return isOverdueAssignedJob(job, OVERDUE_CRITICAL_HOURS, now)
}
