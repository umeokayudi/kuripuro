import { locationNameFromTitle } from './cleaningType'
import { jobMinutes } from './salaryCalc'

/** Fill job.value from service_contracts when missing (scheduled jobs often have value=0). */
export function enrichJobValues(jobs, contracts = []) {
  const byLoc = Object.fromEntries(
    (contracts || [])
      .filter(c => c.location_name)
      .map(c => [c.location_name.trim().toLowerCase(), Number(c.price_per_visit || 0)]),
  )
  return (jobs || []).map(j => {
    if (Number(j.value) > 0 || Number(j.retro_value) > 0) return j
    const loc = locationNameFromTitle(j.title).trim().toLowerCase()
    const price = byLoc[loc]
    if (!price) return j
    return { ...j, value: price }
  })
}

/** Client billing amount for a job */
export function clientValueForJob(job) {
  return Number(job?.retro_value ?? job?.value ?? 0)
}

/** What this employee earns from one completed job (display + per_job calc). */
export function employeeEarningsForJob(job, empInfo) {
  if (!job || job.status !== 'completed') return 0
  const type = empInfo?.salary_type || 'fixed'
  const mins = jobMinutes(job)
  const clientVal = clientValueForJob(job)

  if (type === 'hourly') {
    return Math.round((mins / 60) * (empInfo?.hourly_rate || 0))
  }
  if (type === 'per_job') {
    const rate = (empInfo?.job_bonus_rate ?? 100) / 100
    return Math.round(clientVal * rate)
  }
  if (type === 'mixed') {
    return Math.round(clientVal * ((empInfo?.job_bonus_rate || 0) / 100))
  }
  // fixed: monthly — per-job share shown as 0 (use monthly total on home)
  return 0
}

export function salaryTypeLabel(type, lang = 'en') {
  const en = { fixed: 'Monthly fixed', hourly: 'Hourly', per_job: 'Per job', mixed: 'Mixed' }
  const ja = { fixed: '月給', hourly: '時給', per_job: '件数', mixed: '混合' }
  const map = lang === 'ja' ? ja : en
  return map[type] || type
}

/** Human-readable elapsed for stale shifts */
export function formatShiftElapsed(seconds, lang = 'en') {
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    return lang === 'ja' ? `${m}分` : `${m}m`
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return lang === 'ja' ? `${h}時間${m}分` : `${h}h ${m}m`
  }
  const days = Math.floor(seconds / 86400)
  return lang === 'ja' ? `${days}日前に開始` : `Started ${days} day${days > 1 ? 's' : ''} ago`
}

export function isStaleActiveJob(job, today, elapsedSeconds) {
  if (!job || job.status !== 'in_progress') return false
  if (job.scheduled_date && job.scheduled_date !== today) return true
  return elapsedSeconds >= 12 * 3600
}
