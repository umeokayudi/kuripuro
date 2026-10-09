import { isDeepCleanJob } from './cleaningType'

// Month summary of one cleaning type for the client portal.
// done = completed, scheduled = still to come (today or later),
// missed = date already passed without being completed.
export function summarizeCleaningMonth(jobs, yearMonth, today, deep) {
  const monthJobs = (jobs || []).filter(j =>
    j.scheduled_date?.startsWith(yearMonth)
    && j.status !== 'cancelled'
    && isDeepCleanJob(j) === deep,
  )
  let done = 0, scheduled = 0, missed = 0
  for (const j of monthJobs) {
    if (j.status === 'completed') done += 1
    else if (j.scheduled_date >= today) scheduled += 1
    else missed += 1
  }
  const total = monthJobs.length
  return { total, done, scheduled, missed, notScheduled: 0, pct: total ? Math.round((done / total) * 100) : 0 }
}

// On The Planet deep cleans have a fixed plan: compare against what should happen.
export function deepSummaryFromPlan(deepProgress) {
  const t = deepProgress?.totals
  if (!t || !t.expected) return null
  const done = t.completed || 0
  const scheduled = t.pending || 0
  const notScheduled = Math.max(0, t.expected - (t.scheduled ?? done + scheduled))
  const missed = Math.max(0, t.expected - done - scheduled - notScheduled)
  return { total: t.expected, done, scheduled, missed, notScheduled, pct: Math.round((done / t.expected) * 100) }
}

// Completed cleanings per week of the month (days 1–7, 8–14, …), split by type.
export function weeklyCompleted(jobs, yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const weeks = []
  for (let from = 1; from <= lastDay; from += 7) weeks.push({ from, to: Math.min(lastDay, from + 6), basic: 0, deep: 0 })
  for (const j of jobs || []) {
    if (j.status !== 'completed' || !j.scheduled_date?.startsWith(yearMonth)) continue
    const day = Number(j.scheduled_date.slice(8, 10))
    const week = weeks[Math.floor((day - 1) / 7)]
    if (week) week[isDeepCleanJob(j) ? 'deep' : 'basic'] += 1
  }
  return weeks
}

export function shiftMonth(yearMonth, delta) {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}
