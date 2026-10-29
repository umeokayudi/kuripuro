import { tokyoToday } from './dates'

/** Latest time a self-planned shift may end (night work finishes by 9 AM). */
export const SHIFT_END_LIMIT = '09:00'
const MAX_SHIFT_MINUTES = 12 * 60

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function tokyoTomorrow() {
  return addDays(tokyoToday(), 1)
}

const toMinutes = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '')
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * Start/end chosen by the employee. The end must fall between 00:01 and 09:00;
 * a start in the evening means the shift crosses midnight.
 */
export function validateShiftWindow(start, end) {
  const s = toMinutes(start), e = toMinutes(end)
  if (s == null || e == null) return { ok: false, error: 'shift_time_invalid' }
  if (e === 0 || e > toMinutes(SHIFT_END_LIMIT)) return { ok: false, error: 'shift_end_after_limit' }
  const minutes = (e - s + 1440) % 1440
  if (minutes === 0 || minutes > MAX_SHIFT_MINUTES) return { ok: false, error: 'shift_time_invalid' }
  return { ok: true, minutes }
}

export function shiftWindowNote(start, end) {
  return `Turno marcado pelo funcionário: ${start}–${end} (terminar até ${SHIFT_END_LIMIT})`
}

/** Assigned jobs after today, soonest first (spot offers still waiting for an answer are left out). */
export function upcomingJobs(jobs, today) {
  return (jobs || [])
    .filter(j => j.scheduled_date > today && ['assigned', 'in_progress'].includes(j.status))
    .filter(j => j.job_category !== 'spot' || j.spot_status === 'accepted')
    .sort((a, b) => `${a.scheduled_date} ${a.scheduled_time || '00:00'}`.localeCompare(`${b.scheduled_date} ${b.scheduled_time || '00:00'}`))
}
