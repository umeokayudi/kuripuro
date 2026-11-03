// v1.0.133 · ONE count of jobs for every screen (Dashboard, Serviços, Relatórios, Ao vivo, Gerador, World).
// Same definitions everywhere, by the job's scheduled day (Tokyo), cancelled and test jobs out:
//   programados  every job of the period that is not cancelled
//   atribuídos   programados with a person (never more than programados)
//   sem pessoa   programados without a person
//   concluídos   status completed
//   em andamento status in_progress
//   pendentes    programados not completed (assigned + in progress)
//   não começou  pendentes still 'assigned' (not started), today or earlier
//   atrasados    not started and past its time (today, LATE_AFTER_MIN after the hour) or of a past day
import { isTestJob } from './testData.js'
import { coveredJobs } from './jobCoverage.js'
import { tokyoToday, tokyoNow } from './dates.js'
import { isDeadlineJob, isDeadlineLate } from './jobDeadline.js'

export const LATE_AFTER_MIN = 5

const toMin = t => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const nowMinutes = (now = tokyoNow()) => now.getHours() * 60 + now.getMinutes()

export const isCountable = (j, { keepTests = false } = {}) => !!j && j.status !== 'cancelled' && (keepTests || !isTestJob(j))
export const isNotStarted = j => !!j && j.status === 'assigned' && !j.started_at

/**
 * Not started and late: a past day, or today LATE_AFTER_MIN after its time.
 * v1.0.147 · On The Planet night jobs: late = not COMPLETED at 10:00 (running ones too), never by the start.
 */
export function isLateJob(j, today = tokyoToday(), nowMin = nowMinutes()) {
  if (isDeadlineJob(j)) return isDeadlineLate(j, { today, nowMin })
  if (!isNotStarted(j) || !j.scheduled_date) return false
  if (j.scheduled_date < today) return true
  if (j.scheduled_date > today) return false
  const t = toMin(j.scheduled_time)
  return t != null && nowMin - t >= LATE_AFTER_MIN
}

/**
 * @param jobs any jobs (filtered here)
 * @param opts { from, to } (YYYY-MM-DD, inclusive; omit for all), today, nowMin, keepTests
 */
export function countJobs(jobs, { from = null, to = null, today = tokyoToday(), nowMin = nowMinutes(), keepTests = false } = {}) {
  let list = (jobs || []).filter(j => isCountable(j, { keepTests })
    && (!from || (j.scheduled_date && j.scheduled_date >= from))
    && (!to || (j.scheduled_date && j.scheduled_date <= to)))
  // v1.0.148 · a service covered by another person counts once (B's completed job), never as A's pending/late
  const cov = coveredJobs(list)
  if (cov.size) list = list.filter(j => !cov.has(j.id))
  const c = { scheduled: list.length, covered: cov.size, assigned: 0, unassigned: 0, completed: 0, inProgress: 0, pending: 0, notStarted: 0, late: 0, list }
  for (const j of list) {
    if (j.employee_id) c.assigned++; else c.unassigned++
    if (j.status === 'completed') { c.completed++; continue }
    c.pending++
    if (j.status === 'in_progress') c.inProgress++
    if (isNotStarted(j) && j.scheduled_date <= today) c.notStarted++
    if (isLateJob(j, today, nowMin)) c.late++
  }
  return c
}
