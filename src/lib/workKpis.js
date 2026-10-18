// Work KPIs from job rows: service time, punctuality, GPS check-in and checklist.
// Shared by the employee home ("My progress") and the admin dashboard ("Team").

export const ON_SITE_METERS = 150
export const LATE_GRACE_MIN = 15

const minutesBetween = (a, b) => (new Date(b) - new Date(a)) / 60000

/** Minutes between start and finish, or null when missing or implausible. */
export function jobDurationMin(job) {
  if (!job?.started_at || !job?.completed_at) return null
  const min = minutesBetween(job.started_at, job.completed_at)
  return min >= 1 && min <= 12 * 60 ? Math.round(min) : null
}

/** Minutes late versus the scheduled time (Tokyo). Negative = early. Null when unknown. */
export function startDelayMin(job) {
  if (!job?.started_at || !job?.scheduled_date || !/^\d{1,2}:\d{2}/.test(job.scheduled_time || '')) return null
  const [h, m] = job.scheduled_time.split(':')
  const planned = new Date(`${job.scheduled_date}T${h.padStart(2, '0')}:${m.slice(0, 2)}:00+09:00`)
  const delay = minutesBetween(planned, job.started_at)
  return Math.abs(delay) > 12 * 60 ? null : Math.round(delay)
}

/** 'on_site' | 'away' | 'captured' (position saved, no reference point) | null */
export function gpsCheck(job) {
  if (job?.gps_start_distance != null) return job.gps_start_distance <= ON_SITE_METERS ? 'on_site' : 'away'
  if (job?.start_lat != null) return 'captured'
  return null
}

const avg = list => list.length ? list.reduce((s, v) => s + v, 0) / list.length : null
const pct = (part, total) => total ? Math.round((part / total) * 100) : null

export function summarizeJobs(jobs) {
  const done = (jobs || []).filter(j => j.status === 'completed')
  const durations = done.map(jobDurationMin).filter(v => v != null)
  const delays = done.map(startDelayMin).filter(v => v != null)
  const gps = done.map(gpsCheck).filter(Boolean)
  const checklists = done.filter(j => j.checklist_total > 0)
  const photoScores = done.map(j => j.photo_ai_score).filter(v => v != null)
  return {
    completed: done.length,
    timed: durations.length,
    avgMin: durations.length ? Math.round(avg(durations)) : null,
    totalMin: durations.reduce((s, v) => s + v, 0),
    onTimePct: pct(delays.filter(d => d <= LATE_GRACE_MIN).length, delays.length),
    avgDelayMin: delays.length ? Math.round(avg(delays)) : null,
    gpsPct: pct(gps.filter(g => g !== 'away').length, done.length),
    gpsAway: gps.filter(g => g === 'away').length,
    checklistPct: checklists.length ? Math.round(avg(checklists.map(j => Math.min(1, (j.checklist_done || 0) / j.checklist_total))) * 100) : null,
    photoScore: photoScores.length ? Math.round(avg(photoScores) * 10) / 10 : null,
  }
}

/** One summary per employee, busiest first. */
export function summarizeByEmployee(jobs) {
  const groups = new Map()
  for (const job of jobs || []) {
    if (job.status !== 'completed') continue
    const key = job.employee_id || job.employee_name || '—'
    if (!groups.has(key)) groups.set(key, { id: job.employee_id, name: job.employee_name || '—', jobs: [] })
    groups.get(key).jobs.push(job)
  }
  return [...groups.values()]
    .map(g => ({ id: g.id, name: g.name, ...summarizeJobs(g.jobs) }))
    .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name))
}

const isoWeekStart = iso => {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** Last `weeks` Monday-based weeks ending with the week of `today`, oldest first. */
export function weeklyEvolution(jobs, today, weeks = 8) {
  const current = isoWeekStart(today)
  const keys = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(current + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() - (weeks - 1 - i) * 7)
    return d.toISOString().slice(0, 10)
  })
  return keys.map(key => {
    const inWeek = (jobs || []).filter(j => j.scheduled_date && isoWeekStart(j.scheduled_date) === key)
    return { week: key, ...summarizeJobs(inWeek) }
  })
}

export function formatMinutes(min) {
  if (min == null) return '—'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}
