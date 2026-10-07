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

/** Last calendar day of YYYY-MM (never invents day 31). */
export function monthLastDate(period) {
  const [y, m] = String(period || '').split('-').map(Number)
  if (!y || !m) return ''
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${String(period).slice(0, 7)}-${String(last).padStart(2, '0')}`
}

export function monthFirstDate(period) {
  return `${String(period).slice(0, 7)}-01`
}

export function completedJobsInMonth(jobs, month, todayStr = tokyoToday()) {
  const start = monthFirstDate(month)
  const end = monthLastDate(month)
  const cap = todayStr && todayStr < end ? todayStr : end
  return (jobs || []).filter(j =>
    j.status === 'completed'
    && j.scheduled_date >= start
    && j.scheduled_date <= cap,
  )
}

export function advanceDate(row) {
  return String(row?.payment_date || row?.received_at || row?.created_at || '').slice(0, 10)
}

export function advancesInPeriod(rows, period) {
  const ym = String(period || '').slice(0, 7)
  const seen = new Set()
  return (rows || [])
    .filter(a => {
      if (a?.payment_type && a.payment_type !== 'advance') return false
      const d = advanceDate(a)
      const inPeriod = a?.period === ym || d.startsWith(ym)
      if (!inPeriod) return false
      const key = a?.id || `${d}-${a?.amount}-${a?.description}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => advanceDate(a).localeCompare(advanceDate(b)))
}

export function payslipAdvanceLines(rows, period) {
  const list = advancesInPeriod(rows, period)
  const lines = list.map(a => ({
    date: advanceDate(a) || '—',
    amount: Number(a.amount || 0),
    description: a.description || 'Advance',
  }))
  return {
    lines,
    total: lines.reduce((s, l) => s + l.amount, 0),
  }
}

export function otherDeductionTotal(payments) {
  return (payments || [])
    .filter(p => p.is_deduction && p.payment_type !== 'advance')
    .reduce((s, d) => s + Number(d.amount || 0), 0)
}

export function payslipNetPay(salaryData, payments, advanceTotal) {
  const scheduled = (payments || [])
    .filter(p => !p.is_deduction && p.payment_type !== 'advance' && p.payment_type !== 'deduction')
    .reduce((s, p) => s + Number(p.amount || 0), 0)
  if (scheduled > 0) return scheduled
  const deds = otherDeductionTotal(payments)
  return Math.max(0, Number(salaryData?.total || 0) - deds - Number(advanceTotal || 0))
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
 * Salary for a YYYY-MM period. Pass the month's last day as todayStr when closing a past month.
 */
export function calcPeriodSalary(empInfo, allJobs, deductionsList = [], period, todayStr = tokyoToday()) {
  const month = String(period || tokyoToday().slice(0, 7)).slice(0, 7)
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

  const currentMonth = tokyoToday().slice(0, 7)
  let remain = 0
  if (month === currentMonth) {
    const now = tokyoNow()
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    for (let d = now.getDate() + 1; d <= daysInMonth; d++) {
      const day = new Date(now.getFullYear(), now.getMonth(), d).getDay()
      if (day !== 0 && day !== 6) remain++
    }
  }

  const total = base + spotEarned
  return {
    period: month,
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
    projected: month === currentMonth
      ? Math.min(base + Math.round(dailyRate * remain), fixedMax)
      : base + spotEarned,
  }
}

/**
 * Employee portal monthly salary breakdown (shared logic).
 */
export function calcEmployeeMonthlySalary(empInfo, allJobs, deductionsList = []) {
  const todayStr = tokyoToday()
  return calcPeriodSalary(empInfo, allJobs, deductionsList, todayStr.slice(0, 7), todayStr)
}
