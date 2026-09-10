import { tokyoNow, tokyoToday, workedDayKey } from './dates'

export function jobMinutes(job) {
  if (job?.started_at && job?.completed_at) {
    return (new Date(job.completed_at) - new Date(job.started_at)) / 60000
  }
  if (job?.retro_time_min) return Number(job.retro_time_min)
  return 45
}

export function jobPay(job) {
  return Number(job?.retro_value ?? job?.value ?? 0)
}

export function completedJobsInMonth(jobs, month, todayStr = tokyoToday()) {
  return (jobs || []).filter(j =>
    j.status === 'completed'
    && j.scheduled_date?.startsWith(month)
    && j.scheduled_date <= todayStr,
  )
}

export function countWorkedDays(jobs) {
  const set = new Set()
  for (const j of jobs || []) {
    const key = workedDayKey(j)
    if (key) set.add(key)
  }
  return set.size
}

/**
 * Employee portal monthly salary breakdown (shared logic).
 */
export function calcEmployeeMonthlySalary(empInfo, allJobs, deductionsList = []) {
  const todayStr = tokyoToday()
  const month = todayStr.slice(0, 7)
  const completed = completedJobsInMonth(allJobs, month, todayStr)
  const totalMins = completed.reduce((s, j) => s + jobMinutes(j), 0)
  const spotEarned = completed
    .filter(j => j.job_category === 'spot')
    .reduce((s, j) => s + Number(j.spot_value || 0), 0)
  const deductions = (deductionsList || []).reduce((s, d) => s + Number(d.amount || 0), 0)
  const workedDays = countWorkedDays(completed)
  const fixedMax = empInfo?.fixed_salary || 0
  const monthlyDays = empInfo?.monthly_work_days || 22
  const dailyRate = fixedMax / monthlyDays
  const bonusRate = (empInfo?.job_bonus_rate || 100) / 100

  let base = 0
  if (empInfo?.salary_type === 'fixed') {
    base = Math.min(Math.round(dailyRate * workedDays), fixedMax)
  } else if (empInfo?.salary_type === 'hourly') {
    base = Math.round((totalMins / 60) * (empInfo?.hourly_rate || 0))
  } else if (empInfo?.salary_type === 'per_job') {
    base = completed.reduce((s, j) => s + Math.round(jobPay(j) * bonusRate), 0)
  } else if (empInfo?.salary_type === 'mixed') {
    const fixedPart = Math.min(Math.round(dailyRate * workedDays), fixedMax)
    const hourlyPart = Math.round((totalMins / 60) * (empInfo?.hourly_rate || 0))
    const bonusPart = completed.reduce((s, j) => s + Math.round(jobPay(j) * ((empInfo?.job_bonus_rate || 0) / 100)), 0)
    base = fixedPart + hourlyPart + bonusPart
  } else {
    base = Math.round(fixedMax + (totalMins / 60) * (empInfo?.hourly_rate || 0))
  }

  const now = tokyoNow()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  let remain = 0
  for (let d = now.getDate() + 1; d <= daysInMonth; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), d).getDay()
    if (day !== 0 && day !== 6) remain++
  }

  const total = base + spotEarned
  return {
    jobs: completed.length,
    hours: (totalMins / 60).toFixed(1),
    base,
    spotEarned,
    deductions,
    net: Math.max(0, total - deductions),
    total,
    workedDays,
    fixedMax,
    dailyRate: Math.round(dailyRate),
    projected: Math.min(base + Math.round(dailyRate * remain), fixedMax),
  }
}
